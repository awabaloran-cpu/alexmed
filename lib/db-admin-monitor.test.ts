// The admin's monitoring numbers on a real Postgres (PGlite).
import { beforeAll, describe, expect, it, vi } from "vitest";
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
vi.mock("./db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));

import { getAdminMonitor, STUCK_MINUTES } from "./db-admin-monitor";

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const USER = id(1);
const HEALTHY = id(101); // read, every question explained
const READING = id(102); // being read right now
const STUCK_READING = id(103); // "being read" for an hour
const FAILED = id(104);
const STALLED = id(105); // questions waiting, nothing moving
const BUSY = id(106); // questions waiting, one being written
const LONG = id(107); // a long bank: its first questions done, the rest deferred
const STOPPED = id(108); // stopped by an admin's hand

let test: TestDb;

const sqlRun = (text: string, values: unknown[] = []) =>
  test.client.query(text, values);

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  await insertUser(test.client, { id: USER, name: "Secret Student" });
  for (const [bookId, questions] of [
    [HEALTHY, 3],
    [READING, 0],
    [STUCK_READING, 0],
    [FAILED, 0],
    [STALLED, 4],
    [BUSY, 4],
    [LONG, 90],
    [STOPPED, 3],
  ] as const) {
    await insertQuestionFile(test.client, {
      id: bookId,
      userId: USER,
      fileKey: `uploads/secret/${bookId}.pdf`,
      questions,
    });
  }
  await sqlRun(
    `UPDATE extracted_questions SET "aiStatus" = 'complete' WHERE "bookId" = $1`,
    [HEALTHY]
  );
  await sqlRun(`UPDATE books SET status = 'extracting' WHERE id = $1`, [
    READING,
  ]);
  await sqlRun(
    `UPDATE books SET status = 'extracting', "updatedAt" = now() - interval '1 hour' WHERE id = $1`,
    [STUCK_READING]
  );
  await sqlRun(
    `UPDATE books SET status = 'failed', "extractionError" = 'تعذرت قراءة هذا الملف.' WHERE id = $1`,
    [FAILED]
  );
  for (const bookId of [STALLED, BUSY]) {
    await sqlRun(
      `UPDATE books SET "updatedAt" = now() - interval '2 hours' WHERE id = $1`,
      [bookId]
    );
    await sqlRun(
      `UPDATE extracted_questions SET "aiStatus" = 'pending' WHERE "bookId" = $1`,
      [bookId]
    );
    await sqlRun(
      `UPDATE question_file_pages SET "updatedAt" = now() - interval '2 hours' WHERE "bookId" = $1`,
      [bookId]
    );
  }
  await sqlRun(
    `UPDATE extracted_questions SET "aiStatus" = 'processing'
     WHERE id = (SELECT id FROM extracted_questions WHERE "bookId" = $1 LIMIT 1)`,
    [BUSY]
  );
  // A long file, quiet for hours: its first 40 are explained, the other 50
  // wait until a student gets near them. That is how it is meant to be.
  await sqlRun(
    `UPDATE books SET "updatedAt" = now() - interval '2 hours' WHERE id = $1`,
    [LONG]
  );
  await sqlRun(
    `UPDATE question_file_pages SET "updatedAt" = now() - interval '2 hours' WHERE "bookId" = $1`,
    [LONG]
  );
  await sqlRun(
    `UPDATE extracted_questions
     SET "aiStatus" = CASE WHEN "orderIndex" < 40 THEN 'complete' ELSE 'pending' END::extracted_question_ai_status
     WHERE "bookId" = $1`,
    [LONG]
  );
  await sqlRun(
    `UPDATE extracted_questions SET "aiStatus" = 'failed', "aiAttemptCount" = 3,
       "aiError" = 'stopped_by_admin' WHERE "bookId" = $1`,
    [STOPPED]
  );
  // Two questions that used up every attempt, with the same reason.
  await sqlRun(
    `UPDATE extracted_questions SET "aiStatus" = 'failed', "aiAttemptCount" = 3,
       "aiError" = 'تعذر توليد الشرح والكلمات المفتاحية لهذا السؤال.'
     WHERE id IN (SELECT id FROM extracted_questions WHERE "bookId" = $1 LIMIT 2)`,
    [HEALTHY]
  );
}, 60_000);

describe("what the admin sees of the system", () => {
  it("counts what is being read, what has stopped, and what failed", async () => {
    const monitor = await getAdminMonitor();
    expect(monitor.files).toMatchObject({
      readingNow: 2,
      stuckReading: 1,
      failed24h: 1,
    });
    expect(monitor.files.failureRate24h).toBeGreaterThan(0);
    expect(monitor.files.failureRate24h).toBeLessThan(1);
    expect(monitor.questions).toMatchObject({
      // STALLED's four and BUSY's other three.
      waiting: 7,
      // LONG's fifty wait on purpose.
      deferred: 50,
      writing: 1,
      // An admin's stop is not a failure.
      failed7d: 2,
      stoppedByAdmin7d: 3,
      stalledFiles: 1,
    });
    expect(STUCK_MINUTES).toBeGreaterThan(0);
  });

  it("names the files that have stopped, each once, with how long", async () => {
    const { stuck } = await getAdminMonitor();
    expect(stuck.map(file => [file.id, file.stage])).toEqual([
      [STUCK_READING, "reading"],
      [STALLED, "explaining"],
    ]);
    expect(stuck[0].minutes).toBeGreaterThanOrEqual(59);
    expect(stuck[1]).toMatchObject({ waiting: 4, kind: "question_file" });
    // A file with a question being written is working, not stuck — and
    // neither is a long file whose later questions wait for a student.
    expect(stuck.some(file => file.id === BUSY)).toBe(false);
    expect(stuck.some(file => file.id === LONG)).toBe(false);
  });

  it("groups the reasons things failed, most frequent first", async () => {
    const { reasons } = await getAdminMonitor();
    expect(reasons.files).toEqual([
      { reason: "تعذرت قراءة هذا الملف.", count: 1 },
    ]);
    expect(reasons.questions).toEqual([
      {
        reason: "تعذر توليد الشرح والكلمات المفتاحية لهذا السؤال.",
        count: 2,
      },
    ]);
    expect(reasons.pages).toEqual([]);
    // An admin's own stop is not listed among the reasons things failed.
    expect(JSON.stringify(reasons)).not.toContain("stopped_by_admin");
  });

  it("gives away no file key, no text of a file and no student's name", async () => {
    const said = JSON.stringify(await getAdminMonitor());
    expect(said).not.toMatch(/uploads\/secret|fileKey|storageKey/);
    expect(said).not.toContain("Secret Student");
    expect(said).not.toContain("Question 1?");
    expect(said).not.toContain(USER);
  });

  it("answers with zeros when there is no database, instead of failing", async () => {
    const kept = holder.db;
    holder.db = null;
    try {
      const monitor = await getAdminMonitor();
      expect(monitor.files.readingNow).toBe(0);
      expect(monitor.stuck).toEqual([]);
    } finally {
      holder.db = kept;
    }
  });
});
