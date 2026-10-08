// Saved answers and the guest → account upgrade, on a real Postgres (PGlite).
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

import {
  listQuestionAttempts,
  saveQuestionAttempt,
} from "./db-question-attempts";
import { upgradeGuestWithVerifiedPhone } from "./db-phone";

let test: TestDb;
const OWNER = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const BOOK = "00000000-0000-4000-8000-0000000000c1";

async function questionIds() {
  const result = await test.client.query<{ id: string }>(
    `SELECT id FROM extracted_questions WHERE "bookId" = $1 ORDER BY "orderIndex"`,
    [BOOK]
  );
  return result.rows.map(row => row.id);
}

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
});

beforeEach(async () => {
  await test.client.exec(`TRUNCATE users CASCADE; TRUNCATE phone_verifications`);
  await insertUser(test.client, { id: OWNER });
  await insertUser(test.client, { id: OTHER });
  // The fixture's questions have 4 options and answer index 1.
  await insertQuestionFile(test.client, { id: BOOK, userId: OWNER, questions: 3 });
});

describe("question attempts", () => {
  it("checks the answer on the server and keeps the latest choice", async () => {
    const [first] = await questionIds();
    expect(
      await saveQuestionAttempt(OWNER, { bookId: BOOK, questionId: first, selectedIndex: 0 })
    ).toEqual({ isCorrect: false });
    expect(
      await saveQuestionAttempt(OWNER, { bookId: BOOK, questionId: first, selectedIndex: 1 })
    ).toEqual({ isCorrect: true });

    expect(await listQuestionAttempts(OWNER, BOOK)).toEqual({ [first]: 1 });
    const stored = await test.client.query(`SELECT id FROM question_attempts`);
    expect(stored.rows).toHaveLength(1);
  });

  it("returns a student's progress across the file", async () => {
    const [a, b] = await questionIds();
    await saveQuestionAttempt(OWNER, { bookId: BOOK, questionId: a, selectedIndex: 1 });
    await saveQuestionAttempt(OWNER, { bookId: BOOK, questionId: b, selectedIndex: 3 });
    expect(await listQuestionAttempts(OWNER, BOOK)).toEqual({ [a]: 1, [b]: 3 });
  });

  it("refuses another student's file, a foreign question and an option that does not exist", async () => {
    const [first] = await questionIds();
    expect(
      await saveQuestionAttempt(OTHER, { bookId: BOOK, questionId: first, selectedIndex: 1 })
    ).toBeNull();
    expect(
      await saveQuestionAttempt(OWNER, {
        bookId: "00000000-0000-4000-8000-0000000000ff",
        questionId: first,
        selectedIndex: 1,
      })
    ).toBeNull();
    expect(
      await saveQuestionAttempt(OWNER, { bookId: BOOK, questionId: first, selectedIndex: 9 })
    ).toBeNull();
    expect(await listQuestionAttempts(OTHER, BOOK)).toEqual({});
  });

  it("stores no verdict for a question with no known answer", async () => {
    const [first] = await questionIds();
    await test.client.query(
      `UPDATE extracted_questions SET "extractedAnswerIndex" = NULL WHERE id = $1`,
      [first]
    );
    expect(
      await saveQuestionAttempt(OWNER, { bookId: BOOK, questionId: first, selectedIndex: 2 })
    ).toEqual({ isCorrect: null });
  });

  it("never accepts an answer to a question hidden for review", async () => {
    const [first] = await questionIds();
    await test.client.query(
      `UPDATE extracted_questions SET "reviewStatus" = 'needs_review' WHERE id = $1`,
      [first]
    );
    expect(
      await saveQuestionAttempt(OWNER, { bookId: BOOK, questionId: first, selectedIndex: 1 })
    ).toBeNull();
  });

  it("attempts go when the file or the account goes", async () => {
    const [first] = await questionIds();
    await saveQuestionAttempt(OWNER, { bookId: BOOK, questionId: first, selectedIndex: 1 });
    await test.client.query(`DELETE FROM users WHERE id = $1`, [OWNER]);
    const left = await test.client.query(`SELECT id FROM question_attempts`);
    expect(left.rows).toHaveLength(0);
  });
});

describe("a Telegram guest registering", () => {
  const GUEST = "00000000-0000-4000-8000-0000000000d1";

  async function verifiedPhone(phone: string) {
    const result = await test.client.query<{ id: string }>(
      `INSERT INTO phone_verifications (phone, status, "expiresAt", "verifiedAt")
       VALUES ($1, 'verified', now() + interval '10 minutes', now()) RETURNING id`,
      [phone]
    );
    return result.rows[0].id;
  }

  beforeEach(async () => {
    await test.client.query(`INSERT INTO users (id, name) VALUES ($1, 'ضيف Telegram')`, [GUEST]);
  });

  it("completes the same account, so the guest's files stay theirs", async () => {
    await insertQuestionFile(test.client, {
      id: "00000000-0000-4000-8000-0000000000c2",
      userId: GUEST,
      questions: 1,
    });
    const outcome = await upgradeGuestWithVerifiedPhone({
      userId: GUEST,
      verificationId: await verifiedPhone("+962790000010"),
      name: "Sara",
      password: "a-strong-password",
    });

    expect(outcome).toEqual({ ok: true, userId: GUEST, phone: "+962790000010" });
    const user = await test.client.query<{ phone: string; name: string; passwordHash: string }>(
      `SELECT phone, name, "passwordHash" FROM users WHERE id = $1`,
      [GUEST]
    );
    expect(user.rows[0]).toMatchObject({ phone: "+962790000010", name: "Sara" });
    expect(user.rows[0].passwordHash).not.toBe("a-strong-password");
    const owned = await test.client.query(`SELECT id FROM books WHERE "userId" = $1`, [GUEST]);
    expect(owned.rows).toHaveLength(1);
  });

  it("never rewrites an account that is already registered", async () => {
    const outcome = await upgradeGuestWithVerifiedPhone({
      userId: OWNER,
      verificationId: await verifiedPhone("+962790000011"),
      name: "Attacker",
      password: "a-strong-password",
    });
    expect(outcome).toEqual({ ok: false, error: "not_guest" });
    const user = await test.client.query<{ name: string; phone: string | null }>(
      `SELECT name, phone FROM users WHERE id = $1`,
      [OWNER]
    );
    expect(user.rows[0]).toMatchObject({ name: "Test user", phone: null });
    // The verified code was not spent by the refused attempt.
    const code = await test.client.query<{ status: string }>(`SELECT status FROM phone_verifications`);
    expect(code.rows[0].status).toBe("verified");
  });

  it("refuses a number that already has an account, and an unverified code", async () => {
    await test.client.query(`UPDATE users SET phone = '+962790000012' WHERE id = $1`, [OTHER]);
    expect(
      await upgradeGuestWithVerifiedPhone({
        userId: GUEST,
        verificationId: await verifiedPhone("+962790000012"),
        name: "Sara",
        password: "a-strong-password",
      })
    ).toEqual({ ok: false, error: "phone_taken" });
    expect(
      await upgradeGuestWithVerifiedPhone({
        userId: GUEST,
        verificationId: "00000000-0000-4000-8000-0000000000ee",
        name: "Sara",
        password: "a-strong-password",
      })
    ).toEqual({ ok: false, error: "not_verified" });
  });
});
