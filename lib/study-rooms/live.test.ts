// What members share inside a room — the file, the page, highlights, chat —
// and the group quiz, through the REAL router on a real Postgres (PGlite).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
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

import { isFileKeyAccessibleToUser } from "../db-file-access";
import { roomsRouter } from "../trpc/roomsRouter";
import { cleanRects } from "./live";
import { quizPoints, REVEAL_SECONDS } from "./quiz";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AHMED = id(1);
const SARA = id(2);
const OMAR = id(3);
const LAYAN = id(4);
const OUTSIDER = id(5);
const BOOK = id(101); // Ahmed's file, 3 pages
const BANK = id(102); // Ahmed's question bank, 6 questions
const SARA_BANK = id(103);
const SET_BANK = id(104); // Ahmed's, but a doctor's protected set
const THIN_BANK = id(105); // 2 questions only
const KEY = `uploads/${AHMED}/bank.pdf`;

let test: TestDb;
let medicine: string;
let roomId: string;

const as = (userId: string) =>
  roomsRouter.createCaller({
    user: {
      id: userId,
      role: "user",
      email: `${userId}@x.test`,
      name: null,
    } as unknown as User,
  } as never);

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof TRPCError) return `${error.code}:${error.message}`;
    throw error;
  }
  return "allowed";
}

const cid = (() => {
  let n = 0;
  return () => `client-${String(++n).padStart(6, "0")}`;
})();
const rect = { x: 0.1, y: 0.2, w: 0.5, h: 0.03 };

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  process.env.STUDY_ROOMS_ENABLED = "true";
  for (const [userId, name] of [
    [AHMED, "أحمد"],
    [SARA, "سارة"],
    [OMAR, "عمر"],
    [LAYAN, "ليان"],
    [OUTSIDER, "غريب"],
  ] as const) {
    await insertUser(test.client, { id: userId, name });
    await as(userId).setProfile({
      birthDate: "2003-05-05",
      stage: "university",
      country: "EG",
    });
    await as(userId).setProfile({ acceptRules: true });
  }
  await insertQuestionFile(test.client, { id: BOOK, userId: AHMED });
  await insertQuestionFile(test.client, {
    id: BANK,
    userId: AHMED,
    fileKey: "k/bank",
    questions: 6,
  });
  await insertQuestionFile(test.client, {
    id: SARA_BANK,
    userId: SARA,
    fileKey: "k/sara",
    questions: 6,
  });
  await insertQuestionFile(test.client, {
    id: SET_BANK,
    userId: AHMED,
    fileKey: "k/set",
    questions: 6,
  });
  await insertQuestionFile(test.client, {
    id: THIN_BANK,
    userId: AHMED,
    fileKey: "k/thin",
    questions: 2,
  });
  await test.client.query(
    `INSERT INTO question_sets ("bookId", "ownerId", title) VALUES ($1, $2, 'Set')`,
    [SET_BANK, AHMED]
  );
  const section = await test.client.query<{ id: string }>(
    `SELECT id FROM study_sections WHERE key = 'medicine'`
  );
  medicine = section.rows[0].id;
}, 120_000);

beforeEach(async () => {
  await test.client.exec(
    `DELETE FROM study_room_events; DELETE FROM study_rooms; DELETE FROM user_blocks;`
  );
  ({ roomId } = await as(AHMED).create({
    visibility: "public",
    title: "أدوية الكلى",
    sectionId: medicine,
    bookId: BOOK,
  }));
  await as(SARA).join({ roomId });
  await as(OMAR).join({ roomId });
});

describe("the room's file", () => {
  it("is readable by the members while they are in, and by nobody else", async () => {
    const file = await as(SARA).file({ roomId });
    expect(file).toMatchObject({ bookId: BOOK, pageCount: 3, sharedPage: 1 });
    expect(file?.url).toBe(`/api/files/${KEY}?stream=1`);
    expect(await isFileKeyAccessibleToUser(SARA, KEY)).toBe(true);
    expect(await isFileKeyAccessibleToUser(OUTSIDER, KEY)).toBe(false);
    expect(await refusal(as(OUTSIDER).file({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
  });

  it("stops the moment the student leaves, is removed, or the room ends", async () => {
    await as(SARA).leave({ roomId });
    expect(await isFileKeyAccessibleToUser(SARA, KEY)).toBe(false);

    await as(AHMED).remove({ roomId, userId: OMAR, ban: false });
    expect(await isFileKeyAccessibleToUser(OMAR, KEY)).toBe(false);

    await as(LAYAN).join({ roomId });
    expect(await isFileKeyAccessibleToUser(LAYAN, KEY)).toBe(true);
    await as(AHMED).end({ roomId });
    expect(await isFileKeyAccessibleToUser(LAYAN, KEY)).toBe(false);
    // The owner still reads their own file, room or no room.
    expect(await isFileKeyAccessibleToUser(AHMED, KEY)).toBe(true);
  });

  it("never opens a doctor's protected set, whatever a room row says", async () => {
    // Forced in behind the application's back.
    await test.client.query(
      `UPDATE study_rooms SET "bookId" = $1 WHERE id = $2`,
      [SET_BANK, roomId]
    );
    expect(await isFileKeyAccessibleToUser(SARA, "k/set")).toBe(false);
  });

  it("is not asked about at all while the feature is off", async () => {
    process.env.STUDY_ROOMS_ENABLED = "false";
    try {
      expect(await isFileKeyAccessibleToUser(SARA, KEY)).toBe(false);
    } finally {
      process.env.STUDY_ROOMS_ENABLED = "true";
    }
  });
});

describe("the page everyone follows", () => {
  it("only the host moves it — or a member the host lets lead", async () => {
    expect(await as(AHMED).setPage({ roomId, page: 2 })).toMatchObject({
      sharedPage: 2,
    });
    expect((await as(SARA).file({ roomId }))?.sharedPage).toBe(2);
    expect(await refusal(as(SARA).setPage({ roomId, page: 3 }))).toBe(
      "FORBIDDEN:not_allowed"
    );
    expect((await as(OMAR).file({ roomId }))?.sharedPage).toBe(2);

    await as(AHMED).setMember({ roomId, userId: SARA, grants: { lead: true } });
    expect(await refusal(as(SARA).setPage({ roomId, page: 3 }))).toBe(
      "allowed"
    );
    expect((await as(OMAR).file({ roomId }))?.sharedPage).toBe(3);
  });

  it("refuses a page the file does not have, and a room with no file", async () => {
    expect(await refusal(as(AHMED).setPage({ roomId, page: 4 }))).toBe(
      "BAD_REQUEST:bad_page"
    );
    await as(AHMED).update({ roomId, bookId: null });
    expect(await refusal(as(AHMED).setPage({ roomId, page: 1 }))).toBe(
      "BAD_REQUEST:no_file"
    );
    expect(await as(SARA).file({ roomId })).toBeNull();
  });

  it("each move takes the room's sequence number on; the same page does not", async () => {
    const first = await as(AHMED).setPage({ roomId, page: 2 });
    const same = await as(AHMED).setPage({ roomId, page: 2 });
    const next = await as(AHMED).setPage({ roomId, page: 3 });
    expect(same.seq).toBe(first.seq);
    expect(next.seq).toBe(first.seq + 1);
  });
});

describe("shared highlights", () => {
  it("one member's highlight is everyone's, with its author", async () => {
    const mark = await as(SARA).addMark({
      roomId,
      page: 2,
      color: "yellow",
      rects: [rect],
      text: "Loop diuretics",
      clientId: cid(),
    });
    const seen = await as(OMAR).marks({ roomId, page: 2 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      id: mark.id,
      name: "سارة",
      color: "yellow",
      text: "Loop diuretics",
      rects: [rect],
    });
    expect(await as(OMAR).marks({ roomId, page: 1 })).toEqual([]);
    expect(await refusal(as(OUTSIDER).marks({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
  });

  it("a resend is the same highlight, not a second one", async () => {
    const clientId = cid();
    const input = {
      roomId,
      page: 1,
      color: "green" as const,
      rects: [rect],
      clientId,
    };
    const first = await as(SARA).addMark(input);
    const again = await as(SARA).addMark(input);
    expect(again.id).toBe(first.id);
    expect(await as(SARA).marks({ roomId })).toHaveLength(1);
  });

  it("the author removes their own; only the host or a co-host removes another's", async () => {
    const mark = await as(SARA).addMark({
      roomId,
      page: 1,
      color: "pink",
      rects: [rect],
      clientId: cid(),
    });
    expect(
      await refusal(as(OMAR).deleteMark({ roomId, markId: mark.id }))
    ).toBe("FORBIDDEN:not_allowed");
    expect(
      await refusal(as(AHMED).deleteMark({ roomId, markId: mark.id }))
    ).toBe("allowed");
    expect(await as(SARA).marks({ roomId })).toEqual([]);
  });

  it("is refused when the host has switched highlighting off — for that member only if so", async () => {
    await as(AHMED).update({ roomId, settings: { marks: false } });
    const attempt = () =>
      as(SARA).addMark({
        roomId,
        page: 1,
        color: "blue",
        rects: [rect],
        clientId: cid(),
      });
    expect(await refusal(attempt())).toBe("FORBIDDEN:not_allowed");
    await as(AHMED).setMember({ roomId, userId: SARA, grants: { mark: true } });
    expect(await refusal(attempt())).toBe("allowed");
    expect(
      await refusal(
        as(OMAR).addMark({
          roomId,
          page: 1,
          color: "blue",
          rects: [rect],
          clientId: cid(),
        })
      )
    ).toBe("FORBIDDEN:not_allowed");
  });

  it("accepts only rectangles inside the page", () => {
    expect(cleanRects([rect])).toEqual([rect]);
    expect(cleanRects([])).toBeNull();
    expect(cleanRects([{ x: 0.9, y: 0.1, w: 0.5, h: 0.1 }])).toBeNull();
    expect(cleanRects([{ x: -0.1, y: 0.1, w: 0.5, h: 0.1 }])).toBeNull();
    expect(cleanRects([{ x: 0.1, y: 0.1, w: 0, h: 0.1 }])).toBeNull();
    expect(cleanRects([{ x: Number.NaN, y: 0.1, w: 0.2, h: 0.1 }])).toBeNull();
    expect(cleanRects(Array.from({ length: 41 }, () => rect))).toBeNull();
  });

  it("holds a member to a number of highlights", async () => {
    await test.client.query(
      `INSERT INTO study_room_marks ("roomId", "userId", "bookId", "pageNumber", color, rects, "clientId", "createdAt")
       SELECT $1, $2, $3, 1, 'yellow', '[]'::jsonb, 'seed-' || n, now() - interval '1 hour'
       FROM generate_series(1, 60) n`,
      [roomId, SARA, BOOK]
    );
    expect(
      await refusal(
        as(SARA).addMark({
          roomId,
          page: 2,
          color: "yellow",
          rects: [rect],
          clientId: cid(),
        })
      )
    ).toBe("CONFLICT:limit_reached");
    // Another member is not held back by it.
    expect(
      await refusal(
        as(OMAR).addMark({
          roomId,
          page: 2,
          color: "yellow",
          rects: [rect],
          clientId: cid(),
        })
      )
    ).toBe("allowed");
  });
});

describe("the chat", () => {
  it("messages arrive in order, with their author and the page they point at", async () => {
    await as(SARA).sendMessage({
      roomId,
      body: "  السؤال 3 صعب  ",
      page: 2,
      clientId: cid(),
    });
    await as(OMAR).sendMessage({
      roomId,
      body: "<script>alert(1)</script>",
      clientId: cid(),
    });
    const messages = await as(AHMED).messages({ roomId });
    expect(
      messages.map(message => [message.name, message.body, message.page])
    ).toEqual([
      ["سارة", "السؤال 3 صعب", 2],
      // Text is stored and returned as text.
      ["عمر", "<script>alert(1)</script>", null],
    ]);
    expect(messages[1].seq).toBeGreaterThan(messages[0].seq);
    // Only what is new since a known point.
    expect(
      await as(AHMED).messages({ roomId, afterSeq: messages[0].seq })
    ).toHaveLength(1);
    expect(await refusal(as(OUTSIDER).messages({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
  });

  it("a resend is the same message; a flood is stopped", async () => {
    const clientId = cid();
    const first = await as(SARA).sendMessage({
      roomId,
      body: "مرحبا",
      clientId,
    });
    const again = await as(SARA).sendMessage({
      roomId,
      body: "مرحبا",
      clientId,
    });
    expect(again.id).toBe(first.id);
    for (let i = 0; i < 4; i++) {
      await as(SARA).sendMessage({
        roomId,
        body: `رسالة ${i}`,
        clientId: cid(),
      });
    }
    expect(
      await refusal(
        as(SARA).sendMessage({ roomId, body: "واحدة أخرى", clientId: cid() })
      )
    ).toBe("TOO_MANY_REQUESTS:rate_limited");
    expect(await as(AHMED).messages({ roomId })).toHaveLength(5);
  });

  it("is refused when the host stops writing, and for someone outside", async () => {
    await as(AHMED).update({ roomId, settings: { chat: false } });
    expect(
      await refusal(
        as(SARA).sendMessage({ roomId, body: "هل", clientId: cid() })
      )
    ).toBe("FORBIDDEN:not_allowed");
    // The host and a co-host still write.
    expect(
      await refusal(
        as(AHMED).sendMessage({ roomId, body: "ركّزوا", clientId: cid() })
      )
    ).toBe("allowed");
    expect(
      await refusal(
        as(OUTSIDER).sendMessage({ roomId, body: "هاي", clientId: cid() })
      )
    ).toBe("NOT_FOUND:not_available");
    expect(
      await refusal(
        as(AHMED).sendMessage({ roomId, body: "   ", clientId: cid() })
      )
    ).toBe("BAD_REQUEST:message_empty");
  });

  it("a deleted message keeps its place and loses its words", async () => {
    const mine = await as(SARA).sendMessage({
      roomId,
      body: "غلطة",
      clientId: cid(),
    });
    const theirs = await as(OMAR).sendMessage({
      roomId,
      body: "كلام مسيء",
      clientId: cid(),
    });
    expect(
      await refusal(as(SARA).deleteMessage({ roomId, messageId: theirs.id }))
    ).toBe("FORBIDDEN:not_allowed");
    await as(SARA).deleteMessage({ roomId, messageId: mine.id });
    await as(AHMED).deleteMessage({ roomId, messageId: theirs.id });
    const messages = await as(OMAR).messages({ roomId });
    expect(messages.map(message => [message.deleted, message.body])).toEqual([
      [true, ""],
      [true, ""],
    ]);
  });

  it("two students who blocked each other do not read one another", async () => {
    await as(SARA).sendMessage({ roomId, body: "من سارة", clientId: cid() });
    await as(OMAR).sendMessage({ roomId, body: "من عمر", clientId: cid() });
    await as(OMAR).addMark({
      roomId,
      page: 1,
      color: "blue",
      rects: [rect],
      clientId: cid(),
    });
    await test.client.query(
      `INSERT INTO user_blocks ("blockerId", "blockedId") VALUES ($1, $2)`,
      [SARA, OMAR]
    );
    expect(
      (await as(SARA).messages({ roomId })).map(message => message.body)
    ).toEqual(["من سارة"]);
    expect(
      (await as(OMAR).messages({ roomId })).map(message => message.body)
    ).toEqual(["من عمر"]);
    expect(await as(SARA).marks({ roomId })).toEqual([]);
    // A third member reads both.
    expect(await as(AHMED).messages({ roomId })).toHaveLength(2);
  });
});

describe("the group quiz", () => {
  const start = (overrides: Record<string, unknown> = {}) =>
    as(AHMED).quizStart({
      roomId,
      bookId: BANK,
      count: 3,
      seconds: 30,
      ...overrides,
    });
  const expire = (quizId: string, seconds: number) =>
    test.client.query(
      `UPDATE study_room_quizzes SET "questionStartedAt" = now() - make_interval(secs => $2) WHERE id = $1`,
      [quizId, seconds]
    );

  it("scores a right answer, more when it is fast, and nothing for a wrong one", () => {
    expect(quizPoints(true, 0, 30_000)).toBe(150);
    expect(quizPoints(true, 15_000, 30_000)).toBe(125);
    expect(quizPoints(true, 30_000, 30_000)).toBe(100);
    expect(quizPoints(false, 0, 30_000)).toBe(0);
  });

  it("only who may start one starts it, from their own bank, one at a time", async () => {
    expect(
      await refusal(
        as(SARA).quizStart({ roomId, bookId: SARA_BANK, count: 3, seconds: 30 })
      )
    ).toBe("FORBIDDEN:not_allowed");
    expect(await refusal(start({ bookId: SARA_BANK }))).toBe(
      "BAD_REQUEST:book_not_allowed"
    );
    expect(await refusal(start({ bookId: SET_BANK }))).toBe(
      "BAD_REQUEST:book_not_allowed"
    );
    expect(await refusal(start({ bookId: THIN_BANK }))).toBe(
      "BAD_REQUEST:quiz_too_few"
    );
    expect(await refusal(start())).toBe("allowed");
    expect(await refusal(start())).toBe("CONFLICT:quiz_running");
  });

  it("the answer never reaches a phone before the reveal", async () => {
    await start();
    const current = await as(SARA).quizCurrent({ roomId });
    expect(current).toMatchObject({
      state: "question",
      index: 0,
      total: 3,
      seconds: 30,
    });
    expect(current?.question.options).toHaveLength(4);
    expect(current?.remainingMs).toBeGreaterThan(25_000);
    expect(JSON.stringify(current)).not.toMatch(
      /correctIndex|extractedAnswerIndex|aiInferredAnswerIndex|distribution|leaderboard|explanation/
    );
  });

  it("a whole quiz for three students, from the first question to the podium", async () => {
    const { quizId } = await start();
    const play = async (picks: Record<string, number | null>) => {
      const current = (await as(AHMED).quizCurrent({ roomId }))!;
      expect(current.state).toBe("question");
      for (const [userId, selectedIndex] of Object.entries(picks)) {
        if (selectedIndex === null) continue;
        await as(userId).quizAnswer({
          quizId,
          questionId: current.question.id,
          selectedIndex,
        });
      }
      return current;
    };

    // Q1: everyone answers → revealed at once, without waiting for the clock.
    await play({ [AHMED]: 1, [SARA]: 1, [OMAR]: 0 });
    let current = (await as(OMAR).quizCurrent({ roomId }))!;
    expect(current).toMatchObject({
      state: "reveal",
      correctIndex: 1,
      distribution: [1, 2, 0, 0],
      mySelectedIndex: 0,
    });
    expect(current.leaderboard?.map(row => row.correct)).toEqual([1, 1, 0]);
    // A member cannot rush the reveal; the host moves on.
    expect(await refusal(as(SARA).quizAdvance({ quizId }))).toBe(
      "FORBIDDEN:not_allowed"
    );
    expect(await as(AHMED).quizAdvance({ quizId })).toEqual({
      state: "question",
    });

    // Q2: Omar does not answer; the clock runs out.
    const second = await play({ [AHMED]: 1, [SARA]: 2 });
    expect((await as(SARA).quizCurrent({ roomId }))?.state).toBe("question");
    await expire(quizId, 31);
    expect(
      await refusal(
        as(OMAR).quizAnswer({
          quizId,
          questionId: second.question.id,
          selectedIndex: 1,
        })
      )
    ).toBe("PRECONDITION_FAILED:quiz_closed");
    current = (await as(OMAR).quizCurrent({ roomId }))!;
    expect(current).toMatchObject({ state: "reveal", mySelectedIndex: null });
    // The host is gone? After a few seconds any member moves it on.
    await expire(quizId, REVEAL_SECONDS + 1);
    expect((await as(SARA).quizCurrent({ roomId }))?.canAdvance).toBe(true);
    expect(await as(SARA).quizAdvance({ quizId })).toEqual({
      state: "question",
    });

    // Q3, then the end.
    await play({ [AHMED]: 0, [SARA]: 1, [OMAR]: 1 });
    expect(await as(AHMED).quizAdvance({ quizId })).toEqual({
      state: "finished",
    });
    expect(await as(AHMED).quizCurrent({ roomId })).toBeNull();

    const results = await as(SARA).quizResults({ quizId });
    expect(results.total).toBe(3);
    expect(results.ranking.map(row => [row.name, row.correct])).toEqual(
      expect.arrayContaining([
        ["أحمد", 2],
        ["سارة", 2],
        ["عمر", 1],
      ])
    );
    expect(results.ranking[2].name).toBe("عمر");
    expect(results.me).toMatchObject({ correct: 2 });
    expect(results.hardest).toMatchObject({ answers: 2, correct: 1 });
    expect(await refusal(as(OUTSIDER).quizResults({ quizId }))).toBe(
      "NOT_FOUND:not_available"
    );
    // A new quiz may start now.
    expect(await refusal(start())).toBe("allowed");
  });

  it("an answer is given once, to the question that is up, by a member", async () => {
    const { quizId } = await start();
    const current = (await as(SARA).quizCurrent({ roomId }))!;
    const answer = (
      userId: string,
      questionId = current.question.id,
      selectedIndex = 1
    ) => as(userId).quizAnswer({ quizId, questionId, selectedIndex });
    expect(await refusal(answer(SARA))).toBe("allowed");
    expect(await refusal(answer(SARA, current.question.id, 0))).toBe(
      "CONFLICT:already_answered"
    );
    expect(await refusal(answer(OMAR, id(999)))).toBe(
      "PRECONDITION_FAILED:quiz_closed"
    );
    expect(await refusal(answer(OMAR, current.question.id, 9))).toBe(
      "PRECONDITION_FAILED:quiz_closed"
    );
    expect(await refusal(answer(OUTSIDER))).toBe("NOT_FOUND:not_available");
    // Sara's first answer stands.
    const stored = await test.client.query<{ selectedIndex: number }>(
      `SELECT "selectedIndex" FROM study_room_quiz_answers WHERE "quizId" = $1 AND "userId" = $2`,
      [quizId, SARA]
    );
    expect(stored.rows).toEqual([{ selectedIndex: 1 }]);
  });

  it("two phones moving it on at the same instant move it once", async () => {
    const { quizId } = await start();
    await as(AHMED).quizAdvance({ quizId }); // reveal
    await Promise.all([
      as(AHMED)
        .quizAdvance({ quizId })
        .catch(() => null),
      as(AHMED)
        .quizAdvance({ quizId })
        .catch(() => null),
    ]);
    const current = await as(SARA).quizCurrent({ roomId });
    expect(current).toMatchObject({ state: "question", index: 1 });
  });

  it("someone who joins midway meets the question that is up", async () => {
    const { quizId } = await start();
    await as(AHMED).quizAdvance({ quizId });
    await as(AHMED).quizAdvance({ quizId });
    await as(LAYAN).join({ roomId });
    const current = await as(LAYAN).quizCurrent({ roomId });
    expect(current).toMatchObject({
      state: "question",
      index: 1,
      mySelectedIndex: null,
    });
  });

  it("the host can call it off", async () => {
    const { quizId } = await start();
    expect(await refusal(as(SARA).quizCancel({ quizId }))).toBe(
      "FORBIDDEN:not_allowed"
    );
    await as(AHMED).quizCancel({ quizId });
    expect(await as(SARA).quizCurrent({ roomId })).toBeNull();
    expect(await refusal(as(SARA).quizResults({ quizId }))).toBe(
      "PRECONDITION_FAILED:quiz_not_active"
    );
  });
});
