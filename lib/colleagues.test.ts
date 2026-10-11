// Colleagues, room invitations and file sending through the REAL routers on
// a real Postgres (PGlite): who may ask whom, who may answer, what a block
// ends, and that an invitation never opens a door `joinRoom` keeps shut.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { User } from "../drizzle/schema";
import {
  createTestDb,
  insertUser,
  type TestDb,
} from "./test-fixtures/pglite-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));

import {
  allowSearch,
  checkConnectionRequest,
  MAX_COLLEAGUES,
  MAX_DECLINES,
  SEARCHES_PER_MINUTE,
  MAX_REQUESTS_PER_HOUR,
  normalizeSearch,
  RESEND_AFTER_DECLINE_MS,
  type ConnectionRequestState,
} from "./colleagues";
import { colleaguesRouter } from "./trpc/colleaguesRouter";
import { roomsRouter } from "./trpc/roomsRouter";
import { sharingRouter } from "./trpc/sharingRouter";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AHMED = id(1); // adult
const SARA = id(2); // adult woman
const OMAR = id(3); // adult
const YARA = id(4); // 16
const LAYAN = id(5); // adult woman
const GONE = id(6); // suspended
const BOOK = id(101); // Ahmed's book
const NOBODY = id(999);

let test: TestDb;
let medicine: string;
let pharmacology: string;

const ctx = (userId: string) =>
  ({
    user: { id: userId, role: "user", email: `${userId}@x.test`, name: null },
  }) as unknown as { user: User };
const col = (userId: string) =>
  colleaguesRouter.createCaller(ctx(userId) as never);
const rooms = (userId: string) =>
  roomsRouter.createCaller(ctx(userId) as never);
const sharing = (userId: string) =>
  sharingRouter.createCaller(ctx(userId) as never);

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof TRPCError) return `${error.code}:${error.message}`;
    throw error;
  }
  return "allowed";
}

const yearsAgo = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - 3);
  return date.toISOString().slice(0, 10);
};

async function befriend(a: string, b: string) {
  const { connectionId } = await col(a).request({ userId: b });
  await col(b).respond({ connectionId, decision: "accept" });
  return connectionId;
}

const privateRoom = (overrides: Record<string, unknown> = {}) => ({
  visibility: "private" as const,
  title: "مذاكرة مع الزملاء",
  sectionId: medicine,
  ...overrides,
});

const notices = async (userId: string) =>
  (
    await test.client.query<{ type: string; readAt: string | null }>(
      `SELECT type, "readAt" FROM notifications WHERE "userId" = $1 ORDER BY "createdAt"`,
      [userId]
    )
  ).rows;

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  for (const [userId, name] of [
    [AHMED, "أحمد علي"],
    [SARA, "سارة محمود"],
    [OMAR, "Omar Hassan"],
    [YARA, "يارا"],
    [LAYAN, "ليان"],
    [GONE, "أحمد الموقوف"],
  ] as const) {
    await insertUser(test.client, { id: userId, name });
  }
  await test.client.query(
    `UPDATE users SET "suspendedAt" = now() WHERE id = $1`,
    [GONE]
  );
  await test.client.query(
    `INSERT INTO books (id, "userId", "fileName", "fileKey", "sourceType", status, "pageCount")
     VALUES ($1, $2, 'Renal.pdf', 'uploads/a/renal.pdf', 'study_book', 'complete', 3)`,
    [BOOK, AHMED]
  );
  process.env.STUDY_ROOMS_ENABLED = "true";
  const setup = async (
    userId: string,
    age: number,
    gender: "female" | "male"
  ) => {
    await rooms(userId).setProfile({
      birthDate: yearsAgo(age),
      stage: age >= 18 ? "university" : "high_school",
      gender,
      country: "EG",
    });
    if (age >= 18) await rooms(userId).setProfile({ acceptRules: true });
  };
  await setup(AHMED, 22, "male");
  await setup(SARA, 21, "female");
  await setup(OMAR, 24, "male");
  await setup(YARA, 16, "female");
  await setup(LAYAN, 23, "female");
  const sections = await test.client.query<{ id: string; key: string }>(
    `SELECT id, key FROM study_sections`
  );
  medicine = sections.rows.find(row => row.key === "medicine")!.id;
  const subject = await test.client.query<{ id: string }>(
    `SELECT id FROM study_subjects WHERE "nameEn" = 'Pharmacology' AND "sectionId" = $1`,
    [medicine]
  );
  pharmacology = subject.rows[0].id;
}, 120_000);

beforeEach(async () => {
  process.env.STUDY_ROOMS_ENABLED = "true";
  await test.client.exec(
    `DELETE FROM study_room_invites; DELETE FROM study_connections; DELETE FROM notifications;
     DELETE FROM book_shares; DELETE FROM user_blocks; DELETE FROM study_room_reports;
     DELETE FROM study_room_events; DELETE FROM study_rooms;`
  );
});

describe("the rules of a colleague request", () => {
  const state = (
    over: Partial<ConnectionRequestState> = {}
  ): ConnectionRequestState => ({
    requesterId: "a",
    addresseeId: "b",
    blocked: false,
    live: null,
    lastDeclinedAt: null,
    declines: 0,
    requestsLastHour: 0,
    colleagues: 0,
    theirColleagues: 0,
    now: new Date("2026-10-11T10:00:00Z"),
    ...over,
  });

  it("may be sent when nothing stands in the way", () => {
    expect(checkConnectionRequest(state())).toBeNull();
  });

  it("is never to oneself, and a block reads as nobody there", () => {
    expect(checkConnectionRequest(state({ addresseeId: "a" }))).toBe("self");
    expect(checkConnectionRequest(state({ blocked: true }))).toBe("not_found");
  });

  it("is not repeated while one waits or the two are colleagues", () => {
    expect(
      checkConnectionRequest(
        state({ live: { status: "pending", requesterId: "a" } })
      )
    ).toBe("already_pending");
    expect(
      checkConnectionRequest(
        state({ live: { status: "accepted", requesterId: "b" } })
      )
    ).toBe("already_colleagues");
  });

  it("asking back is saying yes", () => {
    expect(
      checkConnectionRequest(
        state({ live: { status: "pending", requesterId: "b" } })
      )
    ).toBe("accept_theirs");
  });

  it("waits a day after a decline, and no longer", () => {
    const now = new Date("2026-10-11T10:00:00Z");
    const just = new Date(now.getTime() - RESEND_AFTER_DECLINE_MS + 1000);
    const old = new Date(now.getTime() - RESEND_AFTER_DECLINE_MS);
    expect(checkConnectionRequest(state({ lastDeclinedAt: just, now }))).toBe(
      "try_later"
    );
    expect(
      checkConnectionRequest(state({ lastDeclinedAt: old, now }))
    ).toBeNull();
  });

  it("has an hourly limit and a largest number of colleagues", () => {
    expect(
      checkConnectionRequest(state({ requestsLastHour: MAX_REQUESTS_PER_HOUR }))
    ).toBe("rate_limited");
    expect(checkConnectionRequest(state({ colleagues: MAX_COLLEAGUES }))).toBe(
      "too_many"
    );
  });

  it("after enough declines the answer stays 'not now', whatever the date", () => {
    expect(
      checkConnectionRequest(
        state({
          declines: MAX_DECLINES,
          lastDeclinedAt: new Date("2020-01-01T00:00:00Z"),
        })
      )
    ).toBe("try_later");
  });

  it("the largest number of colleagues holds for the other student too", () => {
    expect(
      checkConnectionRequest(state({ theirColleagues: MAX_COLLEAGUES }))
    ).toBe("too_many");
  });

  it("a student searches only so often in a minute", () => {
    const now = 1_000_000;
    for (let i = 0; i < SEARCHES_PER_MINUTE; i++) {
      expect(allowSearch("limiter-test", now + i)).toBe(true);
    }
    expect(allowSearch("limiter-test", now + 100)).toBe(false);
    expect(allowSearch("someone-else", now + 100)).toBe(true);
    expect(allowSearch("limiter-test", now + 61_000)).toBe(true);
  });

  it("reads a search as typed, without the @ or the capitals", () => {
    expect(normalizeSearch("  @Omar   Hassan ")).toBe("omar hassan");
  });
});

describe("asking and answering", () => {
  it("a request waits, is seen by both, and becomes a colleagueship when accepted", async () => {
    const sent = await col(AHMED).request({ userId: SARA });
    expect(sent.status).toBe("pending");
    expect((await col(AHMED).requests()).outgoing.map(r => r.id)).toEqual([
      SARA,
    ]);
    const incoming = (await col(SARA).requests()).incoming;
    expect(incoming.map(r => r.id)).toEqual([AHMED]);
    expect(await col(AHMED).list()).toEqual([]);
    expect((await sharing(SARA).homeSummary()).colleagueRequests).toBe(1);

    await col(SARA).respond({
      connectionId: sent.connectionId,
      decision: "accept",
    });
    expect((await col(AHMED).list()).map(c => c.id)).toEqual([SARA]);
    expect((await col(SARA).list()).map(c => c.id)).toEqual([AHMED]);
    expect((await col(SARA).requests()).incoming).toEqual([]);
    // Sara's request notice is answered; Ahmed is told she accepted.
    expect(await notices(SARA)).toEqual([
      { type: "connection_request", readAt: expect.anything() },
    ]);
    expect((await notices(AHMED)).map(n => n.type)).toEqual([
      "connection_accepted",
    ]);
  });

  it("only the one who was asked may answer, and only once", async () => {
    const { connectionId } = await col(AHMED).request({ userId: SARA });
    for (const other of [AHMED, OMAR]) {
      expect(
        await refusal(col(other).respond({ connectionId, decision: "accept" }))
      ).toBe("NOT_FOUND:not_found");
    }
    await col(SARA).respond({ connectionId, decision: "decline" });
    expect(
      await refusal(col(SARA).respond({ connectionId, decision: "accept" }))
    ).toBe("NOT_FOUND:not_found");
    expect(await col(AHMED).list()).toEqual([]);
  });

  it("refuses oneself, nobody, a suspended account and a repeat", async () => {
    expect(await refusal(col(AHMED).request({ userId: AHMED }))).toBe(
      "BAD_REQUEST:self"
    );
    expect(await refusal(col(AHMED).request({ userId: NOBODY }))).toBe(
      "NOT_FOUND:not_found"
    );
    expect(await refusal(col(AHMED).request({ userId: GONE }))).toBe(
      "NOT_FOUND:not_found"
    );
    await col(AHMED).request({ userId: SARA });
    expect(await refusal(col(AHMED).request({ userId: SARA }))).toBe(
      "CONFLICT:already_pending"
    );
    await befriend(AHMED, OMAR);
    expect(await refusal(col(OMAR).request({ userId: AHMED }))).toBe(
      "CONFLICT:already_colleagues"
    );
  });

  it("two requests that cross make one colleagueship, not two rows", async () => {
    await col(AHMED).request({ userId: SARA });
    const back = await col(SARA).request({ userId: AHMED });
    expect(back.status).toBe("accepted");
    expect((await col(AHMED).list()).map(c => c.id)).toEqual([SARA]);
    const rows = await test.client.query(`SELECT 1 FROM study_connections`);
    expect(rows.rows.length).toBe(1);
  });

  it("the database itself refuses a second live row for a pair", async () => {
    await col(AHMED).request({ userId: SARA });
    await expect(
      test.client.query(
        `INSERT INTO study_connections ("requesterId", "addresseeId") VALUES ($1, $2)`,
        [SARA, AHMED]
      )
    ).rejects.toThrow();
  });

  it("a decline is silent and holds the next request for a day", async () => {
    const { connectionId } = await col(AHMED).request({ userId: SARA });
    await col(SARA).respond({ connectionId, decision: "decline" });
    expect(await notices(AHMED)).toEqual([]);
    expect(await refusal(col(AHMED).request({ userId: SARA }))).toBe(
      "CONFLICT:try_later"
    );
    // Sara herself may still ask Ahmed.
    expect((await col(SARA).request({ userId: AHMED })).status).toBe("pending");
  });

  it("a request can be taken back by the one who sent it only", async () => {
    const { connectionId } = await col(AHMED).request({ userId: SARA });
    expect(await refusal(col(SARA).cancel({ connectionId }))).toBe(
      "NOT_FOUND:not_found"
    );
    await col(AHMED).cancel({ connectionId });
    expect((await col(SARA).requests()).incoming).toEqual([]);
    expect(await notices(SARA)).toEqual([]);
    expect(
      await refusal(col(SARA).respond({ connectionId, decision: "accept" }))
    ).toBe("NOT_FOUND:not_found");
  });

  it("is limited per hour", async () => {
    await test.client.query(
      `INSERT INTO study_connections ("requesterId", "addresseeId", status)
       SELECT $1, $2, 'cancelled' FROM generate_series(1, $3)`,
      [AHMED, OMAR, MAX_REQUESTS_PER_HOUR]
    );
    expect(await refusal(col(AHMED).request({ userId: SARA }))).toBe(
      "TOO_MANY_REQUESTS:rate_limited"
    );
  });

  it("either of the two ends it; a stranger cannot", async () => {
    await befriend(AHMED, SARA);
    expect(await refusal(col(OMAR).remove({ userId: SARA }))).toBe(
      "NOT_FOUND:not_found"
    );
    await col(SARA).remove({ userId: AHMED });
    expect(await col(AHMED).list()).toEqual([]);
    // And they may become colleagues again.
    await befriend(AHMED, SARA);
    expect((await col(AHMED).list()).length).toBe(1);
  });

  it("a minor and an adult may be colleagues", async () => {
    await befriend(AHMED, YARA);
    expect((await col(YARA).list()).map(c => c.id)).toEqual([AHMED]);
  });
});

describe("finding a student", () => {
  it("is by the registered name, with how the two stand", async () => {
    await befriend(AHMED, SARA);
    await col(OMAR).request({ userId: AHMED });
    const sara = await col(AHMED).search({ query: "سارة" });
    expect(sara.items).toEqual([
      expect.objectContaining({ id: SARA, relation: "colleague" }),
    ]);
    const omar = await col(AHMED).search({ query: "OMAR" });
    expect(omar.items).toEqual([
      expect.objectContaining({ id: OMAR, relation: "incoming" }),
    ]);
    const fromOmar = await col(OMAR).search({ query: "أحمد" });
    expect(fromOmar.items).toEqual([
      expect.objectContaining({ id: AHMED, relation: "outgoing" }),
    ]);
    expect((await col(LAYAN).search({ query: "يارا" })).items[0].relation).toBe(
      "none"
    );
  });

  it("gives a name and a picture, and nothing else", async () => {
    const found = await col(SARA).search({ query: "omar" });
    expect(Object.keys(found.items[0]).sort()).toEqual(
      ["connectionId", "id", "image", "name", "relation"].sort()
    );
  });

  it("never shows oneself, a suspended account, or either side of a block", async () => {
    const ahmeds = await col(SARA).search({ query: "أحمد" });
    expect(ahmeds.items.map(i => i.id)).toEqual([AHMED]);
    expect((await col(AHMED).search({ query: "أحمد" })).items).toEqual([]);
    await col(AHMED).block({ userId: SARA });
    expect((await col(SARA).search({ query: "أحمد" })).items).toEqual([]);
    expect((await col(AHMED).search({ query: "سارة" })).items).toEqual([]);
  });

  it("needs two letters, and a % or _ is a letter like any other", async () => {
    expect((await col(SARA).search({ query: "أ" })).items).toEqual([]);
    expect((await col(SARA).search({ query: "%%" })).items).toEqual([]);
    expect((await col(SARA).search({ query: "__" })).items).toEqual([]);
    expect((await col(SARA).search({ query: "' or 1=1 --" })).items).toEqual(
      []
    );
  });
});

describe("blocking", () => {
  it("ends the colleagueship, closes what waited and hides each from the other", async () => {
    await befriend(AHMED, SARA);
    await sharing(SARA).homeSummary();
    await col(SARA).block({ userId: AHMED });
    expect(await col(AHMED).list()).toEqual([]);
    expect(await refusal(col(AHMED).request({ userId: SARA }))).toBe(
      "NOT_FOUND:not_found"
    );
    // The one who blocked gets the same answer: it is undone from the
    // blocked list first.
    expect(await refusal(col(SARA).request({ userId: AHMED }))).toBe(
      "NOT_FOUND:not_found"
    );
    expect((await sharing(SARA).blocked()).map(b => b.id)).toEqual([AHMED]);
    await sharing(SARA).unblock({ userId: AHMED });
    expect((await col(AHMED).request({ userId: SARA })).status).toBe("pending");
  });

  it("declining with a block removes the request and its notice", async () => {
    const { connectionId } = await col(AHMED).request({ userId: SARA });
    await col(SARA).respond({ connectionId, decision: "decline", block: true });
    expect(await notices(SARA)).toEqual([]);
    expect((await sharing(SARA).blocked()).map(b => b.id)).toEqual([AHMED]);
  });

  it("a block on accept is ignored: accepting never blocks", async () => {
    const { connectionId } = await col(AHMED).request({ userId: SARA });
    await col(SARA).respond({ connectionId, decision: "accept", block: true });
    expect(await sharing(SARA).blocked()).toEqual([]);
    expect((await col(SARA).list()).length).toBe(1);
  });
});

describe("reporting a person", () => {
  it("needs a history between the two, once, and reaches the admin's list", async () => {
    expect(
      await refusal(col(SARA).report({ userId: AHMED, reason: "spam" }))
    ).toBe("NOT_FOUND:not_found");
    await col(AHMED).request({ userId: SARA });
    await col(SARA).report({ userId: AHMED, reason: "spam", details: "  x " });
    expect(
      await refusal(col(SARA).report({ userId: AHMED, reason: "abuse" }))
    ).toBe("CONFLICT:already_reported");
    const rows = await test.client.query<{ roomId: string | null }>(
      `SELECT "roomId", "targetUserId", reason, details FROM study_room_reports`
    );
    expect(rows.rows).toEqual([
      { roomId: null, targetUserId: AHMED, reason: "spam", details: "x" },
    ]);
  });

  it("asking a stranger and taking it back is not a history with them", async () => {
    const { connectionId } = await col(AHMED).request({ userId: SARA });
    expect(
      await refusal(col(AHMED).report({ userId: SARA, reason: "spam" }))
    ).toBe("NOT_FOUND:not_found");
    await col(AHMED).cancel({ connectionId });
    expect(
      await refusal(col(AHMED).report({ userId: SARA, reason: "spam" }))
    ).toBe("NOT_FOUND:not_found");
  });

  it("a former colleague can be reported", async () => {
    await befriend(AHMED, SARA);
    await col(AHMED).remove({ userId: SARA });
    await col(AHMED).report({ userId: SARA, reason: "abuse" });
  });
});

describe("sending a file", () => {
  it("is to a colleague only", async () => {
    expect(
      (
        await refusal(
          sharing(AHMED).sendRequest({ bookId: BOOK, recipientId: SARA })
        )
      ).split(":")[0]
    ).toBe("FORBIDDEN");
    await befriend(AHMED, SARA);
    const sent = await sharing(AHMED).sendRequest({
      bookId: BOOK,
      recipientId: SARA,
    });
    expect(sent.recipient.id).toBe(SARA);
    const incoming = await sharing(SARA).incoming();
    expect(incoming[0]).toEqual(
      expect.objectContaining({ ownerId: AHMED, bookTitle: "Renal.pdf" })
    );
  });

  it("the recipient list is the sender's colleagues, found by name", async () => {
    await befriend(AHMED, SARA);
    const found = await sharing(AHMED).searchUsers({ query: "سارة" });
    expect(found.items.map(i => i.id)).toEqual([SARA]);
    // Omar exists but is not Ahmed's colleague.
    expect((await sharing(AHMED).searchUsers({ query: "omar" })).items).toEqual(
      []
    );
  });

  it("a block closes a request that waited", async () => {
    await befriend(AHMED, SARA);
    await sharing(AHMED).sendRequest({ bookId: BOOK, recipientId: SARA });
    await col(SARA).block({ userId: AHMED });
    expect(await sharing(SARA).incoming()).toEqual([]);
    expect(await notices(SARA)).toEqual([]);
  });
});

describe("a block and the files between the two", () => {
  it("takes the blocker's file back, and the blocked student's file out of the blocker's library", async () => {
    const SARA_BOOK = id(102);
    await test.client.query(
      `INSERT INTO books (id, "userId", "fileName", "fileKey", "sourceType", status, "pageCount")
       VALUES ($1, $2, 'Cardio.pdf', 'uploads/s/cardio.pdf', 'study_book', 'complete', 3)
       ON CONFLICT (id) DO NOTHING`,
      [SARA_BOOK, SARA]
    );
    await befriend(AHMED, SARA);
    const mine = await sharing(AHMED).sendRequest({
      bookId: BOOK,
      recipientId: SARA,
    });
    await sharing(SARA).respond({ shareId: mine.shareId, decision: "accept" });
    const hers = await sharing(SARA).sendRequest({
      bookId: SARA_BOOK,
      recipientId: AHMED,
    });
    await sharing(AHMED).respond({ shareId: hers.shareId, decision: "accept" });
    expect((await sharing(SARA).sharedWithMe()).length).toBe(1);
    expect((await sharing(AHMED).sharedWithMe()).length).toBe(1);

    await col(AHMED).block({ userId: SARA });
    expect(await sharing(SARA).sharedWithMe()).toEqual([]);
    expect(await sharing(AHMED).sharedWithMe()).toEqual([]);
    const rows = await test.client.query<{ status: string }>(
      `SELECT status FROM book_shares ORDER BY status`
    );
    expect(rows.rows.map(row => row.status).sort()).toEqual([
      "removed",
      "revoked",
    ]);
  });

  it("a blocked sender hears what a removed colleague hears", async () => {
    await befriend(AHMED, SARA);
    await befriend(AHMED, OMAR);
    await col(SARA).block({ userId: AHMED });
    await col(OMAR).remove({ userId: AHMED });
    const blocked = await refusal(
      sharing(AHMED).sendRequest({ bookId: BOOK, recipientId: SARA })
    );
    const removed = await refusal(
      sharing(AHMED).sendRequest({ bookId: BOOK, recipientId: OMAR })
    );
    expect(blocked.split(":")[0]).toBe("FORBIDDEN");
    // The same sentence but for the name in it.
    expect(blocked.replace("سارة محمود", "X")).toBe(
      removed.replace("Omar Hassan", "X")
    );
  });
});

describe("inviting a colleague to a room", () => {
  it("lets the colleague into a private room without the link — through joinRoom", async () => {
    await befriend(AHMED, SARA);
    const room = await rooms(AHMED).create(privateRoom());
    // No invitation yet: the room does not exist for Sara.
    expect(await refusal(rooms(SARA).preview({ roomId: room.roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(await refusal(rooms(SARA).join({ roomId: room.roomId }))).toBe(
      "NOT_FOUND:bad_invite"
    );

    await rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA });
    const mine = await rooms(SARA).myInvites();
    expect(mine).toEqual([
      expect.objectContaining({
        roomId: room.roomId,
        roomTitle: "مذاكرة مع الزملاء",
        inviter: expect.objectContaining({ id: AHMED }),
      }),
    ]);
    expect((await rooms(SARA).preview({ roomId: room.roomId })).joined).toBe(
      false
    );
    await rooms(SARA).join({ roomId: room.roomId });
    expect(await rooms(SARA).myInvites()).toEqual([]);
    const candidates = await rooms(AHMED).inviteCandidates({
      roomId: room.roomId,
    });
    expect(candidates).toEqual([
      expect.objectContaining({ id: SARA, state: "here" }),
    ]);
    expect((await notices(SARA)).filter(n => n.type === "room_invite")).toEqual(
      [{ type: "room_invite", readAt: expect.anything() }]
    );
  });

  it("is for colleagues only, and an invitation is for its one student", async () => {
    await befriend(AHMED, SARA);
    const room = await rooms(AHMED).create(privateRoom());
    expect(
      await refusal(
        rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: OMAR })
      )
    ).toBe("FORBIDDEN:invite_not_colleague");
    await rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA });
    expect(await refusal(rooms(OMAR).join({ roomId: room.roomId }))).toBe(
      "NOT_FOUND:bad_invite"
    );
    expect(await rooms(OMAR).myInvites()).toEqual([]);
  });

  it("only someone in the room invites, and a private room follows its setting", async () => {
    await befriend(SARA, OMAR);
    await befriend(AHMED, SARA);
    const room = await rooms(AHMED).create(privateRoom());
    expect(
      await refusal(
        rooms(SARA).inviteColleague({ roomId: room.roomId, userId: OMAR })
      )
    ).toBe("NOT_FOUND:not_available");
    await rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA });
    await rooms(SARA).join({ roomId: room.roomId });
    // A private room starts with "only the host invites".
    expect(
      await refusal(
        rooms(SARA).inviteColleague({ roomId: room.roomId, userId: OMAR })
      )
    ).toBe("FORBIDDEN:not_allowed");
    expect(
      await refusal(rooms(SARA).inviteCandidates({ roomId: room.roomId }))
    ).toBe("FORBIDDEN:not_allowed");
  });

  it("is not repeated, can be taken back, and a decline is final for that room", async () => {
    await befriend(AHMED, SARA);
    const room = await rooms(AHMED).create(privateRoom());
    const { inviteId } = await rooms(AHMED).inviteColleague({
      roomId: room.roomId,
      userId: SARA,
    });
    expect(
      await refusal(
        rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA })
      )
    ).toBe("CONFLICT:already_invited");
    expect(await refusal(rooms(SARA).cancelInvite({ inviteId }))).toBe(
      "NOT_FOUND:not_available"
    );
    await rooms(AHMED).cancelInvite({ inviteId });
    expect(await rooms(SARA).myInvites()).toEqual([]);
    expect(await refusal(rooms(SARA).join({ roomId: room.roomId }))).toBe(
      "NOT_FOUND:bad_invite"
    );

    const again = await rooms(AHMED).inviteColleague({
      roomId: room.roomId,
      userId: SARA,
    });
    expect(await refusal(rooms(OMAR).declineInvite(again))).toBe(
      "NOT_FOUND:not_available"
    );
    await rooms(SARA).declineInvite(again);
    expect(await refusal(rooms(SARA).join({ roomId: room.roomId }))).toBe(
      "NOT_FOUND:bad_invite"
    );
    expect(
      await refusal(
        rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA })
      )
    ).toBe("FORBIDDEN:invite_refused");
  });

  it("never crosses the age groups or a women-only room", async () => {
    await befriend(AHMED, YARA);
    await befriend(SARA, AHMED);
    await befriend(SARA, YARA);
    const adults = await rooms(AHMED).create(privateRoom());
    expect(
      await refusal(
        rooms(AHMED).inviteColleague({ roomId: adults.roomId, userId: YARA })
      )
    ).toBe("FORBIDDEN:invite_refused");
    // Even with a row forced in, joinRoom keeps the minor out.
    await test.client.query(
      `INSERT INTO study_room_invites ("roomId", "inviterId", "inviteeId", "expiresAt")
       VALUES ($1, $2, $3, now() + interval '1 day')`,
      [adults.roomId, AHMED, YARA]
    );
    expect(await refusal(rooms(YARA).join({ roomId: adults.roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(await rooms(YARA).myInvites()).toEqual([]);

    await rooms(AHMED).end({ roomId: adults.roomId });
    // Women-only rooms are public ones.
    const women = await rooms(SARA).create({
      visibility: "public",
      title: "مراجعة الأدوية للطالبات",
      sectionId: medicine,
      subjectId: pharmacology,
      topic: "Renal drugs",
      womenOnly: true,
    });
    expect(
      await refusal(
        rooms(SARA).inviteColleague({ roomId: women.roomId, userId: AHMED })
      )
    ).toBe("FORBIDDEN:invite_refused");
  });

  it("an expired invitation opens nothing, nor one from someone put out of the room", async () => {
    await befriend(AHMED, SARA);
    await befriend(SARA, OMAR);
    const room = await rooms(AHMED).create(privateRoom());
    await rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA });
    await test.client.query(
      `UPDATE study_room_invites SET "expiresAt" = now() - interval '1 minute'`
    );
    expect(await refusal(rooms(SARA).join({ roomId: room.roomId }))).toBe(
      "NOT_FOUND:bad_invite"
    );
    expect(await rooms(SARA).myInvites()).toEqual([]);
    // An expired one can be sent anew.
    await rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA });
    await rooms(SARA).join({ roomId: room.roomId });

    await rooms(AHMED).update({
      roomId: room.roomId,
      settings: { invite: "anyone" },
    });
    await rooms(SARA).inviteColleague({ roomId: room.roomId, userId: OMAR });
    await rooms(AHMED).remove({
      roomId: room.roomId,
      userId: SARA,
      ban: false,
    });
    expect(await refusal(rooms(OMAR).join({ roomId: room.roomId }))).toBe(
      "NOT_FOUND:bad_invite"
    );
    // And the one put out does not return on a fresh invitation.
    expect(
      await refusal(
        rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA })
      )
    ).toBe("FORBIDDEN:invite_refused");
  });

  it("stops with a block or the end of the colleagueship", async () => {
    await befriend(AHMED, SARA);
    await befriend(AHMED, OMAR);
    const room = await rooms(AHMED).create(privateRoom());
    await rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA });
    await rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: OMAR });
    await col(SARA).block({ userId: AHMED });
    await col(AHMED).remove({ userId: OMAR });
    for (const other of [SARA, OMAR]) {
      expect(await rooms(other).myInvites()).toEqual([]);
      expect(await refusal(rooms(other).join({ roomId: room.roomId }))).toBe(
        "NOT_FOUND:" + (other === SARA ? "not_available" : "bad_invite")
      );
    }
  });

  it("is void once the inviter may no longer invite, or has left the room", async () => {
    await befriend(AHMED, SARA);
    await befriend(SARA, OMAR);
    await befriend(SARA, LAYAN);
    const room = await rooms(AHMED).create(privateRoom());
    await rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA });
    await rooms(SARA).join({ roomId: room.roomId });
    await rooms(AHMED).update({
      roomId: room.roomId,
      settings: { invite: "anyone" },
    });
    await rooms(SARA).inviteColleague({ roomId: room.roomId, userId: OMAR });
    await rooms(SARA).inviteColleague({ roomId: room.roomId, userId: LAYAN });
    expect((await rooms(OMAR).myInvites()).length).toBe(1);

    // The host takes the right to invite back: Sara's invitations close.
    await rooms(AHMED).update({
      roomId: room.roomId,
      settings: { invite: "host" },
    });
    expect(await rooms(OMAR).myInvites()).toEqual([]);
    expect(await refusal(rooms(OMAR).preview({ roomId: room.roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(await refusal(rooms(OMAR).join({ roomId: room.roomId }))).toBe(
      "NOT_FOUND:bad_invite"
    );

    // Given back, they open again — until Sara leaves the room.
    await rooms(AHMED).update({
      roomId: room.roomId,
      settings: { invite: "anyone" },
    });
    expect((await rooms(LAYAN).myInvites()).length).toBe(1);
    await rooms(SARA).leave({ roomId: room.roomId });
    expect(await rooms(LAYAN).myInvites()).toEqual([]);
    expect(await refusal(rooms(LAYAN).join({ roomId: room.roomId }))).toBe(
      "NOT_FOUND:bad_invite"
    );
  });

  it("declining a file with a block closes the room's door too", async () => {
    await befriend(AHMED, SARA);
    const room = await rooms(AHMED).create(privateRoom());
    await rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA });
    const { shareId } = await sharing(AHMED).sendRequest({
      bookId: BOOK,
      recipientId: SARA,
    });
    // The older screen's "decline and block".
    await sharing(SARA).respond({ shareId, decision: "decline", block: true });
    expect(await col(AHMED).list()).toEqual([]);
    expect(await col(SARA).list()).toEqual([]);
    expect(await rooms(SARA).myInvites()).toEqual([]);
    const invites = await test.client.query<{ status: string }>(
      `SELECT status FROM study_room_invites`
    );
    expect(invites.rows).toEqual([{ status: "cancelled" }]);
    // Unblocking does not bring the colleagueship back by itself.
    await sharing(SARA).unblock({ userId: AHMED });
    expect(await col(SARA).list()).toEqual([]);
  });

  it("a locked or full room stays shut to an invited colleague", async () => {
    await befriend(AHMED, SARA);
    const room = await rooms(AHMED).create(privateRoom());
    await rooms(AHMED).inviteColleague({ roomId: room.roomId, userId: SARA });
    await rooms(AHMED).update({ roomId: room.roomId, locked: true });
    expect(await refusal(rooms(SARA).join({ roomId: room.roomId }))).toBe(
      "FORBIDDEN:room_locked"
    );
  });

  it("is off with the rooms", async () => {
    process.env.STUDY_ROOMS_ENABLED = "false";
    expect((await refusal(rooms(SARA).myInvites())).split(":")[0]).not.toBe(
      "allowed"
    );
  });
});
