// 🤝 Colleagues — two students who agreed to study together. A request is
// sent, the other accepts or declines; only then can they send each other
// files (lib/db-sharing.ts) and room invitations (lib/study-rooms/invites.ts).
// "Who" always comes from the session; blocking lives in `user_blocks` and
// notices in `notifications`, the same tables sharing and the rooms use.
import { and, asc, count, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import {
  bookShareEvents,
  bookShares,
  notifications,
  studyConnections,
  studyRoomInvites,
  studyRoomReports,
  userBlocks,
  users,
} from "../drizzle/schema";
import { getDb, requireDb } from "./db";

type Db = ReturnType<typeof requireDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ColleagueReason =
  | "self"
  // No such student — also the answer when either has blocked the other,
  // so a block is never revealed.
  | "not_found"
  | "already_pending"
  | "already_colleagues"
  // Not now — said the same way whether the other student declined a
  // while ago or for good, so a decline is never spelled out.
  | "try_later"
  | "rate_limited"
  | "too_many"
  | "already_reported";

const CODES = {
  self: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  already_pending: "CONFLICT",
  already_colleagues: "CONFLICT",
  try_later: "CONFLICT",
  rate_limited: "TOO_MANY_REQUESTS",
  too_many: "CONFLICT",
  already_reported: "CONFLICT",
} as const satisfies Record<ColleagueReason, string>;

export class ColleagueError extends Error {
  readonly code: (typeof CODES)[ColleagueReason];
  constructor(public reason: ColleagueReason) {
    super(reason);
    this.code = CODES[reason];
  }
}

// After a decline the same student may ask again only after this long —
// and after this many declines, not again.
export const RESEND_AFTER_DECLINE_MS = 24 * 60 * 60 * 1000;
export const MAX_DECLINES = 3;
export const MAX_REQUESTS_PER_HOUR = 30;
export const MAX_COLLEAGUES = 300;
export const SEARCH_PAGE_SIZE = 10;
const REPORTS_PER_DAY = 5;

export type Relation = "none" | "outgoing" | "incoming" | "colleague";

// ── The rules of a request (pure, unit-tested) ────────────────────────────
export type ConnectionRequestState = {
  requesterId: string;
  addresseeId: string;
  blocked: boolean;
  // The live row between the two, whoever asked.
  live: { status: "pending" | "accepted"; requesterId: string } | null;
  // When the addressee last declined a request from this requester.
  lastDeclinedAt: Date | null;
  // How many times the addressee has declined this requester.
  declines: number;
  requestsLastHour: number;
  // How many colleagues each of the two already has.
  colleagues: number;
  theirColleagues: number;
  now: Date;
};

// The first rule a request breaks; "accept_theirs" when the other student
// had already asked (asking back is saying yes); null when it may be sent.
export function checkConnectionRequest(
  state: ConnectionRequestState
): ColleagueReason | "accept_theirs" | null {
  if (state.requesterId === state.addresseeId) return "self";
  if (state.blocked) return "not_found";
  if (state.live?.status === "accepted") return "already_colleagues";
  if (
    state.colleagues >= MAX_COLLEAGUES ||
    state.theirColleagues >= MAX_COLLEAGUES
  ) {
    return "too_many";
  }
  if (state.live?.status === "pending") {
    return state.live.requesterId === state.requesterId
      ? "already_pending"
      : "accept_theirs";
  }
  if (state.declines >= MAX_DECLINES) return "try_later";
  if (
    state.lastDeclinedAt &&
    state.now.getTime() - state.lastDeclinedAt.getTime() <
      RESEND_AFTER_DECLINE_MS
  ) {
    return "try_later";
  }
  if (state.requestsLastHour >= MAX_REQUESTS_PER_HOUR) return "rate_limited";
  return null;
}

// ── Small reads ───────────────────────────────────────────────────────────
const between = (a: string, b: string) =>
  or(
    and(
      eq(studyConnections.requesterId, a),
      eq(studyConnections.addresseeId, b)
    ),
    and(
      eq(studyConnections.requesterId, b),
      eq(studyConnections.addresseeId, a)
    )
  );

const involving = (userId: string) =>
  or(
    eq(studyConnections.requesterId, userId),
    eq(studyConnections.addresseeId, userId)
  );

export async function isBlockedEitherWay(
  db: Db | Tx,
  a: string,
  b: string
): Promise<boolean> {
  const [row] = await db
    .select({ blockerId: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
        and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a))
      )
    )
    .limit(1);
  return Boolean(row);
}

export async function areColleagues(
  db: Db | Tx,
  a: string,
  b: string
): Promise<boolean> {
  if (a === b) return false;
  const [row] = await db
    .select({ id: studyConnections.id })
    .from(studyConnections)
    .where(and(between(a, b), eq(studyConnections.status, "accepted")))
    .limit(1);
  return Boolean(row);
}

async function countColleagues(db: Db | Tx, userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(studyConnections)
    .where(and(involving(userId), eq(studyConnections.status, "accepted")));
  return Number(row?.n ?? 0);
}

async function notify(
  tx: Tx,
  userId: string,
  type: "connection_request" | "connection_accepted",
  actorId: string,
  connectionId: string
) {
  await tx
    .insert(notifications)
    .values({ userId, type, actorId, data: { connectionId } });
}

// The request's own notice is answered (or withdrawn): it is not left
// waiting in the list.
async function settleRequestNotice(
  tx: Tx,
  userId: string,
  connectionId: string,
  how: "read" | "delete"
) {
  const mine = and(
    eq(notifications.userId, userId),
    eq(notifications.type, "connection_request"),
    sql`${notifications.data}->>'connectionId' = ${connectionId}`
  );
  if (how === "delete") await tx.delete(notifications).where(mine);
  else await tx.update(notifications).set({ readAt: new Date() }).where(mine);
}

// ── Asking ────────────────────────────────────────────────────────────────
export async function requestColleague(userId: string, targetId: string) {
  if (userId === targetId) throw new ColleagueError("self");
  const db = requireDb();
  return db.transaction(async tx => {
    const [target] = await tx
      .select({ id: users.id, suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);
    if (!target || target.suspendedAt) throw new ColleagueError("not_found");

    const [live] = await tx
      .select({
        id: studyConnections.id,
        status: studyConnections.status,
        requesterId: studyConnections.requesterId,
      })
      .from(studyConnections)
      .where(
        and(
          between(userId, targetId),
          inArray(studyConnections.status, ["pending", "accepted"])
        )
      )
      .limit(1)
      .for("update");
    const declined = await tx
      .select({ respondedAt: studyConnections.respondedAt })
      .from(studyConnections)
      .where(
        and(
          eq(studyConnections.requesterId, userId),
          eq(studyConnections.addresseeId, targetId),
          eq(studyConnections.status, "declined")
        )
      )
      .orderBy(desc(studyConnections.respondedAt))
      .limit(MAX_DECLINES);
    const lastDecline = declined[0];
    const [recent] = await tx
      .select({ n: count() })
      .from(studyConnections)
      .where(
        and(
          eq(studyConnections.requesterId, userId),
          gt(studyConnections.createdAt, new Date(Date.now() - 60 * 60 * 1000))
        )
      );

    const verdict = checkConnectionRequest({
      requesterId: userId,
      addresseeId: targetId,
      blocked: await isBlockedEitherWay(tx, userId, targetId),
      live: live
        ? {
            status: live.status as "pending" | "accepted",
            requesterId: live.requesterId,
          }
        : null,
      lastDeclinedAt: lastDecline?.respondedAt ?? null,
      declines: declined.length,
      requestsLastHour: Number(recent?.n ?? 0),
      colleagues: await countColleagues(tx, userId),
      theirColleagues: await countColleagues(tx, targetId),
      now: new Date(),
    });

    if (verdict === "accept_theirs" && live) {
      await accept(tx, live.id, live.requesterId, userId);
      return { connectionId: live.id, status: "accepted" as const };
    }
    if (verdict) throw new ColleagueError(verdict as ColleagueReason);

    // The unique index on the pair is the last guard against two requests
    // crossing at the same moment.
    const [row] = await tx
      .insert(studyConnections)
      .values({ requesterId: userId, addresseeId: targetId })
      .onConflictDoNothing()
      .returning({ id: studyConnections.id });
    if (!row) throw new ColleagueError("already_pending");
    await notify(tx, targetId, "connection_request", userId, row.id);
    return { connectionId: row.id, status: "pending" as const };
  });
}

async function accept(
  tx: Tx,
  connectionId: string,
  requesterId: string,
  addresseeId: string
) {
  const now = new Date();
  await tx
    .update(studyConnections)
    .set({ status: "accepted", respondedAt: now, updatedAt: now })
    .where(eq(studyConnections.id, connectionId));
  await settleRequestNotice(tx, addresseeId, connectionId, "read");
  await notify(
    tx,
    requesterId,
    "connection_accepted",
    addresseeId,
    connectionId
  );
}

async function lockConnection(tx: Tx, connectionId: string) {
  const [row] = await tx
    .select()
    .from(studyConnections)
    .where(eq(studyConnections.id, connectionId))
    .for("update");
  return row ?? null;
}

// ── Answering ─────────────────────────────────────────────────────────────
// Only the student who was asked answers, and only while it waits. A
// decline is silent: the one who asked is not told.
export async function respondToColleague(
  userId: string,
  connectionId: string,
  decision: "accept" | "decline",
  block = false
) {
  const db = requireDb();
  return db.transaction(async tx => {
    const row = await lockConnection(tx, connectionId);
    if (!row || row.addresseeId !== userId || row.status !== "pending") {
      throw new ColleagueError("not_found");
    }
    if (decision === "accept") {
      if (await isBlockedEitherWay(tx, userId, row.requesterId)) {
        throw new ColleagueError("not_found");
      }
      if (
        (await countColleagues(tx, userId)) >= MAX_COLLEAGUES ||
        (await countColleagues(tx, row.requesterId)) >= MAX_COLLEAGUES
      ) {
        throw new ColleagueError("too_many");
      }
      await accept(tx, row.id, row.requesterId, userId);
      return { status: "accepted" as const };
    }
    const now = new Date();
    await tx
      .update(studyConnections)
      .set({ status: "declined", respondedAt: now, updatedAt: now })
      .where(eq(studyConnections.id, row.id));
    await settleRequestNotice(tx, userId, row.id, "read");
    if (block) await blockWithin(tx, userId, row.requesterId);
    return { status: "declined" as const };
  });
}

// The one who asked takes the request back before it is answered.
export async function cancelColleagueRequest(
  userId: string,
  connectionId: string
) {
  const db = requireDb();
  return db.transaction(async tx => {
    const row = await lockConnection(tx, connectionId);
    if (!row || row.requesterId !== userId || row.status !== "pending") {
      throw new ColleagueError("not_found");
    }
    await tx
      .update(studyConnections)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(studyConnections.id, row.id));
    await settleRequestNotice(tx, row.addresseeId, row.id, "delete");
    return { status: "cancelled" as const };
  });
}

// Room invitations waiting between the two stop with the colleagueship.
async function cancelInvitesBetween(tx: Tx, a: string, b: string) {
  await tx
    .update(studyRoomInvites)
    .set({ status: "cancelled", respondedAt: new Date() })
    .where(
      and(
        eq(studyRoomInvites.status, "pending"),
        or(
          and(
            eq(studyRoomInvites.inviterId, a),
            eq(studyRoomInvites.inviteeId, b)
          ),
          and(
            eq(studyRoomInvites.inviterId, b),
            eq(studyRoomInvites.inviteeId, a)
          )
        )
      )
    );
}

// Either of the two ends it, quietly. Files already shared stay as they
// are — each is ended from the file itself.
export async function removeColleague(userId: string, otherId: string) {
  const db = requireDb();
  return db.transaction(async tx => {
    const ended = await tx
      .update(studyConnections)
      .set({ status: "removed", updatedAt: new Date() })
      .where(
        and(between(userId, otherId), eq(studyConnections.status, "accepted"))
      )
      .returning({ id: studyConnections.id });
    if (!ended.length) throw new ColleagueError("not_found");
    await cancelInvitesBetween(tx, userId, otherId);
    return { status: "removed" as const };
  });
}

// Everything a block means, in the caller's transaction — the one place
// a block is made, whichever screen it came from. The colleagueship ends,
// invitations and requests that waited are closed, and no file stays
// shared between the two in either direction.
export async function blockWithin(
  tx: Tx,
  blockerId: string,
  blockedId: string
) {
  await tx
    .insert(userBlocks)
    .values({ blockerId, blockedId })
    .onConflictDoNothing();
  const now = new Date();
  await tx
    .update(studyConnections)
    .set({ status: "removed", updatedAt: now })
    .where(
      and(
        between(blockerId, blockedId),
        inArray(studyConnections.status, ["pending", "accepted"])
      )
    );
  await cancelInvitesBetween(tx, blockerId, blockedId);
  await tx
    .update(bookShares)
    .set({ status: "declined", respondedAt: now, updatedAt: now })
    .where(
      and(
        eq(bookShares.ownerId, blockedId),
        eq(bookShares.recipientId, blockerId),
        eq(bookShares.status, "pending")
      )
    );
  // The blocker's files leave the blocked student's library…
  const revoked = await tx
    .update(bookShares)
    .set({ status: "revoked", updatedAt: now })
    .where(
      and(
        eq(bookShares.ownerId, blockerId),
        eq(bookShares.recipientId, blockedId),
        inArray(bookShares.status, ["pending", "accepted"])
      )
    )
    .returning({ id: bookShares.id });
  // …and the blocked student's files leave the blocker's.
  const removed = await tx
    .update(bookShares)
    .set({ status: "removed", updatedAt: now })
    .where(
      and(
        eq(bookShares.ownerId, blockedId),
        eq(bookShares.recipientId, blockerId),
        eq(bookShares.status, "accepted")
      )
    )
    .returning({ id: bookShares.id });
  const trail = [
    ...revoked.map(share => ({ shareId: share.id, event: "access_revoked" })),
    ...removed.map(share => ({
      shareId: share.id,
      event: "recipient_removed",
    })),
  ];
  if (trail.length) {
    await tx
      .insert(bookShareEvents)
      .values(trail.map(row => ({ ...row, actorId: blockerId })));
  }
  // Nothing the blocked student sent is left waiting in the list.
  await tx
    .delete(notifications)
    .where(
      and(
        eq(notifications.userId, blockerId),
        eq(notifications.actorId, blockedId),
        inArray(notifications.type, [
          "connection_request",
          "room_invite",
          "share_request",
        ])
      )
    );
}

export async function blockUser(userId: string, otherId: string) {
  if (userId === otherId) throw new ColleagueError("self");
  const db = requireDb();
  return db.transaction(async tx => {
    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, otherId))
      .limit(1);
    if (!target) throw new ColleagueError("not_found");
    await blockWithin(tx, userId, otherId);
    return { status: "blocked" as const };
  });
}

// ── Reporting a person ────────────────────────────────────────────────────
// The same reports table the rooms use, with no room on it. Only someone
// who came to the reporter can be reported — they sent the request, or the
// two are or were colleagues — so the form is not a way to report strangers
// at random (asking someone and taking it back does not count).
export async function reportPerson(
  userId: string,
  input: { targetId: string; reason: string; details?: string | null }
) {
  if (userId === input.targetId) throw new ColleagueError("self");
  return requireDb().transaction(async db => {
    // One report at a time per reporter: the limits below are counted, so two
    // at once must not both pass them.
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    const [history] = await db
      .select({ id: studyConnections.id })
      .from(studyConnections)
      .where(
        or(
          and(
            eq(studyConnections.requesterId, input.targetId),
            eq(studyConnections.addresseeId, userId)
          ),
          and(
            between(userId, input.targetId),
            inArray(studyConnections.status, ["accepted", "removed"])
          )
        )
      )
      .limit(1);
    if (!history) throw new ColleagueError("not_found");
    const [today] = await db
      .select({ n: count() })
      .from(studyRoomReports)
      .where(
        and(
          eq(studyRoomReports.reporterId, userId),
          gt(
            studyRoomReports.createdAt,
            new Date(Date.now() - 24 * 60 * 60_000)
          )
        )
      );
    if (Number(today?.n ?? 0) >= REPORTS_PER_DAY) {
      throw new ColleagueError("rate_limited");
    }
    const [again] = await db
      .select({ id: studyRoomReports.id })
      .from(studyRoomReports)
      .where(
        and(
          eq(studyRoomReports.reporterId, userId),
          eq(studyRoomReports.targetUserId, input.targetId),
          eq(studyRoomReports.status, "open"),
          sql`${studyRoomReports.roomId} is null`
        )
      )
      .limit(1);
    if (again) throw new ColleagueError("already_reported");
    await db.insert(studyRoomReports).values({
      reporterId: userId,
      roomId: null,
      targetUserId: input.targetId,
      reason: input.reason,
      details: (input.details ?? "").trim().slice(0, 500) || null,
    });
    return { status: "reported" as const };
  });
}

// ── Lists ─────────────────────────────────────────────────────────────────
// What one student may see of another: the name they registered with and
// their picture. Never a phone number or an email.
const person = { id: users.id, name: users.name, image: users.image };

export async function listColleagues(userId: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      connectionId: studyConnections.id,
      since: studyConnections.respondedAt,
      ...person,
    })
    .from(studyConnections)
    .innerJoin(
      users,
      sql`${users.id} = case when ${studyConnections.requesterId} = ${userId}
        then ${studyConnections.addresseeId} else ${studyConnections.requesterId} end`
    )
    .where(and(involving(userId), eq(studyConnections.status, "accepted")))
    .orderBy(asc(sql`lower(coalesce(${users.name}, ''))`), asc(users.id));
}

export async function listColleagueRequests(userId: string) {
  const db = getDb();
  if (!db) return { incoming: [], outgoing: [] };
  const [incoming, outgoing] = await Promise.all([
    db
      .select({
        connectionId: studyConnections.id,
        createdAt: studyConnections.createdAt,
        ...person,
      })
      .from(studyConnections)
      .innerJoin(users, eq(users.id, studyConnections.requesterId))
      .where(
        and(
          eq(studyConnections.addresseeId, userId),
          eq(studyConnections.status, "pending")
        )
      )
      .orderBy(desc(studyConnections.createdAt)),
    db
      .select({
        connectionId: studyConnections.id,
        createdAt: studyConnections.createdAt,
        ...person,
      })
      .from(studyConnections)
      .innerJoin(users, eq(users.id, studyConnections.addresseeId))
      .where(
        and(
          eq(studyConnections.requesterId, userId),
          eq(studyConnections.status, "pending")
        )
      )
      .orderBy(desc(studyConnections.createdAt)),
  ]);
  return { incoming, outgoing };
}

export async function countIncomingColleagueRequests(userId: string) {
  const db = getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(studyConnections)
    .where(
      and(
        eq(studyConnections.addresseeId, userId),
        eq(studyConnections.status, "pending")
      )
    );
  return Number(row?.n ?? 0);
}

// ── Finding a student by the name they registered with ────────────────────
export function normalizeSearch(input: string): string {
  return input.trim().replace(/^@+/, "").replace(/\s+/g, " ").toLowerCase();
}

const escapeLike = (value: string) =>
  value.replace(/[\\%_]/g, match => `\\${match}`);

// Never the searcher, never a suspended account, never anyone in a block
// with the searcher. Each result says how the two stand already. One page
// only: the answer to a long list is a fuller name, not a way to walk
// through everyone (`more` says there were others).
export async function searchPeople(
  viewerId: string,
  rawQuery: string,
  limit = SEARCH_PAGE_SIZE
) {
  const empty = { items: [], more: false };
  const q = normalizeSearch(rawQuery);
  if (q.length < 2) return empty;
  const db = getDb();
  if (!db) return empty;
  const like = escapeLike(q);
  const name = sql`lower(coalesce(${users.name}, ''))`;
  const rows = await db
    .select(person)
    .from(users)
    .where(
      and(
        sql`${users.id} <> ${viewerId}`,
        sql`${users.suspendedAt} is null`,
        or(
          sql`${name} like ${`%${like}%`}`,
          sql`${users.username} like ${`${like}%`}`
        ),
        sql`not exists (
          select 1 from "user_blocks" ub
          where (ub."blockerId" = ${viewerId} and ub."blockedId" = "users"."id")
             or (ub."blockerId" = "users"."id" and ub."blockedId" = ${viewerId})
        )`
      )
    )
    // The exact name first, then names that start with it, then the rest.
    .orderBy(
      sql`case when ${name} = ${q} then 0 when ${name} like ${`${like}%`} then 1 else 2 end`,
      asc(name),
      asc(users.id)
    )
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const ids = page.map(row => row.id);
  const live = ids.length
    ? await db
        .select({
          id: studyConnections.id,
          requesterId: studyConnections.requesterId,
          addresseeId: studyConnections.addresseeId,
          status: studyConnections.status,
        })
        .from(studyConnections)
        .where(
          and(
            involving(viewerId),
            inArray(studyConnections.status, ["pending", "accepted"]),
            or(
              inArray(studyConnections.requesterId, ids),
              inArray(studyConnections.addresseeId, ids)
            )
          )
        )
    : [];
  const items = page.map(row => {
    const found = live.find(
      c => c.requesterId === row.id || c.addresseeId === row.id
    );
    const relation: Relation = !found
      ? "none"
      : found.status === "accepted"
        ? "colleague"
        : found.requesterId === viewerId
          ? "outgoing"
          : "incoming";
    return { ...row, relation, connectionId: found?.id ?? null };
  });
  return { items, more: rows.length > limit };
}

// How often one student may search, so the list of names cannot be read
// out a query at a time. Counted in this process (one web process serves
// the app); a restart only resets the minute.
export const SEARCHES_PER_MINUTE = 30;
const searchTimes = new Map<string, number[]>();

export function allowSearch(userId: string, now = Date.now()): boolean {
  const recent = (searchTimes.get(userId) ?? []).filter(
    time => now - time < 60_000
  );
  if (recent.length >= SEARCHES_PER_MINUTE) {
    searchTimes.set(userId, recent);
    return false;
  }
  recent.push(now);
  searchTimes.set(userId, recent);
  if (searchTimes.size > 5000) {
    for (const [key, times] of searchTimes) {
      if (!times.some(time => now - time < 60_000)) searchTimes.delete(key);
    }
  }
  return true;
}
