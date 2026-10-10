// Data-access layer for the multimodal question-files pipeline (stage 2:
// per-page image capture/classification, stage 3: per-question AI
// enrichment) — kept separate from lib/db-question-files.ts (which owns the
// original PR16 text-extraction CRUD) since this is purely additive,
// best-effort background enrichment layered on top: a question file's
// books.status stays "complete" the moment text extraction finishes (PR16
// behavior, unchanged), independent of how far these two later stages have
// gotten. Same getDb()-singleton, ownership-agnostic-for-workers conventions
// as lib/db-books.ts.
import { and, asc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  extractedQuestionImageRelations,
  extractedQuestionImages,
  extractedQuestions,
  questionFilePages,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  questionPageRange,
  type ImageOwnerDecision,
} from "./question-file-analysis";
import { inQuestionWindow, type QuestionWindow } from "./question-file-window";

// The pages a window's questions need: a question's own page and the one
// after it (where a figure at the foot of the question, or the rest of a
// question cut by the page break, sits). `page` is the page-number column.
function pageOfWindow(bookId: string, window: QuestionWindow, page: SQL): SQL {
  return sql`exists (
    select 1 from "extracted_questions" wq
    where wq."bookId" = ${bookId}
      and ${inQuestionWindow(window, sql`wq."orderIndex"`)}
      and ${page} between wq."sourcePage" and wq."sourcePage" + 1
  )`;
}

// Ensures a `question_file_pages` row exists for every page 1..pageCount —
// called once, right when stage 2 starts, so getNextPendingQuestionFilePage
// below has a real row to claim for every page, same as bookPages rows all
// being created up front by finalizeBookExtraction.
export async function ensureQuestionFilePages(
  bookId: string,
  pageCount: number
): Promise<void> {
  if (pageCount <= 0) return;
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select({ pageNumber: questionFilePages.pageNumber })
    .from(questionFilePages)
    .where(eq(questionFilePages.bookId, bookId));
  const existingPageNumbers = new Set(existing.map(row => row.pageNumber));

  const missing = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    if (!existingPageNumbers.has(pageNumber)) {
      missing.push({ bookId, pageNumber });
    }
  }
  if (missing.length) {
    await db.insert(questionFilePages).values(missing);
  }
}

// Pages the file's questions actually cover (stage 1 has already run) —
// stage 2 only looks for figures there.
export async function getQuestionFilePageRange(bookId: string) {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select({ sourcePage: extractedQuestions.sourcePage })
    .from(extractedQuestions)
    .where(eq(extractedQuestions.bookId, bookId));
  return questionPageRange(rows.map(row => row.sourcePage));
}

// With a window (lib/question-file-window.ts) only the pages its questions
// need are handed out; the rest stay pending until a student gets near.
export async function getNextPendingQuestionFilePage(
  bookId: string,
  window?: QuestionWindow | null
) {
  const maxAttempts = 3;
  const db = getDb();
  if (!db) return null;
  const [page] = await db
    .select()
    .from(questionFilePages)
    .where(
      and(
        eq(questionFilePages.bookId, bookId),
        inArray(questionFilePages.status, ["pending", "failed"]),
        sql`${questionFilePages.attemptCount} < ${maxAttempts}`,
        window
          ? pageOfWindow(
              bookId,
              window,
              sql`"question_file_pages"."pageNumber"`
            )
          : undefined
      )
    )
    .orderBy(asc(questionFilePages.pageNumber))
    .limit(1);
  return page ?? null;
}

export async function markQuestionFilePageComplete(
  pageId: string
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(questionFilePages)
    .set({ status: "complete", errorMessage: null, updatedAt: new Date() })
    .where(eq(questionFilePages.id, pageId));
}

export async function markQuestionFilePageFailed(
  pageId: string,
  errorMessage: string
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(questionFilePages)
    .set({ status: "failed", errorMessage, updatedAt: new Date() })
    .where(eq(questionFilePages.id, pageId));
}

export async function insertExtractedQuestionImage(
  bookId: string,
  pageNumber: number,
  storageKey: string,
  isAtPageEnd: boolean
): Promise<{ id: string }> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .insert(extractedQuestionImages)
    .values({ bookId, pageNumber, storageKey, isAtPageEnd })
    .returning({ id: extractedQuestionImages.id });
  return row;
}

// The file's questions (all of them, needs-review included — they still
// occupy their pages) for working out which questions a page holds.
export async function listQuestionsForImageOwnership(bookId: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      id: extractedQuestions.id,
      sourcePage: extractedQuestions.sourcePage,
      orderIndex: extractedQuestions.orderIndex,
      questionText: extractedQuestions.questionText,
    })
    .from(extractedQuestions)
    .where(eq(extractedQuestions.bookId, bookId));
}

// Persists one page figure's decision (lib/question-file-analysis.ts's
// decideImageOwner): a link to exactly ONE question, or — when the layout
// isn't clear enough — no link, and its candidate questions flagged
// "check_image" for the doctor (a needs-review block keeps its status).
export async function saveImageOwnerDecision(
  imageId: string,
  pageNumber: number,
  decision: ImageOwnerDecision
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  if (decision.kind === "question") {
    await db
      .insert(extractedQuestionImageRelations)
      .values({ questionId: decision.questionId, imageId })
      .onConflictDoNothing();
    return;
  }
  if (decision.kind === "review" && decision.questionIds.length) {
    await db
      .update(extractedQuestions)
      .set({
        reviewStatus: "check_image",
        reviewReason: `ambiguous_image_page_${pageNumber}`,
      })
      .where(
        and(
          inArray(extractedQuestions.id, decision.questionIds),
          sql`${extractedQuestions.reviewStatus} is null`
        )
      );
  }
}

// The next question stage 3 should explain, in file order.
//
// Stage 3 runs WHILE stage 2 is still walking the pages (a 5,000-page bank
// spends hours there, and students were left without explanations for all
// of it). A question is only handed out once every page that could still
// give it a picture is settled, so its explanation is as image-aware as
// before: pages are taken in order, so that means every question before
// the last one that starts ahead of the first unsettled page. (That last
// one may run onto the unsettled page — lib/question-file-analysis.ts's
// pageQuestionCandidates.) With no unsettled page there is no bound.
//
// Table names are written out: ${table.column} renders unqualified here
// and would bind to the inner table.
export async function getNextPendingExtractedQuestion(
  bookId: string,
  window?: QuestionWindow | null
) {
  const maxAttempts = 3;
  const db = getDb();
  if (!db) return null;
  // A page stage 2 has yet to finish. One left "processing" by a crashed
  // run stops counting after a while, as stage 2 itself never returns to it.
  const unsettledPage = sql`p."bookId" = ${bookId} and (
    p."status" = 'pending'
    or (p."status" = 'failed' and p."attemptCount" < ${maxAttempts})
    or (p."status" = 'processing' and p."updatedAt" > now() - interval '10 minutes')
  )`;
  const [question] = await db
    .select()
    .from(extractedQuestions)
    .where(
      and(
        eq(extractedQuestions.bookId, bookId),
        inArray(extractedQuestions.aiStatus, ["pending", "failed"]),
        sql`${extractedQuestions.aiAttemptCount} < ${maxAttempts}`,
        // With a window, pages are no longer settled front to back, so each
        // question waits for its own two pages instead of for a page front.
        window
          ? sql`(
          ${inQuestionWindow(window, sql`"extracted_questions"."orderIndex"`)}
          and not exists (
            select 1 from "question_file_pages" p where ${unsettledPage}
              and p."pageNumber" between "extracted_questions"."sourcePage"
                and "extracted_questions"."sourcePage" + 1
          )
        )`
          : undefined,
        window
          ? undefined
          : sql`(
          not exists (select 1 from "question_file_pages" p where ${unsettledPage})
          or "extracted_questions"."orderIndex" < (
            select max(q2."orderIndex") from "extracted_questions" q2
            where q2."bookId" = ${bookId}
              and q2."orderIndex" < coalesce(
                (
                  select min(q3."orderIndex") from "extracted_questions" q3
                  where q3."bookId" = ${bookId}
                    and q3."sourcePage" >= (
                      select min(p."pageNumber") from "question_file_pages" p
                      where ${unsettledPage}
                    )
                ),
                2147483647
              )
          )
        )`
      )
    )
    .orderBy(asc(extractedQuestions.orderIndex))
    .limit(1);
  return question ?? null;
}

// What stage 3 leaves behind when it finds nothing to explain right now:
// how many questions are still owed an explanation (held back by a page
// stage 2 has not settled), and whether stage 2 itself looks dead — pages
// still to do, and none of the file's pages touched for a few minutes.
//
// Both happened to a real file (2026-10-09): a server restart killed the
// runs holding two pages, stage 3 stopped at the first of them with half
// the file unexplained, and nothing ever started either stage again.
export async function getQuestionsHeldBack(
  bookId: string,
  window?: QuestionWindow | null
): Promise<{ waiting: number; pagesStalled: boolean }> {
  const maxAttempts = 3;
  const db = getDb();
  if (!db) return { waiting: 0, pagesStalled: false };
  const [questions] = await db
    .select({ waiting: count() })
    .from(extractedQuestions)
    .where(
      and(
        eq(extractedQuestions.bookId, bookId),
        inArray(extractedQuestions.aiStatus, ["pending", "failed"]),
        sql`${extractedQuestions.aiAttemptCount} < ${maxAttempts}`,
        window
          ? inQuestionWindow(window, sql`"extracted_questions"."orderIndex"`)
          : undefined
      )
    );
  const [pages] = await db
    .select({
      toDo: sql<number>`count(*) filter (where ${questionFilePages.status} = 'pending' or (${questionFilePages.status} = 'failed' and ${questionFilePages.attemptCount} < ${maxAttempts}))::int`,
      recent: sql<number>`count(*) filter (where ${questionFilePages.updatedAt} > now() - interval '3 minutes')::int`,
    })
    .from(questionFilePages)
    .where(
      and(
        eq(questionFilePages.bookId, bookId),
        window
          ? pageOfWindow(
              bookId,
              window,
              sql`"question_file_pages"."pageNumber"`
            )
          : undefined
      )
    );
  return {
    waiting: questions?.waiting ?? 0,
    pagesStalled: (pages?.toDo ?? 0) > 0 && (pages?.recent ?? 0) === 0,
  };
}

// A question has at most one image in v1 (one page -> one screenshot), but
// this reads through the many-to-many relation table regardless, so a future
// real-cropping pass that links more than one image never needs this query
// to change — it would just start returning more rows.
export async function getExtractedQuestionImages(questionId: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      id: extractedQuestionImages.id,
      pageNumber: extractedQuestionImages.pageNumber,
      storageKey: extractedQuestionImages.storageKey,
    })
    .from(extractedQuestionImageRelations)
    .innerJoin(
      extractedQuestionImages,
      eq(extractedQuestionImages.id, extractedQuestionImageRelations.imageId)
    )
    .where(eq(extractedQuestionImageRelations.questionId, questionId));
}

export async function saveExtractedQuestionEnrichment(
  questionId: string,
  update: {
    keywords: string[];
    aiExplanationAr: string;
    inferredAnswerIndex: number | null;
    // Whether the source PDF already stated an answer — inferredAnswerIndex
    // is only ever persisted when it did NOT, per the schema comment's
    // "never overrides a real source-stated answer" invariant.
    hasStatedAnswer: boolean;
    // Only the parts the file didn't provide — never overwrites the file's
    // own Arabic. Present = a machine translation was produced.
    translation?: { questionTextAr?: string; optionsAr?: string[] };
    mnemonicAr?: string | null;
  }
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  const translation = update.translation;
  await db
    .update(extractedQuestions)
    .set({
      keywords: update.keywords,
      aiExplanationAr: update.aiExplanationAr,
      mnemonicAr: update.mnemonicAr?.trim().slice(0, 300) || null,
      ...(update.hasStatedAnswer
        ? {}
        : { aiInferredAnswerIndex: update.inferredAnswerIndex }),
      ...(translation &&
      (translation.questionTextAr !== undefined ||
        translation.optionsAr !== undefined)
        ? {
            ...(translation.questionTextAr !== undefined
              ? { questionTextAr: translation.questionTextAr }
              : {}),
            ...(translation.optionsAr !== undefined
              ? { optionsAr: translation.optionsAr }
              : {}),
            translationSource: "machine",
          }
        : {}),
      aiStatus: "complete",
      aiError: null,
    })
    .where(eq(extractedQuestions.id, questionId));
}

export async function markExtractedQuestionAiFailed(
  questionId: string,
  errorMessage: string
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(extractedQuestions)
    .set({ aiStatus: "failed", aiError: errorMessage })
    .where(eq(extractedQuestions.id, questionId));
}

// The AI service itself was down (lib/ai/types.ts's isAiServiceOutage): the
// question goes back to waiting and the attempt it was claimed with is
// given back — an outage is not one of its three tries.
export async function returnExtractedQuestionAttempt(
  questionId: string
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(extractedQuestions)
    .set({
      aiStatus: "pending",
      aiAttemptCount: sql`greatest(${extractedQuestions.aiAttemptCount} - 1, 0)`,
      aiError: null,
    })
    .where(
      and(
        eq(extractedQuestions.id, questionId),
        eq(extractedQuestions.aiStatus, "processing")
      )
    );
}

export type QuestionFileCoverage = {
  imagePagesTotal: number;
  imagePagesProcessed: number;
  questionsTotal: number;
  questionsAiComplete: number;
  done: boolean;
};

// Mirrors lib/db-books.ts's getBookCoverageReport/computeCoverageDetail
// style — the UI polls this instead of guessing from a single book-level
// status, since stage 2 and stage 3 finish independently and at different
// times for a large file.
// With a window, `done` means "nothing is owed right now": every page and
// question the window asks for is settled. The totals stay the whole file's.
export async function getQuestionFileCoverage(
  bookId: string,
  window?: QuestionWindow | null
): Promise<QuestionFileCoverage> {
  const db = getDb();
  if (!db) {
    return {
      imagePagesTotal: 0,
      imagePagesProcessed: 0,
      questionsTotal: 0,
      questionsAiComplete: 0,
      done: true,
    };
  }

  const [pageStats] = await db
    .select({
      total: count(),
      processed: count(
        sql`case when ${questionFilePages.status} in ('complete','failed') then 1 end`
      ),
    })
    .from(questionFilePages)
    .where(eq(questionFilePages.bookId, bookId));

  const [questionStats] = await db
    .select({
      total: count(),
      aiComplete: count(
        sql`case when ${extractedQuestions.aiStatus} in ('complete','failed') then 1 end`
      ),
    })
    .from(extractedQuestions)
    .where(eq(extractedQuestions.bookId, bookId));

  const imagePagesTotal = Number(pageStats?.total ?? 0);
  const imagePagesProcessed = Number(pageStats?.processed ?? 0);
  const questionsTotal = Number(questionStats?.total ?? 0);
  const questionsAiComplete = Number(questionStats?.aiComplete ?? 0);

  if (window) {
    const [owed] = await db.execute<{ pages: number; questions: number }>(sql`
      select
        (select count(*)::int from "question_file_pages" p
          where p."bookId" = ${bookId}
            and p."status" not in ('complete', 'failed')
            and ${pageOfWindow(bookId, window, sql`p."pageNumber"`)}) as pages,
        (select count(*)::int from "extracted_questions" q
          where q."bookId" = ${bookId}
            and q."aiStatus" not in ('complete', 'failed')
            and ${inQuestionWindow(window, sql`q."orderIndex"`)}) as questions
    `);
    return {
      imagePagesTotal,
      imagePagesProcessed,
      questionsTotal,
      questionsAiComplete,
      done:
        imagePagesTotal > 0 &&
        Number(owed?.pages ?? 0) === 0 &&
        Number(owed?.questions ?? 0) === 0,
    };
  }

  return {
    imagePagesTotal,
    imagePagesProcessed,
    questionsTotal,
    questionsAiComplete,
    done:
      imagePagesTotal > 0 &&
      imagePagesProcessed === imagePagesTotal &&
      questionsAiComplete === questionsTotal,
  };
}

// How many of a file's extracted items a student can actually answer (two
// options or more) — for lib/question-file-quality.ts.
export async function countAnswerableQuestions(
  bookId: string
): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const [row] = await db
    .select({
      answerable: count(
        sql`case when jsonb_typeof(${extractedQuestions.options}) = 'array'
          and jsonb_array_length(${extractedQuestions.options}) >= 2 then 1 end`
      ),
    })
    .from(extractedQuestions)
    .where(eq(extractedQuestions.bookId, bookId));
  return Number(row?.answerable ?? 0);
}

// ── 🩹 Repairing held-back questions (lib/question-repair.ts) ───────────

// The blocks held back from students that start on this page and have not
// been through a repair yet. None for a doctor's protected set: there the
// doctor reviews held-back blocks, and nothing an AI transcribed is shown
// to students in the doctor's name.
export async function listBrokenQuestionsOnPage(
  bookId: string,
  pageNumber: number,
  limit = 4
) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      id: extractedQuestions.id,
      questionText: extractedQuestions.questionText,
      options: extractedQuestions.options,
      extractedAnswerText: extractedQuestions.extractedAnswerText,
      explanationText: extractedQuestions.explanationText,
    })
    .from(extractedQuestions)
    .where(
      and(
        eq(extractedQuestions.bookId, bookId),
        eq(extractedQuestions.sourcePage, pageNumber),
        eq(extractedQuestions.reviewStatus, "needs_review"),
        sql`coalesce(${extractedQuestions.reviewReason}, '') not like '%repair_declined%'`,
        sql`not exists (select 1 from "question_sets" s where s."bookId" = ${bookId})`
      )
    )
    .orderBy(asc(extractedQuestions.orderIndex))
    .limit(limit);
}

// Stores a repaired question and hands it to stage 3 for its explanation.
// Refused (false) when the block is no longer held back, or when the file
// already has a visible question with the same stem — the model read a
// neighbour on the page instead of the one it was asked for.
export async function saveRepairedQuestion(
  bookId: string,
  questionId: string,
  repaired: {
    questionText: string;
    options: string[];
    extractedAnswerIndex: number | null;
    extractedAnswerText: string | null;
    explanationText: string | null;
  }
): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  const updated = await db
    .update(extractedQuestions)
    .set({
      questionText: repaired.questionText,
      options: repaired.options,
      extractedAnswerIndex: repaired.extractedAnswerIndex,
      extractedAnswerText: repaired.extractedAnswerText,
      explanationText: repaired.explanationText,
      // Whatever Arabic the parser split off belonged to the broken text.
      questionTextAr: null,
      optionsAr: null,
      translationSource: null,
      reviewStatus: null,
      reviewReason: "repaired_from_page",
      aiStatus: "pending",
      aiAttemptCount: 0,
      aiError: null,
    })
    .where(
      and(
        eq(extractedQuestions.id, questionId),
        eq(extractedQuestions.bookId, bookId),
        eq(extractedQuestions.reviewStatus, "needs_review"),
        sql`not exists (
          select 1 from "extracted_questions" o
          where o."bookId" = ${bookId}
            and o."id" <> ${questionId}
            and o."reviewStatus" is distinct from 'needs_review'
            and lower(o."questionText") = lower(${repaired.questionText})
        )`
      )
    )
    .returning({ id: extractedQuestions.id });
  return updated.length > 0;
}

// The page did not give this question back whole: it stays held back, and
// is not sent for repair again.
export async function markQuestionRepairDeclined(
  questionId: string
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(extractedQuestions)
    .set({
      reviewReason: sql`concat_ws(',', nullif(${extractedQuestions.reviewReason}, ''), 'repair_declined')`,
    })
    .where(
      and(
        eq(extractedQuestions.id, questionId),
        eq(extractedQuestions.reviewStatus, "needs_review")
      )
    );
}
