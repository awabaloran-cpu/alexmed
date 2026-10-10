// Data-access layer for PR16's question-file pipeline — deliberately its own
// file (not folded into lib/db-books.ts) since question files are a
// different concept from study books even though they share the books
// table (sourceType distinguishes them): no chapters, no AI analysis, no
// bookCards/bookMcqs — just extractedQuestions. Same conventions as
// lib/db-books.ts: getDb() singleton, ownership-scoped via
// and(eq(id,...), eq(userId,...)).
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import {
  bookShares,
  books,
  extractedQuestionImageRelations,
  extractedQuestionImages,
  extractedQuestions,
  questionSets,
  users,
  type Book,
} from "../drizzle/schema";
import { getDb, requireDb } from "./db";
import { getQuestionFileCoverage } from "./db-question-file-images";
import { getQuestionFileWindow } from "./question-file-window";
import { getQuestionFileAccess } from "./question-file-access";
import type { ExtractedQuestionInput } from "./question-extraction";

// `subjectId` is the student's folder (required by the student upload
// route); a doctor's protected set has none. `executor` lets a caller create
// the book inside its own transaction (lib/db-question-sets.ts).
export async function createQuestionFileShell(
  userId: string,
  input: { fileName: string; fileKey: string; subjectId: string | null },
  executor?: Pick<ReturnType<typeof requireDb>, "insert">
): Promise<Book> {
  const db = executor ?? getDb();
  if (!db) throw new Error("Database not available");

  const [book] = await db
    .insert(books)
    .values({
      userId,
      fileName: input.fileName,
      fileKey: input.fileKey,
      sourceType: "question_file",
      status: "extracting",
      subjectId: input.subjectId,
    })
    .returning();
  return book;
}

// Is this id one of the student's own study books? (What a question file
// that turned out to be a book has become.)
export async function isOwnStudyBook(
  userId: string,
  bookId: string
): Promise<boolean> {
  const db = getDb();
  if (!db || !/^[0-9a-f-]{36}$/i.test(bookId)) return false;
  const [row] = await db
    .select({ id: books.id })
    .from(books)
    .where(
      and(
        eq(books.id, bookId),
        eq(books.userId, userId),
        eq(books.sourceType, "study_book")
      )
    )
    .limit(1);
  return Boolean(row);
}

// A doctor's protected set? (lib/db-question-sets.ts) Its questions are the
// doctor's to review, and it is never turned into anything else.
export async function isProtectedQuestionSetBook(
  bookId: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: questionSets.id })
    .from(questionSets)
    .where(eq(questionSets.bookId, bookId))
    .limit(1);
  return Boolean(row);
}

// 📚 The file turned out to be a study book (lib/question-file-quality.ts's
// isBookNotQuestions): the SAME row becomes a book that is still being
// read — same id, same stored PDF, same folder, and whatever page text the
// reader already staged (the book worker resumes from it instead of
// reading or OCR-ing the file again). Nothing else of a question file
// exists yet at that point; anything that does is removed.
// False when the row is not a student's question file still being read.
export async function convertQuestionFileToBook(
  bookId: string
): Promise<boolean> {
  const db = requireDb();
  return db.transaction(async tx => {
    const converted = await tx
      .update(books)
      .set({ sourceType: "study_book", extractionError: null })
      .where(
        and(
          eq(books.id, bookId),
          eq(books.sourceType, "question_file"),
          eq(books.status, "extracting"),
          sql`not exists (
            select 1 from "question_sets" s where s."bookId" = ${bookId}
          )`
        )
      )
      .returning({ id: books.id });
    if (!converted.length) return false;
    await tx
      .delete(extractedQuestions)
      .where(eq(extractedQuestions.bookId, bookId));
    return true;
  });
}

// No-ownership-filter lookup for the extraction queue worker — same
// trust-boundary reasoning as lib/db-books.ts's getBookById.
export async function getQuestionFileBookById(
  bookId: string
): Promise<Book | null> {
  const db = getDb();
  if (!db) return null;
  const [book] = await db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.sourceType, "question_file")))
    .limit(1);
  return book ?? null;
}

export async function listQuestionFilesForUser(userId: string) {
  const db = getDb();
  if (!db) return [];

  return db
    .select({
      id: books.id,
      fileName: books.fileName,
      status: books.status,
      extractionError: books.extractionError,
      createdAt: books.createdAt,
      questionCount: count(extractedQuestions.id),
    })
    .from(books)
    .leftJoin(
      extractedQuestions,
      and(eq(extractedQuestions.bookId, books.id), studentVisibleQuestion)
    )
    .where(and(eq(books.userId, userId), eq(books.sourceType, "question_file")))
    .groupBy(books.id)
    .orderBy(desc(books.createdAt));
}

// The only book fields a question-file viewer ever needs. Never the storage
// key of the uploaded PDF (fileKey), the owner/folder ids, or the
// extraction staging columns (pageTexts etc.) — this projection is what
// every question-file read returns, whoever the viewer is.
const questionFileBookColumns = {
  id: books.id,
  fileName: books.fileName,
  status: books.status,
  extractionError: books.extractionError,
  pageCount: books.pageCount,
  createdAt: books.createdAt,
};

// Likewise for each question: the content the question cards render, not
// the enrichment worker's bookkeeping (aiError, attempt counts).
const questionColumns = {
  id: extractedQuestions.id,
  orderIndex: extractedQuestions.orderIndex,
  questionText: extractedQuestions.questionText,
  options: extractedQuestions.options,
  extractedAnswerIndex: extractedQuestions.extractedAnswerIndex,
  extractedAnswerText: extractedQuestions.extractedAnswerText,
  aiInferredAnswerIndex: extractedQuestions.aiInferredAnswerIndex,
  explanationText: extractedQuestions.explanationText,
  sourcePage: extractedQuestions.sourcePage,
  keywords: extractedQuestions.keywords,
  aiExplanationAr: extractedQuestions.aiExplanationAr,
  mnemonicAr: extractedQuestions.mnemonicAr,
  aiStatus: extractedQuestions.aiStatus,
  questionTextAr: extractedQuestions.questionTextAr,
  optionsAr: extractedQuestions.optionsAr,
  translationSource: extractedQuestions.translationSource,
  // null / "check_image" (image not attributed — flagged to the doctor);
  // "needs_review" rows are filtered out of every student read.
  reviewStatus: extractedQuestions.reviewStatus,
  reviewReason: extractedQuestions.reviewReason,
};

export type QuestionFileBookView = {
  id: string;
  fileName: string;
  status: Book["status"];
  extractionError: string | null;
  pageCount: number;
  createdAt: Date;
};

type QuestionImageRef = { imageId: string; storageKey: string };

// How a question's image is addressed in the response. The owner's own
// file keeps the existing /api/files/<key> URL; a caller that must not see
// storage keys (a protected set's student) passes its own builder.
export type QuestionImageUrlBuilder = (image: QuestionImageRef) => string;

// Same URL lib/storage.ts's storageGet builds.
const ownerImageUrl: QuestionImageUrlBuilder = image =>
  `/api/files/${image.storageKey.replace(/^\/+/, "")}`;

export async function getQuestionFileForUser(userId: string, bookId: string) {
  const db = getDb();
  if (!db) return null;

  const [book] = await db
    .select(questionFileBookColumns)
    .from(books)
    .where(
      and(
        eq(books.id, bookId),
        eq(books.userId, userId),
        eq(books.sourceType, "question_file")
      )
    )
    .limit(1);
  if (!book) return null;

  return { book, ...(await readQuestionFileContent(bookId, ownerImageUrl)) };
}

// A shared file's images go through a route that checks the viewer's own
// access (app/api/books/question-files/[bookId]/images/[imageId]); the
// storage key never reaches a classmate.
const sharedImageUrl =
  (bookId: string): QuestionImageUrlBuilder =>
  image =>
    `/api/books/question-files/${bookId}/images/${image.imageId}`;

// The question file as `userId` may see it — its owner, or a classmate it
// was shared with (lib/question-file-access.ts). `sharedBy` is the owner's
// display name for a classmate, null for the owner.
export async function getQuestionFileForViewer(userId: string, bookId: string) {
  const db = getDb();
  if (!db) return null;
  const access = await getQuestionFileAccess(userId, bookId);
  if (!access) return null;
  const [book] = await db
    .select(questionFileBookColumns)
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  if (!book) return null;
  const shared = access.role === "shared";
  return {
    book,
    shared,
    sharedBy: shared ? access.ownerName : null,
    ...(await readQuestionFileContent(
      bookId,
      shared ? sharedImageUrl(bookId) : ownerImageUrl
    )),
  };
}

// Question files classmates shared with this student (accepted shares),
// in the same shape as their own list.
export async function listSharedQuestionFiles(userId: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      id: books.id,
      fileName: books.fileName,
      status: books.status,
      extractionError: books.extractionError,
      createdAt: books.createdAt,
      questionCount: count(extractedQuestions.id),
      sharedBy: users.name,
    })
    .from(bookShares)
    .innerJoin(books, eq(books.id, bookShares.bookId))
    .innerJoin(users, eq(users.id, books.userId))
    .leftJoin(
      extractedQuestions,
      and(eq(extractedQuestions.bookId, books.id), studentVisibleQuestion)
    )
    .where(
      and(
        eq(bookShares.recipientId, userId),
        eq(bookShares.status, "accepted"),
        eq(books.sourceType, "question_file"),
        // Never a doctor's protected set (lib/question-file-access.ts).
        sql`not exists (
          select 1 from ${questionSets} where ${questionSets.bookId} = ${books.id}
        )`
      )
    )
    .groupBy(books.id, users.name, bookShares.respondedAt)
    .orderBy(desc(bookShares.respondedAt));
}

// Questions + their images + processing coverage for a question-file book
// the caller has ALREADY been authorized for. Three queries whatever the
// question count (no per-question lookups), and no AI or queue work — a
// read of what the pipeline already produced.
//
// Needs-review blocks are NEVER in `questions`. With `includeNeedsReview`
// (the doctor's preview only) they come back separately, with their reasons.
export async function readQuestionFileContent(
  bookId: string,
  imageUrl: QuestionImageUrlBuilder,
  options: { includeNeedsReview?: boolean } = {}
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select(questionColumns)
    .from(extractedQuestions)
    .where(
      and(
        eq(extractedQuestions.bookId, bookId),
        options.includeNeedsReview ? undefined : studentVisibleQuestion
      )
    )
    .orderBy(asc(extractedQuestions.orderIndex));
  const questions = rows.filter(row => row.reviewStatus !== "needs_review");
  const needsReview = options.includeNeedsReview
    ? rows
        .filter(row => row.reviewStatus === "needs_review")
        .map(row => ({
          id: row.id,
          orderIndex: row.orderIndex,
          questionText: row.questionText,
          options: row.options,
          sourcePage: row.sourcePage,
          reasons: (row.reviewReason ?? "").split(",").filter(Boolean),
        }))
    : [];

  // One query for every question's associated image (if any), rather than
  // N+1 per question — a question with no row here just gets undefined,
  // meaning "no image container" in the UI.
  const imagesByQuestionId = new Map<string, string>();
  if (questions.length) {
    const rows = await db
      .select({
        questionId: extractedQuestionImageRelations.questionId,
        imageId: extractedQuestionImages.id,
        storageKey: extractedQuestionImages.storageKey,
      })
      .from(extractedQuestionImageRelations)
      .innerJoin(
        extractedQuestionImages,
        eq(extractedQuestionImages.id, extractedQuestionImageRelations.imageId)
      )
      // extractedQuestionImageRelations has no bookId of its own — the join
      // above (through extractedQuestionImages) is what scopes this to the
      // right book.
      .where(eq(extractedQuestionImages.bookId, bookId));
    for (const row of rows) {
      if (!imagesByQuestionId.has(row.questionId)) {
        imagesByQuestionId.set(row.questionId, imageUrl(row));
      }
    }
  }

  const questionsWithImages = questions.map(
    ({ reviewReason: _reason, ...question }) => ({
      ...question,
      imageUrl: imagesByQuestionId.get(question.id) ?? null,
    })
  );

  // "Done" for a long file is "nothing is owed right now" — the rest is
  // prepared as the student gets near (lib/question-file-window.ts).
  const coverage = await getQuestionFileCoverage(
    bookId,
    await getQuestionFileWindow(bookId)
  );

  return { questions: questionsWithImages, needsReview, coverage };
}

export type QuestionFileContent = Awaited<
  ReturnType<typeof readQuestionFileContent>
>;
export type QuestionFileQuestion = QuestionFileContent["questions"][number];

// Valid questions (reviewStatus null) and needs-review blocks, in file
// order. Needs-review rows are kept for the doctor's review and are never
// returned to students (see readQuestionFileContent).
export async function saveExtractedQuestions(
  bookId: string,
  questions: (ExtractedQuestionInput & {
    reviewStatus?: string | null;
    reviewReason?: string | null;
  })[]
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  // Reprocessing (retryQuestionFileExtraction) re-runs the whole real
  // extraction from scratch — clearing old rows first avoids duplicating or
  // stale-merging results from a previous, possibly-failed attempt.
  await db
    .delete(extractedQuestions)
    .where(eq(extractedQuestions.bookId, bookId));

  if (!questions.length) return;
  await db.insert(extractedQuestions).values(
    questions.map(q => ({
      bookId,
      orderIndex: q.orderIndex,
      questionText: q.questionText,
      options: q.options,
      extractedAnswerIndex: q.extractedAnswerIndex,
      extractedAnswerText: q.extractedAnswerText,
      explanationText: q.explanationText,
      sourcePage: q.sourcePage,
      // The file's own Arabic (lib/question-extraction.ts). Anything still
      // missing is machine-translated once in stage 3, which then marks the
      // question "machine".
      questionTextAr: q.questionTextAr,
      optionsAr: q.optionsAr,
      translationSource: q.questionTextAr ? "source" : null,
      reviewStatus: q.reviewStatus ?? null,
      reviewReason: q.reviewReason ?? null,
      // Needs-review blocks get no AI enrichment (stage 3 skips them).
      ...(q.reviewStatus === "needs_review"
        ? { aiStatus: "complete" as const }
        : {}),
    }))
  );
}

// A question students may see: valid, or valid with an unattributed image
// ("check_image"). Needs-review blocks never are.
export const studentVisibleQuestion = sql`${extractedQuestions.reviewStatus} is distinct from 'needs_review'`;

// The resumable OCR staging columns app/api/books/extract-questions uses —
// cleared once the file completes, and on a retry so it starts fresh.
export const CLEARED_OCR_STAGING = {
  pageTexts: null,
  pagesNeedingOcr: null,
  ocrFailedPages: null,
  ocrAttemptCounts: null,
};

export async function markQuestionFileComplete(
  bookId: string,
  pageCount: number
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(books)
    .set({
      status: "complete",
      pageCount,
      // OCR staging (app/api/books/extract-questions) is done with.
      ...CLEARED_OCR_STAGING,
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId));
}

export async function markQuestionFileFailed(
  bookId: string,
  message: string
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(books)
    .set({ status: "failed", extractionError: message, updatedAt: new Date() })
    .where(eq(books.id, bookId));
}

// Student-initiated retry (mirrors lib/db-books.ts's resetBookExtractionForRetry)
// — ownership-checked here since, unlike the QStash worker path, this is
// reachable directly from a protectedProcedure.
export async function retryQuestionFileExtraction(
  userId: string,
  bookId: string
): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const updated = await db
    .update(books)
    .set({
      status: "extracting",
      extractionError: null,
      ...CLEARED_OCR_STAGING,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(books.id, bookId),
        eq(books.userId, userId),
        eq(books.sourceType, "question_file"),
        // Only a FAILED file: re-extracting a finished one re-runs the paid
        // AI enrichment for every question, outside the upload quota. Part
        // of the same UPDATE, so concurrent retries can't both pass.
        eq(books.status, "failed")
      )
    )
    .returning({ id: books.id });
  return updated.length > 0;
}
