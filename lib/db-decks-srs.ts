// SRS (spaced-repetition) data-access for مِرآة cards — kept separate from
// lib/db.ts, mirroring lib/db-books.ts's own separation rationale: same
// getDb() singleton, ownership-scoped queries, safe-empty-default reads,
// throw-on-write when the DB isn't configured. `cards` has no direct
// userId column (unlike bookCards, which denormalizes it), so ownership is
// checked via an innerJoin up to the owning deck's userId.
import { and, asc, eq, lte } from "drizzle-orm";
import { cardReviewEvents, cards, decks } from "../drizzle/schema";
import { getDb } from "./db";
import { applySrsRating, type SrsRating } from "./srs";

export async function getDueCardsForUser(userId: string) {
  const db = getDb();
  if (!db) return [];

  return db
    .select({
      id: cards.id,
      question: cards.question,
      questionArabic: cards.questionArabic,
      answer: cards.answer,
      answerArabic: cards.answerArabic,
      keyword: cards.keyword,
      keywordArabic: cards.keywordArabic,
      sourcePage: cards.sourcePage,
      dueAt: cards.dueAt,
      deckFileName: decks.fileName,
      // For the review screen's "comes back in…" (lib/review-preview.ts).
      easeFactor: cards.easeFactor,
      intervalDays: cards.intervalDays,
      reviewCount: cards.reviewCount,
    })
    .from(cards)
    .innerJoin(decks, eq(decks.id, cards.deckId))
    .where(and(eq(decks.userId, userId), lte(cards.dueAt, new Date())))
    .orderBy(asc(cards.dueAt));
}

export async function rateCard(
  userId: string,
  cardId: string,
  rating: SrsRating
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const [row] = await db
    .select({
      easeFactor: cards.easeFactor,
      intervalDays: cards.intervalDays,
      reviewCount: cards.reviewCount,
    })
    .from(cards)
    .innerJoin(decks, eq(decks.id, cards.deckId))
    .where(and(eq(cards.id, cardId), eq(decks.userId, userId)))
    .limit(1);
  if (!row) return null;

  const update = applySrsRating(row, rating);

  await db
    .update(cards)
    .set({
      easeFactor: update.easeFactor,
      intervalDays: update.intervalDays,
      dueAt: update.dueAt,
      reviewCount: update.reviewCount,
      lastRating: rating,
    })
    .where(eq(cards.id, cardId));

  await db.insert(cardReviewEvents).values({ cardId, userId, rating });

  return update;
}
