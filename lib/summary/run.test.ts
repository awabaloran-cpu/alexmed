import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDb,
  insertQuestionFile,
  insertUser,
  type TestDb,
} from "../test-fixtures/pglite-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));

const plan = vi.hoisted(() => ({ id: "free" }));
vi.mock("@/lib/billing/entitlement", () => ({
  getUserPlan: async () => plan,
}));

const invokeLLM = vi.hoisted(() => vi.fn());
vi.mock("@/lib/llm", async importOriginal => ({
  ...(await importOriginal<typeof import("../llm")>()),
  invokeLLM,
}));

const htmlToPdf = vi.hoisted(() => vi.fn());
vi.mock("@/lib/summary/pdf", () => ({ htmlToPdf }));

const storagePut = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage", () => ({ storagePut }));

const publishMessage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queue/client", () => ({ publishMessage }));

const tg = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  sendDocument: vi.fn(),
}));
vi.mock("@/lib/telegram/api", async importOriginal => ({
  ...(await importOriginal<typeof import("../telegram/api")>()),
  ...tg,
}));

import { AiUpstreamError } from "../ai/types";
import {
  HEAD_SYSTEM_PROMPT,
  PAGES_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
} from "./compose";
import { getSummary, requestSummary } from "./jobs";
import { runSummary } from "./run";

const STUDENT = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";
const ACCOUNT = "55555555-5555-4555-8555-555555555555";

let test: TestDb;

// A question file whose questions start on `pages` different pages.
async function fileWithPages(id: string, userId: string, pages: number) {
  await insertQuestionFile(test.client, { id, userId });
  for (let page = 1; page <= pages; page++) {
    await test.client.query(
      `INSERT INTO extracted_questions ("bookId", "orderIndex", "questionText", options, "extractedAnswerText", "sourcePage")
       VALUES ($1, $2, $3, '["A","B"]', 'A', $4)`,
      [id, page, `What is fact ${page}?`, page]
    );
  }
}

// The AI, answering each of the three kinds of call.
function aiAnswers() {
  invokeLLM.mockImplementation(async ({ messages }) => {
    const [system, user] = messages as { content: string }[];
    let content = "";
    if (system.content === PAGES_SYSTEM_PROMPT) {
      const pages = [...user.content.matchAll(/=== PAGE (\d+) ===/g)].map(
        m => m[1]
      );
      content = pages
        .map(n => `# Topic ${n}\n@pages ${n}\nFact ${n} explained.`)
        .join("\n");
    } else if (system.content === PLAN_SYSTEM_PROMPT) {
      content = "TOPIC: Everything\nPARTS: 1,2,3,4,5,6,7,8,9,10,11,12";
    } else if (system.content === HEAD_SYSTEM_PROMPT) {
      content =
        "TITLE: Facts Review\nSUBTITLE: All facts.\nSUBJECT: Facts\nLANG: en\n- Why?";
    }
    return { choices: [{ message: { content } }] };
  });
}

const ask = (overrides: Partial<Parameters<typeof requestSummary>[0]> = {}) =>
  requestSummary({
    userId: STUDENT,
    bookId: FILE,
    telegramAccountId: ACCOUNT,
    style: "full",
    theme: "mint",
    ...overrides,
  });

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  process.env.TELEGRAM_BOT_USERNAME = "Nirolearnbot";
}, 60_000);

beforeEach(async () => {
  await test.client.exec(`TRUNCATE users CASCADE`);
  vi.clearAllMocks();
  plan.id = "free";
  await insertUser(test.client, { id: STUDENT });
  await insertUser(test.client, { id: OTHER });
  await test.client.query(
    `INSERT INTO telegram_accounts (id, "telegramUserId", "chatId", "userId") VALUES ($1, 777, 777, $2)`,
    [ACCOUNT, STUDENT]
  );
  await fileWithPages(FILE, STUDENT, 12);
  aiAnswers();
  htmlToPdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  storagePut.mockImplementation(async (key: string) => ({ key, url: "" }));
  tg.sendMessage.mockResolvedValue(500);
  tg.editMessage.mockResolvedValue(true);
  tg.sendDocument.mockResolvedValue(501);
});

describe("requestSummary", () => {
  it("makes a job for the student's own finished file", async () => {
    const asked = await ask();
    expect(asked.ok && asked.summary).toMatchObject({
      status: "queued",
      sourcePages: 12,
      style: "full",
      theme: "mint",
    });
  });

  it("refuses someone else's file, and a guest", async () => {
    expect(await ask({ userId: OTHER })).toEqual({
      ok: false,
      reason: "not_found",
    });

    await test.client.query(
      `INSERT INTO users (id, name, role) VALUES ($1, 'guest', 'user')`,
      [GUEST]
    );
    await test.client.query(
      `INSERT INTO telegram_accounts ("telegramUserId", "chatId", "userId") VALUES (888, 888, $1)`,
      [GUEST]
    );
    const guestFile = "66666666-6666-4666-8666-666666666666";
    await fileWithPages(guestFile, GUEST, 3);
    expect(await ask({ userId: GUEST, bookId: guestFile })).toEqual({
      ok: false,
      reason: "guest",
    });
  });

  it("allows the free plan one summary a day, and not a second of the same file while it is written", async () => {
    expect((await ask()).ok).toBe(true);
    expect(await ask()).toEqual({ ok: false, reason: "in_progress" });

    const second = "77777777-7777-4777-8777-777777777777";
    await fileWithPages(second, STUDENT, 3);
    expect(await ask({ bookId: second })).toEqual({
      ok: false,
      reason: "daily_limit",
      limit: 1,
      paid: false,
    });

    plan.id = "pro";
    expect((await ask({ bookId: second })).ok).toBe(true);
  });

  it("limits the free plan to 40 pages", async () => {
    const long = "88888888-8888-4888-8888-888888888888";
    await fileWithPages(long, STUDENT, 41);
    expect(await ask({ bookId: long })).toEqual({
      ok: false,
      reason: "too_long",
      pages: 41,
      limit: 40,
      paid: false,
    });
    plan.id = "pro";
    expect((await ask({ bookId: long })).ok).toBe(true);
  });

  it("does not count a failed summary against the day", async () => {
    const first = await ask();
    if (!first.ok) throw new Error("expected a job");
    await test.client.query(
      `UPDATE file_summaries SET status = 'failed' WHERE id = $1`,
      [first.summary.id]
    );
    expect((await ask()).ok).toBe(true);
  });
});

describe("runSummary", () => {
  async function job() {
    const asked = await ask();
    if (!asked.ok) throw new Error("expected a job");
    await test.client.query(
      `UPDATE file_summaries SET "statusMessageId" = 400 WHERE id = $1`,
      [asked.summary.id]
    );
    return asked.summary.id;
  }

  it("writes the file a few pages at a time, then prints and sends the PDF", async () => {
    const id = await job();

    // Run 1: two calls of five pages.
    expect(await runSummary(id)).toBe("requeued");
    expect((await getSummary(id))!.donePages).toBe(10);
    expect(publishMessage).toHaveBeenLastCalledWith({
      type: "generate_file_summary",
      summaryId: id,
    });
    expect(htmlToPdf).not.toHaveBeenCalled();

    // Run 2: the last two pages.
    expect(await runSummary(id)).toBe("requeued");
    expect((await getSummary(id))!.donePages).toBe(12);

    // Run 3: chapters, cover, PDF.
    expect(await runSummary(id)).toBe("done");
    const done = (await getSummary(id))!;
    expect(done).toMatchObject({
      status: "complete",
      title: "Facts Review",
      fileKey: `summaries/${STUDENT}/${id}.pdf`,
    });
    // Twelve parts became the one chapter the plan asked for.
    expect(done.parts).toHaveLength(1);

    const html = htmlToPdf.mock.calls[0][0] as string;
    expect(html).toContain('data-theme="mint"');
    expect(html).toContain("Fact 12 explained.");
    // Signed with the student's own invite link.
    expect(html).toMatch(
      /href="https:\/\/t\.me\/Nirolearnbot\?start=[a-z]+_\w+"/
    );

    const [chatId, bytes, fileName, caption] = tg.sendDocument.mock.calls[0];
    expect(chatId).toBe(777);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(fileName).toBe("Facts Review - NiroLearn.pdf");
    expect(caption).toContain("Facts Review");
  });

  it("gives the AI the questions with their answers, never asking twice for the same pages", async () => {
    const id = await job();
    await runSummary(id);
    await runSummary(id);
    const pageCalls = invokeLLM.mock.calls
      .map(call => call[0].messages as { content: string }[])
      .filter(messages => messages[0].content === PAGES_SYSTEM_PROMPT);
    expect(pageCalls).toHaveLength(3);
    expect(pageCalls[0][1].content).toContain("Q: What is fact 1?");
    expect(pageCalls[0][1].content).toContain("Answer: A");
    const asked = pageCalls.flatMap(messages =>
      [...messages[1].content.matchAll(/=== PAGE (\d+) ===/g)].map(m =>
        Number(m[1])
      )
    );
    expect(asked).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("waits and tries again when the AI is down, keeping what was written", async () => {
    const id = await job();
    invokeLLM
      .mockImplementationOnce(invokeLLM.getMockImplementation()!)
      .mockRejectedValueOnce(new AiUpstreamError("502"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await runSummary(id)).toBe("requeued");
    logged.mockRestore();
    expect((await getSummary(id))!.donePages).toBe(5);
    expect(publishMessage).toHaveBeenLastCalledWith(
      { type: "generate_file_summary", summaryId: id },
      { delay: 30 }
    );
    expect(tg.sendDocument).not.toHaveBeenCalled();
  });

  it("gives up after repeated failures, tells the student and frees their day", async () => {
    const id = await job();
    invokeLLM.mockRejectedValue(new AiUpstreamError("502"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await runSummary(id));
    logged.mockRestore();

    expect(results).toEqual(["requeued", "requeued", "requeued", "failed"]);
    expect((await getSummary(id))!.status).toBe("failed");
    expect(tg.editMessage).toHaveBeenLastCalledWith(
      777,
      400,
      expect.stringContaining("لم يُحسب")
    );
    // A failed job is never run again, and the student can ask again today.
    expect(await runSummary(id)).toBe("skipped");
    aiAnswers();
    expect((await ask()).ok).toBe(true);
  });

  it("fails the job when the PDF cannot be printed, without losing the day", async () => {
    const id = await job();
    await runSummary(id);
    await runSummary(id);
    htmlToPdf.mockRejectedValue(new Error("no browser"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await runSummary(id));
    logged.mockRestore();

    expect(results.at(-1)).toBe("failed");
    expect(tg.sendDocument).not.toHaveBeenCalled();
    expect((await getSummary(id))!.status).toBe("failed");
  });
});
