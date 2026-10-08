// ✈️ The Telegram gateway end to end on a real Postgres (PGlite): identity,
// the bot's handling of a file, the queue steps, links and sessions.
// Telegram itself, the queue, storage and the plan guard are replaced by
// spies — everything between them is the real code and the real SQL.
import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
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
  insertUser,
  type TestDb,
} from "../test-fixtures/pglite-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));

const tg = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  answerCallback: vi.fn(),
  getFileDownloadUrl: vi.fn(),
}));
vi.mock("@/lib/telegram/api", async importOriginal => ({
  ...(await importOriginal<typeof import("./api")>()),
  ...tg,
}));

const publishMessage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queue/client", () => ({ publishMessage }));

const storage = vi.hoisted(() => ({
  storageGetUploadUrl: vi.fn(),
  deleteObject: vi.fn(),
}));
vi.mock("@/lib/storage", () => storage);

const admitUpload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/upload-guard", () => ({ admitUpload }));

const readLeadingPages = vi.hoisted(() => vi.fn());
vi.mock("@/lib/telegram/pdf-sample", () => ({ readLeadingPages }));

import {
  ensureTelegramAccount,
  findTelegramAccount,
  isTelegramGuest,
  linkTelegramToAccount,
} from "./accounts";
import { handleTelegramUpdate, type TelegramUpdate } from "./handler";
import {
  retryTelegramUpload,
  runTelegramIntake,
  runTelegramWatch,
} from "./intake";
import { BUTTONS, CALLBACK, LABELS, TEXT } from "./messages";
import {
  consumeLinkToken,
  createLinkToken,
  findLinkToken,
  hashToken,
  revokeLinkTokens,
  safeInternalPath,
} from "./tokens";
import {
  checkPhoneVerification,
  createAccountWithVerifiedPhone,
} from "../db-phone";
import {
  claimTelegramPhoneVerification,
  getPhoneVerificationStatus,
  startTelegramPhoneVerification,
} from "./phone-verify";
import { MAX_BONUS_UPLOADS, parseStartOrigin, sourceReport } from "./growth";
import { validateInitData } from "./webapp";
import { isSameOriginPost, resolveWebLogin } from "./web-session";

let test: TestDb;

const TG_USER = 555001;
const REGISTERED = "00000000-0000-4000-8000-0000000000a1";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nfake body\n%%EOF");

const QUESTION_PAGE = Array.from(
  { length: 6 },
  (_, i) =>
    `${i + 1}. Which of the following is the most likely diagnosis in this child?\n` +
    "A. Epiglottitis\nB. Croup\nC. Bronchiolitis\nD. Asthma\n"
).join("\n");
const PROSE_PAGE =
  "The respiratory system of the child differs from that of the adult in several important ways. " +
  "The airways are narrower and more compliant, which increases resistance to airflow during illness. " +
  "This chapter reviews the anatomy and physiology that underlie common paediatric presentations.";

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await test.client.query<T>(sql, params)).rows;
}

let nextUpdateId = 1000;
function documentUpdate(
  overrides: {
    from?: number;
    size?: number;
    name?: string;
    mime?: string;
    unique?: string;
    updateId?: number;
  } = {}
): TelegramUpdate {
  const from = overrides.from ?? TG_USER;
  return {
    update_id: overrides.updateId ?? nextUpdateId++,
    message: {
      message_id: 1,
      from: { id: from, language_code: "ar" },
      chat: { id: from, type: "private" },
      document: {
        file_id: "file-id",
        file_unique_id: overrides.unique ?? `unique-${nextUpdateId}`,
        file_name: overrides.name ?? "Pediatrics_MCQs.pdf",
        mime_type: overrides.mime ?? "application/pdf",
        file_size: overrides.size ?? 2 * 1024 * 1024,
      },
    },
  };
}

function textUpdate(text: string, from = TG_USER): TelegramUpdate {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: 1,
      from: { id: from, language_code: "ar" },
      chat: { id: from, type: "private" },
      text,
    },
  };
}

function lastSent(): { text: string; markup: unknown } {
  const call = tg.sendMessage.mock.calls.at(-1)!;
  return { text: call[1] as string, markup: call[2] };
}

async function onlyUpload() {
  const [upload] = await rows<{
    id: string;
    status: string;
    kind: string | null;
    bookId: string | null;
    error: string | null;
  }>(`SELECT id, status, kind, "bookId", error FROM telegram_uploads`);
  return upload;
}

// Sends a PDF and runs the intake worker, as the queue would.
async function uploadAndIntake(options: { kind?: "questions" | "book" } = {}) {
  readLeadingPages.mockResolvedValue(
    options.kind === "book"
      ? [1, 2, 3, 4].map(page => ({ page, text: PROSE_PAGE }))
      : [{ page: 1, text: QUESTION_PAGE }]
  );
  await handleTelegramUpdate(documentUpdate());
  const upload = await onlyUpload();
  await runTelegramIntake(upload.id);
  return (await onlyUpload())!;
}

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
  process.env.TELEGRAM_WEBHOOK_SECRET = "hook-secret";
  process.env.TELEGRAM_ENABLED = "true";
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  // Booting PGlite and applying every migration can outlast the default
  // hook timeout while the whole suite runs in parallel.
}, 60_000);

beforeEach(async () => {
  await test.client.exec(`TRUNCATE users CASCADE; TRUNCATE phone_verifications`);
  vi.clearAllMocks();
  delete process.env.TELEGRAM_API_BASE;
  delete process.env.TELEGRAM_MAX_FILE_MB;
  delete process.env.TELEGRAM_DAILY_UPLOAD_CAP;
  delete process.env.TELEGRAM_ACCOUNT_BURST_LIMIT;
  delete process.env.TELEGRAM_GUEST_FREE_UPLOADS;
  delete process.env.TELEGRAM_MINI_APP;
  let messageId = 100;
  tg.sendMessage.mockImplementation(async () => messageId++);
  tg.editMessage.mockResolvedValue(true);
  tg.getFileDownloadUrl.mockResolvedValue("https://tg.example/file.pdf");
  storage.storageGetUploadUrl.mockResolvedValue("https://r2.example/put");
  storage.deleteObject.mockResolvedValue(undefined);
  admitUpload.mockResolvedValue({ receipt: {}, release: vi.fn() });
  readLeadingPages.mockResolvedValue([{ page: 1, text: QUESTION_PAGE }]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Response(null, { status: 200 })
        : new Response(PDF_BYTES, { status: 200 })
    )
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Telegram identity", () => {
  it("creates one guest account per Telegram user, and never reuses the Telegram id as a user id", async () => {
    const first = await ensureTelegramAccount({ telegramUserId: TG_USER, chatId: TG_USER });
    const again = await ensureTelegramAccount({ telegramUserId: TG_USER, chatId: TG_USER });

    expect(first.user.isGuest).toBe(true);
    expect(again.user.id).toBe(first.user.id);
    expect(first.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await rows(`SELECT id FROM users`)).toHaveLength(1);
    expect(await isTelegramGuest(first.user.id)).toBe(true);
  });

  it("simultaneous first messages from one user still make a single account", async () => {
    await Promise.all([
      ensureTelegramAccount({ telegramUserId: TG_USER, chatId: TG_USER }),
      ensureTelegramAccount({ telegramUserId: TG_USER, chatId: TG_USER }),
    ]);
    expect(await rows(`SELECT id FROM telegram_accounts`)).toHaveLength(1);
    expect(await rows(`SELECT id FROM users`)).toHaveLength(1);
  });

  it("links a registered account with a one-time code", async () => {
    await insertUser(test.client, { id: REGISTERED });
    const code = await createLinkToken({
      userId: REGISTERED,
      purpose: "telegram_link",
      ttlMinutes: 10,
    });

    await handleTelegramUpdate(textUpdate(`/start link_${code}`));
    expect(lastSent().text).toBe(TEXT.linked);
    const account = await findTelegramAccount(TG_USER);
    expect(account?.user.id).toBe(REGISTERED);
    expect(account?.user.isGuest).toBe(false);

    // The same code again does nothing for another Telegram user.
    const second = await linkTelegramToAccount(code, { telegramUserId: 777, chatId: 777 });
    expect(second).toEqual({ ok: false, reason: "invalid_code" });
  });

  it("moves an empty guest onto the registered account and removes the guest", async () => {
    await insertUser(test.client, { id: REGISTERED });
    const guest = await ensureTelegramAccount({ telegramUserId: TG_USER, chatId: TG_USER });
    const code = await createLinkToken({ userId: REGISTERED, purpose: "telegram_link", ttlMinutes: 10 });

    expect(await linkTelegramToAccount(code, { telegramUserId: TG_USER, chatId: TG_USER })).toEqual({ ok: true });
    expect((await findTelegramAccount(TG_USER))?.user.id).toBe(REGISTERED);
    expect(await rows(`SELECT id FROM users WHERE id = $1`, [guest.user.id])).toHaveLength(0);
  });

  it("a guest with files who links an existing account keeps everything: files, folder, answers", async () => {
    await insertUser(test.client, { id: REGISTERED });
    const uploaded = await uploadAndIntake();
    const guestId = (await findTelegramAccount(TG_USER))!.user.id;
    await test.client.query(
      `INSERT INTO extracted_questions ("bookId", "orderIndex", "questionText", options, "extractedAnswerIndex", "sourcePage")
       VALUES ($1, 0, 'Q?', '["A","B"]', 1, 1)`,
      [uploaded.bookId]
    );
    await test.client.query(
      `INSERT INTO question_attempts ("userId", "bookId", "questionId", "selectedIndex", "isCorrect")
       SELECT $1, "bookId", id, 1, true FROM extracted_questions WHERE "bookId" = $2`,
      [guestId, uploaded.bookId]
    );
    const code = await createLinkToken({ userId: REGISTERED, purpose: "telegram_link", ttlMinutes: 10 });

    await handleTelegramUpdate(textUpdate(`/start link_${code}`));
    expect(lastSent().text).toBe(TEXT.linked);

    const account = await findTelegramAccount(TG_USER);
    expect(account?.user).toMatchObject({ id: REGISTERED, isGuest: false });
    expect(await rows(`SELECT id FROM users WHERE id = $1`, [guestId])).toHaveLength(0);
    for (const table of ["books", "subjects", "question_attempts"]) {
      const owned = await rows<{ userId: string }>(`SELECT "userId" FROM ${table}`);
      expect(owned.map(row => row.userId)).toEqual([REGISTERED]);
    }
    // The upload still points at the same book, now the account's.
    expect((await onlyUpload()).bookId).toBe(uploaded.bookId);
  });

  it("merging keeps the account's own row where only one is allowed, and one Telegram folder", async () => {
    await insertUser(test.client, { id: REGISTERED });
    await uploadAndIntake();
    const guestId = (await findTelegramAccount(TG_USER))!.user.id;
    await test.client.query(`INSERT INTO subjects ("userId", name) VALUES ($1, 'Telegram')`, [REGISTERED]);
    // Both accounts used the assistant today: one counter per (user, day).
    for (const [userId, used] of [[REGISTERED, 7], [guestId, 2]]) {
      await test.client.query(
        `INSERT INTO usage_daily ("userId", day, "assistantMessages") VALUES ($1, '2026-10-08', $2)`,
        [userId, used]
      );
    }
    const code = await createLinkToken({ userId: REGISTERED, purpose: "telegram_link", ttlMinutes: 10 });

    expect(await linkTelegramToAccount(code, { telegramUserId: TG_USER, chatId: TG_USER })).toEqual({ ok: true });
    const usage = await rows<{ userId: string; assistantMessages: number }>(
      `SELECT "userId", "assistantMessages" FROM usage_daily`
    );
    expect(usage).toEqual([{ userId: REGISTERED, assistantMessages: 7 }]);
    const folders = await rows<{ id: string }>(`SELECT id FROM subjects WHERE name = 'Telegram'`);
    expect(folders).toHaveLength(1);
    const [book] = await rows<{ userId: string; subjectId: string }>(`SELECT "userId", "subjectId" FROM books`);
    expect(book).toEqual({ userId: REGISTERED, subjectId: folders[0].id });
  });

  it("refuses to attach a second Telegram to an account, and to steal a registered Telegram", async () => {
    await insertUser(test.client, { id: REGISTERED });
    const first = await createLinkToken({ userId: REGISTERED, purpose: "telegram_link", ttlMinutes: 10 });
    await linkTelegramToAccount(first, { telegramUserId: 111, chatId: 111 });

    await uploadAndIntake();
    const second = await createLinkToken({ userId: REGISTERED, purpose: "telegram_link", ttlMinutes: 10 });
    expect(
      await linkTelegramToAccount(second, { telegramUserId: TG_USER, chatId: TG_USER })
    ).toEqual({ ok: false, reason: "account_has_other_telegram" });
    // Nothing was moved.
    expect((await findTelegramAccount(TG_USER))?.user.isGuest).toBe(true);
    expect(await rows(`SELECT id FROM books WHERE "userId" = $1`, [REGISTERED])).toHaveLength(0);

    const OTHER = "00000000-0000-4000-8000-0000000000a2";
    await insertUser(test.client, { id: OTHER });
    const third = await createLinkToken({ userId: OTHER, purpose: "telegram_link", ttlMinutes: 10 });
    expect(
      await linkTelegramToAccount(third, { telegramUserId: 111, chatId: 111 })
    ).toEqual({ ok: false, reason: "already_linked_elsewhere" });
  });
});

describe("The bot receiving a file", () => {
  it("/start greets with the main keyboard", async () => {
    await handleTelegramUpdate(textUpdate("/start"));
    const [welcome, hint] = tg.sendMessage.mock.calls;
    expect(welcome[1]).toBe(TEXT.welcome);
    expect(JSON.stringify(welcome[2])).toContain(BUTTONS.uploadQuestions);
    // A guest is also shown how to keep their files: a /connect link.
    expect(hint[1]).toBe(TEXT.guestConnectHint);
    expect(JSON.stringify(hint[2])).toMatch(/https:\/\/nirolearn\.com\/connect\/[A-Za-z0-9_-]{43}/);
  });

  it("records a PDF once and queues its intake", async () => {
    await handleTelegramUpdate(documentUpdate());
    const upload = await onlyUpload();
    expect(upload.status).toBe("received");
    expect(lastSent().text).toBe(TEXT.received);
    expect(publishMessage).toHaveBeenCalledWith({ type: "telegram_intake", uploadId: upload.id });
  });

  it("a webhook delivered twice creates one upload and one job", async () => {
    const update = documentUpdate({ updateId: 4242, unique: "same" });
    await handleTelegramUpdate(update);
    // Clear the duplicate-file path so only update-id idempotency is tested.
    await test.client.exec(`UPDATE telegram_uploads SET "fileUniqueId" = 'other'`);
    await handleTelegramUpdate(update);

    expect(await rows(`SELECT id FROM telegram_uploads`)).toHaveLength(1);
    expect(publishMessage).toHaveBeenCalledTimes(1);
  });

  it("the same file sent again is not processed twice", async () => {
    const first = documentUpdate({ unique: "dup" });
    await handleTelegramUpdate(first);
    await handleTelegramUpdate(documentUpdate({ unique: "dup" }));

    expect(await rows(`SELECT id FROM telegram_uploads`)).toHaveLength(1);
    expect(lastSent().text).toBe(TEXT.duplicateProcessing);
    expect(publishMessage).toHaveBeenCalledTimes(1);
  });

  it("an upload that got stuck before the pipeline neither blocks a re-send nor uses up a guest's free file", async () => {
    await handleTelegramUpdate(documentUpdate({ unique: "stuck" }));
    // As seen in production: the intake never ran, the row stayed "received".
    await test.client.exec(
      `UPDATE telegram_uploads SET "updatedAt" = now() - interval '20 minutes', "createdAt" = now() - interval '20 minutes'`
    );
    publishMessage.mockClear();

    await handleTelegramUpdate(documentUpdate({ unique: "stuck" }));
    expect(lastSent().text).toBe(TEXT.received);
    expect(await rows(`SELECT id FROM telegram_uploads`)).toHaveLength(2);
    expect(publishMessage).toHaveBeenCalledTimes(1);
  });

  it("refuses a file that is not a PDF", async () => {
    await handleTelegramUpdate(documentUpdate({ name: "notes.docx", mime: "application/msword" }));
    expect(lastSent().text).toBe(TEXT.notPdf);
    expect(await rows(`SELECT id FROM telegram_uploads`)).toHaveLength(0);
  });

  it("refuses a file above the limit before downloading anything (20 MB on Telegram's own API)", async () => {
    await handleTelegramUpdate(documentUpdate({ size: 21 * 1024 * 1024 }));
    expect(lastSent().text).toBe(TEXT.tooLarge(20 * 1024 * 1024));
    expect(await rows(`SELECT id FROM telegram_uploads`)).toHaveLength(0);
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("accepts up to 70 MB once a self-hosted Bot API server is configured", async () => {
    process.env.TELEGRAM_API_BASE = "https://botapi.internal";
    await handleTelegramUpdate(documentUpdate({ size: 69 * 1024 * 1024 }));
    expect((await onlyUpload()).status).toBe("received");

    await handleTelegramUpdate(documentUpdate({ size: 71 * 1024 * 1024, from: 888 }));
    expect(lastSent().text).toBe(TEXT.tooLarge(70 * 1024 * 1024));
  });

  it("a guest's second file asks them to create their account; a registered user is not asked", async () => {
    await uploadAndIntake();
    tg.sendMessage.mockClear();
    await handleTelegramUpdate(documentUpdate());
    expect(lastSent().text).toBe(TEXT.guestLimit);
    expect(JSON.stringify(lastSent().markup)).toMatch(/nirolearn\.com\/connect\/[A-Za-z0-9_-]{43}/);
    expect(await rows(`SELECT id FROM telegram_uploads`)).toHaveLength(1);

    // The same person after registering (the guest row gains a phone).
    await test.client.exec(`UPDATE users SET phone = '+962790000001', "passwordHash" = 'x'`);
    await handleTelegramUpdate(documentUpdate());
    expect(await rows(`SELECT id FROM telegram_uploads`)).toHaveLength(2);
  });

  it("limits how many files one account can send in a short time", async () => {
    process.env.TELEGRAM_ACCOUNT_BURST_LIMIT = "2";
    process.env.TELEGRAM_GUEST_FREE_UPLOADS = "50";
    await handleTelegramUpdate(documentUpdate());
    await handleTelegramUpdate(documentUpdate());
    await handleTelegramUpdate(documentUpdate());
    expect(lastSent().text).toBe(TEXT.slowDown);
    expect(await rows(`SELECT id FROM telegram_uploads`)).toHaveLength(2);
  });

  it("stops accepting files once the channel's daily ceiling is reached", async () => {
    process.env.TELEGRAM_DAILY_UPLOAD_CAP = "1";
    await handleTelegramUpdate(documentUpdate({ from: 901 }));
    await handleTelegramUpdate(documentUpdate({ from: 902 }));
    expect(lastSent().text).toBe(TEXT.busy);
    expect(await rows(`SELECT id FROM telegram_uploads`)).toHaveLength(1);
  });

  it("ignores groups and other bots", async () => {
    await handleTelegramUpdate({
      update_id: 1,
      message: { message_id: 1, from: { id: 5 }, chat: { id: -100, type: "group" }, text: "/start" },
    });
    await handleTelegramUpdate({
      update_id: 2,
      message: { message_id: 1, from: { id: 6, is_bot: true }, chat: { id: 6, type: "private" }, text: "/start" },
    });
    expect(tg.sendMessage).not.toHaveBeenCalled();
    expect(await rows(`SELECT id FROM telegram_accounts`)).toHaveLength(0);
  });
});

describe("Intake: from the bot's file to the existing pipeline", () => {
  it("a question file becomes an ordinary question-file book and starts the existing job", async () => {
    const upload = await uploadAndIntake({ kind: "questions" });
    expect(upload).toMatchObject({ status: "processing", kind: "question_file" });

    const [book] = await rows<{ sourceType: string; status: string; fileKey: string; userId: string }>(
      `SELECT "sourceType", status, "fileKey", "userId" FROM books WHERE id = $1`,
      [upload.bookId]
    );
    expect(book.sourceType).toBe("question_file");
    expect(book.status).toBe("extracting");
    // Stored under a key issued to the owner, like a web upload.
    expect(book.fileKey).toMatch(new RegExp(`^book-pdfs/${book.userId}/`));
    expect(publishMessage).toHaveBeenCalledWith({ type: "extract_question_file_job", bookId: upload.bookId });
    expect(publishMessage).toHaveBeenCalledWith({ type: "telegram_watch", uploadId: upload.id }, { delay: 6 });
    // Filed in the student's own "Telegram" folder.
    expect(await rows(`SELECT id FROM subjects WHERE name = 'Telegram'`)).toHaveLength(1);
  });

  it("a book goes to the book pipeline, not the question one", async () => {
    const upload = await uploadAndIntake({ kind: "book" });
    expect(upload.kind).toBe("book");
    const [book] = await rows<{ sourceType: string }>(`SELECT "sourceType" FROM books`);
    expect(book.sourceType).toBe("study_book");
    expect(publishMessage).toHaveBeenCalledWith(
      { type: "extract_book_job", bookId: upload.bookId },
      expect.anything()
    );
  });

  it("asks the student when the file contradicts what they said, then follows their answer", async () => {
    await handleTelegramUpdate(textUpdate(BUTTONS.uploadBook));
    readLeadingPages.mockResolvedValue([{ page: 1, text: QUESTION_PAGE }]);
    await handleTelegramUpdate(documentUpdate());
    const upload = await onlyUpload();
    await runTelegramIntake(upload.id);

    expect((await onlyUpload()).status).toBe("awaiting_kind");
    expect(await rows(`SELECT id FROM books`)).toHaveLength(0);

    await handleTelegramUpdate({
      update_id: nextUpdateId++,
      callback_query: {
        id: "cb1",
        from: { id: TG_USER },
        data: CALLBACK.kind(upload.id, "question_file"),
        message: { message_id: 1, chat: { id: TG_USER, type: "private" } },
      },
    });
    await runTelegramIntake(upload.id);
    expect(await onlyUpload()).toMatchObject({ status: "processing", kind: "question_file" });
    // The file was downloaded once, not again after the answer.
    expect(tg.getFileDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it("another Telegram user cannot answer or retry someone else's upload", async () => {
    await handleTelegramUpdate(textUpdate(BUTTONS.uploadBook));
    await handleTelegramUpdate(documentUpdate());
    const upload = await onlyUpload();
    await runTelegramIntake(upload.id);

    await handleTelegramUpdate({
      update_id: nextUpdateId++,
      callback_query: {
        id: "cb2",
        from: { id: 31337 },
        data: CALLBACK.kind(upload.id, "book"),
        message: { message_id: 1, chat: { id: 31337, type: "private" } },
      },
    });
    expect((await onlyUpload()).status).toBe("awaiting_kind");
  });

  it("a second delivery of the same job does nothing", async () => {
    await handleTelegramUpdate(documentUpdate());
    const upload = await onlyUpload();
    const [a, b] = await Promise.all([runTelegramIntake(upload.id), runTelegramIntake(upload.id)]);
    expect([a, b].sort()).toEqual(["done", "skipped"]);
    expect(await rows(`SELECT id FROM books`)).toHaveLength(1);
  });

  it("refuses a file whose content is not a PDF, whatever its name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>not a pdf</html>")));
    await handleTelegramUpdate(documentUpdate());
    const upload = await onlyUpload();
    await runTelegramIntake(upload.id);
    expect((await onlyUpload()).status).toBe("rejected");
    expect(await rows(`SELECT id FROM books`)).toHaveLength(0);
  });

  it("stops a download that turns out larger than Telegram reported", async () => {
    process.env.TELEGRAM_MAX_FILE_MB = "1";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(2 * 1024 * 1024).fill(37)))
    );
    await handleTelegramUpdate(documentUpdate({ size: 500_000 }));
    const upload = await onlyUpload();
    await runTelegramIntake(upload.id);
    expect((await onlyUpload()).status).toBe("rejected");
    expect(storage.storageGetUploadUrl).not.toHaveBeenCalled();
  });

  it("a plan limit refuses the file with the plan's own message and removes the stored copy", async () => {
    admitUpload.mockResolvedValue(
      NextResponse.json({ error: "وصلت إلى حد ملفاتك اليوم." }, { status: 402 })
    );
    await handleTelegramUpdate(documentUpdate());
    const upload = await onlyUpload();
    await runTelegramIntake(upload.id);

    const after = await onlyUpload();
    expect(after.status).toBe("rejected");
    expect(after.error).toBe("وصلت إلى حد ملفاتك اليوم.");
    expect(storage.deleteObject).toHaveBeenCalled();
    expect(tg.editMessage.mock.calls.at(-1)![2]).toBe(TEXT.refused("وصلت إلى حد ملفاتك اليوم."));
  });

  it("if even claiming the upload fails, the last attempt still tells the student instead of leaving them waiting", async () => {
    await handleTelegramUpdate(documentUpdate());
    const upload = await onlyUpload();
    const uploads = await import("./uploads");
    const claim = vi
      .spyOn(uploads, "claimUploadForIntake")
      .mockRejectedValue(new Error("database unavailable"));
    try {
      await expect(runTelegramIntake(upload.id)).rejects.toThrow("database unavailable");
      expect((await onlyUpload()).status).toBe("received");

      expect(await runTelegramIntake(upload.id, { finalAttempt: true })).toBe("done");
      expect((await onlyUpload()).status).toBe("failed");
      expect(tg.editMessage.mock.calls.at(-1)![2]).toBe(TEXT.downloadFailed);
    } finally {
      claim.mockRestore();
    }
  });

  it("a transient failure hands the upload back for the queue's retry; the last attempt tells the student", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 502 })));
    await handleTelegramUpdate(documentUpdate());
    const upload = await onlyUpload();

    await expect(runTelegramIntake(upload.id)).rejects.toThrow();
    expect((await onlyUpload()).status).toBe("received");

    await runTelegramIntake(upload.id, { finalAttempt: true });
    expect((await onlyUpload()).status).toBe("failed");
    expect(tg.editMessage.mock.calls.at(-1)![2]).toBe(TEXT.downloadFailed);
  });
});

describe("Watch: reporting the pipeline's status in the chat", () => {
  async function finishQuestions(bookId: string, count: number) {
    await test.client.query(`UPDATE books SET status = 'complete', "pageCount" = 2 WHERE id = $1`, [bookId]);
    await test.client.query(
      `INSERT INTO question_file_pages ("bookId", "pageNumber", status) VALUES ($1, 1, 'complete')`,
      [bookId]
    );
    for (let i = 0; i < count; i++) {
      await test.client.query(
        `INSERT INTO extracted_questions ("bookId", "orderIndex", "questionText", options, "extractedAnswerIndex", "sourcePage", "aiStatus")
         VALUES ($1, $2, 'Q?', '["A","B","C","D"]', 1, 1, 'complete')`,
        [bookId, i]
      );
    }
  }

  it("keeps polling while the file is being read", async () => {
    const upload = await uploadAndIntake();
    publishMessage.mockClear();
    expect(await runTelegramWatch(upload.id)).toBe("requeued");
    expect(publishMessage).toHaveBeenCalledWith(
      { type: "telegram_watch", uploadId: upload.id },
      expect.objectContaining({ delay: expect.any(Number) })
    );
  });

  it("announces a finished question file with a button that opens it inside Telegram", async () => {
    const upload = await uploadAndIntake();
    await finishQuestions(upload.bookId!, 80);

    expect(await runTelegramWatch(upload.id)).toBe("done");
    const { text, markup } = lastSent();
    expect(text).toBe(TEXT.questionsReady(80));
    const button = (markup as { inline_keyboard: Record<string, unknown>[][] }).inline_keyboard[0][0];
    // A Mini App button: no token and no storage key in it — the student is
    // identified by Telegram's own signed launch data.
    expect(button).toEqual({
      text: LABELS.startQuestions,
      web_app: {
        url: `https://nirolearn.com/tg?to=${encodeURIComponent(`/books/question-files/${upload.bookId}`)}`,
      },
    });
    expect(await rows(`SELECT id FROM access_link_tokens`)).toHaveLength(0);
  });

  it("with the Mini App switched off: a guest link that hides every internal key", async () => {
    process.env.TELEGRAM_MINI_APP = "false";
    const upload = await uploadAndIntake();
    await finishQuestions(upload.bookId!, 80);

    expect(await runTelegramWatch(upload.id)).toBe("done");
    expect((await onlyUpload()).status).toBe("complete");
    const { text, markup } = lastSent();
    expect(text).toBe(TEXT.questionsReady(80));
    const url = (markup as { inline_keyboard: { url: string }[][] }).inline_keyboard[0][0].url;
    expect(url).toMatch(/^https:\/\/nirolearn\.com\/t\/[A-Za-z0-9_-]{43}$/);
    expect(url).not.toContain(upload.bookId!);
    expect(url).not.toContain("book-pdfs");
  });

  it("tells the student as soon as the questions are extracted, without waiting for the explanations", async () => {
    const upload = await uploadAndIntake();
    await test.client.query(`UPDATE books SET status = 'complete' WHERE id = $1`, [upload.bookId]);
    await test.client.query(
      `INSERT INTO question_file_pages ("bookId", "pageNumber", status) VALUES ($1, 1, 'complete')`,
      [upload.bookId]
    );
    // 80 questions extracted, none enriched yet.
    await test.client.query(
      `INSERT INTO extracted_questions ("bookId", "orderIndex", "questionText", options, "extractedAnswerIndex", "sourcePage", "aiStatus")
       SELECT $1, n, 'Q?', '["A","B","C","D"]', 1, 1, 'pending' FROM generate_series(0, 79) AS n`,
      [upload.bookId]
    );
    publishMessage.mockClear();

    expect(await runTelegramWatch(upload.id)).toBe("done");
    expect((await onlyUpload()).status).toBe("complete");
    expect(lastSent().text).toBe(TEXT.questionsReadyPartial(80));
    expect(JSON.stringify(lastSent().markup)).toContain(LABELS.startQuestions);
    // No more polling for this file.
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("announces a finished book", async () => {
    const upload = await uploadAndIntake({ kind: "book" });
    await test.client.query(`UPDATE books SET status = 'pending', "pageCount" = 120 WHERE id = $1`, [upload.bookId]);
    await runTelegramWatch(upload.id);
    expect(lastSent().text).toBe(TEXT.bookReady(120));
  });

  it("with the Mini App switched off: a registered user gets the page itself, never a link that signs them in", async () => {
    process.env.TELEGRAM_MINI_APP = "false";
    const upload = await uploadAndIntake();
    await test.client.exec(`UPDATE users SET phone = '+962790000002', "passwordHash" = 'x'`);
    await finishQuestions(upload.bookId!, 3);
    await runTelegramWatch(upload.id);
    const url = (lastSent().markup as { inline_keyboard: { url: string }[][] }).inline_keyboard[0][0].url;
    expect(url).toBe(
      `https://nirolearn.com/api/telegram/open?to=${encodeURIComponent(`/books/question-files/${upload.bookId}`)}`
    );
    expect(url).not.toMatch(/\/t\//);
  });

  it("explains a failure with its reason and offers a retry that restarts the same file", async () => {
    const upload = await uploadAndIntake();
    await test.client.query(
      `UPDATE books SET status = 'failed', "extractionError" = 'تعذر قراءة أي صفحة من هذا الملف.' WHERE id = $1`,
      [upload.bookId]
    );

    await runTelegramWatch(upload.id);
    expect((await onlyUpload()).status).toBe("failed");
    const call = tg.editMessage.mock.calls.at(-1)!;
    expect(call[2]).toBe(TEXT.failed("تعذر قراءة أي صفحة من هذا الملف."));
    expect(JSON.stringify(call[3])).toContain(CALLBACK.retry(upload.id));

    publishMessage.mockClear();
    expect(await retryTelegramUpload(upload.id)).toBe(true);
    expect(await onlyUpload()).toMatchObject({ status: "processing", bookId: upload.bookId });
    expect(publishMessage).toHaveBeenCalledWith({ type: "extract_question_file_job", bookId: upload.bookId });
    // No second book, no second quota unit.
    expect(await rows(`SELECT id FROM books`)).toHaveLength(1);
    expect(admitUpload).toHaveBeenCalledTimes(1);
  });

  it("a blocked bot does not fail the worker", async () => {
    const upload = await uploadAndIntake();
    await finishQuestions(upload.bookId!, 2);
    const { TelegramApiError } = await import("./api");
    tg.editMessage.mockRejectedValue(new TelegramApiError("editMessageText", 403, "bot was blocked by the user"));
    tg.sendMessage.mockRejectedValue(new TelegramApiError("sendMessage", 403, "bot was blocked by the user"));

    await expect(runTelegramWatch(upload.id)).resolves.toBe("done");
    expect((await onlyUpload()).status).toBe("complete");
  });
});

describe("Link tokens and the guest web session", () => {
  async function guestToken(path = "/books/question-files/x") {
    const guest = await ensureTelegramAccount({ telegramUserId: TG_USER, chatId: TG_USER });
    const token = await createLinkToken({ userId: guest.user.id, purpose: "web_login", path, ttlMinutes: 60 });
    return { guest, token };
  }

  it("stores only the token's hash", async () => {
    const { token } = await guestToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await rows<{ tokenHash: string }>(`SELECT "tokenHash" FROM access_link_tokens`);
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toContain(token);
  });

  it("two links never share a token", async () => {
    const { guest, token } = await guestToken();
    const other = await createLinkToken({ userId: guest.user.id, purpose: "web_login", ttlMinutes: 60 });
    expect(other).not.toBe(token);
  });

  it("rejects unknown, malformed, wrong-purpose, expired and revoked tokens alike", async () => {
    const { guest, token } = await guestToken();
    expect(await findLinkToken("x".repeat(43), "web_login")).toBeNull();
    expect(await findLinkToken("../../etc/passwd", "web_login")).toBeNull();
    expect(await findLinkToken(token, "telegram_link")).toBeNull();
    expect(await resolveWebLogin(token)).not.toBeNull();

    await test.client.exec(`UPDATE access_link_tokens SET "expiresAt" = now() - interval '1 minute'`);
    expect(await resolveWebLogin(token)).toBeNull();

    await test.client.exec(`UPDATE access_link_tokens SET "expiresAt" = now() + interval '1 hour'`);
    await revokeLinkTokens(guest.user.id, "web_login");
    expect(await resolveWebLogin(token)).toBeNull();
  });

  it("a link stops working the moment the guest registers", async () => {
    const { token } = await guestToken();
    await test.client.exec(`UPDATE users SET phone = '+962790000003', "passwordHash" = 'x'`);
    expect(await resolveWebLogin(token)).toBeNull();
  });

  it("a suspended guest cannot enter", async () => {
    const { token } = await guestToken();
    await test.client.exec(`UPDATE users SET "suspendedAt" = now()`);
    expect(await resolveWebLogin(token)).toBeNull();
  });

  it("a one-time code works once, even under a race", async () => {
    await insertUser(test.client, { id: REGISTERED });
    const code = await createLinkToken({ userId: REGISTERED, purpose: "telegram_link", ttlMinutes: 10 });
    const results = await Promise.all([
      consumeLinkToken(code, "telegram_link"),
      consumeLinkToken(code, "telegram_link"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("only allows destinations inside the site", () => {
    expect(safeInternalPath("/books/1")).toBe("/books/1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", ""]) {
      expect(safeInternalPath(bad)).toBe("/subjects");
    }
  });

  it("tells a same-site form post from a cross-site one", () => {
    const post = (headers: Record<string, string>) =>
      new Request("https://nirolearn.com/api/telegram/session", { method: "POST", headers });
    const site = "https://nirolearn.com";
    expect(isSameOriginPost(post({ origin: "https://nirolearn.com", host: "nirolearn.com" }), site)).toBe(true);
    expect(isSameOriginPost(post({ origin: "https://evil.example", host: "nirolearn.com" }), site)).toBe(false);
    expect(isSameOriginPost(post({ "sec-fetch-site": "cross-site", origin: "https://nirolearn.com" }), site)).toBe(false);
    expect(isSameOriginPost(post({ host: "nirolearn.com" }), site)).toBe(false);
    // What a real browser sent from /t/<token> when the page asked for no
    // referrer: the browser vouches for same-origin while Origin is "null".
    // This must be accepted (it was refused with 403 in production).
    expect(isSameOriginPost(post({ "sec-fetch-site": "same-origin", origin: "null" }), site)).toBe(true);
    // An opaque origin with nothing vouching for it stays refused.
    expect(isSameOriginPost(post({ origin: "null", host: "nirolearn.com" }), site)).toBe(false);
    expect(isSameOriginPost(post({ "sec-fetch-site": "same-site", origin: "https://nirolearn.com" }), site)).toBe(false);
  });

  it("the session route signs the guest in with the ordinary session cookie and sends them to their file", async () => {
    const { POST } = await import("@/app/api/telegram/session/route");
    const { token } = await guestToken("/books/question-files/abc");
    const body = new FormData();
    body.set("token", token);
    const response = await POST(
      new Request("https://nirolearn.com/api/telegram/session", {
        method: "POST",
        headers: { origin: "https://nirolearn.com", host: "nirolearn.com" },
        body,
      })
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/books/question-files/abc");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/authjs\.session-token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });

  it("the session route refuses a cross-site post and an invalid token", async () => {
    const { POST } = await import("@/app/api/telegram/session/route");
    const { token } = await guestToken();
    const form = (value: string) => {
      const body = new FormData();
      body.set("token", value);
      return body;
    };

    const crossSite = await POST(
      new Request("https://nirolearn.com/api/telegram/session", {
        method: "POST",
        headers: { origin: "https://evil.example", host: "nirolearn.com" },
        body: form(token),
      })
    );
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get("set-cookie")).toBeNull();

    const invalid = await POST(
      new Request("https://nirolearn.com/api/telegram/session", {
        method: "POST",
        headers: { origin: "https://nirolearn.com", host: "nirolearn.com" },
        body: form("y".repeat(43)),
      })
    );
    expect(invalid.status).toBe(303);
    expect(invalid.headers.get("set-cookie")).toBeNull();
  });
});

describe("Connecting a guest to an account from the web (/connect)", () => {
  const authState = vi.hoisted(() => ({ userId: null as string | null }));
  vi.mock("@/lib/auth", () => ({
    auth: async () => (authState.userId ? { user: { id: authState.userId } } : null),
  }));

  async function post(fields: Record<string, string>, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/telegram/connect/route");
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return POST(
      new Request("https://nirolearn.com/api/telegram/connect", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", ...headers },
        body,
      })
    );
  }

  async function guestWithFile() {
    const upload = await uploadAndIntake();
    const guest = (await findTelegramAccount(TG_USER))!;
    const { connectLink } = await import("./links");
    const token = (await connectLink(guest.user)).split("/connect/")[1];
    return { upload, guest, token };
  }

  beforeEach(() => {
    authState.userId = null;
  });

  it("the student who signs in to an existing account and confirms gets the guest's files, and the chat is told", async () => {
    await insertUser(test.client, { id: REGISTERED });
    const { upload, guest, token } = await guestWithFile();
    authState.userId = REGISTERED;
    tg.sendMessage.mockClear();

    const response = await post({ token, action: "link" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/connect/${token}`);

    expect((await findTelegramAccount(TG_USER))?.user).toMatchObject({ id: REGISTERED, isGuest: false });
    expect(await rows(`SELECT id FROM users WHERE id = $1`, [guest.user.id])).toHaveLength(0);
    const [book] = await rows<{ userId: string }>(`SELECT "userId" FROM books WHERE id = $1`, [upload.bookId]);
    expect(book.userId).toBe(REGISTERED);
    expect(tg.sendMessage).toHaveBeenCalledWith(TG_USER, TEXT.linked, expect.anything());

    // The link is spent: a second confirmation changes nothing.
    const again = await post({ token, action: "link" });
    expect(again.headers.get("location")).toBe(`/connect/${token}?error=invalid_code`);
  });

  it("sends a visitor to sign in or register and back, ending a guest session first", async () => {
    const { guest, token } = await guestWithFile();
    const back = encodeURIComponent(`/connect/${token}`);

    const login = await post({ token, action: "login" });
    expect(login.headers.get("location")).toBe(`/login?callbackUrl=${back}`);
    expect(login.headers.get("set-cookie")).toBeNull();

    authState.userId = guest.user.id;
    const register = await post({ token, action: "register" });
    expect(register.headers.get("location")).toBe(`/register?callbackUrl=${back}`);
    // Signed in as the guest: that session is cleared so a real account follows.
    expect(register.headers.get("set-cookie")).toMatch(/authjs\.session-token=;/);
  });

  it("never links for someone who is not signed in to a real account", async () => {
    const { guest, token } = await guestWithFile();
    await post({ token, action: "link" });
    authState.userId = guest.user.id;
    await post({ token, action: "link" });
    expect((await findTelegramAccount(TG_USER))?.user.isGuest).toBe(true);
  });

  it("refuses a cross-site post and a malformed token", async () => {
    await insertUser(test.client, { id: REGISTERED });
    const { token } = await guestWithFile();
    authState.userId = REGISTERED;

    const crossSite = await post({ token, action: "link" }, { "sec-fetch-site": "cross-site" });
    expect(crossSite.status).toBe(403);
    expect((await findTelegramAccount(TG_USER))?.user.isGuest).toBe(true);

    const malformed = await post({ token: "../../admin", action: "login" });
    expect(malformed.headers.get("location")).toBe("/login");
  });

  it("a registered student's bot button opens the page when signed in, the login otherwise — and only inside the site", async () => {
    const { GET } = await import("@/app/api/telegram/open/route");
    const open = (to: string) =>
      GET(new Request(`https://nirolearn.com/api/telegram/open?to=${encodeURIComponent(to)}`));

    expect((await open("/books/abc")).headers.get("location")).toBe(
      `/login?callbackUrl=${encodeURIComponent("/books/abc")}`
    );
    authState.userId = REGISTERED;
    expect((await open("/books/abc")).headers.get("location")).toBe("/books/abc");
    expect((await open("https://evil.example/x")).headers.get("location")).toBe("/subjects");
    expect((await open("//evil.example")).headers.get("location")).toBe("/subjects");
  });
});

describe("Mini App sign-in (Telegram's signed launch data)", () => {
  const BOT_TOKEN = "123:test-token";

  function signedInitData(
    fields: Record<string, string>,
    token = BOT_TOKEN
  ): string {
    const dataCheckString = Object.entries(fields)
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("\n");
    const secret = createHmac("sha256", "WebAppData").update(token).digest();
    const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
    return new URLSearchParams({ ...fields, hash }).toString();
  }
  const now = () => String(Math.floor(Date.now() / 1000));
  const launch = (userId = TG_USER, authDate = now()) =>
    signedInitData({
      auth_date: authDate,
      query_id: "AAF",
      user: JSON.stringify({ id: userId, first_name: "Awab", language_code: "ar" }),
    });

  it("accepts genuine launch data and reads the Telegram user", () => {
    expect(validateInitData(launch(), BOT_TOKEN)).toEqual({
      telegramUserId: TG_USER,
      languageCode: "ar",
    });
  });

  it("refuses forged, altered, stale and malformed launch data", () => {
    // Signed with another bot's token.
    expect(validateInitData(signedInitData({ auth_date: now(), user: '{"id":1}' }, "999:other"), BOT_TOKEN)).toBeNull();
    // A field changed after signing (someone else's id).
    const altered = new URLSearchParams(launch());
    altered.set("user", JSON.stringify({ id: 42, first_name: "Awab", language_code: "ar" }));
    expect(validateInitData(altered.toString(), BOT_TOKEN)).toBeNull();
    // Older than an hour.
    expect(validateInitData(launch(TG_USER, String(Math.floor(Date.now() / 1000) - 2 * 60 * 60)), BOT_TOKEN)).toBeNull();
    expect(validateInitData("", BOT_TOKEN)).toBeNull();
    expect(validateInitData("hash=zz&user=%7B%7D", BOT_TOKEN)).toBeNull();
    expect(validateInitData(signedInitData({ auth_date: now(), user: '{"id":"7"}' }), BOT_TOKEN)).toBeNull();
    expect(validateInitData(signedInitData({ auth_date: now(), user: '{"id":7,"is_bot":true}' }), BOT_TOKEN)).toBeNull();
  });

  async function post(body: unknown, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/telegram/webapp-session/route");
    return POST(
      new Request("https://nirolearn.com/api/telegram/webapp-session", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
        body: JSON.stringify(body),
      })
    );
  }

  it("signs in the account this Telegram user is connected to and says where to go", async () => {
    await insertUser(test.client, { id: REGISTERED });
    const code = await createLinkToken({ userId: REGISTERED, purpose: "telegram_link", ttlMinutes: 10 });
    await linkTelegramToAccount(code, { telegramUserId: TG_USER, chatId: TG_USER });

    const response = await post({ initData: launch(), to: "/books/question-files/abc" });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/authjs\.session-token=.+HttpOnly/i);
    expect(await response.json()).toEqual({
      to: "/books/question-files/abc",
      external: `https://nirolearn.com/api/telegram/open?to=${encodeURIComponent("/books/question-files/abc")}`,
    });
    // Still exactly one account for this Telegram user: the registered one.
    expect((await findTelegramAccount(TG_USER))?.user.id).toBe(REGISTERED);
  });

  it("a first-time Telegram user gets a guest account, and an outside destination is never followed", async () => {
    const response = await post({ initData: launch(700700), to: "https://evil.example/x" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { to: string; external: string };
    expect(body.to).toBe("/subjects");
    expect(body.external).toMatch(/^https:\/\/nirolearn\.com\/t\/[A-Za-z0-9_-]{43}$/);
    expect((await findTelegramAccount(700700))?.user.isGuest).toBe(true);
  });

  it("refuses bad launch data, a cross-site post and a suspended account — with no cookie", async () => {
    const forged = await post({ initData: "user=%7B%22id%22%3A1%7D&hash=" + "0".repeat(64), to: "/" });
    expect(forged.status).toBe(401);
    expect(forged.headers.get("set-cookie")).toBeNull();

    const crossSite = await post({ initData: launch(), to: "/" }, { "sec-fetch-site": "cross-site" });
    expect(crossSite.status).toBe(403);

    await ensureTelegramAccount({ telegramUserId: TG_USER, chatId: TG_USER });
    await test.client.exec(`UPDATE users SET "suspendedAt" = now()`);
    const suspended = await post({ initData: launch(), to: "/" });
    expect(suspended.status).toBe(403);
    expect(suspended.headers.get("set-cookie")).toBeNull();
  });
});

describe("Verifying a sign-up phone number through the bot (no code)", () => {
  const PHONE = "+962791234567";
  const contactUpdate = (from: number, phone: string, owner: number = from): TelegramUpdate => ({
    update_id: nextUpdateId++,
    message: {
      message_id: 1,
      from: { id: from },
      chat: { id: from, type: "private" },
      contact: { phone_number: phone, user_id: owner },
    },
  });
  async function begin(phone = PHONE) {
    process.env.TELEGRAM_BOT_USERNAME = "Nirolearnbot";
    const started = await startTelegramPhoneVerification({ phone, ip: "1.2.3.4" });
    if (!started.ok) throw new Error(started.error);
    return { ...started, token: started.url.split("start=verify_")[1] };
  }

  it("the student opens the bot, shares their own number, and the sign-up page is told", async () => {
    const { verificationId, url, token } = await begin();
    expect(url).toMatch(/^https:\/\/t\.me\/Nirolearnbot\?start=verify_[A-Za-z0-9_-]{43}$/);
    // Only the token's hash is stored.
    const [row] = await rows<{ providerRequestId: string }>(`SELECT "providerRequestId" FROM phone_verifications`);
    expect(row.providerRequestId).not.toContain(token);
    expect(await getPhoneVerificationStatus(verificationId)).toBe("pending");

    await handleTelegramUpdate(textUpdate(`/start verify_${token}`));
    expect(lastSent().text).toBe(TEXT.verifyAsk);
    expect(JSON.stringify(lastSent().markup)).toContain('"request_contact":true');

    // Telegram sends the number without "+".
    await handleTelegramUpdate(contactUpdate(TG_USER, "962791234567"));
    expect(lastSent().text).toBe(TEXT.verifyDone);
    expect(await getPhoneVerificationStatus(verificationId)).toBe("verified");
    // Verifying a number creates no Telegram account and links nothing.
    expect(await rows(`SELECT id FROM telegram_accounts`)).toHaveLength(0);
    expect(await rows(`SELECT id FROM users`)).toHaveLength(0);
  });

  it("a different number than the one typed on the page is refused", async () => {
    const { verificationId, token } = await begin();
    await handleTelegramUpdate(textUpdate(`/start verify_${token}`));
    await handleTelegramUpdate(contactUpdate(TG_USER, "+962790000099"));
    expect(lastSent().text).toBe(TEXT.verifyMismatch);
    expect(await getPhoneVerificationStatus(verificationId)).toBe("pending");
  });

  it("someone else's contact card proves nothing", async () => {
    const { verificationId, token } = await begin();
    await handleTelegramUpdate(textUpdate(`/start verify_${token}`));
    await handleTelegramUpdate(contactUpdate(TG_USER, PHONE, 999));
    expect(lastSent().text).toBe(TEXT.verifyNotOwn);
    expect(await getPhoneVerificationStatus(verificationId)).toBe("pending");
  });

  it("only the Telegram user who opened the link can complete it", async () => {
    const { verificationId, token } = await begin();
    expect(await claimTelegramPhoneVerification(token, TG_USER)).toBe(true);
    expect(await claimTelegramPhoneVerification(token, 31337)).toBe(false);
    // The intruder sharing the right number changes nothing.
    await handleTelegramUpdate(contactUpdate(31337, PHONE));
    expect(lastSent().text).toBe(TEXT.verifyNoRequest);
    expect(await getPhoneVerificationStatus(verificationId)).toBe("pending");
    // The same user tapping the link twice is fine.
    expect(await claimTelegramPhoneVerification(token, TG_USER)).toBe(true);
  });

  it("refuses an unknown or expired link, and a number that already has an account", async () => {
    await handleTelegramUpdate(textUpdate(`/start verify_${"x".repeat(43)}`));
    expect(lastSent().text).toBe(TEXT.verifyInvalid);

    const { verificationId, token } = await begin();
    await test.client.exec(`UPDATE phone_verifications SET "expiresAt" = now() - interval '1 minute'`);
    expect(await claimTelegramPhoneVerification(token, TG_USER)).toBe(false);
    expect(await getPhoneVerificationStatus(verificationId)).toBe("expired");

    await insertUser(test.client, { id: REGISTERED });
    await test.client.exec(`UPDATE users SET phone = '+962795550000'`);
    expect(
      await startTelegramPhoneVerification({ phone: "+962795550000", ip: "5.6.7.8" })
    ).toEqual({ ok: false, error: "phone_taken" });
  });

  it("a number verified this way creates the account like a verified code does, exactly once", async () => {
    const { verificationId, token } = await begin();
    await handleTelegramUpdate(textUpdate(`/start verify_${token}`));
    await handleTelegramUpdate(contactUpdate(TG_USER, PHONE));

    const created = await createAccountWithVerifiedPhone({ verificationId, name: "Sara", password: "a-strong-password" });
    expect(created).toMatchObject({ ok: true, phone: PHONE });
    const again = await createAccountWithVerifiedPhone({ verificationId, name: "Sara", password: "a-strong-password" });
    expect(again).toEqual({ ok: false, error: "not_verified" });
  });

  it("a code typed against a Telegram verification never reaches the SMS provider", async () => {
    const { verificationId } = await begin();
    const fetchImpl = vi.fn();
    expect(
      await checkPhoneVerification({ verificationId, code: "123456", fetchImpl })
    ).toEqual({ ok: false, error: "wrong_code" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Growth: campaign links and invites", () => {
  const INVITER = 810001;
  const FRIEND = 810002;
  const account = async (telegramUserId: number) => {
    const [row] = await rows<{
      id: string;
      source: string | null;
      referredById: string | null;
      bonusUploads: number;
      bonusUsed: number;
      referralRewardedAt: string | null;
    }>(
      `SELECT id, source, "referredById", "bonusUploads", "bonusUsed", "referralRewardedAt"
       FROM telegram_accounts WHERE "telegramUserId" = $1`,
      [telegramUserId]
    );
    return row;
  };
  // The student's invite link, read from the bot's own reply.
  async function inviteCodeOf(telegramUserId: number) {
    await handleTelegramUpdate(textUpdate(BUTTONS.invite, telegramUserId));
    const link = /https:\/\/t\.me\/Nirolearnbot\?start=ref_([A-Z0-9]{8})/.exec(lastSent().text);
    expect(link).not.toBeNull();
    return link![1];
  }
  async function sendFileAndIntake(telegramUserId: number) {
    await handleTelegramUpdate(documentUpdate({ from: telegramUserId }));
    const [upload] = await rows<{ id: string }>(
      `SELECT u.id FROM telegram_uploads u JOIN telegram_accounts a ON a.id = u."telegramAccountId"
       WHERE a."telegramUserId" = $1 ORDER BY u."createdAt" DESC LIMIT 1`,
      [telegramUserId]
    );
    await runTelegramIntake(upload.id);
    return upload.id;
  }

  beforeEach(() => {
    process.env.TELEGRAM_BOT_USERNAME = "Nirolearnbot";
  });

  it("reads a /start payload strictly", () => {
    expect(parseStartOrigin("src_Batch6")).toEqual({ source: "batch6" });
    expect(parseStartOrigin("ref_abcd2345")).toEqual({ referralCode: "ABCD2345", source: "invite" });
    for (const payload of [undefined, "", "src_", "src_has space", "src_<script>", "ref_short", "ref_ABCD234O", "other"]) {
      expect(parseStartOrigin(payload)).toEqual({});
    }
  });

  it("a campaign link labels a NEW student, and an existing one is never relabelled", async () => {
    await handleTelegramUpdate(textUpdate("/start src_batch6", FRIEND));
    expect((await account(FRIEND)).source).toBe("batch6");
    await handleTelegramUpdate(textUpdate("/start src_other_group", FRIEND));
    expect((await account(FRIEND)).source).toBe("batch6");
  });

  it("the invite reply carries the student's own link and a share button", async () => {
    const code = await inviteCodeOf(INVITER);
    expect(lastSent().text).toContain(TEXT.invite({ joined: 0, available: 0 }));
    expect(JSON.stringify(lastSent().markup)).toContain("https://t.me/share/url?url=");
    // The same code every time.
    expect(await inviteCodeOf(INVITER)).toBe(code);
  });

  it("an invited classmate's first processed file earns the inviter one file — once", async () => {
    const code = await inviteCodeOf(INVITER);
    await handleTelegramUpdate(textUpdate(`/start ref_${code}`, FRIEND));
    const friend = await account(FRIEND);
    expect(friend.source).toBe("invite");
    expect(friend.referredById).toBe((await account(INVITER)).id);
    // Joining alone earns nothing.
    expect((await account(INVITER)).bonusUploads).toBe(0);

    tg.sendMessage.mockClear();
    await sendFileAndIntake(FRIEND);
    expect((await account(INVITER)).bonusUploads).toBe(1);
    expect(tg.sendMessage).toHaveBeenCalledWith(INVITER, TEXT.inviteEarned(1));
    expect((await account(FRIEND)).referralRewardedAt).not.toBeNull();

    // The friend becoming a regular changes nothing more.
    await test.client.exec(`UPDATE users SET phone = '+962790001111', "passwordHash" = 'x' WHERE id IN (SELECT "userId" FROM telegram_accounts WHERE "telegramUserId" = ${FRIEND})`);
    await sendFileAndIntake(FRIEND);
    expect((await account(INVITER)).bonusUploads).toBe(1);
  });

  it("an unknown invite code and an existing student tapping an invite earn nothing", async () => {
    await handleTelegramUpdate(textUpdate("/start ref_ZZZZ9999", FRIEND));
    expect(await account(FRIEND)).toMatchObject({ source: "invite", referredById: null });

    const code = await inviteCodeOf(INVITER);
    // FRIEND already exists: tapping the link now does not make them invited.
    await handleTelegramUpdate(textUpdate(`/start ref_${code}`, FRIEND));
    await sendFileAndIntake(FRIEND);
    expect((await account(INVITER)).bonusUploads).toBe(0);
  });

  it("a guest past the free file uploads with an earned file, and is told the two ways when there is none", async () => {
    await sendFileAndIntake(INVITER); // the guest's free file
    const inviter = await account(INVITER);
    await test.client.query(`UPDATE telegram_accounts SET "bonusUploads" = 1 WHERE id = $1`, [inviter.id]);

    await handleTelegramUpdate(documentUpdate({ from: INVITER }));
    expect(lastSent().text).toContain(TEXT.bonusUsed);
    expect(await account(INVITER)).toMatchObject({ bonusUploads: 1, bonusUsed: 1 });
    expect(await rows(`SELECT id FROM telegram_uploads WHERE "telegramAccountId" = $1`, [inviter.id])).toHaveLength(2);

    // Finish that upload so it counts, then try a third.
    await test.client.exec(`UPDATE telegram_uploads SET status = 'processing'`);
    await handleTelegramUpdate(documentUpdate({ from: INVITER }));
    expect(lastSent().text).toBe(TEXT.guestLimit);
    const markup = JSON.stringify(lastSent().markup);
    expect(markup).toMatch(/nirolearn\.com\/connect\//);
    expect(markup).toContain("https://t.me/share/url?url=");
    expect((await account(INVITER)).bonusUsed).toBe(1);
  });

  it("a registered student at the plan's limit uploads with an earned file instead", async () => {
    await handleTelegramUpdate(textUpdate("/start", INVITER));
    const inviter = await account(INVITER);
    await test.client.exec(`UPDATE users SET phone = '+962790002222', "passwordHash" = 'x'`);
    await test.client.query(`UPDATE telegram_accounts SET "bonusUploads" = 1 WHERE id = $1`, [inviter.id]);
    const limit = () =>
      NextResponse.json({ error: "وصلت إلى حد ملفاتك اليوم.", code: "PLAN_LIMIT_REACHED" }, { status: 429 });
    admitUpload
      .mockResolvedValueOnce(limit())
      .mockResolvedValueOnce({ receipt: null, release: vi.fn() });

    const uploadId = await sendFileAndIntake(INVITER);
    const [upload] = await rows<{ status: string }>(`SELECT status FROM telegram_uploads WHERE id = $1`, [uploadId]);
    expect(upload.status).toBe("processing");
    expect(admitUpload.mock.calls.at(-1)![3]).toEqual({ skipQuota: true });
    expect((await account(INVITER)).bonusUsed).toBe(1);

    // No earned file left: the plan's own message is what the student sees.
    admitUpload.mockResolvedValue(limit());
    const second = await sendFileAndIntake(INVITER);
    const [refused] = await rows<{ status: string; error: string }>(`SELECT status, error FROM telegram_uploads WHERE id = $1`, [second]);
    expect(refused).toEqual({ status: "rejected", error: "وصلت إلى حد ملفاتك اليوم." });
    expect((await account(INVITER)).bonusUsed).toBe(1);
  });

  it("earned files are capped", async () => {
    await handleTelegramUpdate(textUpdate("/start", INVITER));
    const inviter = await account(INVITER);
    await test.client.query(`UPDATE telegram_accounts SET "bonusUploads" = $2 WHERE id = $1`, [inviter.id, MAX_BONUS_UPLOADS]);
    const code = await inviteCodeOf(INVITER);
    await handleTelegramUpdate(textUpdate(`/start ref_${code}`, FRIEND));
    await sendFileAndIntake(FRIEND);
    expect((await account(INVITER)).bonusUploads).toBe(MAX_BONUS_UPLOADS);
  });

  it("reports, per source, who arrived, who uploaded and who registered — as counts only", async () => {
    await handleTelegramUpdate(textUpdate("/start src_batch6", 820001));
    await handleTelegramUpdate(textUpdate("/start src_batch6", 820002));
    await handleTelegramUpdate(textUpdate("/start", 820003));
    await sendFileAndIntake(820001);
    await test.client.exec(`UPDATE users SET phone = '+962790003333', "passwordHash" = 'x' WHERE id IN (SELECT "userId" FROM telegram_accounts WHERE "telegramUserId" = 820002)`);

    expect(await sourceReport()).toEqual([
      { source: "batch6", arrived: 2, uploaded: 1, registered: 1 },
      { source: "direct", arrived: 1, uploaded: 0, registered: 0 },
    ]);
  });
});

describe("The webhook route", () => {
  const call = async (headers: Record<string, string>, body: unknown = { update_id: 1 }) => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    return POST(
      new Request("https://nirolearn.com/api/telegram/webhook", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    );
  };

  it("refuses a call without Telegram's secret", async () => {
    expect((await call({})).status).toBe(401);
    expect((await call({ "x-telegram-bot-api-secret-token": "wrong-secret" })).status).toBe(401);
  });

  it("handles an authentic update", async () => {
    const response = await call({ "x-telegram-bot-api-secret-token": "hook-secret" }, textUpdate("/start"));
    expect(response.status).toBe(200);
    expect(tg.sendMessage.mock.calls[0][1]).toBe(TEXT.welcome);
  });

  it("does not exist while the gateway is switched off", async () => {
    process.env.TELEGRAM_ENABLED = "false";
    try {
      expect((await call({ "x-telegram-bot-api-secret-token": "hook-secret" })).status).toBe(404);
    } finally {
      process.env.TELEGRAM_ENABLED = "true";
    }
  });
});
