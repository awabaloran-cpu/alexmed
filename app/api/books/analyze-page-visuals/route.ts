import {
  finalizeBookIfDone,
  getBookById,
  getNextPendingBookPage,
  markBookPageVisualFailed,
  updateBookPageVisualResult,
} from "@/lib/db-books";
import { replaceSafeBookPageVisualAssets } from "@/lib/chapter-visual-context";
import {
  buildPageVisualMessages,
  PAGE_VISUAL_MAX_TOKENS,
  PAGE_VISUAL_MODEL,
  pageVisualResponseSchema,
  parsePageVisualAnalysis,
} from "@/lib/book-page-visual-analysis";
import { invokeLLM } from "@/lib/llm";
import { transientAiRetryDelaySeconds } from "@/lib/ai/types";
import { claimBookPageVisual } from "@/lib/queue/claim";
import { publishMessage } from "@/lib/queue/client";
import { storageGetSignedUrl, storagePut } from "@/lib/storage";
import {
  findRepeatedMarks,
  pageMayHoldVisual,
  readPageDrawing,
} from "@/lib/pdf-page-drawing";
import { getScreenshotUnderLimit } from "@/lib/pdf-screenshot";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { NextResponse } from "next/server";
// Must be imported before "pdf-parse" — see app/api/books/extract/route.ts for why.
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

// Processes at most PAGES_PER_INVOCATION pages (each its own screenshot +
// vision-model call) then self-chains — keeps each invocation's AI-call
// volume bounded, same OCR_BATCH_SIZE convention as
// app/api/books/extract/route.ts.
const PAGES_PER_INVOCATION = 12;

// كتبي's page-level visual pipeline — runs on EVERY page of every book,
// always (product decision), entirely independent of and never blocking
// text extraction/chapter analysis (see app/api/books/extract/route.ts,
// which publishes the first analyze_book_page_visuals message right after
// finalizeBookExtraction, alongside — not before — the chapter messages).
// Self-chaining: this route claims and processes a few pending pages, then
// republishes itself (per-book Flow Control key, parallelism 1, so the same
// book's pages are never processed by two overlapping invocations) until no
// pending pages remain, then checks whether the whole book can finalize.
//
// A page that paints no picture, drawing or ruled table
// (lib/pdf-page-drawing.ts) has nothing for a vision model to describe —
// its words are already in the text layer. Its image is still stored for
// the reader; only the AI call is left out.
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
      return NextResponse.json(
        { error: "معرف الكتاب مفقود." },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error("[Books] Page-visual body parse failed", error);
    return NextResponse.json(
      { error: "تعذر تجهيز هذا الكتاب." },
      { status: 502 }
    );
  }

  const book = await getBookById(bookId);
  if (!book) {
    return NextResponse.json({ bookId, status: "skipped" });
  }

  let parser: PDFParse | undefined;
  let repeatedMarks: Set<string> | undefined;
  let textOnlyPages = 0;
  // Set when the AI service failed in a way that passes (an outage, a rate
  // limit, an open circuit): the batch stops there and the next one waits,
  // so a page's attempts are spread over minutes instead of spent at once.
  let retryDelay: number | null = null;
  try {
    for (let i = 0; i < PAGES_PER_INVOCATION; i++) {
      const candidate = await getNextPendingBookPage(bookId);
      if (!candidate) break;

      const claimed = await claimBookPageVisual(candidate.id);
      if (!claimed) continue; // lost the race to another delivery — move on

      try {
        if (!parser) {
          const signedGetUrl = await storageGetSignedUrl(book.fileKey ?? "");
          parser = new PDFParse({ url: signedGetUrl, CanvasFactory });
        }

        const shot = await getScreenshotUnderLimit(
          parser,
          candidate.pageNumber,
          { imageBuffer: true }
        );
        if (!shot?.dataUrl || !shot.data) {
          throw new Error("Page screenshot generation failed");
        }

        const { key: storageKey } = await storagePut(
          `book-pages/${bookId}/${candidate.pageNumber}.png`,
          shot.data,
          "image/png"
        );

        repeatedMarks ??= await findRepeatedMarks(parser);
        const mayHoldVisual = pageMayHoldVisual(
          await readPageDrawing(parser, candidate.pageNumber, repeatedMarks)
        );
        if (!mayHoldVisual) {
          textOnlyPages++;
          await updateBookPageVisualResult(candidate.id, {
            storageKey,
            width: shot.width,
            height: shot.height,
            hasImages: false,
            hasTables: false,
            hasDiagrams: false,
            visualStatus: "complete",
          });
          continue;
        }

        const response = await invokeLLM({
          model: PAGE_VISUAL_MODEL,
          max_tokens: PAGE_VISUAL_MAX_TOKENS,
          messages: buildPageVisualMessages(
            candidate.pageNumber,
            candidate.extractedText ?? "",
            shot.dataUrl
          ),
          response_format: pageVisualResponseSchema,
        });
        const analysis = parsePageVisualAnalysis(
          response.choices[0]?.message.content
        );

        const hasImages = analysis.visuals.some(
          v => v.assetType === "image" || v.assetType === "screenshot"
        ) || analysis.extractedText.trim().length > 0;
        const hasTables = analysis.visuals.some(v => v.assetType === "table");
        const hasDiagrams = analysis.visuals.some(
          v => v.assetType === "diagram" || v.assetType === "chart"
        );

        await updateBookPageVisualResult(candidate.id, {
          storageKey,
          width: shot.width,
          height: shot.height,
          extractedText: analysis.extractedText || undefined,
          hasImages,
          hasTables,
          hasDiagrams,
          visualStatus: analysis.reviewStatus,
        });

        const assets = [...analysis.visuals];
        if (analysis.extractedText.trim()) {
          assets.push({
            assetType: "screenshot",
            descriptionAr: `نص مقروء من الصورة: ${analysis.extractedText}`,
            descriptionEn: `Text read from the page image: ${analysis.extractedText}`,
            confidence: analysis.confidence,
            needsReview: analysis.reviewStatus === "needs_review",
          });
        }
        if (assets.length) {
          const normalizedAssets = assets.map(v => ({
              assetType: v.assetType,
              storageKey,
              descriptionAr: v.descriptionAr,
              descriptionEn: v.descriptionEn,
              confidence: v.confidence,
              reviewStatus: v.needsReview
                ? ("needs_review" as const)
                : ("complete" as const),
            }));
          await replaceSafeBookPageVisualAssets(
            candidate.id,
            bookId,
            candidate.chapterId,
            normalizedAssets,
          );
        }
      } catch (pageError) {
        // One page's failure doesn't fail this whole invocation or the
        // book — it just needs a manual retry (books.retryPageVisual). No
        // automatic QStash-level retry for a single page's error, since
        // this route processes several pages per invocation and always
        // acks (200) once it's done its batch.
        console.error(
          `[Books] Page ${candidate.pageNumber} visual analysis failed`,
          pageError
        );
        await markBookPageVisualFailed(
          candidate.id,
          "تعذر تحليل هذه الصفحة بصريًا."
        );
        retryDelay = transientAiRetryDelaySeconds(
          pageError,
          claimed.attemptCount
        );
        if (retryDelay !== null) break;
      }
    }

    if (textOnlyPages) {
      console.warn(
        JSON.stringify({
          event: "book_text_only_pages",
          bookId,
          skipped: textOnlyPages,
        })
      );
    }
    const remaining = await getNextPendingBookPage(bookId);
    if (remaining) {
      await publishMessage(
        { type: "analyze_book_page_visuals", bookId },
        {
          flowControl: { key: `books-visual-${bookId}`, parallelism: 1 },
          ...(retryDelay !== null ? { delay: retryDelay } : {}),
        }
      );
      return NextResponse.json({ bookId, status: "processing" });
    }

    await finalizeBookIfDone(bookId);
    return NextResponse.json({ bookId, status: "done" });
  } catch (error) {
    console.error("[Books] Page visual pipeline failed", error);
    return NextResponse.json(
      { error: "تعذر تحليل صفحات هذا الكتاب بصريًا." },
      { status: 502 }
    );
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
