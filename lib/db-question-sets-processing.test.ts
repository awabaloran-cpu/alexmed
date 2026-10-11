// A doctor's draft while it is being prepared, on a real Postgres (PGlite):
// sending it round again, removing it, and being told when it is ready.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "./test-fixtures/pglite-db";
import {
  IDS,
  seedPeople,
  simulatePipelineDone,
  TEST_HMAC_KEY,
} from "./test-fixtures/question-sets";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));

import {
  createQuestionSet,
  draftQuestionSetBook,
  listQuestionSetsForOwner,
  notifyDraftReady,
  publishQuestionSet,
  resumeDraftProcessing,
} from "./db-question-sets";

let test: TestDb;
let serial = 0;

async function newDraft(ownerId: string = IDS.doctorA) {
  const set = await createQuestionSet(
    ownerId,
    { title: `Anatomy ${++serial}`, visibility: "unlisted" as const },
    { fileName: "anatomy.pdf", fileKey: `book-pdfs/${ownerId}/${serial}.pdf` }
  );
  await simulatePipelineDone(test.client, set.bookId);
  return set;
}

const questions = (bookId: string) =>
  test.client.query<{
    orderIndex: number;
    aiStatus: string;
    aiAttemptCount: number;
    aiExplanationAr: string | null;
  }>(
    `SELECT "orderIndex", "aiStatus", "aiAttemptCount", "aiExplanationAr"
     FROM extracted_questions WHERE "bookId" = $1 ORDER BY "orderIndex"`,
    [bookId]
  );

beforeAll(async () => {
  process.env.QUESTION_SET_CODE_HMAC_KEY = TEST_HMAC_KEY;
  test = await createTestDb();
  holder.db = test.db;
  await seedPeople(test.client);
}, 60_000);

describe("sending a draft round again", () => {
  it("only what is still owed: failed questions and pages, never what succeeded", async () => {
    const set = await newDraft();
    const before = (await questions(set.bookId)).rows;
    await test.client.query(
      `UPDATE extracted_questions SET "aiStatus" = 'failed', "aiAttemptCount" = 3, "aiError" = 'x'
       WHERE "bookId" = $1 AND "orderIndex" IN (0, 2)`,
      [set.bookId]
    );
    await test.client.query(
      `UPDATE question_file_pages SET status = 'failed', "attemptCount" = 3
       WHERE "bookId" = $1 AND "pageNumber" = 1`,
      [set.bookId]
    );
    // What the doctor is shown.
    const [listed] = (await listQuestionSetsForOwner(IDS.doctorA)).filter(
      row => row.id === set.id
    );
    expect(listed.aiFailedCount).toBe(2);

    expect(await resumeDraftProcessing(IDS.doctorA, set.id)).toEqual({
      bookId: set.bookId,
      questions: 2,
      pages: 1,
    });
    const after = (await questions(set.bookId)).rows;
    expect(after.map(row => [row.aiStatus, row.aiAttemptCount])).toEqual([
      ["pending", 0],
      [before[1].aiStatus, before[1].aiAttemptCount],
      ["pending", 0],
    ]);
    // The one that had succeeded keeps what was written for it.
    expect(after[1].aiExplanationAr).toBe(before[1].aiExplanationAr);
    const pages = await test.client.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM question_file_pages
       WHERE "bookId" = $1 GROUP BY status ORDER BY status`,
      [set.bookId]
    );
    expect(pages.rows.find(row => row.status === "pending")?.n).toBe(1);
    expect(pages.rows.some(row => row.status === "failed")).toBe(false);
    // Nothing owed any more: a second press changes nothing.
    expect(await resumeDraftProcessing(IDS.doctorA, set.id)).toEqual({
      bookId: set.bookId,
      questions: 0,
      pages: 0,
    });
  });

  it("picks up a page a dead run left half-done, not one being worked on now", async () => {
    const set = await newDraft();
    await test.client.query(
      `UPDATE question_file_pages SET status = 'processing', "updatedAt" = now() - interval '11 minutes'
       WHERE "bookId" = $1 AND "pageNumber" = 1`,
      [set.bookId]
    );
    await test.client.query(
      `UPDATE question_file_pages SET status = 'processing', "updatedAt" = now()
       WHERE "bookId" = $1 AND "pageNumber" = 2`,
      [set.bookId]
    );
    expect((await resumeDraftProcessing(IDS.doctorA, set.id))?.pages).toBe(1);
  });

  it("is the owner's, for a draft whose file has been read", async () => {
    const set = await newDraft();
    expect(await resumeDraftProcessing(IDS.doctorB, set.id)).toBeNull();
    await test.client.query(
      `UPDATE books SET status = 'extracting' WHERE id = $1`,
      [set.bookId]
    );
    expect(await resumeDraftProcessing(IDS.doctorA, set.id)).toBeNull();
    await test.client.query(
      `UPDATE books SET status = 'complete' WHERE id = $1`,
      [set.bookId]
    );
    await publishQuestionSet(IDS.doctorA, set.id);
    // Published: its questions are fixed.
    expect(await resumeDraftProcessing(IDS.doctorA, set.id)).toBeNull();
  });
});

describe("removing a draft", () => {
  it("names the file of the owner's draft, never a published set's", async () => {
    const set = await newDraft();
    expect(await draftQuestionSetBook(IDS.doctorB, set.id)).toBeNull();
    expect(await draftQuestionSetBook(IDS.doctorA, set.id)).toBe(set.bookId);
    await publishQuestionSet(IDS.doctorA, set.id);
    expect(await draftQuestionSetBook(IDS.doctorA, set.id)).toBeNull();
  });

  it("the set, its questions and its pages go with the file", async () => {
    const set = await newDraft();
    await test.client.query(`DELETE FROM books WHERE id = $1`, [set.bookId]);
    const left = await test.client.query<{
      sets: number;
      q: number;
      p: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM question_sets WHERE id = $1) AS sets,
         (SELECT count(*)::int FROM extracted_questions WHERE "bookId" = $2) AS q,
         (SELECT count(*)::int FROM question_file_pages WHERE "bookId" = $2) AS p`,
      [set.id, set.bookId]
    );
    expect(left.rows[0]).toEqual({ sets: 0, q: 0, p: 0 });
  });
});

describe("telling the doctor a draft is ready", () => {
  const notes = (userId: string, setId: string) =>
    test.client.query<{ type: string; data: Record<string, unknown> }>(
      `SELECT type, data FROM notifications
       WHERE "userId" = $1 AND data->>'setId' = $2`,
      [userId, setId]
    );

  it("once, with the way to it and what still needs the doctor", async () => {
    const set = await newDraft();
    await test.client.query(
      `UPDATE extracted_questions SET "aiStatus" = 'failed', "aiAttemptCount" = 3
       WHERE "bookId" = $1 AND "orderIndex" = 0`,
      [set.bookId]
    );
    expect(await notifyDraftReady(set.bookId)).toBe(true);
    expect(await notifyDraftReady(set.bookId)).toBe(false);
    const told = (await notes(IDS.doctorA, set.id)).rows;
    expect(told).toHaveLength(1);
    expect(told[0].type).toBe("question_set_ready");
    expect(told[0].data).toMatchObject({ setId: set.id, failed: 1 });
    expect(String(told[0].data.title)).toMatch(/^Anatomy /);
    // Nobody else is told.
    expect((await notes(IDS.doctorB, set.id)).rows).toHaveLength(0);
  });

  it("not while questions are still being prepared", async () => {
    const set = await newDraft();
    await test.client.query(
      `UPDATE extracted_questions SET "aiStatus" = 'pending'
       WHERE "bookId" = $1 AND "orderIndex" = 1`,
      [set.bookId]
    );
    expect(await notifyDraftReady(set.bookId)).toBe(false);
    expect((await notes(IDS.doctorA, set.id)).rows).toHaveLength(0);
  });

  it("not for a published set, and not for a file that is no doctor's set", async () => {
    const set = await newDraft();
    await publishQuestionSet(IDS.doctorA, set.id);
    expect(await notifyDraftReady(set.bookId)).toBe(false);
    expect(await notifyDraftReady("99999999-9999-4999-8999-999999999999")).toBe(
      false
    );
  });
});
