// Real-Postgres test for "a part is never generated / saved twice":
// concurrent generate requests for the same part share one AI run
// (book-enrichment's in-flight join), and concurrent saves are serialized by
// saveChapterOutputOnce's row lock, so exactly one copy is stored.
// Skipped unless LIVE_DB=1. Uses a throwaway lock-qa+<time>@example.invalid
// user and deletes it at the end (cascades to the book, parts and cards).
//
//   LIVE_DB=1 npx vitest run lib/generation-lock.integration.test.ts
import { config as loadEnv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./llm", async importOriginal => ({
  ...(await importOriginal<typeof import("./llm")>()),
  invokeLLM: vi.fn(),
}));

const live = process.env.LIVE_DB === "1";
if (live) loadEnv();

const PAGE_TEXT =
  "Amblyopia is reduced vision not correctable by glasses. Treatment is occlusion of the good eye before age 8. ".repeat(
    12
  );

describe.skipIf(!live)(
  "generation lock — real database",
  { timeout: 60_000 },
  () => {
    const stamp = Date.now();
    let userId = "";
    let chapterId = "";
    let schema: typeof import("../drizzle/schema");
    let db: ReturnType<typeof import("./db").requireDb>;
    let orm: typeof import("drizzle-orm");
    let invokeLLM: ReturnType<typeof vi.fn>;

    const countCards = async () => {
      const [row] = await db
        .select({ c: orm.count() })
        .from(schema.bookCards)
        .where(orm.eq(schema.bookCards.chapterId, chapterId));
      return Number(row.c);
    };

    beforeAll(async () => {
      schema = await import("../drizzle/schema");
      db = (await import("./db")).requireDb();
      orm = await import("drizzle-orm");
      invokeLLM = (await import("./llm")).invokeLLM as never;

      const [user] = await db
        .insert(schema.users)
        .values({ email: `lock-qa+${stamp}@example.invalid`, name: "Lock QA" })
        .returning({ id: schema.users.id });
      userId = user.id;
      const [book] = await db
        .insert(schema.books)
        .values({
          userId,
          fileName: "lock-qa.pdf",
          pageCount: 1,
          status: "complete",
        })
        .returning({ id: schema.books.id });
      const [chapter] = await db
        .insert(schema.bookChapters)
        .values({
          bookId: book.id,
          orderIndex: 0,
          title: "Lock QA part",
          startPage: 1,
          endPage: 1,
          status: "complete",
          pageTexts: [{ page: 1, text: PAGE_TEXT }],
        })
        .returning({ id: schema.bookChapters.id });
      chapterId = chapter.id;
    });

    afterAll(async () => {
      if (userId) {
        await db
          .delete(schema.books)
          .where(orm.eq(schema.books.userId, userId));
        await db.delete(schema.users).where(orm.eq(schema.users.id, userId));
      }
    });

    it("saves only once when two saves race", async () => {
      const { saveChapterOutputOnce } = await import("./db-knowledge");
      const { insertBookCards } = await import("./db-books");
      const card = (n: number) => ({
        questionAr: "س",
        questionEn: `Race question ${n}?`,
        answerAr: "ج",
        answerEn: `Answer ${n}`,
        relatedTermEn: "",
        sourcePage: 1,
      });
      const slowWrite =
        (n: number) => async (tx: Parameters<typeof insertBookCards>[3]) => {
          await new Promise(resolve => setTimeout(resolve, 300));
          await insertBookCards(chapterId, userId, [card(n), card(n + 10)], tx);
        };
      const results = await Promise.all([
        saveChapterOutputOnce(chapterId, "cards", "fresh", slowWrite(1)),
        saveChapterOutputOnce(chapterId, "cards", "fresh", slowWrite(2)),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await countCards()).toBe(2);

      // "rebuild" replaces the V1 cards in the same transaction.
      expect(
        await saveChapterOutputOnce(chapterId, "cards", "rebuild", tx =>
          insertBookCards(chapterId, userId, [card(3)], tx)
        )
      ).toBe(true);
      expect(await countCards()).toBe(1);

      await db
        .delete(schema.bookCards)
        .where(orm.eq(schema.bookCards.chapterId, chapterId));
    });

    it("concurrent generate requests share one AI run and store one copy", async () => {
      invokeLLM.mockReset();
      invokeLLM.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 400));
        return {
          id: "fake",
          created: 0,
          model: "fake",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  flashcards: [
                    {
                      questionAr: "ما هو الغمش؟",
                      questionEn: "What is amblyopia?",
                      answerAr: "ضعف نظر",
                      answerEn: "Reduced vision not correctable by glasses",
                      relatedTermEn: "Amblyopia",
                      sourcePage: 1,
                    },
                  ],
                }),
              },
            },
          ],
        };
      });
      const { generateAndSaveChapterFlashcards } = await import(
        "./book-enrichment"
      );
      const results = await Promise.all([
        generateAndSaveChapterFlashcards(chapterId),
        generateAndSaveChapterFlashcards(chapterId),
        generateAndSaveChapterFlashcards(chapterId),
      ]);
      // One run, shared by all three callers.
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);
      expect(invokeLLM).toHaveBeenCalledTimes(1);
      expect(await countCards()).toBe(1);

      // A later request finds the part done: no AI call at all.
      invokeLLM.mockClear();
      expect(await generateAndSaveChapterFlashcards(chapterId)).toBeNull();
      expect(invokeLLM).not.toHaveBeenCalled();
      expect(await countCards()).toBe(1);
    });
  }
);
