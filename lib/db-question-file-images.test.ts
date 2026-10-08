import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDb,
  insertQuestionFile,
  insertUser,
  type TestDb,
} from "./test-fixtures/pglite-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));

import { getNextPendingExtractedQuestion } from "./db-question-file-images";

const OWNER = "11111111-1111-4111-8111-111111111111";
const BOOK = "33333333-3333-4333-8333-333333333333";
const OTHER_BOOK = "44444444-4444-4444-8444-444444444444";

let test: TestDb;

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  await insertUser(test.client, { id: OWNER });
  await insertQuestionFile(test.client, { id: BOOK, userId: OWNER });
  await insertQuestionFile(test.client, { id: OTHER_BOOK, userId: OWNER });
}, 60_000);

// Questions by the page each starts on, in file order, all waiting for
// their explanation.
async function questionsOnPages(pages: number[]) {
  await test.client.query(
    `DELETE FROM extracted_questions WHERE "bookId" = $1`,
    [BOOK]
  );
  for (const [i, page] of pages.entries()) {
    await test.client.query(
      `INSERT INTO extracted_questions ("bookId", "orderIndex", "questionText", "sourcePage", "aiStatus")
       VALUES ($1, $2, $3, $4, 'pending')`,
      [BOOK, i, `Question ${i}?`, page]
    );
  }
}

type PageState = {
  status: "pending" | "processing" | "complete" | "failed";
  attempts?: number;
  minutesAgo?: number;
};

async function pages(states: PageState[], bookId = BOOK) {
  await test.client.query(
    `DELETE FROM question_file_pages WHERE "bookId" = $1`,
    [bookId]
  );
  for (const [i, state] of states.entries()) {
    await test.client.query(
      `INSERT INTO question_file_pages ("bookId", "pageNumber", status, "attemptCount", "updatedAt")
       VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5))`,
      [bookId, i + 1, state.status, state.attempts ?? 0, state.minutesAgo ?? 0]
    );
  }
}

async function explain(orderIndex: number) {
  await test.client.query(
    `UPDATE extracted_questions SET "aiStatus" = 'complete' WHERE "bookId" = $1 AND "orderIndex" = $2`,
    [BOOK, orderIndex]
  );
}

const next = async () =>
  (await getNextPendingExtractedQuestion(BOOK))?.orderIndex ?? null;

const done: PageState = { status: "complete" };
const waiting: PageState = { status: "pending" };

describe("getNextPendingExtractedQuestion — explanations while pages are still being looked at", () => {
  beforeEach(async () => {
    await pages([], OTHER_BOOK);
  });

  it("hands out every question when no page is unsettled", async () => {
    await questionsOnPages([1, 1, 2]);
    await pages([done, done, done]);
    expect(await next()).toBe(0);
    await explain(0);
    await explain(1);
    expect(await next()).toBe(2);
  });

  it("hands out every question before stage 2 has made its page rows", async () => {
    await questionsOnPages([1, 2]);
    await pages([]);
    expect(await next()).toBe(0);
  });

  it("stops before the last question that starts ahead of the first unsettled page", async () => {
    // Pages 1–2 are settled, page 3 is not. Questions 0,1 (page 1) are
    // safe; question 2 (page 2) may run onto page 3 and waits, like 3 and 4.
    await questionsOnPages([1, 1, 2, 3, 4]);
    await pages([done, done, waiting, waiting]);
    expect(await next()).toBe(0);
    await explain(0);
    expect(await next()).toBe(1);
    await explain(1);
    expect(await next()).toBeNull();
  });

  it("holds a question that spans pages until the page its successor starts on is settled", async () => {
    // Question 0 starts on page 1 and runs to page 3; question 1 starts on
    // page 4. Page 2 is still unsettled.
    await questionsOnPages([1, 4]);
    await pages([done, waiting, waiting, waiting]);
    expect(await next()).toBeNull();
    await pages([done, done, done, done]);
    expect(await next()).toBe(0);
  });

  it("moves on as the page front advances", async () => {
    await questionsOnPages([1, 2, 3]);
    await pages([done, waiting, waiting]);
    expect(await next()).toBeNull();
    await pages([done, done, done]);
    expect(await next()).toBe(0);
  });

  it("holds the file's last question until the pages after it are settled", async () => {
    await questionsOnPages([1, 2]);
    // Page 3 comes after every question and is still unsettled.
    await pages([done, done, waiting]);
    expect(await next()).toBe(0);
    await explain(0);
    expect(await next()).toBeNull();
  });

  it("counts a failed page as unsettled only while it can be retried", async () => {
    await questionsOnPages([1, 2, 3]);
    await pages([done, { status: "failed", attempts: 1 }, done]);
    expect(await next()).toBeNull();
    await pages([done, { status: "failed", attempts: 3 }, done]);
    expect(await next()).toBe(0);
  });

  it("stops waiting for a page left in processing by a crashed run", async () => {
    await questionsOnPages([1, 2, 3]);
    await pages([done, { status: "processing", minutesAgo: 1 }, done]);
    expect(await next()).toBeNull();
    await pages([done, { status: "processing", minutesAgo: 30 }, done]);
    expect(await next()).toBe(0);
  });

  it("is not held back by another file's pages", async () => {
    await questionsOnPages([1, 2]);
    await pages([done, done]);
    await pages([waiting, waiting], OTHER_BOOK);
    expect(await next()).toBe(0);
  });
});
