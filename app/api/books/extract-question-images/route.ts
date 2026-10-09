import { getQuestionFileBookById } from "@/lib/db-question-files";
import {
  ensureQuestionFilePages,
  getNextPendingQuestionFilePage,
  getQuestionFilePageRange,
  insertExtractedQuestionImage,
  listQuestionsForImageOwnership,
  markQuestionFilePageComplete,
  markQuestionFilePageFailed,
  saveImageOwnerDecision,
} from "@/lib/db-question-file-images";
import {
  buildQuestionFilePageImageMessages,
  decideImageOwner,
  PAGE_IMAGE_CLASSIFICATION_MAX_TOKENS,
  pageQuestionCandidates,
  parseQuestionFilePageImageVerdict,
  questionFilePageImageResponseSchema,
} from "@/lib/question-file-analysis";
import { invokeLLM, DEFAULT_VISION_MODEL } from "@/lib/llm";
import { repairBrokenQuestionsOnPage } from "@/lib/question-repair-run";
import { transientAiRetryDelaySeconds } from "@/lib/ai/types";
import { claimQuestionFilePage } from "@/lib/queue/claim";
import { publishMessage } from "@/lib/queue/client";
import { storageGetSignedUrl, storagePut } from "@/lib/storage";
import { getScreenshotUnderLimit } from "@/lib/pdf-screenshot";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { NextResponse } from "next/server";
// Must be imported before "pdf-parse" — see app/api/books/extract/route.ts.
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

// Multimodal question-files pipeline, stage 2 — mirrors
// app/api/books/analyze-page-visuals/route.ts closely: screenshot each page,
// classify it with a cheap vision call, keep only the pages that actually
// contain a real figure. Self-chaining (per-book Flow Control key,
// parallelism 1) exactly like that route, so every page of even a very long
// PDF is eventually processed — never silently stopping after the first
// batch.
//
// Each figure's owner is decided right here, per page
// (lib/question-file-analysis.ts's decideImageOwner): the page's questions
// (from stage 1) → the model's reading of the LAYOUT, among those questions
// only → a link to ONE question when the structure or a confident verdict
// supports it; otherwise no link and the candidates are flagged for the
// doctor. A cover / introduction / answer-key page is never looked at.
// Stage 3 (explanations) is started after every batch of pages, not only
// at the end: it takes the questions whose pages are settled
// (getNextPendingExtractedQuestion) and stops when it reaches the page
// front, so students get explanations from the first minutes of a long
// file.
const PAGES_PER_INVOCATION = 12;

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
    console.error("[QuestionFiles] Image body parse failed", error);
    return NextResponse.json(
      { error: "تعذر تجهيز هذا الملف." },
      { status: 502 }
    );
  }

  const book = await getQuestionFileBookById(bookId);
  if (!book) {
    return NextResponse.json({ bookId, status: "skipped" });
  }

  // First invocation for this book — creates one question_file_pages row per
  // PDF page (idempotent: only inserts rows that don't already exist), so
  // getNextPendingQuestionFilePage below always has real, claimable rows for
  // every page, same convention as bookPages being created up front.
  await ensureQuestionFilePages(bookId, book.pageCount);
  const questionRange = await getQuestionFilePageRange(bookId);
  const questions = await listQuestionsForImageOwnership(bookId);

  let parser: PDFParse | undefined;
  // Set when the AI service failed in a way that passes: the batch stops
  // there and the next one waits (see app/api/books/analyze-page-visuals).
  let retryDelay: number | null = null;
  try {
    for (let i = 0; i < PAGES_PER_INVOCATION; i++) {
      const candidate = await getNextPendingQuestionFilePage(bookId);
      if (!candidate) break;

      const claimed = await claimQuestionFilePage(candidate.id);
      if (!claimed) continue; // lost the race to another delivery — move on

      // A page no question covers (cover, introduction, contents, answer
      // key): never classified, so its pictures can't become question
      // images — and no AI call is spent on it.
      if (
        !questionRange ||
        candidate.pageNumber < questionRange.first ||
        candidate.pageNumber > questionRange.last
      ) {
        await markQuestionFilePageComplete(candidate.id);
        continue;
      }

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
        if (!shot?.dataUrl) {
          throw new Error("Page screenshot generation failed");
        }

        // 🩹 A question of this page the text parser could not put together
        // is read again from the picture, so it reaches the student
        // instead of staying held back (lib/question-repair.ts).
        await repairBrokenQuestionsOnPage({
          bookId,
          pageNumber: candidate.pageNumber,
          pageCount: book.pageCount,
          parser,
          pageImage: shot.dataUrl,
        });

        const pageCandidates = pageQuestionCandidates(
          questions,
          candidate.pageNumber
        );
        const response = await invokeLLM({
          model: DEFAULT_VISION_MODEL,
          max_tokens: PAGE_IMAGE_CLASSIFICATION_MAX_TOKENS,
          messages: buildQuestionFilePageImageMessages(
            candidate.pageNumber,
            shot.dataUrl,
            pageCandidates
          ),
          response_format: questionFilePageImageResponseSchema,
        });
        const verdict = parseQuestionFilePageImageVerdict(
          response.choices[0]?.message.content
        );

        if (verdict.hasImage && shot.data) {
          const decision = decideImageOwner(pageCandidates, verdict);
          // Cover art / decoration: not stored at all.
          if (decision.kind !== "none") {
            const { key: storageKey } = await storagePut(
              `question-files/${bookId}/${candidate.pageNumber}.png`,
              shot.data,
              "image/png"
            );
            const image = await insertExtractedQuestionImage(
              bookId,
              candidate.pageNumber,
              storageKey,
              verdict.isAtPageEnd
            );
            await saveImageOwnerDecision(
              image.id,
              candidate.pageNumber,
              decision
            );
          }
        }

        await markQuestionFilePageComplete(candidate.id);
      } catch (pageError) {
        console.error(
          `[QuestionFiles] Page ${candidate.pageNumber} image classification failed`,
          pageError
        );
        await markQuestionFilePageFailed(
          candidate.id,
          "تعذر تحليل صور هذه الصفحة."
        );
        retryDelay = transientAiRetryDelaySeconds(
          pageError,
          claimed.attemptCount
        );
        if (retryDelay !== null) break;
      }
    }

    const remaining = await getNextPendingQuestionFilePage(bookId);
    if (remaining) {
      // Explanations for the questions behind the page front. Best-effort:
      // the last batch starts stage 3 again for whatever is left.
      try {
        await publishMessage(
          { type: "generate_question_file_content", bookId },
          {
            flowControl: {
              key: `question-file-content-${bookId}`,
              parallelism: 1,
            },
          }
        );
      } catch (error) {
        console.error("[QuestionFiles] Could not start explanations", error);
      }
      await publishMessage(
        { type: "extract_question_file_images", bookId },
        {
          flowControl: {
            key: `question-file-images-${bookId}`,
            parallelism: 1,
          },
          ...(retryDelay !== null ? { delay: retryDelay } : {}),
        }
      );
      return NextResponse.json({ bookId, status: "processing" });
    }

    // Every page has reached a terminal status (each figure's owner was
    // decided with its page) — stage 3 takes over per-question enrichment.
    await publishMessage({ type: "generate_question_file_content", bookId });
    return NextResponse.json({ bookId, status: "images_done" });
  } catch (error) {
    console.error("[QuestionFiles] Image pipeline failed", error);
    return NextResponse.json(
      { error: "تعذر تحليل صور هذا الملف." },
      { status: 502 }
    );
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
