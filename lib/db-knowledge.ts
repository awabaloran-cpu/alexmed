// 🧠 Knowledge Items storage access (see lib/knowledge-study.ts). The items
// themselves are the book's Exam Focus facts (exam_focus_cards); this file
// only reads them for the generators, cleans V1 output on an explicit
// rebuild, and assembles the Coverage Matrix:
//   Knowledge Item → Exam Focus card → Flashcard(s) → Question(s) → pages.
import { and, asc, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  bookCards,
  bookChapters,
  bookMcqs,
  examFocusCards,
  examFocusDecks,
} from "../drizzle/schema";
import { getDb } from "./db";
import type { KnowledgeItem } from "./knowledge-study";

export type BookKnowledge = {
  deckStatus: (typeof examFocusDecks.$inferSelect)["status"] | null;
  // True once the deck is finished (fully, or with some failed units) —
  // only then is it the source of truth for cards/questions.
  ready: boolean;
  items: KnowledgeItem[];
};

export async function getBookKnowledge(bookId: string): Promise<BookKnowledge> {
  const db = getDb();
  if (!db) return { deckStatus: null, ready: false, items: [] };
  const [deck] = await db
    .select({ id: examFocusDecks.id, status: examFocusDecks.status })
    .from(examFocusDecks)
    .where(eq(examFocusDecks.bookId, bookId))
    .limit(1);
  if (!deck) return { deckStatus: null, ready: false, items: [] };
  const ready = deck.status === "complete" || deck.status === "partial_failed";
  if (!ready) return { deckStatus: deck.status, ready, items: [] };
  const rows = await db
    .select({
      id: examFocusCards.id,
      category: examFocusCards.category,
      topic: examFocusCards.topic,
      title: examFocusCards.title,
      points: examFocusCards.points,
      highlightLabel: examFocusCards.highlightLabel,
      highlightText: examFocusCards.highlightText,
      sourcePages: examFocusCards.sourcePages,
    })
    .from(examFocusCards)
    .where(eq(examFocusCards.deckId, deck.id))
    .orderBy(asc(examFocusCards.orderIndex));
  return { deckStatus: deck.status, ready, items: rows };
}

// How much of a chapter's output already came from Knowledge Items vs V1
// page-text generation — drives idempotency and the "rebuild" offer.
export async function getChapterOutputSources(chapterId: string) {
  const empty = { knowledge: 0, v1: 0 };
  const db = getDb();
  if (!db) return { cards: empty, mcqs: empty };
  const counted = (rows: { c: number }[]) => rows[0]?.c ?? 0;
  const [cardKnowledge, cardV1, mcqKnowledge, mcqV1] = await Promise.all([
    db
      .select({ c: count() })
      .from(bookCards)
      .where(
        and(
          eq(bookCards.chapterId, chapterId),
          isNotNull(bookCards.knowledgeItemId)
        )
      ),
    db
      .select({ c: count() })
      .from(bookCards)
      .where(
        and(
          eq(bookCards.chapterId, chapterId),
          isNull(bookCards.knowledgeItemId)
        )
      ),
    db
      .select({ c: count() })
      .from(bookMcqs)
      .where(
        and(
          eq(bookMcqs.chapterId, chapterId),
          isNotNull(bookMcqs.knowledgeItemId)
        )
      ),
    db
      .select({ c: count() })
      .from(bookMcqs)
      .where(
        and(eq(bookMcqs.chapterId, chapterId), isNull(bookMcqs.knowledgeItemId))
      ),
  ]);
  return {
    cards: { knowledge: counted(cardKnowledge), v1: counted(cardV1) },
    mcqs: { knowledge: counted(mcqKnowledge), v1: counted(mcqV1) },
  };
}

// Explicit "rebuild from the knowledge base" only: removes the chapter's V1
// (page-text) cards or questions. Knowledge-based ones are never touched.
// Review history of the removed cards goes with them (cascade) — the UI
// says so before the student confirms.
export async function deleteChapterV1Output(
  chapterId: string,
  kind: "cards" | "mcqs"
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  if (kind === "cards") {
    await db
      .delete(bookCards)
      .where(
        and(
          eq(bookCards.chapterId, chapterId),
          isNull(bookCards.knowledgeItemId)
        )
      );
  } else {
    await db
      .delete(bookMcqs)
      .where(
        and(eq(bookMcqs.chapterId, chapterId), isNull(bookMcqs.knowledgeItemId))
      );
  }
}

export type CoverageMatrixRow = {
  itemId: string;
  orderIndex: number;
  category: string;
  title: string;
  sourcePages: number[];
  chapterId: string | null;
  cardIds: string[];
  questionIds: string[];
  questionTypes: string[];
};

// The Coverage Matrix for a whole book: every Knowledge Item with the
// flashcards and questions derived from it (a differentiation question
// counts for both facts it relies on; flagged questions don't count).
export async function getKnowledgeCoverageMatrix(bookId: string): Promise<{
  deckStatus: BookKnowledge["deckStatus"];
  rows: CoverageMatrixRow[];
}> {
  const db = getDb();
  const knowledge = await getBookKnowledge(bookId);
  if (!db || !knowledge.ready) {
    return { deckStatus: knowledge.deckStatus, rows: [] };
  }

  const chapters = await db
    .select({
      id: bookChapters.id,
      startPage: bookChapters.startPage,
      endPage: bookChapters.endPage,
    })
    .from(bookChapters)
    .where(eq(bookChapters.bookId, bookId));
  const chapterIds = chapters.map(chapter => chapter.id);
  const [cards, mcqs] = chapterIds.length
    ? await Promise.all([
        db
          .select({
            id: bookCards.id,
            knowledgeItemId: bookCards.knowledgeItemId,
          })
          .from(bookCards)
          .where(
            and(
              inArray(bookCards.chapterId, chapterIds),
              isNotNull(bookCards.knowledgeItemId)
            )
          ),
        db
          .select({
            id: bookMcqs.id,
            knowledgeItemId: bookMcqs.knowledgeItemId,
            related: bookMcqs.relatedKnowledgeItemIds,
            questionType: bookMcqs.questionType,
            validationStatus: bookMcqs.validationStatus,
          })
          .from(bookMcqs)
          .where(
            and(
              inArray(bookMcqs.chapterId, chapterIds),
              isNotNull(bookMcqs.knowledgeItemId)
            )
          ),
      ])
    : [[], []];

  const rows = new Map<string, CoverageMatrixRow>(
    knowledge.items.map((item, index) => {
      const first = item.sourcePages.length ? Math.min(...item.sourcePages) : 0;
      const chapter = chapters.find(
        c => first >= c.startPage && first <= c.endPage
      );
      return [
        item.id,
        {
          itemId: item.id,
          orderIndex: index + 1,
          category: item.category,
          title: item.title,
          sourcePages: item.sourcePages,
          chapterId: chapter?.id ?? null,
          cardIds: [],
          questionIds: [],
          questionTypes: [],
        },
      ];
    })
  );
  for (const card of cards) {
    rows.get(card.knowledgeItemId!)?.cardIds.push(card.id);
  }
  for (const mcq of mcqs) {
    if (mcq.validationStatus === "flagged") continue;
    const itemIds = new Set([mcq.knowledgeItemId!, ...(mcq.related ?? [])]);
    for (const itemId of itemIds) {
      const row = rows.get(itemId);
      if (!row) continue;
      row.questionIds.push(mcq.id);
      if (mcq.questionType) row.questionTypes.push(mcq.questionType);
    }
  }
  return { deckStatus: knowledge.deckStatus, rows: [...rows.values()] };
}
