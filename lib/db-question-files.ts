// Data-access layer for PR16's question-file pipeline — deliberately its own
// file (not folded into lib/db-books.ts) since question files are a
// different concept from study books even though they share the books
// table (sourceType distinguishes them): no chapters, no AI analysis, no
// bookCards/bookMcqs — just extractedQuestions. Same conventions as
// lib/db-books.ts: getDb() singleton, ownership-scoped via
// and(eq(id,...), eq(userId,...)).
import { and, asc, count, desc, eq } from "drizzle-orm";
import { books, extractedQuestions, type Book } from "../drizzle/schema";
import { getDb } from "./db";
import type { ExtractedQuestionInput } from "./question-extraction";

export async function createQuestionFileShell(
  userId: string,
  input: { fileName: string; fileKey: string }
): Promise<Book> {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const [book] = await db
    .insert(books)
    .values({
      userId,
      fileName: input.fileName,
      fileKey: input.fileKey,
      sourceType: "question_file",
      status: "extracting",
    })
    .returning();
  return book;
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
    .leftJoin(extractedQuestions, eq(extractedQuestions.bookId, books.id))
    .where(and(eq(books.userId, userId), eq(books.sourceType, "question_file")))
    .groupBy(books.id)
    .orderBy(desc(books.createdAt));
}

export async function getQuestionFileForUser(userId: string, bookId: string) {
  const db = getDb();
  if (!db) return null;

  const [book] = await db
    .select()
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

  const questions = await db
    .select()
    .from(extractedQuestions)
    .where(eq(extractedQuestions.bookId, bookId))
    .orderBy(asc(extractedQuestions.orderIndex));

  return { book, questions };
}

export async function saveExtractedQuestions(
  bookId: string,
  questions: ExtractedQuestionInput[]
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
    }))
  );
}

export async function markQuestionFileComplete(
  bookId: string,
  pageCount: number
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(books)
    .set({ status: "complete", pageCount, updatedAt: new Date() })
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
    .set({ status: "extracting", extractionError: null, updatedAt: new Date() })
    .where(
      and(
        eq(books.id, bookId),
        eq(books.userId, userId),
        eq(books.sourceType, "question_file")
      )
    )
    .returning({ id: books.id });
  return updated.length > 0;
}
