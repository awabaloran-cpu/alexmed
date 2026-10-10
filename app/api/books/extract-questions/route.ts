import {
  updateBookExtractionProgress,
  type BookPageText,
} from "@/lib/db-books";
import {
  convertQuestionFileToBook,
  getQuestionFileBookById,
  isProtectedQuestionSetBook,
  markQuestionFileComplete,
  markQuestionFileFailed,
  saveExtractedQuestions,
} from "@/lib/db-question-files";
import { findMissingPageNumbers, normalizePageText } from "@/lib/pdf-cards";
import { ocrPages, OCR_PAGES_PER_BATCH } from "@/lib/pdf-ocr";
import { analyzeQuestionDocument } from "@/lib/question-extraction";
import { isBookNotQuestions } from "@/lib/question-file-quality";
import { claimBookExtraction, releaseBookExtraction } from "@/lib/queue/claim";
import { storageGetSignedUrl } from "@/lib/storage";
import { publishMessage } from "@/lib/queue/client";
import { getQueueMaxAttempts } from "@/lib/queue/types";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { NextResponse } from "next/server";
// Must be imported before "pdf-parse" — see app/api/books/extract/route.ts.
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

// Same backoff / lease re-check as app/api/books/extract/route.ts.
const OCR_RETRY_BACKOFF_CAP_SECONDS = 90;
const LEASE_RECHECK_DELAY_SECONDS = 60;
function ocrRetryBackoffSeconds(attemptNumber: number): number {
  return Math.min(
    OCR_RETRY_BACKOFF_CAP_SECONDS,
    10 * 3 ** Math.max(0, attemptNumber - 1)
  );
}

function selfChain(bookId: string, delay?: number) {
  return publishMessage(
    { type: "extract_question_file_job", bookId },
    {
      flowControl: {
        key: `question-file-extract-${bookId}`,
        parallelism: 1,
      },
      ...(delay ? { delay } : {}),
    }
  );
}

// Question-file worker (every question file: a student's, or a doctor's
// protected set). Stage 1 reads the PDF's embedded text; any page WITHOUT
// text (a scanned / image-only page) is read with the same OCR the study-book
// pipeline uses (lib/pdf-ocr.ts), in batches of OCR_PAGES_PER_BATCH per
// invocation, resuming across invocations through the book's own
// pageTexts / pagesNeedingOcr / ocrAttemptCounts staging columns — exactly
// app/api/books/extract/route.ts's design, under the same exclusive lease
// (claimBookExtraction). A text PDF never calls OCR at all.
//
// Once every page has text (or has permanently exhausted its OCR retry
// budget), the questions are parsed exactly as before (pure regex, no AI —
// lib/question-extraction.ts) and stages 2+3 (images, enrichment) start.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  const verified = await verifyQStashRequest(rawBody, signature, request);
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let bookId: string;
  try {
    const body = JSON.parse(rawBody) as { bookId?: string };
    bookId = typeof body.bookId === "string" ? body.bookId : "";
    if (!bookId) {
      return NextResponse.json({ error: "معرف الملف مفقود." }, { status: 200 });
    }
  } catch (error) {
    console.error("[QuestionFiles] Invalid job payload", error);
    return NextResponse.json({ error: "طلب غير صالح." }, { status: 200 });
  }

  const book = await getQuestionFileBookById(bookId);
  if (!book) {
    return NextResponse.json({ bookId, status: "skipped" });
  }
  if (book.status !== "extracting") {
    return NextResponse.json({ bookId, status: "already_done" });
  }

  // One invocation at a time per file (a duplicate delivery or a slow OCR
  // batch must not run twice); the loser re-checks later instead of
  // dropping what may be the file's only message.
  if (!(await claimBookExtraction(bookId))) {
    await selfChain(bookId, LEASE_RECHECK_DELAY_SECONDS);
    return NextResponse.json({ bookId, status: "lease_held" });
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
      if (!totalPages && !pages.length) {
        await markQuestionFileFailed(
          bookId,
          "تعذر قراءة أي صفحة من هذا الملف."
        );
        return NextResponse.json({ bookId, status: "failed" });
      }
      for (const pageNumber of findMissingPageNumbers(pages, totalPages)) {
        pages.push({ page: pageNumber, text: "", hasText: false });
      }
      pages.sort((a, b) => a.page - b.page);
      pagesNeedingOcr = pages.filter(p => !p.hasText).map(p => p.page);
      ocrFailedPages = [];
      ocrAttemptCounts = {};
      if (pagesNeedingOcr.length) {
        await updateBookExtractionProgress(bookId, {
          pageCount: totalPages,
          pageTexts: pages,
          pagesNeedingOcr,
          ocrFailedPages,
          ocrAttemptCounts,
        });
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
      const batch = pagesNeedingOcr.slice(0, OCR_PAGES_PER_BATCH);
      const { pages: ocrResults, failedPages } = await ocrPages(parser, batch);
      const ocrByPage = new Map(ocrResults.map(page => [page.page, page]));
      pages = pages.map(page => {
        const ocr = ocrByPage.get(page.page);
        return ocr
          ? { page: page.page, text: ocr.text, hasText: ocr.hasText }
          : page;
      });

      // Per-page retry budget (see app/api/books/extract/route.ts).
      const stillRetryable: number[] = [];
      for (const failedPage of failedPages) {
        const key = String(failedPage);
        const attempts = (ocrAttemptCounts[key] ?? 0) + 1;
        ocrAttemptCounts[key] = attempts;
        if (attempts >= maxAttempts) ocrFailedPages.push(failedPage);
        else stillRetryable.push(failedPage);
      }
      const remainingOcr = [
        ...pagesNeedingOcr.slice(OCR_PAGES_PER_BATCH),
        ...stillRetryable,
      ];
      await updateBookExtractionProgress(bookId, {
        pageCount: totalPages,
        pageTexts: pages,
        pagesNeedingOcr: remainingOcr,
        ocrFailedPages,
        ocrAttemptCounts,
      });

      if (remainingOcr.length) {
        // Hand the file back BEFORE publishing the next step, so that step
        // never finds this invocation's lease still live.
        await releaseBookExtraction(bookId);
        const highestAttempt = Math.max(
          0,
          ...stillRetryable.map(p => ocrAttemptCounts[String(p)] ?? 0)
        );
        await selfChain(
          bookId,
          stillRetryable.length
            ? ocrRetryBackoffSeconds(highestAttempt)
            : undefined
        );
        return NextResponse.json({
          bookId,
          status: "extracting",
          remaining: remainingOcr.length,
        });
      }
    }

    const readable = pages
      .filter(page => page.hasText && page.text.trim().length > 0)
      .map(page => ({ page: page.page, text: page.text }));

    if (!readable.length) {
      await markQuestionFileFailed(
        bookId,
        "تعذرت قراءة نص هذا الملف حتى بعد القراءة الضوئية. تأكد من وضوح الصفحات وجرّب نسخة أوضح."
      );
      return NextResponse.json({ bookId, status: "failed" });
    }

    // Document understanding first (lib/question-document.ts): cover /
    // front matter / answer key are never parsed as questions, and an
    // incomplete block is held back instead of saved.
    //
    // A student's own file is taken as it is: a question the file gives
    // with one option, or none, is kept and shown, not held back. A
    // doctor's set keeps the strict reading — the doctor reviews those.
    const protectedSet = await isProtectedQuestionSetBook(bookId);
    const analysis = analyzeQuestionDocument(readable, {
      acceptIncompleteOptions: !protectedSet,
    });
    const questions = analysis.questions;

    // 📚 A study book uploaded under "questions" is started as a book — the
    // same row and stored file — instead of being refused or shown as a
    // few stray lines. The file is handed back first, so the book worker
    // never finds this run's lease still live.
    if (
      !protectedSet &&
      isBookNotQuestions({
        textPages: readable.length,
        blocks: questions.length + analysis.needsReview.length,
        valid: questions.length,
        answerable: questions.filter(q => (q.options?.length ?? 0) >= 2).length,
      })
    ) {
      await releaseBookExtraction(bookId);
      if (await convertQuestionFileToBook(bookId)) {
        console.warn(
          JSON.stringify({
            event: "question_file_converted_to_book",
            bookId,
            textPages: readable.length,
            valid: questions.length,
            heldBack: analysis.needsReview.length,
          })
        );
        await publishMessage(
          { type: "extract_book_job", bookId },
          { flowControl: { key: `books-extract-${bookId}`, parallelism: 1 } }
        );
        return NextResponse.json({ bookId, status: "converted_to_book" });
      }
    }

    if (analysis.needsReview.length) {
      console.warn(
        JSON.stringify({
          event: "question_file_needs_review",
          bookId,
          valid: questions.length,
          needsReview: analysis.needsReview.length,
          reasons: [...new Set(analysis.needsReview.flatMap(q => q.reasons))],
        })
      );
    }
    if (!questions.length) {
      await markQuestionFileFailed(
        bookId,
        "تعذر التعرف على أي أسئلة بالتنسيق المتوقع (نص السؤال، ثم الخيارات A، B، C…). جرّب ملفًا آخر أو تواصل معنا."
      );
      return NextResponse.json({ bookId, status: "failed" });
    }

    // Valid questions AND needs-review blocks (with their reasons), in file
    // order — the doctor reviews the latter; students never see them.
    await saveExtractedQuestions(bookId, analysis.all);
    await markQuestionFileComplete(bookId, totalPages);

    // Multimodal pipeline, stages 2+3 (lib/question-file-analysis.ts) — a
    // separate, additive, best-effort background pass; the file is already
    // "complete" above and the base questions are already usable regardless
    // of how this later job goes.
    await publishMessage({ type: "extract_question_file_images", bookId });

    return NextResponse.json({
      bookId,
      status: "complete",
      questionCount: questions.length,
    });
  } catch (error) {
    console.error("[QuestionFiles] Extraction failed", error);
    await markQuestionFileFailed(
      bookId,
      "تعذرت قراءة هذا الملف. حاول إعادة المعالجة."
    );
    return NextResponse.json(
      { error: "تعذر استخراج الأسئلة من هذا الملف." },
      { status: 502 }
    );
  } finally {
    await releaseBookExtraction(bookId).catch(() => undefined);
    await parser?.destroy().catch(() => undefined);
  }
}
