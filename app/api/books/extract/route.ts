import {
  finalizeBookExtraction,
  getBookById,
  markBookExtractionFailed,
  updateBookExtractionProgress,
  upsertBookPagesText,
  type BookPageText,
} from "@/lib/db-books";
import { findMissingPageNumbers, normalizePageText } from "@/lib/pdf-cards";
import { ocrPages } from "@/lib/pdf-ocr";
import { publishMessage } from "@/lib/queue/client";
import { getQueueMaxAttempts } from "@/lib/queue/types";
import { storageGetSignedUrl } from "@/lib/storage";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { NextResponse } from "next/server";
// Must be imported before "pdf-parse" — see app/api/pdf/extract/route.ts for why.
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

// Processes at most one OCR batch per invocation, then self-chains via
// QStash — keeps each invocation's AI-call volume bounded and progress
// checkpointed (a mid-book failure only loses the current batch, not the
// whole extraction), same reasoning as app/api/mirror/extract/route.ts.
const OCR_BATCH_SIZE = 12;

// Same exponential shape as lib/queue/client.ts's RETRY_DELAY_FORMULA
// (10 * 3^n, capped) — applied here as an explicit publish `delay` because
// this self-chain call returns 200 (a *successful* round that still has
// failing pages to retry), so QStash's own failure-retryDelay never applies
// to it. A round with zero failures (just more pages left in a big book)
// publishes immediately — no reason to slow down a healthy book.
const OCR_RETRY_BACKOFF_CAP_SECONDS = 90;
function ocrRetryBackoffSeconds(attemptNumber: number): number {
  return Math.min(
    OCR_RETRY_BACKOFF_CAP_SECONDS,
    10 * 3 ** Math.max(0, attemptNumber - 1)
  );
}

// كتبي's counterpart to app/api/mirror/extract/route.ts — see that file's
// comment for the full design. extract-and-plan creates a bare book row
// (status "extracting") and publishes one extract_book_job message; this
// worker does the PDF text-extraction + OCR, resuming across invocations via
// the book's own pageTexts/pagesNeedingOcr staging columns until every page
// either succeeds or permanently exhausts its own OCR retry budget (tracked
// per-page in ocrAttemptCounts — see schema comment), then runs
// detectChapters() (finalizeBookExtraction) and hands off to the existing
// analyze_book_chapter workers. A page that never got usable text is never
// allowed to fail the WHOLE book: finalizeBookExtraction still creates a
// real book_pages row for it (textStatus "failed"), individually retryable
// afterward (see app/api/books/retry-page-text) — only a book where the PDF
// itself couldn't be parsed at all (zero pages, nothing to salvage) becomes
// "failed" outright.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  const verified = await verifyQStashRequest(rawBody, signature, request);
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let bookId: string;
  let book: Awaited<ReturnType<typeof getBookById>>;
  try {
    const body = JSON.parse(rawBody) as { bookId?: string };
    bookId = typeof body.bookId === "string" ? body.bookId : "";
    if (!bookId) {
      return NextResponse.json(
        { error: "معرف الكتاب مفقود." },
        { status: 200 }
      );
    }

    book = await getBookById(bookId);
    if (!book) {
      return NextResponse.json({ bookId, status: "skipped" });
    }
    if (book.status !== "extracting") {
      return NextResponse.json({ bookId, status: "already_done" });
    }
  } catch (error) {
    console.error("[Books] Extraction lookup failed", error);
    return NextResponse.json(
      { error: "تعذر تجهيز هذا الكتاب." },
      { status: 502 }
    );
  }

  let parser: PDFParse | undefined;
  try {
    const signedGetUrl = await storageGetSignedUrl(book.fileKey ?? "");
    parser = new PDFParse({ url: signedGetUrl, CanvasFactory });

    let pages: BookPageText[];
    let pagesNeedingOcr: number[];
    let ocrFailedPages: number[];
    let ocrAttemptCounts: Record<string, number>;
    let totalPages: number;

    if (!book.pageTexts) {
      const result = await parser.getText();
      pages = result.pages.map(page => {
        const text = normalizePageText(page.text);
        return { page: page.num, text, hasText: text.length > 0 };
      });
      totalPages = result.total;

      if (!pages.length) {
        // Nothing at all could be parsed — there is no partial content to
        // salvage, so (unlike every other failure path below) this is a
        // genuine whole-book failure.
        await markBookExtractionFailed(
          bookId,
          "تعذر قراءة أي صفحة من هذا الملف."
        );
        return NextResponse.json({ bookId, status: "failed" });
      }

      // A page number pdf-parse never returned at all (rare parser gap) is
      // folded into the OCR retry queue rather than treated as an immediate,
      // separate failure — getScreenshotUnderLimit renders by page number
      // directly, independent of getText()'s own output, so it's worth a
      // real attempt before giving up on it.
      const missing = findMissingPageNumbers(pages, totalPages);
      for (const pageNumber of missing) {
        pages.push({ page: pageNumber, text: "", hasText: false });
      }
      pages.sort((a, b) => a.page - b.page);

      pagesNeedingOcr = pages
        .filter(page => !page.hasText)
        .map(page => page.page);
      ocrFailedPages = [];
      ocrAttemptCounts = {};
      await updateBookExtractionProgress(bookId, {
        pageCount: totalPages,
        pageTexts: pages,
        pagesNeedingOcr,
        ocrFailedPages,
        ocrAttemptCounts,
      });

      // Pages with real embedded text are already final — persist them as
      // readable book_pages rows right away instead of waiting for OCR (if
      // any) on the rest of the book to finish.
      const readyNow = pages.filter(page => page.hasText);
      if (readyNow.length) {
        await upsertBookPagesText(
          bookId,
          readyNow.map(page => ({
            page: page.page,
            text: page.text,
            textStatus: "complete",
          }))
        );
      }
    } else {
      pages = book.pageTexts;
      pagesNeedingOcr = book.pagesNeedingOcr ?? [];
      ocrFailedPages = book.ocrFailedPages ?? [];
      ocrAttemptCounts = book.ocrAttemptCounts ?? {};
      totalPages = book.pageCount;
    }

    if (pagesNeedingOcr.length) {
      const maxAttempts = getQueueMaxAttempts();
      const batch = pagesNeedingOcr.slice(0, OCR_BATCH_SIZE);
      const { pages: ocrResults, failedPages } = await ocrPages(parser, batch);
      const ocrByPage = new Map(ocrResults.map(page => [page.page, page]));
      pages = pages.map(page => {
        const ocrResult = ocrByPage.get(page.page);
        return ocrResult
          ? {
              page: page.page,
              text: ocrResult.text,
              hasText: ocrResult.hasText,
            }
          : page;
      });

      // Per-page retry budget — deliberately NOT the book's own
      // extractionAttemptCount (that counts worker invocations, which scale
      // with book size, not with actual failures; see schema comment on
      // ocrAttemptCounts). A page only gives up permanently once IT has
      // failed maxAttempts times.
      const stillRetryable: number[] = [];
      const newlyPermanentFailed: number[] = [];
      for (const failedPage of failedPages) {
        const key = String(failedPage);
        const attempts = (ocrAttemptCounts[key] ?? 0) + 1;
        ocrAttemptCounts[key] = attempts;
        if (attempts >= maxAttempts) newlyPermanentFailed.push(failedPage);
        else stillRetryable.push(failedPage);
      }
      ocrFailedPages = [...ocrFailedPages, ...newlyPermanentFailed];

      const succeededPages = new Set(
        batch.filter(pageNumber => !failedPages.includes(pageNumber))
      );
      if (succeededPages.size) {
        await upsertBookPagesText(
          bookId,
          pages
            .filter(page => succeededPages.has(page.page))
            .map(page => ({
              page: page.page,
              text: page.text,
              textStatus: "complete",
            }))
        );
      }
      // Pages that just gave up permanently are persisted as failed (and
      // individually retryable — see app/api/books/retry-page-text)
      // immediately, not only once the whole book eventually finalizes.
      if (newlyPermanentFailed.length) {
        await upsertBookPagesText(
          bookId,
          newlyPermanentFailed.map(pageNumber => ({
            page: pageNumber,
            text: "",
            textStatus: "failed",
            errorMessage: "تعذّرت قراءة هذه الصفحة ضوئيًا بعد عدة محاولات.",
          }))
        );
      }

      const remainingOcr = [
        ...pagesNeedingOcr.slice(OCR_BATCH_SIZE),
        ...stillRetryable,
      ];
      await updateBookExtractionProgress(bookId, {
        pageTexts: pages,
        pagesNeedingOcr: remainingOcr,
        ocrFailedPages,
        ocrAttemptCounts,
      });

      if (remainingOcr.length) {
        const highestAttemptThisRound = Math.max(
          0,
          ...stillRetryable.map(
            pageNumber => ocrAttemptCounts[String(pageNumber)] ?? 0
          )
        );
        await publishMessage(
          { type: "extract_book_job", bookId },
          {
            flowControl: { key: `books-extract-${bookId}`, parallelism: 1 },
            ...(stillRetryable.length
              ? { delay: ocrRetryBackoffSeconds(highestAttemptThisRound) }
              : {}),
          }
        );
        return NextResponse.json({
          bookId,
          status: "extracting",
          remaining: remainingOcr.length,
        });
      }
    }

    // Every page has now either succeeded or permanently exhausted its OCR
    // retry budget — finalize with whatever we have. A book with some
    // permanently-failed pages still finalizes (as "pending", proceeding to
    // chapter analysis); finalizeBookIfDone later rolls the book up to
    // "partial_failed" once chapter analysis + visual analysis also settle.
    const ocrFailedSet = new Set(ocrFailedPages);
    const finalPages = pages.map(page => ({
      page: page.page,
      text: page.text,
      textStatus: (ocrFailedSet.has(page.page) ? "failed" : "complete") as
        | "failed"
        | "complete",
      errorMessage: ocrFailedSet.has(page.page)
        ? "تعذّرت قراءة هذه الصفحة ضوئيًا بعد عدة محاولات."
        : undefined,
    }));

    const { chapters } = await finalizeBookExtraction(bookId, finalPages);

    try {
      await Promise.all(
        chapters.map(chapter =>
          publishMessage({
            type: "analyze_book_chapter",
            chapterId: chapter.id,
            bookId,
          })
        )
      );
    } catch (publishError) {
      console.error(
        "[Books] Failed to enqueue chapters after extraction",
        publishError
      );
      return NextResponse.json(
        { error: "تعذر بدء تحليل الفصول." },
        { status: 502 }
      );
    }

    // Kicks off the page-visual pipeline (images/diagrams/tables) — entirely
    // independent of chapter analysis above, never blocks/delays it. A
    // failure to enqueue this is logged but doesn't fail the extraction
    // response itself: chapters/cards are already usable, and the coverage
    // report (books.getCoverageReport) will simply show visual processing
    // stuck at 0 until an admin/student retries or it's re-triggered.
    try {
      await publishMessage(
        { type: "analyze_book_page_visuals", bookId },
        { flowControl: { key: `books-visual-${bookId}`, parallelism: 1 } }
      );
    } catch (publishError) {
      console.error(
        "[Books] Failed to enqueue page visual analysis",
        publishError
      );
    }

    return NextResponse.json({
      bookId,
      status: "extracted",
      chapterCount: chapters.length,
      failedPageCount: ocrFailedPages.length,
    });
  } catch (error) {
    console.error("[Books] Extraction failed", error);
    return NextResponse.json(
      { error: "تعذر قراءة الملف أو تقسيمه إلى فصول." },
      { status: 502 }
    );
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
