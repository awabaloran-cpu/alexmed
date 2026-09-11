// Data-access layer for الملاحظات والتظليل (PR4) — mirrors lib/db-books.ts's
// and lib/db-subjects.ts's established conventions: getDb() singleton,
// ownership-scoped queries, read functions return safe empty defaults,
// write functions throw when the DB isn't configured.
import { and, desc, eq, ilike, or } from "drizzle-orm";
import {
  annotations,
  bookCards,
  bookChapters,
  bookPages,
  books,
  type Annotation,
} from "../drizzle/schema";
import { getDb } from "./db";

export type AnnotationInput = {
  bookId: string;
  pageId: string;
  type: "highlight" | "note";
  selectedText?: string | null;
  positionJson?: { start: number; end: number } | null;
  content?: string;
  color?: string | null;
};

// Ownership check shared by create/list/search below — a page only ever
// belongs to one book, and a book only ever belongs to one user, so
// verifying (bookId, pageId, userId) line up in one join is enough to
// trust every other operation on the resulting annotation row.
async function assertOwnsPage(
  userId: string,
  bookId: string,
  pageId: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: bookPages.id })
    .from(bookPages)
    .innerJoin(books, eq(books.id, bookPages.bookId))
    .where(
      and(
        eq(bookPages.id, pageId),
        eq(bookPages.bookId, bookId),
        eq(books.userId, userId)
      )
    )
    .limit(1);
  return !!row;
}

export async function createAnnotation(
  userId: string,
  input: AnnotationInput
): Promise<Annotation | null> {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const owns = await assertOwnsPage(userId, input.bookId, input.pageId);
  if (!owns) return null;

  const [annotation] = await db
    .insert(annotations)
    .values({
      userId,
      bookId: input.bookId,
      pageId: input.pageId,
      type: input.type,
      selectedText: input.selectedText ?? null,
      positionJson: input.positionJson ?? null,
      content: input.content ?? "",
      color: input.color ?? null,
    })
    .returning();
  return annotation;
}

export async function listAnnotationsForPage(
  userId: string,
  pageId: string
): Promise<Annotation[]> {
  const db = getDb();
  if (!db) return [];

  return db
    .select()
    .from(annotations)
    .where(and(eq(annotations.pageId, pageId), eq(annotations.userId, userId)))
    .orderBy(desc(annotations.createdAt));
}

export async function updateAnnotation(
  userId: string,
  annotationId: string,
  input: { content?: string; color?: string | null }
): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const updated = await db
    .update(annotations)
    .set({
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(annotations.id, annotationId), eq(annotations.userId, userId))
    )
    .returning({ id: annotations.id });
  return updated.length > 0;
}

export async function deleteAnnotation(
  userId: string,
  annotationId: string
): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const deleted = await db
    .delete(annotations)
    .where(
      and(eq(annotations.id, annotationId), eq(annotations.userId, userId))
    )
    .returning({ id: annotations.id });
  return deleted.length > 0;
}

// "البحث في ملاحظات المادة" — joins through books rather than storing a
// denormalized subjectId on annotations itself (see schema comment: a
// stored copy would go stale the moment a book changes subject).
export async function searchAnnotationsForSubject(
  userId: string,
  subjectId: string,
  query: string
) {
  const db = getDb();
  if (!db) return [];

  const pattern = `%${query}%`;
  return db
    .select({
      annotation: annotations,
      bookFileName: books.fileName,
      pageNumber: bookPages.pageNumber,
    })
    .from(annotations)
    .innerJoin(books, eq(books.id, annotations.bookId))
    .innerJoin(bookPages, eq(bookPages.id, annotations.pageId))
    .where(
      and(
        eq(annotations.userId, userId),
        eq(books.subjectId, subjectId),
        or(
          ilike(annotations.content, pattern),
          ilike(annotations.selectedText, pattern)
        )
      )
    )
    .orderBy(desc(annotations.createdAt));
}

// "إنشاء بطاقة من الملاحظة" — a plain heuristic card (no AI call): a
// highlighted selection becomes "اشرح: <النص>" / "Explain: <text>" with the
// note's own content as the answer (falling back to the selection itself
// when there's no separate note); a plain note with no selection becomes
// "ملاحظتي" / "My note". Reuses bookCards as-is — no new card-provenance
// field (cardType/reason) is added here; that richer model belongs to a
// later مِرآة-integration PR, not this one.
export async function createCardFromAnnotation(
  userId: string,
  annotationId: string
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const [row] = await db
    .select({
      annotation: annotations,
      pageNumber: bookPages.pageNumber,
      chapterId: bookPages.chapterId,
    })
    .from(annotations)
    .innerJoin(bookPages, eq(bookPages.id, annotations.pageId))
    .where(
      and(eq(annotations.id, annotationId), eq(annotations.userId, userId))
    )
    .limit(1);
  if (!row || !row.chapterId) return null;

  const { annotation, pageNumber, chapterId } = row;
  const hasSelection = !!annotation.selectedText;
  const questionAr = hasSelection
    ? `اشرح: ${annotation.selectedText}`
    : "ملاحظتي";
  const questionEn = hasSelection
    ? `Explain: ${annotation.selectedText}`
    : "My note";
  const answer = annotation.content || annotation.selectedText || "";

  const [chapter] = await db
    .select({ id: bookChapters.id })
    .from(bookChapters)
    .where(eq(bookChapters.id, chapterId))
    .limit(1);
  if (!chapter) return null;

  const [card] = await db
    .insert(bookCards)
    .values({
      chapterId,
      userId,
      questionAr,
      questionEn,
      answerAr: answer,
      answerEn: answer,
      relatedTermEn: "",
      sourcePage: pageNumber,
    })
    .returning();
  return card;
}
