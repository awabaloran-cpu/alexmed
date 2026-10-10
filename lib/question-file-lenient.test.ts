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

import {
  convertQuestionFileToBook,
  isOwnStudyBook,
  isProtectedQuestionSetBook,
} from "./db-question-files";
import { analyzeQuestionDocument } from "./question-document";
import { isBookNotQuestions } from "./question-file-quality";

const page = (text: string) => [{ page: 1, text }];

describe("a student's file is shown as the file gives it", () => {
  const ONE_OPTION = `1. Which nerve supplies the deltoid?
A. Axillary nerve
2. Which artery supplies the stomach?
A. Left gastric artery
3. Which bone forms the heel?
A. Calcaneus`;

  const MIXED = `1. Which nerve supplies the deltoid?
A. Axillary nerve
B. Radial nerve
C. Ulnar nerve
D. Median nerve
2. The femur is the longest bone.
A. True
B. False
3. Define the term homeostasis.
4. Which bone forms the heel?
A. Calcaneus
B. Talus
C. Navicular
D. Cuboid
5. Which artery supplies the stomach?
A. Left gastric artery`;

  it("two options only (A, B) was always a valid question", () => {
    const { questions, needsReview } = analyzeQuestionDocument(
      page("1. The heart has four chambers.\nA. True\nB. False")
    );
    expect(needsReview).toEqual([]);
    expect(questions[0].options).toEqual(["True", "False"]);
  });

  it("the strict reading still holds back one option and no options", () => {
    expect(analyzeQuestionDocument(page(ONE_OPTION)).questions).toEqual([]);
    const strict = analyzeQuestionDocument(page(MIXED));
    expect(strict.questions).toHaveLength(3);
    expect(strict.needsReview.flatMap(q => q.reasons).sort()).toEqual([
      "missing_options",
      "single_option",
    ]);
  });

  it("a student's file keeps them, with what the file gives and nothing added", () => {
    const one = analyzeQuestionDocument(page(ONE_OPTION), {
      acceptIncompleteOptions: true,
    });
    expect(one.needsReview).toEqual([]);
    expect(one.questions.map(q => q.options)).toEqual([
      ["Axillary nerve"],
      ["Left gastric artery"],
      ["Calcaneus"],
    ]);
    expect(one.questions.every(q => q.extractedAnswerIndex === null)).toBe(
      true
    );

    const mixed = analyzeQuestionDocument(page(MIXED), {
      acceptIncompleteOptions: true,
    });
    expect(mixed.needsReview).toEqual([]);
    expect(mixed.questions.map(q => q.orderIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(mixed.questions[2]).toMatchObject({
      questionText: "Define the term homeostasis.",
    });
    // What it was short of stays on the stored row.
    expect(mixed.all.map(q => [q.reviewStatus, q.reviewReason])).toEqual([
      [null, null],
      [null, null],
      [null, "incomplete_options:missing_options"],
      [null, null],
      [null, "incomplete_options:single_option"],
    ]);
  });

  it("a question whose stem is cut off is still held back", () => {
    const { questions, needsReview } = analyzeQuestionDocument(
      page(
        `1. Which vitamin deficiency causes scurvy?
A. Vitamin C
B. Vitamin D
C. Vitamin K
D. Vitamin A
2. The most common cause of
A. Infection`
      ),
      { acceptIncompleteOptions: true }
    );
    expect(questions.map(q => q.questionText)).toEqual([
      "Which vitamin deficiency causes scurvy?",
    ]);
    expect(needsReview.map(q => q.reasons)).toEqual([
      ["incomplete_stem", "single_option"],
    ]);
  });
});

describe("a study book uploaded under questions", () => {
  it("pages of prose with no questions are a book", () => {
    expect(
      isBookNotQuestions({ textPages: 40, blocks: 0, valid: 0, answerable: 0 })
    ).toBe(true);
    // The OSCE file measured on the live bot: 162 pages, 44 items, 12 with
    // options.
    expect(
      isBookNotQuestions({
        textPages: 162,
        blocks: 44,
        valid: 44,
        answerable: 12,
      })
    ).toBe(true);
  });

  it("a question file is never turned into a book", () => {
    // An ordinary bank.
    expect(
      isBookNotQuestions({
        textPages: 21,
        blocks: 37,
        valid: 37,
        answerable: 37,
      })
    ).toBe(false);
    // Open questions, no options at all: one on about every page.
    expect(
      isBookNotQuestions({
        textPages: 30,
        blocks: 30,
        valid: 30,
        answerable: 0,
      })
    ).toBe(false);
    // A bank the reader mostly could not put together.
    expect(
      isBookNotQuestions({ textPages: 10, blocks: 25, valid: 0, answerable: 0 })
    ).toBe(false);
    // Too short to tell.
    expect(
      isBookNotQuestions({ textPages: 2, blocks: 0, valid: 0, answerable: 0 })
    ).toBe(false);
    // Few questions on many pages, but real ones.
    expect(
      isBookNotQuestions({ textPages: 20, blocks: 8, valid: 8, answerable: 8 })
    ).toBe(false);
  });
});

describe("the same row becomes the book", () => {
  const OWNER = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const FILE = "33333333-3333-4333-8333-333333333333";
  const DONE = "44444444-4444-4444-8444-444444444444";
  const SET = "55555555-5555-4555-8555-555555555555";
  let test: TestDb;

  beforeAll(async () => {
    test = await createTestDb();
    holder.db = test.db;
    await insertUser(test.client, { id: OWNER });
    await insertUser(test.client, { id: OTHER });
    for (const id of [FILE, DONE, SET]) {
      await insertQuestionFile(test.client, {
        id,
        userId: OWNER,
        fileKey: `uploads/owner/${id}.pdf`,
        questions: 2,
      });
    }
    await test.client.query(
      `UPDATE books SET status = 'extracting' WHERE id IN ($1, $2)`,
      [FILE, SET]
    );
    await test.client.query(
      `INSERT INTO question_sets ("bookId", "ownerId", "title") VALUES ($1, $2, 'Set')`,
      [SET, OWNER]
    );
  }, 60_000);

  it("a student's file still being read becomes a study book, same id and file", async () => {
    expect(await isOwnStudyBook(OWNER, FILE)).toBe(false);
    expect(await convertQuestionFileToBook(FILE)).toBe(true);
    const row = await test.client.query<{
      sourceType: string;
      status: string;
      fileKey: string;
      questions: number;
    }>(
      `SELECT "sourceType", status, "fileKey",
         (SELECT count(*)::int FROM extracted_questions q WHERE q."bookId" = b.id) AS questions
       FROM books b WHERE id = $1`,
      [FILE]
    );
    expect(row.rows[0]).toEqual({
      sourceType: "study_book",
      status: "extracting",
      fileKey: `uploads/owner/${FILE}.pdf`,
      questions: 0,
    });
    expect(await isOwnStudyBook(OWNER, FILE)).toBe(true);
    expect(await isOwnStudyBook(OTHER, FILE)).toBe(false);
    expect(await isOwnStudyBook(OWNER, "not-an-id")).toBe(false);
    // Once only.
    expect(await convertQuestionFileToBook(FILE)).toBe(false);
  });

  it("a file already read, and a doctor's set, are left alone", async () => {
    expect(await convertQuestionFileToBook(DONE)).toBe(false);
    expect(await isProtectedQuestionSetBook(SET)).toBe(true);
    expect(await isProtectedQuestionSetBook(DONE)).toBe(false);
    expect(await convertQuestionFileToBook(SET)).toBe(false);
    const rows = await test.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM extracted_questions WHERE "bookId" IN ($1, $2)`,
      [DONE, SET]
    );
    expect(rows.rows[0].n).toBe(4);
  });
});
