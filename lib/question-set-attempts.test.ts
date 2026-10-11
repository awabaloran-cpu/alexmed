// A student's answers inside a doctor's set, on a real Postgres (PGlite).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  disableQuestionSet,
  generateAccessCodes,
  listSetStudents,
  publishQuestionSet,
  redeemAccessCode,
  revokeStudentAccess,
} from "./db-question-sets";
import {
  clearSetAttempts,
  listSetAttempts,
  saveSetAttempt,
} from "./question-set-attempts";

let test: TestDb;
let serial = 0;
const sara = { id: IDS.student1 };
const omar = { id: IDS.student2 };

// A published set (three questions, the right answer is always the first
// option) that Sara holds a code for.
async function setForSara() {
  const set = await createQuestionSet(
    IDS.doctorA,
    { title: `Set ${++serial}`, visibility: "unlisted" as const },
    { fileName: "a.pdf", fileKey: `book-pdfs/${IDS.doctorA}/${serial}.pdf` }
  );
  const { questionIds } = await simulatePipelineDone(test.client, set.bookId);
  await publishQuestionSet(IDS.doctorA, set.id);
  const codes = (await generateAccessCodes(IDS.doctorA, set.id, 1))!.codes;
  await redeemAccessCode(IDS.student1, codes[0], null);
  return { ...set, questionIds };
}

beforeAll(async () => {
  process.env.QUESTION_SET_CODE_HMAC_KEY = TEST_HMAC_KEY;
  test = await createTestDb();
  holder.db = test.db;
  await seedPeople(test.client);
}, 60_000);

beforeEach(async () => {
  await test.client.query(`DELETE FROM question_set_redeem_attempts`);
});

describe("a student's answers in a doctor's set", () => {
  it("are checked on the server, kept, and changed by answering again", async () => {
    const set = await setForSara();
    const [first, second] = set.questionIds;
    expect(await listSetAttempts(sara, set.id)).toEqual({});
    expect(
      await saveSetAttempt(sara, set.id, {
        questionId: first,
        selectedIndex: 0,
      })
    ).toEqual({ isCorrect: true });
    expect(
      await saveSetAttempt(sara, set.id, {
        questionId: second,
        selectedIndex: 2,
      })
    ).toEqual({ isCorrect: false });
    expect(await listSetAttempts(sara, set.id)).toEqual({
      [first]: 0,
      [second]: 2,
    });
    // Going through a wrong one again replaces the answer; it is one row.
    expect(
      await saveSetAttempt(sara, set.id, {
        questionId: second,
        selectedIndex: 0,
      })
    ).toEqual({ isCorrect: true });
    expect(await listSetAttempts(sara, set.id)).toEqual({
      [first]: 0,
      [second]: 0,
    });
  });

  it("are only this student's, and only for a set open to them", async () => {
    const set = await setForSara();
    const [first] = set.questionIds;
    await saveSetAttempt(sara, set.id, { questionId: first, selectedIndex: 1 });
    // Omar holds no code.
    expect(await listSetAttempts(omar, set.id)).toBeNull();
    expect(
      await saveSetAttempt(omar, set.id, {
        questionId: first,
        selectedIndex: 0,
      })
    ).toBeNull();
    expect(await clearSetAttempts(omar, set.id, false)).toBeNull();
    // The doctor opens their own set and sees their own (no) answers, not
    // Sara's.
    expect(await listSetAttempts({ id: IDS.doctorA }, set.id)).toEqual({});
    // A question of another set, or an option that does not exist, is
    // refused.
    const other = await setForSara();
    expect(
      await saveSetAttempt(sara, set.id, {
        questionId: other.questionIds[0],
        selectedIndex: 0,
      })
    ).toBeNull();
    expect(
      await saveSetAttempt(sara, set.id, {
        questionId: first,
        selectedIndex: 9,
      })
    ).toBeNull();
  });

  it("stop the moment the entitlement is revoked or the set is disabled", async () => {
    const set = await setForSara();
    const [first] = set.questionIds;
    await saveSetAttempt(sara, set.id, { questionId: first, selectedIndex: 0 });
    const [row] = await listSetStudents(IDS.doctorA, set.id);
    expect(
      await revokeStudentAccess(
        { id: IDS.doctorA, role: "doctor" },
        row.entitlementId
      )
    ).toBe(true);
    expect(await listSetAttempts(sara, set.id)).toBeNull();
    expect(
      await saveSetAttempt(sara, set.id, {
        questionId: first,
        selectedIndex: 1,
      })
    ).toBeNull();

    const closed = await setForSara();
    expect(
      await disableQuestionSet({ id: IDS.doctorA, role: "doctor" }, closed.id)
    ).toBe(true);
    expect(await listSetAttempts(sara, closed.id)).toBeNull();
  });

  it("can be started again: only the wrong ones, or all of them", async () => {
    const set = await setForSara();
    const [a, b, c] = set.questionIds;
    await saveSetAttempt(sara, set.id, { questionId: a, selectedIndex: 0 });
    await saveSetAttempt(sara, set.id, { questionId: b, selectedIndex: 3 });
    await saveSetAttempt(sara, set.id, { questionId: c, selectedIndex: 1 });
    expect(await clearSetAttempts(sara, set.id, true)).toBe(2);
    expect(await listSetAttempts(sara, set.id)).toEqual({ [a]: 0 });
    expect(await clearSetAttempts(sara, set.id, false)).toBe(1);
    expect(await listSetAttempts(sara, set.id)).toEqual({});
  });
});
