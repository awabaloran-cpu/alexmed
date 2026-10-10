// What a sitting came to, and the rooms a student has been in — through the
// REAL router on a real Postgres (PGlite).
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

import { roomsRouter } from "../trpc/roomsRouter";
import { sweepRooms } from "./rooms";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AHMED = id(1);
const SARA = id(2);
const OMAR = id(3);
const OUTSIDER = id(5);
const BOOK = id(101); // Ahmed's file, 3 pages
const BANK = id(102); // Ahmed's question bank

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

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  process.env.STUDY_ROOMS_ENABLED = "true";
  for (const [userId, name] of [
    [AHMED, "أحمد"],
    [SARA, "سارة"],
    [OMAR, "عمر"],
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

// A three-question quiz: Ahmed gets all right, Sara two, Omar none.
async function playQuiz() {
  const { quizId } = await as(AHMED).quizStart({
    roomId,
    bookId: BANK,
    count: 3,
    seconds: 30,
  });
  const picks = [
    { [AHMED]: 1, [SARA]: 1, [OMAR]: 0 },
    { [AHMED]: 1, [SARA]: 1, [OMAR]: 0 },
    { [AHMED]: 1, [SARA]: 0, [OMAR]: 0 },
  ];
  for (const round of picks) {
    const current = (await as(AHMED).quizCurrent({ roomId }))!;
    for (const [userId, selectedIndex] of Object.entries(round)) {
      await as(userId).quizAnswer({
        quizId,
        questionId: current.question.id,
        selectedIndex,
      });
    }
    await as(AHMED).quizCurrent({ roomId });
    await as(AHMED).quizAdvance({ quizId });
  }
  return quizId;
}

describe("what a sitting came to", () => {
  it("says who took part, the file and its page, the highlighted pages and the chat", async () => {
    await as(AHMED).setPage({ roomId, page: 2 });
    for (const page of [1, 2, 2]) {
      await as(SARA).addMark({
        roomId,
        page,
        color: "yellow",
        rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.03 }],
        clientId: cid(),
      });
    }
    await as(OMAR).sendMessage({ roomId, body: "سؤال", clientId: cid() });
    const gone = await as(OMAR).sendMessage({
      roomId,
      body: "خطأ",
      clientId: cid(),
    });
    await as(OMAR).deleteMessage({ roomId, messageId: gone.id });

    const summary = await as(SARA).summary({ roomId });
    expect(summary.room).toMatchObject({
      id: roomId,
      title: "أدوية الكلى",
      ended: false,
      endedAt: null,
    });
    expect(summary.participants.map(person => person.name)).toEqual([
      "أحمد",
      "سارة",
      "عمر",
    ]);
    expect(summary.markedPages).toEqual([
      { page: 1, marks: 1 },
      { page: 2, marks: 2 },
    ]);
    // A deleted message is not counted.
    expect(summary.messages).toBe(1);
    expect(summary.quizzes).toEqual([]);
    // Sara sees the file's name and page, and no way into it.
    expect(summary.file).toMatchObject({
      name: "bank.pdf",
      pageCount: 3,
      lastPage: 2,
      mine: false,
      bookId: null,
    });
    // Its owner gets the way back.
    expect((await as(AHMED).summary({ roomId })).file).toMatchObject({
      mine: true,
      bookId: BOOK,
    });
    expect(JSON.stringify(summary)).not.toMatch(/fileKey|uploads\//);
  });

  it("gives each student their own result in every finished quiz", async () => {
    const quizId = await playQuiz();
    const forSara = (await as(SARA).summary({ roomId })).quizzes;
    expect(forSara).toHaveLength(1);
    expect(forSara[0]).toMatchObject({ id: quizId, total: 3, players: 3 });
    expect(forSara[0].me).toMatchObject({ rank: 2, correct: 2 });
    expect((await as(AHMED).summary({ roomId })).quizzes[0].me).toMatchObject({
      rank: 1,
      correct: 3,
    });
    expect((await as(OMAR).summary({ roomId })).quizzes[0].me).toMatchObject({
      rank: 3,
      correct: 0,
      points: 0,
    });
  });

  it("is still there after leaving and after the room has ended", async () => {
    await as(SARA).leave({ roomId });
    expect((await as(SARA).summary({ roomId })).room.ended).toBe(false);
    await as(AHMED).end({ roomId });
    const summary = await as(OMAR).summary({ roomId });
    expect(summary.room.ended).toBe(true);
    expect(summary.room.endedAt).toBeInstanceOf(Date);
    expect(summary.participants).toHaveLength(3);
    expect(summary.minutes).toBeGreaterThanOrEqual(0);
  });

  it("is for those who took part: not an outsider, not someone banned", async () => {
    expect(await refusal(as(OUTSIDER).summary({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    await as(AHMED).remove({ roomId, userId: OMAR, ban: true });
    expect(await refusal(as(OMAR).summary({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    // And the banned student is not listed to the others.
    expect(
      (await as(SARA).summary({ roomId })).participants.map(p => p.name)
    ).toEqual(["أحمد", "سارة"]);
  });

  it("does not name someone the student has blocked", async () => {
    await test.client.query(
      `INSERT INTO user_blocks ("blockerId", "blockedId") VALUES ($1, $2)`,
      [SARA, OMAR]
    );
    expect(
      (await as(SARA).summary({ roomId })).participants.map(p => p.name)
    ).toEqual(["أحمد", "سارة"]);
    expect(
      (await as(OMAR).summary({ roomId })).participants.map(p => p.name)
    ).toEqual(["أحمد", "عمر"]);
  });
});

describe("the rooms a student has been in", () => {
  it("lists a room once it is over for them, never one they are still in", async () => {
    expect(await as(SARA).history()).toEqual([]);
    await as(SARA).leave({ roomId });
    const left = await as(SARA).history();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      id: roomId,
      title: "أدوية الكلى",
      ended: false,
      people: 3,
    });
    // Omar is still inside.
    expect(await as(OMAR).history()).toEqual([]);
    await as(AHMED).end({ roomId });
    expect((await as(OMAR).history())[0]).toMatchObject({
      id: roomId,
      ended: true,
    });
    expect(await as(OUTSIDER).history()).toEqual([]);
  });

  it("never lists a room the student was banned from", async () => {
    await as(AHMED).remove({ roomId, userId: OMAR, ban: true });
    await as(AHMED).end({ roomId });
    expect(await as(OMAR).history()).toEqual([]);
  });
});

describe("rooms stay true to who is really there", () => {
  const seenAgo = (userId: string, minutes: number) =>
    test.client.query(
      `UPDATE study_room_members SET "lastSeenAt" = now() - make_interval(mins => $3)
       WHERE "roomId" = $1 AND "userId" = $2`,
      [roomId, userId, minutes]
    );
  const quietFor = (minutes: number) =>
    test.client.query(
      `UPDATE study_rooms SET "lastActiveAt" = now() - make_interval(mins => $2) WHERE id = $1`,
      [roomId, minutes]
    );

  it("someone not heard from is taken out as if they had left, and may come back", async () => {
    await seenAgo(SARA, 11);
    expect(await sweepRooms()).toEqual({ left: 1, closed: 0 });
    const state = await as(AHMED).state({ roomId });
    expect(state.members.map(member => member.name)).toEqual(["أحمد", "عمر"]);
    // For Sara it is a room she left: in her past sessions, and open to her.
    expect((await as(SARA).history())[0]).toMatchObject({ id: roomId });
    expect(await refusal(as(SARA).state({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    await as(SARA).join({ roomId });
    expect((await as(SARA).state({ roomId })).members).toHaveLength(3);
  });

  it("the leader not heard from hands the room to the longest present", async () => {
    await seenAgo(AHMED, 11);
    await sweepRooms();
    const state = await as(SARA).state({ roomId });
    expect(state.room.hostId).toBe(SARA);
    expect(state.members.map(member => member.name)).toEqual(["سارة", "عمر"]);
  });

  it("a room left with nobody is closed, and its summary stays", async () => {
    for (const userId of [AHMED, SARA, OMAR]) await seenAgo(userId, 11);
    // Taking them out is itself something that happened in the room: it
    // gets its ten quiet minutes from then, like a room everyone left.
    expect(await sweepRooms()).toEqual({ left: 3, closed: 0 });
    await quietFor(11);
    expect(await sweepRooms()).toEqual({ left: 0, closed: 1 });
    expect(await refusal(as(AHMED).state({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(await refusal(as(AHMED).join({ roomId }))).not.toBe("allowed");
    const summary = await as(SARA).summary({ roomId });
    expect(summary.room.ended).toBe(true);
    expect(summary.participants).toHaveLength(3);
    expect((await as(OMAR).history())[0]).toMatchObject({ ended: true });
  });

  it("a room people are quietly reading in is left alone", async () => {
    // Nothing has changed in it for an hour, but all three are still there.
    await quietFor(60);
    expect(await sweepRooms()).toEqual({ left: 0, closed: 0 });
    expect((await as(AHMED).state({ roomId })).members).toHaveLength(3);
  });

  it("a room just emptied is given its ten minutes", async () => {
    for (const userId of [AHMED, SARA, OMAR])
      await as(userId).leave({ roomId });
    expect(await sweepRooms()).toEqual({ left: 0, closed: 0 });
    await quietFor(11);
    expect(await sweepRooms()).toEqual({ left: 0, closed: 1 });
  });
});
