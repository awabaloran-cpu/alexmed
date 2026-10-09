import { getQuestionFileBookById } from "@/lib/db-question-files";
import {
  getExtractedQuestionImages,
  getNextPendingExtractedQuestion,
  getQuestionsHeldBack,
  markExtractedQuestionAiFailed,
  saveExtractedQuestionEnrichment,
} from "@/lib/db-question-file-images";
import {
  buildExtractedQuestionEnrichmentMessages,
  extractedQuestionEnrichmentResponseSchema,
  extractedQuestionEnrichmentWithTranslationResponseSchema,
  parseExtractedQuestionEnrichment,
  type ExtractedQuestionTranslation,
} from "@/lib/question-file-analysis";
import { isArabicText } from "@/lib/question-extraction";
import { invokeLLM, DEFAULT_VISION_MODEL } from "@/lib/llm";
import { transientAiRetryDelaySeconds } from "@/lib/ai/types";
import { claimExtractedQuestion } from "@/lib/queue/claim";
import { publishMessage } from "@/lib/queue/client";
import { getQuestionExplainConcurrency } from "@/lib/queue/types";
import { storageGetSignedUrl } from "@/lib/storage";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { NextResponse } from "next/server";

// Multimodal question-files pipeline, stage 3 — the final stage, run
// automatically for EVERY extracted question (image-bearing or not, per
// product decision), producing keywords/aiExplanationAr/inferredAnswerIndex.
// Self-chaining (per-book Flow Control key, parallelism 1) so a file with
// hundreds of questions is never silently cut off partway through. Started
// by stage 2 after each batch of pages: it only ever sees the questions
// whose pages are settled; when none is ready but some are still held back
// by a page, it looks again shortly rather than ending. Needs no
// access to the source PDF itself — an image-bearing question's screenshot
// was already uploaded to object storage in stage 2, so this only ever
// signs a GET url for that already-stored key.
//
// Several questions are explained at once (getQuestionExplainConcurrency):
// one at a time, a 160-question file took about six minutes of two-second
// AI calls.
const QUESTIONS_PER_INVOCATION = 24;
// How long to wait before looking again for questions a page holds back.
const HELD_BACK_RECHECK_SECONDS = 120;

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
    console.error("[QuestionFiles] Content body parse failed", error);
    return NextResponse.json(
      { error: "تعذر تجهيز هذا الملف." },
      { status: 502 }
    );
  }

  const book = await getQuestionFileBookById(bookId);
  if (!book) {
    return NextResponse.json({ bookId, status: "skipped" });
  }

  // Set when the AI service failed in a way that passes: no more questions
  // are taken, and the next run waits (see extract-question-images).
  let retryDelay: number | null = null;
  try {
    // Questions are taken one at a time, in file order (each pick reads the
    // next one and claims it, so two workers never hold the same question);
    // the AI calls, where the time goes, run side by side.
    let taken = 0;
    let picking: Promise<unknown> = Promise.resolve();
    const pick = () => {
      const turn = picking.then(async () => {
        while (taken < QUESTIONS_PER_INVOCATION && retryDelay === null) {
          const candidate = await getNextPendingExtractedQuestion(bookId);
          if (!candidate) return null;
          taken++;
          const claimed = await claimExtractedQuestion(candidate.id);
          // Lost the race to another delivery — take the next one.
          if (claimed) return { candidate, claimed };
        }
        return null;
      });
      picking = turn.catch(() => null);
      return turn;
    };

    const explain = async ({
      candidate,
      claimed,
    }: NonNullable<Awaited<ReturnType<typeof pick>>>) => {
      try {
        const images = await getExtractedQuestionImages(candidate.id);
        // v1 associates at most one image per question (see
        // lib/question-file-analysis.ts's associateImagesWithQuestions) —
        // reading through the many-to-many table regardless so a future
        // multi-image pass needs no change here beyond using images[1+].
        const image = images[0];
        const imageUrl = image
          ? await storageGetSignedUrl(image.storageKey)
          : null;

        const hasStatedAnswer = !!candidate.extractedAnswerText;
        // Translate only what the file itself didn't give in Arabic — a
        // bilingual file (or an Arabic-only one) is never re-translated.
        const optionCount = candidate.options?.length ?? 0;
        const missingQuestionAr =
          !candidate.questionTextAr && !isArabicText(candidate.questionText);
        const missingOptionsAr =
          optionCount > 0 &&
          !candidate.optionsAr &&
          !isArabicText(candidate.questionText);
        const translate = missingQuestionAr || missingOptionsAr;
        const response = await invokeLLM({
          model: DEFAULT_VISION_MODEL,
          max_tokens: translate ? 1600 : 800,
          messages: buildExtractedQuestionEnrichmentMessages(
            {
              questionText: candidate.questionText,
              options: candidate.options,
              extractedAnswerText: candidate.extractedAnswerText,
              explanationText: candidate.explanationText,
            },
            imageUrl,
            { translate }
          ),
          response_format: translate
            ? extractedQuestionEnrichmentWithTranslationResponseSchema
            : extractedQuestionEnrichmentResponseSchema,
        });
        const enrichment = parseExtractedQuestionEnrichment(
          response.choices[0]?.message.content
        ) as ReturnType<typeof parseExtractedQuestionEnrichment> &
          Partial<ExtractedQuestionTranslation>;

        const questionAr =
          missingQuestionAr && typeof enrichment.questionAr === "string"
            ? enrichment.questionAr.trim()
            : "";
        const optionsAr =
          missingOptionsAr &&
          Array.isArray(enrichment.optionsAr) &&
          enrichment.optionsAr.length === optionCount
            ? enrichment.optionsAr.map(option => String(option).trim())
            : undefined;

        await saveExtractedQuestionEnrichment(candidate.id, {
          keywords: enrichment.keywords,
          aiExplanationAr: enrichment.explanationAr,
          inferredAnswerIndex: enrichment.inferredAnswerIndex,
          hasStatedAnswer,
          mnemonicAr:
            typeof enrichment.mnemonicAr === "string"
              ? enrichment.mnemonicAr
              : null,
          ...(questionAr || optionsAr
            ? {
                translation: {
                  ...(questionAr ? { questionTextAr: questionAr } : {}),
                  ...(optionsAr ? { optionsAr } : {}),
                },
              }
            : {}),
        });
      } catch (questionError) {
        console.error(
          `[QuestionFiles] Question ${candidate.id} AI enrichment failed`,
          questionError
        );
        await markExtractedQuestionAiFailed(
          candidate.id,
          "تعذر توليد الشرح والكلمات المفتاحية لهذا السؤال."
        );
        retryDelay ??= transientAiRetryDelaySeconds(
          questionError,
          claimed.attemptCount
        );
      }
    };

    const worker = async () => {
      for (let next = await pick(); next; next = await pick()) {
        await explain(next);
      }
    };
    await Promise.all(
      Array.from({ length: getQuestionExplainConcurrency() }, worker)
    );

    const remaining = await getNextPendingExtractedQuestion(bookId);
    if (remaining) {
      await publishMessage(
        { type: "generate_question_file_content", bookId },
        {
          flowControl: {
            key: `question-file-content-${bookId}`,
            parallelism: 1,
          },
          ...(retryDelay !== null ? { delay: retryDelay } : {}),
        }
      );
      return NextResponse.json({ bookId, status: "processing" });
    }

    // Nothing to explain right now is not the end while questions are
    // still held back by a page: look again shortly, and if the page stage
    // has gone quiet with pages left, start it again too.
    const heldBack = await getQuestionsHeldBack(bookId);
    if (heldBack.waiting > 0) {
      if (heldBack.pagesStalled) {
        await publishMessage(
          { type: "extract_question_file_images", bookId },
          {
            flowControl: {
              key: `question-file-images-${bookId}`,
              parallelism: 1,
            },
          }
        );
      }
      await publishMessage(
        { type: "generate_question_file_content", bookId },
        {
          flowControl: {
            key: `question-file-content-${bookId}`,
            parallelism: 1,
          },
          delay: HELD_BACK_RECHECK_SECONDS,
        }
      );
      return NextResponse.json({ bookId, status: "waiting_for_pages" });
    }

    return NextResponse.json({ bookId, status: "done" });
  } catch (error) {
    console.error("[QuestionFiles] Content pipeline failed", error);
    return NextResponse.json(
      { error: "تعذر توليد محتوى الذكاء الاصطناعي لهذا الملف." },
      { status: 502 }
    );
  }
}
