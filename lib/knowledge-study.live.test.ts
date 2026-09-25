// LIVE run of the knowledge-based generators on a real book's Exam Focus
// facts with the REAL model. Skipped unless LIVE_AI=1 and KNOWLEDGE_BOOK_ID
// are set — spends real AI credits. READ-ONLY: it reads the book's
// Knowledge Items and chapter ranges, generates per chapter exactly like
// lib/book-enrichment.ts, and writes a report file — nothing is saved.
//
//   LIVE_AI=1 KNOWLEDGE_BOOK_ID=<bookId> KNOWLEDGE_REPORT=report.json \
//     npx vitest run lib/knowledge-study.live.test.ts
import { config as loadEnv } from "dotenv";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const live = process.env.LIVE_AI === "1" && !!process.env.KNOWLEDGE_BOOK_ID;
if (live) loadEnv();

describe.skipIf(!live)("LIVE knowledge-based cards & questions", () => {
  it(
    "turns every Knowledge Item into cards and questions",
    async () => {
      const bookId = process.env.KNOWLEDGE_BOOK_ID!;
      const { invokeLLM } = await import("./llm");
      const { getDb } = await import("./db");
      const { bookChapters } = await import("../drizzle/schema");
      const { asc, eq } = await import("drizzle-orm");
      const { getBookKnowledge } = await import("./db-knowledge");
      const {
        generateKnowledgeFlashcards,
        generateKnowledgeMcqs,
        itemsForPageRange,
      } = await import("./knowledge-study");

      const knowledge = await getBookKnowledge(bookId);
      expect(knowledge.ready).toBe(true);
      const chapters = await getDb()!
        .select({
          title: bookChapters.title,
          startPage: bookChapters.startPage,
          endPage: bookChapters.endPage,
        })
        .from(bookChapters)
        .where(eq(bookChapters.bookId, bookId))
        .orderBy(asc(bookChapters.orderIndex));

      const report: Record<string, unknown>[] = [];
      let cardTotal = 0;
      let mcqTotal = 0;
      let coveredCards = 0;
      let coveredMcqs = 0;
      const started = Date.now();
      for (const chapter of chapters) {
        const items = itemsForPageRange(
          knowledge.items,
          chapter.startPage,
          chapter.endPage
        );
        const t0 = Date.now();
        const [cards, mcqs] = await Promise.all([
          generateKnowledgeFlashcards(chapter.title, items, invokeLLM),
          generateKnowledgeMcqs(chapter.title, items, invokeLLM),
        ]);
        cardTotal += cards.items.length;
        mcqTotal += mcqs.items.length;
        coveredCards += cards.coverage.coveredItems;
        coveredMcqs += mcqs.coverage.coveredItems;
        report.push({
          chapter: `${chapter.title} (pages ${chapter.startPage}–${chapter.endPage})`,
          items: items.length,
          seconds: Math.round((Date.now() - t0) / 1000),
          cards: cards.items.length,
          cardCoverage: cards.coverage,
          cardErrors: cards.errors,
          mcqs: mcqs.items.length,
          mcqCoverage: mcqs.coverage,
          mcqErrors: mcqs.errors,
          questionTypes: mcqs.items.reduce<Record<string, number>>(
            (acc, q) => ({
              ...acc,
              [q.questionType]: (acc[q.questionType] ?? 0) + 1,
            }),
            {}
          ),
          sampleCards: cards.items.slice(0, 6),
          sampleMcqs: mcqs.items.slice(0, 4),
        });
      }
      const summary = {
        knowledgeItems: knowledge.items.length,
        cards: cardTotal,
        mcqs: mcqTotal,
        itemsWithCards: coveredCards,
        itemsWithQuestions: coveredMcqs,
        seconds: Math.round((Date.now() - started) / 1000),
      };
      console.log("[knowledge live]", JSON.stringify(summary));
      if (process.env.KNOWLEDGE_REPORT) {
        writeFileSync(
          process.env.KNOWLEDGE_REPORT,
          JSON.stringify({ summary, chapters: report }, null, 2)
        );
      }
      expect(coveredCards).toBeGreaterThanOrEqual(
        Math.floor(knowledge.items.length * 0.9)
      );
      expect(coveredMcqs).toBeGreaterThanOrEqual(
        Math.floor(knowledge.items.length * 0.9)
      );
    },
    30 * 60_000
  );
});
