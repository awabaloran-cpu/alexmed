// 🔗 Sharing a file by link, on a real Postgres (PGlite): who can make a
// link, who gets access through it, what they can and cannot reach, and
// every way access ends. The rule under test decides who reads students'
// files, so each case is spelled out.
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
const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({
  auth: async () =>
    authState.userId ? { user: { id: authState.userId } } : null,
}));
const streamStoredObject = vi.hoisted(() =>
  vi.fn(async () => new Response("image-bytes"))
);
vi.mock("@/lib/storage-stream", () => ({ streamStoredObject }));

import { getBookAccess } from "./book-access";
import {
  listQuestionAttempts,
  saveQuestionAttempt,
} from "./db-question-attempts";
import {
  getQuestionFileForViewer,
  listQuestionFilesForUser,
  listSharedQuestionFiles,
} from "./db-question-files";
import { listSharedWithMe } from "./db-sharing";
import {
  decideQuestionFileAccess,
  getQuestionFileAccess,
} from "./question-file-access";
import {
  adminStopShareLink,
  getOrCreateShareLink,
  joinByShareLink,
  listReportedShareLinks,
  listSharedFilesForUser,
  parseShareCode,
  reportSharedFile,
  revokeShareLink,
  shareLinkStatus,
  shareLinkUrl,
} from "./share-links";

let test: TestDb;
const OWNER = "00000000-0000-4000-8000-00000000a001";
const FRIEND = "00000000-0000-4000-8000-00000000a002";
const STRANGER = "00000000-0000-4000-8000-00000000a003";
const ADMIN = "00000000-0000-4000-8000-00000000a004";
const QFILE = "00000000-0000-4000-8000-00000000b001";
const BOOK = "00000000-0000-4000-8000-00000000b002";

const rows = async <T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
) => (await test.client.query<T>(sql, params)).rows;

async function codeFor(bookId: string, ownerId = OWNER) {
  const link = await getOrCreateShareLink(ownerId, bookId);
  if (!link.ok) throw new Error(link.reason);
  return link.code;
}

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  process.env.TELEGRAM_BOT_USERNAME = "Nirolearnbot";
}, 60_000);

beforeEach(async () => {
  await test.client.exec(`TRUNCATE users CASCADE`);
  vi.clearAllMocks();
  authState.userId = null;
  for (const [id, name] of [
    [OWNER, "Awab"],
    [FRIEND, "Sara"],
    [STRANGER, "Omar"],
    [ADMIN, "Admin"],
  ]) {
    await insertUser(test.client, { id, name });
  }
  // 3 visible questions, 4 options each, answer index 1.
  await insertQuestionFile(test.client, { id: QFILE, userId: OWNER, questions: 3 });
  await test.client.query(
    `INSERT INTO books (id, "userId", "fileName", "fileKey", "sourceType", status, "pageCount")
     VALUES ($1, $2, 'Pediatrics.pdf', $3, 'study_book', 'complete', 40)`,
    [BOOK, OWNER, `book-pdfs/${OWNER}/pediatrics.pdf`]
  );
});

describe("decideQuestionFileAccess", () => {
  const row = {
    bookId: QFILE,
    ownerId: OWNER,
    ownerName: "Awab",
    shared: false,
    protectedSet: false,
  };
  it("owner, accepted classmate, nobody else", () => {
    expect(decideQuestionFileAccess(OWNER, row)?.role).toBe("owner");
    expect(decideQuestionFileAccess(FRIEND, { ...row, shared: true })?.role).toBe("shared");
    expect(decideQuestionFileAccess(FRIEND, row)).toBeNull();
    expect(decideQuestionFileAccess(FRIEND, undefined)).toBeNull();
  });
  it("a doctor's protected set is never reachable through a share", () => {
    expect(
      decideQuestionFileAccess(FRIEND, { ...row, shared: true, protectedSet: true })
    ).toBeNull();
    // Its owner keeps their own access.
    expect(
      decideQuestionFileAccess(OWNER, { ...row, protectedSet: true })?.role
    ).toBe("owner");
  });
});

describe("making a link", () => {
  it("the owner gets one stable link per file", async () => {
    const first = await getOrCreateShareLink(OWNER, QFILE);
    const again = await getOrCreateShareLink(OWNER, QFILE);
    expect(first).toMatchObject({ ok: true, joinCount: 0 });
    expect(again).toEqual(first);
    const code = (first as { code: string }).code;
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{16}$/);
    expect(shareLinkUrl(code)).toBe(`https://t.me/Nirolearnbot?start=sh_${code}`);
    expect(parseShareCode(`sh_${code.toLowerCase()}`)).toBe(code);
    // Two requests at once still leave one live link.
    await revokeShareLink(OWNER, QFILE);
    await Promise.all([
      getOrCreateShareLink(OWNER, QFILE),
      getOrCreateShareLink(OWNER, QFILE),
    ]);
    expect(
      await rows(`SELECT id FROM file_share_links WHERE "revokedAt" IS NULL`)
    ).toHaveLength(1);
  });

  it("nobody can make a link for a file that is not theirs", async () => {
    expect(await getOrCreateShareLink(FRIEND, QFILE)).toEqual({ ok: false, reason: "not_found" });
    expect(await rows(`SELECT id FROM file_share_links`)).toHaveLength(0);
  });

  it("a file still being read, a failed one, and a protected set cannot be shared", async () => {
    await test.client.query(`UPDATE books SET status = 'extracting' WHERE id = $1`, [QFILE]);
    expect(await getOrCreateShareLink(OWNER, QFILE)).toEqual({ ok: false, reason: "not_ready" });
    await test.client.query(`UPDATE books SET status = 'failed' WHERE id = $1`, [QFILE]);
    expect(await getOrCreateShareLink(OWNER, QFILE)).toEqual({ ok: false, reason: "not_ready" });

    await test.client.query(`UPDATE books SET status = 'complete' WHERE id = $1`, [QFILE]);
    await test.client.query(
      `INSERT INTO question_sets ("bookId", "ownerId", title) VALUES ($1, $2, 'Midterm')`,
      [QFILE, OWNER]
    );
    expect(await getOrCreateShareLink(OWNER, QFILE)).toEqual({ ok: false, reason: "protected" });
  });

  it("rejects anything that is not a share code", () => {
    for (const payload of [undefined, "", "sh_", "sh_short", "sh_ABCDEFGH2345678O", "ref_ABCD2345", "sh_'; drop table"]) {
      expect(parseShareCode(payload)).toBeNull();
    }
  });
});

describe("joining a question file", () => {
  it("gives the classmate the questions — and nothing that identifies the stored file", async () => {
    const image = await test.client.query<{ id: string }>(
      `INSERT INTO extracted_question_images ("bookId", "pageNumber", "storageKey")
       VALUES ($1, 1, 'question-files/secret-key/page-1.png') RETURNING id`,
      [QFILE]
    );
    await test.client.query(
      `INSERT INTO extracted_question_image_relations ("questionId", "imageId")
       SELECT id, $2 FROM extracted_questions WHERE "bookId" = $1 ORDER BY "orderIndex" LIMIT 1`,
      [QFILE, image.rows[0].id]
    );
    expect(await getQuestionFileAccess(FRIEND, QFILE)).toBeNull();

    const joined = await joinByShareLink(await codeFor(QFILE), FRIEND);
    expect(joined).toMatchObject({
      ok: true,
      bookId: QFILE,
      kind: "question_file",
      ownerName: "Awab",
      role: "joined",
    });

    const view = (await getQuestionFileForViewer(FRIEND, QFILE))!;
    expect(view.shared).toBe(true);
    expect(view.sharedBy).toBe("Awab");
    expect(view.questions).toHaveLength(3);
    expect(view.questions[0].imageUrl).toBe(
      `/api/books/question-files/${QFILE}/images/${image.rows[0].id}`
    );
    const sent = JSON.stringify(view);
    expect(sent).not.toContain("secret-key");
    expect(sent).not.toContain("fileKey");
    expect(sent).not.toContain("uploads/");
    expect(sent).not.toContain("secret staging text");

    // The owner's own view is unchanged.
    const own = (await getQuestionFileForViewer(OWNER, QFILE))!;
    expect(own.shared).toBe(false);
    expect(own.sharedBy).toBeNull();
    expect(own.questions[0].imageUrl).toBe("/api/files/question-files/secret-key/page-1.png");
  });

  it("someone without the link still sees nothing", async () => {
    await joinByShareLink(await codeFor(QFILE), FRIEND);
    expect(await getQuestionFileAccess(STRANGER, QFILE)).toBeNull();
    expect(await getQuestionFileForViewer(STRANGER, QFILE)).toBeNull();
    const [first] = await rows<{ id: string }>(`SELECT id FROM extracted_questions WHERE "bookId" = $1`, [QFILE]);
    expect(
      await saveQuestionAttempt(STRANGER, { bookId: QFILE, questionId: first.id, selectedIndex: 1 })
    ).toBeNull();
  });

  it("joining twice (or twice at once) makes one share and counts once", async () => {
    const code = await codeFor(QFILE);
    const results = await Promise.all([
      joinByShareLink(code, FRIEND),
      joinByShareLink(code, FRIEND),
    ]);
    expect(results.every(r => r.ok)).toBe(true);
    expect(await joinByShareLink(code, FRIEND)).toMatchObject({ ok: true, role: "already" });
    expect(await rows(`SELECT id FROM book_shares`)).toHaveLength(1);
    expect((await shareLinkStatus(OWNER, QFILE))?.joinCount).toBe(1);
  });

  it("the owner opening their own link gets the file, not a share of it", async () => {
    expect(await joinByShareLink(await codeFor(QFILE), OWNER)).toMatchObject({ ok: true, role: "own" });
    expect(await rows(`SELECT id FROM book_shares`)).toHaveLength(0);
  });

  it("each student's answers are their own", async () => {
    await joinByShareLink(await codeFor(QFILE), FRIEND);
    const [first] = await rows<{ id: string }>(
      `SELECT id FROM extracted_questions WHERE "bookId" = $1 ORDER BY "orderIndex"`,
      [QFILE]
    );
    expect(
      await saveQuestionAttempt(FRIEND, { bookId: QFILE, questionId: first.id, selectedIndex: 0 })
    ).toEqual({ isCorrect: false });
    await saveQuestionAttempt(OWNER, { bookId: QFILE, questionId: first.id, selectedIndex: 1 });
    expect(await listQuestionAttempts(FRIEND, QFILE)).toEqual({ [first.id]: 0 });
    expect(await listQuestionAttempts(OWNER, QFILE)).toEqual({ [first.id]: 1 });
  });

  it("shows up in the classmate's shared list, never in the owner-only or the books list", async () => {
    await joinByShareLink(await codeFor(QFILE), FRIEND);
    expect(await listSharedQuestionFiles(FRIEND)).toMatchObject([
      { id: QFILE, fileName: "bank.pdf", questionCount: 3, sharedBy: "Awab" },
    ]);
    expect(await listQuestionFilesForUser(FRIEND)).toEqual([]);
    // The older "shared with me" (web + the mobile app) opens what it
    // lists as a study book: a question file must not appear there.
    expect(await listSharedWithMe(FRIEND)).toEqual([]);
    expect(await listSharedFilesForUser(FRIEND)).toMatchObject([{ bookId: QFILE }]);
  });
});

describe("joining a study book", () => {
  it("gives the same access a share by username gives", async () => {
    expect(await getBookAccess(FRIEND, BOOK)).toBeNull();
    const joined = await joinByShareLink(await codeFor(BOOK), FRIEND);
    expect(joined).toMatchObject({ ok: true, kind: "book", role: "joined" });
    expect(await getBookAccess(FRIEND, BOOK)).toMatchObject({ role: "shared", ownerId: OWNER });
    expect((await listSharedWithMe(FRIEND)).map(row => row.bookId)).toEqual([BOOK]);
    expect(await getBookAccess(STRANGER, BOOK)).toBeNull();
    // A book link gives nothing on the owner's other files.
    expect(await getQuestionFileAccess(FRIEND, QFILE)).toBeNull();
  });
});

describe("ending access", () => {
  it("stopping the link withdraws everyone at once; the old code is dead and a new link is a new code", async () => {
    const code = await codeFor(QFILE);
    await joinByShareLink(code, FRIEND);
    await joinByShareLink(code, STRANGER);

    expect(await revokeShareLink(OWNER, QFILE)).toBe(true);
    expect(await getQuestionFileAccess(FRIEND, QFILE)).toBeNull();
    expect(await getQuestionFileAccess(STRANGER, QFILE)).toBeNull();
    expect(await joinByShareLink(code, FRIEND)).toEqual({ ok: false, reason: "invalid" });
    expect(await getQuestionFileAccess(OWNER, QFILE)).not.toBeNull();

    const fresh = await codeFor(QFILE);
    expect(fresh).not.toBe(code);
    // Stopping a link is not a ban: the classmate may join the next one.
    expect(await joinByShareLink(fresh, FRIEND)).toMatchObject({ ok: true, role: "joined" });
  });

  it("only the owner can stop their link", async () => {
    const code = await codeFor(QFILE);
    await joinByShareLink(code, FRIEND);
    expect(await revokeShareLink(FRIEND, QFILE)).toBe(false);
    expect(await getQuestionFileAccess(FRIEND, QFILE)).not.toBeNull();
  });

  it("a student the owner removed themselves, or blocked, cannot come back through the link", async () => {
    const code = await codeFor(BOOK);
    await joinByShareLink(code, FRIEND);
    const { revokeShare } = await import("./db-sharing");
    const [share] = await rows<{ id: string }>(`SELECT id FROM book_shares`);
    await revokeShare(OWNER, share.id);
    expect(await getBookAccess(FRIEND, BOOK)).toBeNull();
    expect(await joinByShareLink(code, FRIEND)).toEqual({ ok: false, reason: "refused" });
    expect(await getBookAccess(FRIEND, BOOK)).toBeNull();

    await test.client.query(
      `INSERT INTO user_blocks ("blockerId", "blockedId") VALUES ($1, $2)`,
      [OWNER, STRANGER]
    );
    expect(await joinByShareLink(code, STRANGER)).toEqual({ ok: false, reason: "refused" });
    expect(await getBookAccess(STRANGER, BOOK)).toBeNull();
  });

  it("a suspended owner's link stops working, and deleting the file removes every trace", async () => {
    const code = await codeFor(QFILE);
    await test.client.query(`UPDATE users SET "suspendedAt" = now() WHERE id = $1`, [OWNER]);
    expect(await joinByShareLink(code, FRIEND)).toEqual({ ok: false, reason: "invalid" });

    await test.client.query(`UPDATE users SET "suspendedAt" = NULL WHERE id = $1`, [OWNER]);
    await joinByShareLink(code, FRIEND);
    await test.client.query(`DELETE FROM books WHERE id = $1`, [QFILE]);
    expect(await getQuestionFileAccess(FRIEND, QFILE)).toBeNull();
    expect(await rows(`SELECT id FROM file_share_links`)).toHaveLength(0);
    expect(await rows(`SELECT id FROM book_shares`)).toHaveLength(0);
    expect(await joinByShareLink(code, FRIEND)).toEqual({ ok: false, reason: "invalid" });
  });

  it("a file that becomes a protected set closes to everyone who joined", async () => {
    const code = await codeFor(QFILE);
    await joinByShareLink(code, FRIEND);
    await test.client.query(
      `INSERT INTO question_sets ("bookId", "ownerId", title) VALUES ($1, $2, 'Midterm')`,
      [QFILE, OWNER]
    );
    expect(await getQuestionFileAccess(FRIEND, QFILE)).toBeNull();
    expect(await getQuestionFileForViewer(FRIEND, QFILE)).toBeNull();
    expect(await listSharedQuestionFiles(FRIEND)).toEqual([]);
    expect(await joinByShareLink(code, STRANGER)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("reports and the admin's stop", () => {
  it("a classmate reports once; an admin's stop withdraws access and cannot be undone by re-sharing", async () => {
    const code = await codeFor(QFILE);
    await joinByShareLink(code, FRIEND);
    await joinByShareLink(code, STRANGER);

    // Only someone the file was shared with can report it.
    expect(await reportSharedFile(ADMIN, QFILE)).toBe(false);
    expect(await reportSharedFile(FRIEND, QFILE)).toBe(true);
    expect(await reportSharedFile(FRIEND, QFILE)).toBe(true);
    expect(await reportSharedFile(STRANGER, QFILE)).toBe(true);

    const [reported] = await listReportedShareLinks();
    expect(reported).toMatchObject({
      bookId: QFILE,
      title: "bank.pdf",
      ownerName: "Awab",
      joinCount: 2,
      reportCount: 2,
    });

    expect(await adminStopShareLink(ADMIN, reported.linkId)).toBe(true);
    expect(await getQuestionFileAccess(FRIEND, QFILE)).toBeNull();
    expect(await joinByShareLink(code, FRIEND)).toEqual({ ok: false, reason: "invalid" });
    expect(await getOrCreateShareLink(OWNER, QFILE)).toEqual({ ok: false, reason: "stopped_by_admin" });
    // The owner still has their own file.
    expect(await getQuestionFileAccess(OWNER, QFILE)).not.toBeNull();
  });
});

describe("the shared file's image route", () => {
  async function get(bookId: string, imageId: string) {
    const { GET } = await import(
      "@/app/api/books/question-files/[bookId]/images/[imageId]/route"
    );
    return GET(new Request("https://nirolearn.com/x"), {
      params: Promise.resolve({ bookId, imageId }),
    });
  }
  async function imageOf(bookId: string, key: string) {
    const image = await test.client.query<{ id: string }>(
      `INSERT INTO extracted_question_images ("bookId", "pageNumber", "storageKey")
       VALUES ($1, 1, $2) RETURNING id`,
      [bookId, key]
    );
    return image.rows[0].id;
  }

  it("serves a file's image to its owner and to a classmate, and to nobody else", async () => {
    const imageId = await imageOf(QFILE, "question-files/k/page-1.png");
    await joinByShareLink(await codeFor(QFILE), FRIEND);

    expect((await get(QFILE, imageId)).status).toBe(401);
    authState.userId = STRANGER;
    expect((await get(QFILE, imageId)).status).toBe(404);
    expect(streamStoredObject).not.toHaveBeenCalled();

    authState.userId = FRIEND;
    const ok = await get(QFILE, imageId);
    expect(ok.status).toBe(200);
    expect(streamStoredObject).toHaveBeenCalledWith(
      "question-files/k/page-1.png",
      expect.anything(),
      { cacheControl: "private, no-store" }
    );
  });

  it("never pairs a file the viewer may read with another file's image", async () => {
    const OTHER = "00000000-0000-4000-8000-00000000b009";
    await insertQuestionFile(test.client, { id: OTHER, userId: STRANGER, questions: 1 });
    const foreign = await imageOf(OTHER, "question-files/other/page-1.png");
    await joinByShareLink(await codeFor(QFILE), FRIEND);
    authState.userId = FRIEND;
    expect((await get(QFILE, foreign)).status).toBe(404);
    expect((await get(QFILE, "not-a-uuid")).status).toBe(404);
    expect(streamStoredObject).not.toHaveBeenCalled();
  });
});
