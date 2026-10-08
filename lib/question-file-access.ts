// 🔗 Who may read a student's QUESTION FILE (its extracted questions, its
// images, and answer them): the ONE rule every such read goes through.
//
//   owner   the student who uploaded it
//   shared  a student holding an ACCEPTED share of it (they joined through
//           its share link — lib/share-links.ts) — while the file is not a
//           doctor's protected question set
//
// Anything else is null, and callers answer "not found". A pending,
// declined, revoked or removed share grants nothing.
//
// A doctor's protected set is the same kind of books row, but its students
// are authorized by lib/question-set-access.ts (entitlements, codes, the
// set's own window) and must never be reachable through a share: `shared`
// is refused for any file that has a question set attached, whatever its
// status. The owner keeps their own access to it here, as before.
//
// Study books have their own, older rule (lib/book-access.ts).
import { and, eq, sql } from "drizzle-orm";
import { bookShares, books, questionSets, users } from "../drizzle/schema";
import { getDb } from "./db";

export type QuestionFileAccess = {
  bookId: string;
  ownerId: string;
  role: "owner" | "shared";
  ownerName: string | null;
};

type AccessRow = {
  bookId: string;
  ownerId: string;
  shared: boolean;
  protectedSet: boolean;
  ownerName: string | null;
};

// Pure decision (unit-tested).
export function decideQuestionFileAccess(
  userId: string,
  row: AccessRow | undefined
): QuestionFileAccess | null {
  if (!row) return null;
  const base = {
    bookId: row.bookId,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
  };
  if (row.ownerId === userId) return { ...base, role: "owner" };
  if (row.shared && !row.protectedSet) return { ...base, role: "shared" };
  return null;
}

export async function getQuestionFileAccess(
  userId: string,
  bookId: string
): Promise<QuestionFileAccess | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      bookId: books.id,
      ownerId: books.userId,
      shared: sql<boolean>`exists (
        select 1 from ${bookShares}
        where ${bookShares.bookId} = ${books.id}
          and ${bookShares.recipientId} = ${userId}
          and ${bookShares.status} = 'accepted'
      )`,
      protectedSet: sql<boolean>`exists (
        select 1 from ${questionSets}
        where ${questionSets.bookId} = ${books.id}
      )`,
      ownerName: users.name,
    })
    .from(books)
    .innerJoin(users, eq(users.id, books.userId))
    .where(and(eq(books.id, bookId), eq(books.sourceType, "question_file")))
    .limit(1);
  return decideQuestionFileAccess(userId, row);
}
