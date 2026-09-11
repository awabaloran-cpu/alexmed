import {
  BOOK_CHAPTER_MAX_TOKENS,
  SUMMARY_MERGE_MAX_TOKENS,
  bookChapterResponseSchema,
  buildChapterAnalysisMessages,
  buildSummaryMergeMessages,
  chunkChapterPages,
  mergeSubChunkResults,
  parseChapterAnalysis,
  parseSummaryMerge,
  summaryMergeResponseSchema,
  type BookPageInput,
} from "@/lib/book-analysis";
import { AiRateLimitError } from "@/lib/ai/types";
import {
  completeChapterAnalysis,
  finalizeBookIfDone,
  getChapterById,
  markBookChapterFailedTerminal,
  markBookChapterRetrying,
} from "@/lib/db-books";
import { invokeLLM } from "@/lib/llm";
import { isUserConcurrencyExceeded } from "@/lib/queue/concurrency";
import { claimBookChapter } from "@/lib/queue/claim";
import { getQueueMaxAttempts } from "@/lib/queue/types";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { NextResponse } from "next/server";

// Vercel Hobby's hard ceiling for a serverless function is 60s regardless of
// this value. Note this route can still exceed 60s for chapters split into
// multiple sub-chunks (each sub-chunk is its own sequential AI call) — a
// known limitation, unchanged by the queue migration (QStash will simply
// retry the whole chapter if the function itself times out).
export const maxDuration = 60;

// The كتبي worker (QStash queue migration): analyzes exactly ONE chapter
// (internally sub-chunked if it's long) and persists the full result before
// returning. This route is no longer callable by the browser — it's invoked
// only by QStash, verified via signature below — see
// app/books/[bookId]/page.tsx, which now just polls chapter status instead
// of driving analysis itself.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  const verified = await verifyQStashRequest(rawBody, signature, request);
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let chapterId: string;
  let chapter: Awaited<ReturnType<typeof getChapterById>>;
  let claimed: Awaited<ReturnType<typeof claimBookChapter>>;
  try {
    const body = JSON.parse(rawBody) as { chapterId?: string };
    chapterId = typeof body.chapterId === "string" ? body.chapterId : "";
    if (!chapterId) {
      return NextResponse.json({ error: "معرف الفصل مفقود." }, { status: 200 });
    }

    chapter = await getChapterById(chapterId);
    if (!chapter) {
      return NextResponse.json({ chapterId, status: "skipped" });
    }

    // Per-user concurrency backstop, checked BEFORE claiming — so one
    // student's book can't monopolize capacity. The row stays claimable
    // (nothing mutated), QStash redelivers later per its own backoff.
    if (await isUserConcurrencyExceeded(chapter.userId, "books")) {
      return NextResponse.json(
        { chapterId, status: "throttled" },
        { status: 429 }
      );
    }

    claimed = await claimBookChapter(chapterId);
    if (!claimed) {
      // Already processing/complete — QStash is at-least-once, this is
      // expected occasionally, not an error.
      return NextResponse.json({ chapterId, status: "already_processing" });
    }
  } catch (error) {
    // Anything before the claim (malformed body, a transient DB error) is
    // safe to let QStash retry — nothing has been claimed/mutated yet.
    console.error("[Books] Chapter lookup/claim failed", error);
    return NextResponse.json(
      { error: "تعذر تجهيز هذا الفصل." },
      { status: 502 }
    );
  }

  const pages = (chapter.pageTexts ?? []) as BookPageInput[];
  const maxAttempts = getQueueMaxAttempts();

  async function retryOrFail(errorMessage: string, httpStatus: number) {
    if (claimed!.attemptCount >= maxAttempts) {
      await markBookChapterFailedTerminal(chapterId, errorMessage);
      await finalizeBookIfDone(chapter!.bookId);
      return NextResponse.json({
        chapterId,
        status: "failed",
        error: errorMessage,
      });
    }
    await markBookChapterRetrying(chapterId, errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: httpStatus });
  }

  if (!pages.length) {
    return await retryOrFail("لا يوجد نص مستخرج لهذا الفصل.", 422);
  }

  try {
    const subChunks = chunkChapterPages(pages);
    const subChunkResults = [];
    for (const chunk of subChunks) {
      const response = await invokeLLM({
        max_tokens: BOOK_CHAPTER_MAX_TOKENS,
        messages: buildChapterAnalysisMessages(
          chapter.title,
          chunk,
          chapter.bookProfile
        ),
        response_format: bookChapterResponseSchema,
      });
      subChunkResults.push(
        parseChapterAnalysis(response.choices[0]?.message.content)
      );
    }

    const merged = mergeSubChunkResults(subChunkResults);

    // Reject (not coerce) any card/MCQ whose sourcePage falls outside this
    // chapter's own page range — same data-integrity guard مِرآة (generate-
    // batch) and مكتبة الأدمن already have; كتبي never had it until now.
    const flashcards = merged.flashcards.filter(
      card =>
        card.sourcePage >= chapter.startPage &&
        card.sourcePage <= chapter.endPage
    );
    const mcqs = merged.mcqs.filter(
      mcq =>
        mcq.sourcePage >= chapter.startPage && mcq.sourcePage <= chapter.endPage
    );

    let chapterSummary = merged.summaries[0] ?? "";
    if (merged.summaries.length > 1) {
      const summaryResponse = await invokeLLM({
        max_tokens: SUMMARY_MERGE_MAX_TOKENS,
        messages: buildSummaryMergeMessages(merged.summaries, merged.keyPoints),
        response_format: summaryMergeResponseSchema,
      });
      chapterSummary = parseSummaryMerge(
        summaryResponse.choices[0]?.message.content
      ).chapterSummary;
    }

    await completeChapterAnalysis(chapterId, chapter.userId, {
      explanationAr: merged.explanationAr,
      explanationEn: merged.explanationEn,
      keyPoints: merged.keyPoints,
      chapterSummary,
      terms: merged.medicalTerms,
      cards: flashcards,
      mcqs,
    });
    await finalizeBookIfDone(chapter.bookId);

    return NextResponse.json({ chapterId, status: "complete" });
  } catch (error) {
    console.error("[Books] Chapter analysis failed", error);
    if (error instanceof AiRateLimitError) {
      if (claimed.attemptCount >= maxAttempts) {
        await markBookChapterFailedTerminal(
          chapterId,
          "تجاوزنا الحد المؤقت لمزوّد الذكاء الاصطناعي."
        );
        await finalizeBookIfDone(chapter.bookId);
        return NextResponse.json({ chapterId, status: "failed" });
      }
      await markBookChapterRetrying(
        chapterId,
        "تجاوزنا الحد المؤقت لمزوّد الذكاء الاصطناعي."
      );
      return NextResponse.json(
        { error: "تجاوزنا الحد المؤقت لمزوّد الذكاء الاصطناعي." },
        { status: 429 }
      );
    }
    return await retryOrFail("تعذر تحليل هذا الفصل.", 502);
  }
}
