import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestDb,
  insertQuestionFile,
  insertUser,
  type TestDb,
} from "./test-fixtures/pglite-db";

const holder = vi.hoisted(() => ({
  db: null as unknown,
  published: [] as { message: Record<string, unknown>; options: unknown }[],
}));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));
vi.mock("@/lib/queue/client", () => ({
  publishMessage: vi.fn(async (message, options) => {
    holder.published.push({ message, options });
  }),
}));

import {
  getNextPendingExtractedQuestion,
  getNextPendingQuestionFilePage,
  getQuestionFileCoverage,
  getQuestionsHeldBack,
} from "./db-question-file-images";
import { prepareQuestionsFrom } from "./question-file-progress";
import {
  buildQuestionWindow,
  getQuestionFileWindow,
  readRequestedSpan,
  WINDOW_AHEAD,
  WINDOW_FIRST_QUESTIONS,
} from "./question-file-window";

describe("which questions of a file are worked on now", () => {
  it("a short file has no window: it is done whole, as before", () => {
    expect(buildQuestionWindow(0, [])).toBeNull();
    expect(
      buildQuestionWindow(WINDOW_FIRST_QUESTIONS + WINDOW_AHEAD - 1, [])
    ).toBeNull();
  });

  it("a long file starts with its first questions only", () => {
    expect(buildQuestionWindow(999, [])).toEqual([[0, 39]]);
  });

  it("follows the answers: the questions ahead of each one", () => {
    // Answering inside the first stretch pushes its end forward.
    expect(buildQuestionWindow(999, [0, 1, 25])).toEqual([[0, 55]]);
    // A jump far ahead opens its own stretch.
    expect(buildQuestionWindow(999, [5, 500])).toEqual([
      [0, 39],
      [500, 530],
    ]);
    // Stretches that meet become one; the file's end is the limit.
    expect(buildQuestionWindow(999, [39, 69, 990])).toEqual([
      [0, 99],
      [990, 999],
    ]);
  });

  it("adds the stretch a student has just reached", () => {
    expect(buildQuestionWindow(999, [], { from: 200, to: 230 })).toEqual([
      [0, 39],
      [200, 230],
    ]);
  });

  it("is the whole file again once everything is wanted", () => {
    const everyTenth = Array.from({ length: 100 }, (_, i) => i * 10);
    expect(buildQuestionWindow(999, everyTenth)).toBeNull();
  });

  it("reads a span from a queue message, and nothing from a bad one", () => {
    expect(readRequestedSpan({ from: 40, to: 70 })).toEqual({
      from: 40,
      to: 70,
    });
    expect(readRequestedSpan({})).toBeUndefined();
    expect(readRequestedSpan({ from: 70, to: 40 })).toBeUndefined();
    expect(readRequestedSpan({ from: -1, to: 4 })).toBeUndefined();
    expect(readRequestedSpan({ from: "x", to: 4 })).toBeUndefined();
  });
});

// ── On a real database: a 200-question file, two questions a page ─────────
const OWNER = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const BOOK = "33333333-3333-4333-8333-333333333333";
const SHORT_BOOK = "44444444-4444-4444-8444-444444444444";
const DOCTOR = "55555555-5555-4555-8555-555555555555";
const SET_BOOK = "66666666-6666-4666-8666-666666666666";
const TOTAL = 200;
const PAGES = TOTAL / 2;

let test: TestDb;

async function fill(bookId: string, total: number) {
  for (let i = 0; i < total; i++) {
    await test.client.query(
      `INSERT INTO extracted_questions ("bookId", "orderIndex", "questionText", options, "extractedAnswerIndex", "sourcePage", "aiStatus")
       VALUES ($1, $2, $3, '["A","B","C","D"]', 0, $4, 'pending')`,
      [bookId, i, `Question ${i}?`, Math.floor(i / 2) + 1]
    );
  }
  for (let page = 1; page <= Math.ceil(total / 2); page++) {
    await test.client.query(
      `INSERT INTO question_file_pages ("bookId", "pageNumber", status) VALUES ($1, $2, 'pending')`,
      [bookId, page]
    );
  }
}

const questionId = async (bookId: string, orderIndex: number) =>
  (
    await test.client.query<{ id: string }>(
      `SELECT id FROM extracted_questions WHERE "bookId" = $1 AND "orderIndex" = $2`,
      [bookId, orderIndex]
    )
  ).rows[0].id;

async function answer(orderIndex: number) {
  await test.client.query(
    `INSERT INTO question_attempts ("userId", "bookId", "questionId", "selectedIndex", "isCorrect")
     VALUES ($1, $2, $3, 0, true)`,
    [STUDENT, BOOK, await questionId(BOOK, orderIndex)]
  );
}

// Runs both stages to the end of what the window asks for, the way the
// workers do, and says what was touched.
async function runPipeline(span?: { from: number; to: number }) {
  const window = await getQuestionFileWindow(BOOK, span);
  const pages: number[] = [];
  for (let guard = 0; guard < 1000; guard++) {
    const page = await getNextPendingQuestionFilePage(BOOK, window);
    if (!page) break;
    pages.push(page.pageNumber);
    await test.client.query(
      `UPDATE question_file_pages SET status = 'complete' WHERE id = $1`,
      [page.id]
    );
  }
  const questions: number[] = [];
  for (let guard = 0; guard < 1000; guard++) {
    const question = await getNextPendingExtractedQuestion(BOOK, window);
    if (!question) break;
    questions.push(question.orderIndex);
    await test.client.query(
      `UPDATE extracted_questions SET "aiStatus" = 'complete', "aiExplanationAr" = 'شرح' WHERE id = $1`,
      [question.id]
    );
  }
  return { window, pages, questions };
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("a long question file is prepared as it is studied", () => {
  beforeAll(async () => {
    test = await createTestDb();
    holder.db = test.db;
    await insertUser(test.client, { id: OWNER });
    await insertUser(test.client, { id: STUDENT });
    await insertUser(test.client, { id: DOCTOR });
    await insertQuestionFile(test.client, { id: BOOK, userId: OWNER });
    await insertQuestionFile(test.client, { id: SHORT_BOOK, userId: OWNER });
    await insertQuestionFile(test.client, { id: SET_BOOK, userId: DOCTOR });
    await fill(BOOK, TOTAL);
    await fill(SHORT_BOOK, 12);
    await fill(SET_BOOK, TOTAL);
    await test.client.query(
      `INSERT INTO question_sets ("ownerId", "bookId", title) VALUES ($1, $2, 'Set')`,
      [DOCTOR, SET_BOOK]
    );
  }, 120_000);

  beforeEach(() => {
    holder.published.length = 0;
    delete process.env.QUESTION_FILE_PROGRESSIVE;
  });
  afterEach(() => {
    delete process.env.QUESTION_FILE_PROGRESSIVE;
  });

  it("a short file, a doctor's set and the switch turned off are done whole", async () => {
    expect(await getQuestionFileWindow(SHORT_BOOK)).toBeNull();
    expect(await getQuestionFileWindow(SET_BOOK)).toBeNull();
    process.env.QUESTION_FILE_PROGRESSIVE = "false";
    expect(await getQuestionFileWindow(BOOK)).toBeNull();
  });

  it("1. after the upload only the first questions and their pages are worked on", async () => {
    const run = await runPipeline();
    expect(run.window).toEqual([[0, 39]]);
    expect(run.questions).toEqual(range(0, 39));
    // Their 20 pages, and the one after the last (a figure may sit there).
    expect(run.pages).toEqual(range(1, 21));

    // Nothing is owed now: the page stops asking, the workers stop.
    const window = await getQuestionFileWindow(BOOK);
    const coverage = await getQuestionFileCoverage(BOOK, window);
    expect(coverage).toMatchObject({
      questionsTotal: TOTAL,
      questionsAiComplete: 40,
      imagePagesTotal: PAGES,
      done: true,
    });
    expect(await getQuestionsHeldBack(BOOK, window)).toEqual({
      waiting: 0,
      pagesStalled: false,
    });
    // Without the window the same file still reads as unfinished.
    expect((await getQuestionFileCoverage(BOOK)).done).toBe(false);
  });

  it("2. an answer near the end of what is ready starts the questions ahead", async () => {
    await answer(20);
    expect(await prepareQuestionsFrom(BOOK, await questionId(BOOK, 20))).toBe(
      true
    );
    expect(holder.published).toHaveLength(1);
    expect(holder.published[0].message).toEqual({
      type: "extract_question_file_images",
      bookId: BOOK,
      from: 20,
      to: 50,
    });
    expect(
      (holder.published[0].options as { deduplicationId: string })
        .deduplicationId
    ).toMatch(new RegExp(`^qf-window-${BOOK}-2-\\d+$`));

    // The window now reaches 30 questions past the answer.
    expect(
      (await getQuestionFileCoverage(BOOK, await getQuestionFileWindow(BOOK)))
        .done
    ).toBe(false);
    const run = await runPipeline();
    expect(run.window).toEqual([[0, 50]]);
    expect(run.questions).toEqual(range(40, 50));
    expect(run.pages).toEqual(range(22, 27));
  });

  it("3. nothing is started when the questions ahead are already prepared", async () => {
    expect(await prepareQuestionsFrom(BOOK, await questionId(BOOK, 5))).toBe(
      false
    );
    expect(holder.published).toHaveLength(0);
  });

  it("4. a jump to a far question prepares that place, not everything before it", async () => {
    const far = await questionId(BOOK, 150);
    expect(await prepareQuestionsFrom(BOOK, far)).toBe(true);
    const span = { from: 150, to: 180 };
    expect(holder.published[0].message).toMatchObject(span);

    // The worker gets the span from the message: nothing is stored.
    const run = await runPipeline(span);
    expect(run.window).toEqual([
      [0, 50],
      [150, 180],
    ]);
    expect(run.questions).toEqual(range(150, 180));
    expect(run.pages).toEqual(range(76, 92));
    // Questions 51–149 were left alone.
    const left = await test.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM extracted_questions WHERE "bookId" = $1 AND "aiStatus" = 'pending'`,
      [BOOK]
    );
    expect(left.rows[0].n).toBe(TOTAL - 51 - 31);
  });

  it("5. a question waits for its own pages, not for the pages before it", async () => {
    // Page 96 (questions 190–191) is still being looked at.
    await answer(188);
    const window = await getQuestionFileWindow(BOOK);
    await test.client.query(
      `UPDATE question_file_pages SET status = 'complete' WHERE "bookId" = $1 AND "pageNumber" IN (95, 97, 98, 99, 100)`,
      [BOOK]
    );
    const taken: number[] = [];
    for (let guard = 0; guard < 50; guard++) {
      const question = await getNextPendingExtractedQuestion(BOOK, window);
      if (!question) break;
      taken.push(question.orderIndex);
      await test.client.query(
        `UPDATE extracted_questions SET "aiStatus" = 'complete' WHERE id = $1`,
        [question.id]
      );
    }
    // 188–189 sit on page 95 but may own a figure on page 96; 190–191 are
    // on page 96 itself. From 192 on, the pages are settled.
    expect(taken).toEqual(range(192, 199));
    expect((await getQuestionsHeldBack(BOOK, window)).waiting).toBe(4);
  });

  it("6. a doctor's set and a short file never start a partial run", async () => {
    expect(
      await prepareQuestionsFrom(SET_BOOK, await questionId(SET_BOOK, 3))
    ).toBe(false);
    expect(await prepareQuestionsFrom(BOOK, DOCTOR)).toBe(false);
    expect(holder.published).toHaveLength(0);

    // A short file is explained whole by its own run. With questions still
    // owed and none being explained, that run has stopped (a long AI
    // outage, a restart): it is started again — whole, never a span.
    const short = await questionId(SHORT_BOOK, 3);
    expect(await prepareQuestionsFrom(SHORT_BOOK, short)).toBe(true);
    expect(holder.published).toHaveLength(1);
    expect(holder.published[0].message).toEqual({
      type: "generate_question_file_content",
      bookId: SHORT_BOOK,
    });
    expect(holder.published[0].options).toMatchObject({
      flowControl: {
        key: `question-file-content-${SHORT_BOOK}`,
        parallelism: 1,
      },
      deduplicationId: expect.stringMatching(
        new RegExp(`^qf-resume-${SHORT_BOOK}-\\d+$`)
      ),
    });

    // While its run is explaining a question, nothing more is started.
    holder.published.length = 0;
    await test.client.query(
      `UPDATE extracted_questions SET "aiStatus" = 'processing' WHERE id = $1`,
      [short]
    );
    expect(await prepareQuestionsFrom(SHORT_BOOK, short)).toBe(true);
    expect(holder.published).toHaveLength(0);
    await test.client.query(
      `UPDATE extracted_questions SET "aiStatus" = 'pending' WHERE id = $1`,
      [short]
    );
    // A set is handed out whole, exactly as before.
    const page = await getNextPendingQuestionFilePage(
      SET_BOOK,
      await getQuestionFileWindow(SET_BOOK)
    );
    expect(page?.pageNumber).toBe(1);
  });
});
