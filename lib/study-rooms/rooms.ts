// 👥 Study rooms: opening one, finding one, entering, leaving, and who
// leads. Every function takes the `Viewer` (lib/study-rooms/profile.ts) and
// decides on the server — age group, gender, bans, blocks, the invite, the
// room's capacity and lock — before it changes anything.
import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  books,
  studyRoomEvents,
  studyRoomMembers,
  studyRooms,
  studySections,
  studySubjects,
  users,
  type StudyRoom,
  type StudyRoomGrants,
  type StudyRoomSettings,
} from "../../drizzle/schema";
import { requireDb } from "../db";
import { mayEnterRoom, mayOpenPublicRoom, mayUseSection } from "./age";
import {
  REPORTS_TO_HIDE,
  ROOM_CAPACITY_DEFAULT,
  type RoomLanguage,
} from "./config";
import { RoomError } from "./errors";
import {
  can,
  canActOn,
  DEFAULT_SETTINGS,
  type Actor,
  type RoomAction,
  type RoomRole,
} from "./permissions";
import type { Viewer } from "./profile";
import {
  cleanText,
  normalizeKey,
  subjectMatches,
  titleIsAllowed,
} from "./text";

type Db = ReturnType<typeof requireDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const hashInvite = (code: string) =>
  createHash("sha256").update(code).digest("hex");
const newInviteCode = () => randomBytes(16).toString("base64url");

// ── Rate limits, counted from the audit trail ─────────────────────────────
async function countEvents(
  db: Db | Tx,
  actorId: string,
  type: string,
  minutes: number
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(studyRoomEvents)
    .where(
      and(
        eq(studyRoomEvents.actorId, actorId),
        eq(studyRoomEvents.type, type),
        gt(studyRoomEvents.createdAt, new Date(Date.now() - minutes * 60_000))
      )
    );
  return Number(row?.n ?? 0);
}

export async function logRoomEvent(
  db: Db | Tx,
  event: {
    roomId?: string | null;
    actorId: string | null;
    type: string;
    targetUserId?: string | null;
    data?: Record<string, string | number | boolean | null>;
  }
): Promise<void> {
  await db.insert(studyRoomEvents).values({
    roomId: event.roomId ?? null,
    actorId: event.actorId,
    type: event.type,
    targetUserId: event.targetUserId ?? null,
    data: event.data ?? null,
  });
}

function assertNotBanned(viewer: Viewer) {
  if (viewer.banned) throw new RoomError("banned_from_rooms");
}

// Either of the two has blocked the other (user_blocks).
const blockedEitherWay = (
  a: string,
  b: ReturnType<typeof sql> | string
) => sql`exists (
  select 1 from "user_blocks" ub
  where (ub."blockerId" = ${a} and ub."blockedId" = ${b})
     or (ub."blockerId" = ${b} and ub."blockedId" = ${a})
)`;

// ── Sections and subjects ─────────────────────────────────────────────────
export async function listSections(viewer: Viewer) {
  const db = requireDb();
  const sections = await db
    .select()
    .from(studySections)
    .where(
      and(
        eq(studySections.active, true),
        eq(studySections.audience, viewer.audience)
      )
    )
    .orderBy(asc(studySections.sortOrder));
  // One grouped count for every card — public rooms the viewer could enter.
  const live = await db
    .select({ sectionId: studyRooms.sectionId, n: count() })
    .from(studyRooms)
    .where(
      and(
        eq(studyRooms.status, "active"),
        eq(studyRooms.visibility, "public"),
        eq(studyRooms.audience, viewer.audience),
        sql`${studyRooms.hiddenAt} is null`,
        viewer.gender === "female" ? undefined : eq(studyRooms.womenOnly, false)
      )
    )
    .groupBy(studyRooms.sectionId);
  const counts = new Map(live.map(row => [row.sectionId, Number(row.n)]));
  return sections.map(section => ({
    id: section.id,
    key: section.key,
    nameAr: section.nameAr,
    nameEn: section.nameEn,
    icon: section.icon,
    color: section.color,
    publicRooms: section.publicRooms,
    liveRooms: counts.get(section.id) ?? 0,
  }));
}

export async function suggestSubjects(
  viewer: Viewer,
  input: { sectionId?: string; q: string }
) {
  const db = requireDb();
  const rows = await db
    .select({
      id: studySubjects.id,
      sectionId: studySubjects.sectionId,
      nameEn: studySubjects.nameEn,
      nameAr: studySubjects.nameAr,
      aliases: studySubjects.aliases,
    })
    .from(studySubjects)
    .innerJoin(studySections, eq(studySections.id, studySubjects.sectionId))
    .where(
      and(
        eq(studySubjects.active, true),
        eq(studySections.active, true),
        eq(studySections.audience, viewer.audience),
        input.sectionId
          ? eq(studySubjects.sectionId, input.sectionId)
          : undefined
      )
    )
    .orderBy(asc(studySubjects.nameEn));
  return rows
    .filter(row => subjectMatches(row, input.q))
    .slice(0, 8)
    .map(({ aliases: _aliases, ...subject }) => subject);
}

// ── Opening a room ────────────────────────────────────────────────────────
export type CreateRoomInput = {
  visibility: "public" | "private";
  title: string;
  sectionId: string;
  subjectId?: string | null;
  subjectText?: string | null;
  topic?: string | null;
  university?: string | null;
  courseCode?: string | null;
  language?: RoomLanguage;
  womenOnly?: boolean;
  capacity?: number;
  bookId?: string | null;
};

// A file may be opened in a room only by its owner, and never a doctor's
// protected set.
async function assertBookAllowed(db: Db | Tx, userId: string, bookId: string) {
  const [book] = await db
    .select({
      userId: books.userId,
      // The table is named in full: inside a raw subquery drizzle writes a
      // single-table column without its table, and the comparison would
      // quietly be against question_sets' own id.
      protectedSet: sql<boolean>`exists (
        select 1 from "question_sets" qs where qs."bookId" = "books"."id"
      )`,
    })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  if (!book || book.userId !== userId || book.protectedSet) {
    throw new RoomError("book_not_allowed");
  }
}

export async function createRoom(viewer: Viewer, input: CreateRoomInput) {
  assertNotBanned(viewer);
  const db = requireDb();
  if (!viewer.birthDateSet) throw new RoomError("birth_date_required");

  const [section] = await db
    .select()
    .from(studySections)
    .where(
      and(eq(studySections.id, input.sectionId), eq(studySections.active, true))
    )
    .limit(1);
  if (!section || !mayUseSection(viewer.audience, section)) {
    throw new RoomError("section_not_allowed");
  }
  const isPublic = input.visibility === "public";
  if (isPublic) {
    if (!mayOpenPublicRoom(viewer.audience, section)) {
      throw new RoomError("public_not_allowed");
    }
    if (!viewer.rulesAccepted) throw new RoomError("rules_required");
    if (!titleIsAllowed(input.title)) throw new RoomError("title_not_allowed");
  }
  if (input.womenOnly) {
    if (!isPublic) throw new RoomError("women_only_not_allowed");
    if (!viewer.gender) throw new RoomError("gender_required");
    if (viewer.gender !== "female")
      throw new RoomError("women_only_not_allowed");
  }
  if (input.subjectId) {
    const [subject] = await db
      .select({ id: studySubjects.id })
      .from(studySubjects)
      .where(
        and(
          eq(studySubjects.id, input.subjectId),
          eq(studySubjects.sectionId, section.id),
          eq(studySubjects.active, true)
        )
      )
      .limit(1);
    if (!subject) throw new RoomError("section_not_allowed");
  }
  if (input.bookId) await assertBookAllowed(db, viewer.userId, input.bookId);

  if ((await countEvents(db, viewer.userId, "create", 60)) >= 5) {
    throw new RoomError("rate_limited");
  }
  if ((await countEvents(db, viewer.userId, "create", 24 * 60)) >= 15) {
    throw new RoomError("rate_limited");
  }

  const title = cleanText(input.title)!;
  const topic = cleanText(input.topic);
  const university = cleanText(input.university);
  const code = isPublic ? null : newInviteCode();

  return db.transaction(async tx => {
    // One room led at a time: opening a second would leave the first
    // without its host.
    const [hosting] = await tx
      .select({ id: studyRooms.id })
      .from(studyRooms)
      .where(
        and(
          eq(studyRooms.hostId, viewer.userId),
          eq(studyRooms.status, "active")
        )
      )
      .limit(1);
    if (hosting) throw new RoomError("already_hosting");

    const [room] = await tx
      .insert(studyRooms)
      .values({
        hostId: viewer.userId,
        createdById: viewer.userId,
        visibility: input.visibility,
        audience: viewer.audience,
        title,
        sectionId: section.id,
        subjectId: input.subjectId ?? null,
        subjectText: input.subjectId ? null : cleanText(input.subjectText),
        topic,
        topicKey: topic ? normalizeKey(topic) : null,
        university,
        universityKey: university ? normalizeKey(university) : null,
        courseCode: cleanText(input.courseCode),
        language: input.language ?? "ar",
        womenOnly: !!input.womenOnly,
        capacity: input.capacity ?? ROOM_CAPACITY_DEFAULT,
        countries: viewer.country ? [viewer.country] : [],
        bookId: input.bookId ?? null,
        pageLeaderId: viewer.userId,
        settings: DEFAULT_SETTINGS[input.visibility],
        inviteHash: code ? hashInvite(code) : null,
      })
      .returning();
    await tx
      .insert(studyRoomMembers)
      .values({ roomId: room.id, userId: viewer.userId, role: "host" });
    await logRoomEvent(tx, {
      roomId: room.id,
      actorId: viewer.userId,
      type: "create",
      data: { visibility: input.visibility },
    });
    return { roomId: room.id, inviteCode: code };
  });
}

// "Study with classmates" on a book: a private room on that file — the one
// already open on it, if the student is leading one.
export async function createRoomForBook(viewer: Viewer, bookId: string) {
  assertNotBanned(viewer);
  const db = requireDb();
  await assertBookAllowed(db, viewer.userId, bookId);
  const [open] = await db
    .select({ id: studyRooms.id })
    .from(studyRooms)
    .where(
      and(
        eq(studyRooms.hostId, viewer.userId),
        eq(studyRooms.bookId, bookId),
        eq(studyRooms.status, "active")
      )
    )
    .limit(1);
  if (open) {
    const inviteCode = await rotateInvite(viewer, open.id);
    return { roomId: open.id, inviteCode };
  }
  const [book] = await db
    .select({ fileName: books.fileName })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  const [section] = await db
    .select({ id: studySections.id })
    .from(studySections)
    .where(
      and(
        eq(studySections.active, true),
        eq(studySections.audience, viewer.audience)
      )
    )
    .orderBy(asc(studySections.sortOrder))
    .limit(1);
  if (!section) throw new RoomError("section_not_allowed");
  const title = (book?.fileName ?? "").replace(/\.pdf$/i, "").slice(0, 80);
  return createRoom(viewer, {
    visibility: "private",
    title: title.length >= 3 ? title : "غرفة مذاكرة",
    sectionId: section.id,
    bookId,
  });
}

// ── Reading a room ────────────────────────────────────────────────────────
type MemberRow = {
  userId: string;
  role: string;
  state: string;
  grants: StudyRoomGrants;
  mutedByHost: boolean;
  joinedAt: Date;
};

async function memberOf(
  db: Db | Tx,
  roomId: string,
  userId: string
): Promise<MemberRow | null> {
  const [member] = await db
    .select({
      userId: studyRoomMembers.userId,
      role: studyRoomMembers.role,
      state: studyRoomMembers.state,
      grants: studyRoomMembers.grants,
      mutedByHost: studyRoomMembers.mutedByHost,
      joinedAt: studyRoomMembers.joinedAt,
    })
    .from(studyRoomMembers)
    .where(
      and(
        eq(studyRoomMembers.roomId, roomId),
        eq(studyRoomMembers.userId, userId)
      )
    )
    .limit(1);
  return member ?? null;
}

const actorOf = (member: MemberRow): Actor => ({
  role: member.role as RoomRole,
  grants: member.grants,
  mutedByHost: member.mutedByHost,
});

// The member row of a student who is IN the room now, or the one refusal.
export async function requireMember(
  db: Db | Tx,
  roomId: string,
  userId: string
): Promise<{ room: StudyRoom; member: MemberRow; actor: Actor }> {
  const [room] = await db
    .select()
    .from(studyRooms)
    .where(eq(studyRooms.id, roomId))
    .limit(1);
  const member = room ? await memberOf(db, roomId, userId) : null;
  if (!room || !member || member.state !== "joined") {
    throw new RoomError("not_available");
  }
  if (room.status !== "active") throw new RoomError("room_ended");
  return { room, member, actor: actorOf(member) };
}

// requireMember + the permission, in one call for the procedures.
export async function requireAction(
  db: Db | Tx,
  roomId: string,
  userId: string,
  action: RoomAction
) {
  const found = await requireMember(db, roomId, userId);
  if (!can(found.actor, found.room.settings, action)) {
    throw new RoomError("not_allowed");
  }
  return found;
}

// Whether this viewer may know the room exists at all (without its invite).
function visibleTo(viewer: Viewer, room: StudyRoom): boolean {
  if (!mayEnterRoom(viewer.audience, room)) return false;
  if (room.womenOnly && viewer.gender !== "female") return false;
  return true;
}

async function presentMembers(db: Db | Tx, roomIds: string[]) {
  if (!roomIds.length) return [];
  return db
    .select({
      roomId: studyRoomMembers.roomId,
      userId: studyRoomMembers.userId,
      role: studyRoomMembers.role,
      grants: studyRoomMembers.grants,
      mutedByHost: studyRoomMembers.mutedByHost,
      joinedAt: studyRoomMembers.joinedAt,
      name: users.name,
      image: users.image,
      country: sql<string | null>`(
        select p."country" from "study_room_profiles" p
        where p."userId" = "study_room_members"."userId"
      )`,
    })
    .from(studyRoomMembers)
    .innerJoin(users, eq(users.id, studyRoomMembers.userId))
    .where(
      and(
        inArray(studyRoomMembers.roomId, roomIds),
        eq(studyRoomMembers.state, "joined")
      )
    )
    .orderBy(asc(studyRoomMembers.joinedAt));
}

function card(
  room: StudyRoom & { subjectEn?: string | null; subjectAr?: string | null },
  members: Awaited<ReturnType<typeof presentMembers>>
) {
  const present = members.filter(member => member.roomId === room.id);
  return {
    id: room.id,
    visibility: room.visibility as "public" | "private",
    title: room.title,
    sectionId: room.sectionId,
    subjectEn: room.subjectEn ?? room.subjectText ?? null,
    subjectAr: room.subjectAr ?? room.subjectText ?? null,
    topic: room.topic,
    university: room.university,
    language: room.language,
    womenOnly: room.womenOnly,
    capacity: room.capacity,
    locked: room.locked,
    countries: room.countries,
    hasBook: !!room.bookId,
    sharedPage: room.sharedPage,
    lastActiveAt: room.lastActiveAt,
    createdAt: room.createdAt,
    memberCount: present.length,
    members: present.slice(0, 5).map(member => ({
      userId: member.userId,
      name: member.name,
      image: member.image,
      country: member.country,
      role: member.role,
    })),
  };
}

const roomWithSubject = {
  room: studyRooms,
  subjectEn: studySubjects.nameEn,
  subjectAr: studySubjects.nameAr,
};

// ── Discovery (adults only: minors have no public rooms) ─────────────────
export type ExploreInput = {
  q?: string;
  sectionId?: string;
  subjectId?: string;
  language?: RoomLanguage;
  country?: string;
  university?: string;
  womenOnly?: boolean;
  limit?: number;
};

export async function exploreRooms(viewer: Viewer, input: ExploreInput = {}) {
  assertNotBanned(viewer);
  if (viewer.audience !== "adult") throw new RoomError("public_not_allowed");
  const db = requireDb();
  const key = input.q ? normalizeKey(input.q) : "";
  const like = `%${key}%`;
  const rows = await db
    .select(roomWithSubject)
    .from(studyRooms)
    .leftJoin(studySubjects, eq(studySubjects.id, studyRooms.subjectId))
    .where(
      and(
        eq(studyRooms.status, "active"),
        eq(studyRooms.visibility, "public"),
        eq(studyRooms.audience, "adult"),
        sql`${studyRooms.hiddenAt} is null`,
        viewer.gender === "female"
          ? undefined
          : eq(studyRooms.womenOnly, false),
        input.womenOnly ? eq(studyRooms.womenOnly, true) : undefined,
        input.sectionId ? eq(studyRooms.sectionId, input.sectionId) : undefined,
        input.subjectId ? eq(studyRooms.subjectId, input.subjectId) : undefined,
        input.language ? eq(studyRooms.language, input.language) : undefined,
        input.country
          ? sql`${studyRooms.countries} @> ${JSON.stringify([input.country.toUpperCase()])}::jsonb`
          : undefined,
        input.university
          ? eq(studyRooms.universityKey, normalizeKey(input.university))
          : undefined,
        key
          ? sql`(
              lower(${studyRooms.title}) like ${like}
              or ${studyRooms.topicKey} like ${like}
              or ${studyRooms.universityKey} like ${like}
              or lower(coalesce(${studyRooms.subjectText}, '')) like ${like}
              or lower(coalesce(${studySubjects.nameEn}, '')) like ${like}
              or coalesce(${studySubjects.nameAr}, '') like ${like}
              or ${studySubjects.aliases}::text like ${like}
            )`
          : undefined,
        sql`not ${blockedEitherWay(viewer.userId, sql`"study_rooms"."hostId"`)}`
      )
    )
    .orderBy(desc(studyRooms.lastActiveAt))
    .limit(Math.min(input.limit ?? 30, 60));
  const rooms = rows.map(row => ({
    ...row.room,
    subjectEn: row.subjectEn,
    subjectAr: row.subjectAr,
  }));
  const members = await presentMembers(
    db,
    rooms.map(room => room.id)
  );
  return (
    rooms
      .map(room => card(room, members))
      // A room everyone has left is not "live".
      .filter(room => room.memberCount > 0)
      .sort((a, b) => b.memberCount - a.memberCount)
  );
}

// The rooms the student is in or leads, newest first.
export async function myRooms(viewer: Viewer) {
  const db = requireDb();
  const rows = await db
    .select(roomWithSubject)
    .from(studyRooms)
    .innerJoin(
      studyRoomMembers,
      and(
        eq(studyRoomMembers.roomId, studyRooms.id),
        eq(studyRoomMembers.userId, viewer.userId)
      )
    )
    .leftJoin(studySubjects, eq(studySubjects.id, studyRooms.subjectId))
    .where(
      and(
        eq(studyRooms.status, "active"),
        inArray(studyRoomMembers.state, ["joined", "left"])
      )
    )
    .orderBy(desc(studyRooms.lastActiveAt))
    .limit(20);
  const rooms = rows.map(row => ({
    ...row.room,
    subjectEn: row.subjectEn,
    subjectAr: row.subjectAr,
  }));
  const members = await presentMembers(
    db,
    rooms.map(room => room.id)
  );
  return rooms.map(room => card(room, members));
}

// The lobby: what a student sees before entering. A private room needs its
// invite (or an earlier membership); every refusal that would reveal the
// room is the same "not available".
export async function previewRoom(
  viewer: Viewer,
  input: { roomId?: string; invite?: string }
) {
  const db = requireDb();
  const [row] = await db
    .select(roomWithSubject)
    .from(studyRooms)
    .leftJoin(studySubjects, eq(studySubjects.id, studyRooms.subjectId))
    .where(
      input.invite
        ? eq(studyRooms.inviteHash, hashInvite(input.invite))
        : eq(
            studyRooms.id,
            input.roomId ?? "00000000-0000-0000-0000-000000000000"
          )
    )
    .limit(1);
  if (!row || !visibleTo(viewer, row.room))
    throw new RoomError("not_available");
  const room = {
    ...row.room,
    subjectEn: row.subjectEn,
    subjectAr: row.subjectAr,
  };
  const member = await memberOf(db, room.id, viewer.userId);
  const known = member && ["joined", "left", "kicked"].includes(member.state);
  if (room.visibility === "private" && !input.invite && !known) {
    throw new RoomError("not_available");
  }
  if (room.hiddenAt && member?.state !== "joined") {
    throw new RoomError("not_available");
  }
  const members = await presentMembers(db, [room.id]);
  return {
    ...card(room, members),
    status: room.status as "active" | "ended",
    full: members.length >= room.capacity && member?.state !== "joined",
    banned: member?.state === "banned",
    joined: member?.state === "joined",
    needsRules: room.visibility === "public" && !viewer.rulesAccepted,
  };
}

// ── Entering ──────────────────────────────────────────────────────────────
async function refreshCountries(tx: Tx, roomId: string) {
  await tx.execute(sql`
    update "study_rooms" r set "countries" = coalesce((
      select jsonb_agg(distinct p."country")
      from "study_room_members" m
      join "study_room_profiles" p on p."userId" = m."userId"
      where m."roomId" = r."id" and m."state" = 'joined' and p."country" is not null
    ), '[]'::jsonb), "lastActiveAt" = now()
    where r."id" = ${roomId}
  `);
}

export async function joinRoom(
  viewer: Viewer,
  input: { roomId: string; invite?: string }
) {
  assertNotBanned(viewer);
  const db = requireDb();
  if ((await countEvents(db, viewer.userId, "join", 10)) >= 20) {
    throw new RoomError("rate_limited");
  }
  if ((await countEvents(db, viewer.userId, "bad_invite", 60)) >= 10) {
    throw new RoomError("rate_limited");
  }

  try {
    return await db.transaction(async tx => {
      // The row is locked: two students cannot take the last seat.
      const [room] = await tx
        .select()
        .from(studyRooms)
        .where(eq(studyRooms.id, input.roomId))
        .for("update");
      if (!room || !visibleTo(viewer, room))
        throw new RoomError("not_available");
      if (room.status !== "active") throw new RoomError("room_ended");

      const member = await memberOf(tx, room.id, viewer.userId);
      if (member?.state === "banned") throw new RoomError("banned_from_room");
      const here = member?.state === "joined";
      if (here) return { roomId: room.id, role: member.role as RoomRole };

      const [blocked] = await tx.execute<{ blocked: boolean }>(
        sql`select ${blockedEitherWay(viewer.userId, room.hostId)} as blocked`
      );
      if (blocked?.blocked) throw new RoomError("not_available");
      if (room.hiddenAt) throw new RoomError("not_available");

      if (room.visibility === "public") {
        if (!viewer.rulesAccepted) throw new RoomError("rules_required");
      } else {
        const invited =
          !!input.invite &&
          !!room.inviteHash &&
          hashInvite(input.invite) === room.inviteHash;
        const returning = member?.state === "left";
        if (!invited && !returning) throw new RoomError("bad_invite");
      }
      if (room.locked) throw new RoomError("room_locked");

      const [present] = await tx
        .select({ n: count() })
        .from(studyRoomMembers)
        .where(
          and(
            eq(studyRoomMembers.roomId, room.id),
            eq(studyRoomMembers.state, "joined")
          )
        );
      const presentCount = Number(present?.n ?? 0);
      if (presentCount >= room.capacity) throw new RoomError("room_full");

      // Everyone had left: whoever comes in first leads.
      const role: RoomRole = presentCount === 0 ? "host" : "member";
      const now = new Date();
      if (role === "host") {
        await tx
          .update(studyRoomMembers)
          .set({ role: "member" })
          .where(
            and(
              eq(studyRoomMembers.roomId, room.id),
              eq(studyRoomMembers.role, "host")
            )
          );
        await tx
          .update(studyRooms)
          .set({ hostId: viewer.userId, pageLeaderId: viewer.userId })
          .where(eq(studyRooms.id, room.id));
      }
      await tx
        .insert(studyRoomMembers)
        .values({ roomId: room.id, userId: viewer.userId, role })
        .onConflictDoUpdate({
          target: [studyRoomMembers.roomId, studyRoomMembers.userId],
          set: {
            state: "joined",
            role,
            joinedAt: now,
            leftAt: null,
            lastSeenAt: now,
            mutedByHost: false,
          },
        });
      await refreshCountries(tx, room.id);
      await logRoomEvent(tx, {
        roomId: room.id,
        actorId: viewer.userId,
        type: "join",
      });
      return { roomId: room.id, role };
    });
  } catch (error) {
    // Wrong codes are counted so they cannot be guessed at speed.
    if (error instanceof RoomError && error.reason === "bad_invite") {
      await logRoomEvent(db, {
        roomId: null,
        actorId: viewer.userId,
        type: "bad_invite",
      });
    }
    throw error;
  }
}

// Leadership goes to whoever has been present longest.
async function handOverIfHostLeft(tx: Tx, room: StudyRoom, leavingId: string) {
  if (room.hostId !== leavingId) return null;
  const [next] = await tx
    .select({ userId: studyRoomMembers.userId })
    .from(studyRoomMembers)
    .where(
      and(
        eq(studyRoomMembers.roomId, room.id),
        eq(studyRoomMembers.state, "joined"),
        sql`${studyRoomMembers.userId} <> ${leavingId}`
      )
    )
    .orderBy(asc(studyRoomMembers.joinedAt))
    .limit(1);
  // Nobody else is here: the room keeps its host on paper and waits (the
  // first to come back leads; an empty room is closed after a while).
  if (!next) return null;
  await setHost(tx, room.id, leavingId, next.userId);
  await logRoomEvent(tx, {
    roomId: room.id,
    actorId: leavingId,
    type: "host_left",
    targetUserId: next.userId,
  });
  return next.userId;
}

async function setHost(tx: Tx, roomId: string, fromId: string, toId: string) {
  await tx
    .update(studyRoomMembers)
    .set({ role: "member" })
    .where(
      and(
        eq(studyRoomMembers.roomId, roomId),
        eq(studyRoomMembers.userId, fromId)
      )
    );
  await tx
    .update(studyRoomMembers)
    .set({ role: "host", mutedByHost: false })
    .where(
      and(
        eq(studyRoomMembers.roomId, roomId),
        eq(studyRoomMembers.userId, toId)
      )
    );
  await tx
    .update(studyRooms)
    .set({ hostId: toId, pageLeaderId: toId })
    .where(eq(studyRooms.id, roomId));
}

export async function leaveRoom(userId: string, roomId: string) {
  const db = requireDb();
  return db.transaction(async tx => {
    const [room] = await tx
      .select()
      .from(studyRooms)
      .where(eq(studyRooms.id, roomId))
      .for("update");
    const member = room ? await memberOf(tx, roomId, userId) : null;
    if (!room || !member || member.state !== "joined")
      return { newHostId: null };
    await tx
      .update(studyRoomMembers)
      .set({ state: "left", leftAt: new Date() })
      .where(
        and(
          eq(studyRoomMembers.roomId, roomId),
          eq(studyRoomMembers.userId, userId)
        )
      );
    const newHostId =
      room.status === "active"
        ? await handOverIfHostLeft(tx, room, userId)
        : null;
    await refreshCountries(tx, roomId);
    await logRoomEvent(tx, { roomId, actorId: userId, type: "leave" });
    return { newHostId };
  });
}

// ── The room, for someone inside it ───────────────────────────────────────
export async function roomState(viewer: Viewer, roomId: string) {
  const db = requireDb();
  const { room, member, actor } = await requireMember(
    db,
    roomId,
    viewer.userId
  );
  // Being asked is the heartbeat: who polled lately is who is here.
  await db
    .update(studyRoomMembers)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(studyRoomMembers.roomId, roomId),
        eq(studyRoomMembers.userId, viewer.userId)
      )
    );
  const members = await presentMembers(db, [roomId]);
  const [subject] = room.subjectId
    ? await db
        .select({ nameEn: studySubjects.nameEn, nameAr: studySubjects.nameAr })
        .from(studySubjects)
        .where(eq(studySubjects.id, room.subjectId))
        .limit(1)
    : [];
  const actions: RoomAction[] = [
    "free_nav",
    "lead_page",
    "mark",
    "chat",
    "speak",
    "mute_member",
    "kick_member",
    "ban_member",
    "edit_room",
    "manage_roles",
    "end_room",
    "start_quiz",
    "invite",
  ];
  return {
    room: {
      id: room.id,
      visibility: room.visibility as "public" | "private",
      title: room.title,
      subjectEn: subject?.nameEn ?? room.subjectText,
      subjectAr: subject?.nameAr ?? room.subjectText,
      topic: room.topic,
      language: room.language,
      womenOnly: room.womenOnly,
      capacity: room.capacity,
      locked: room.locked,
      bookId: room.bookId,
      sharedPage: room.sharedPage,
      hostId: room.hostId,
      pageLeaderId: room.pageLeaderId,
      settings: room.settings,
      seq: room.seq,
      createdAt: room.createdAt,
    },
    me: {
      userId: viewer.userId,
      role: member.role as RoomRole,
      can: Object.fromEntries(
        actions.map(action => [action, can(actor, room.settings, action)])
      ) as Record<RoomAction, boolean>,
    },
    members: members.map(row => ({
      userId: row.userId,
      name: row.name,
      image: row.image,
      country: row.country,
      role: row.role as RoomRole,
      mutedByHost: row.mutedByHost,
      joinedAt: row.joinedAt,
    })),
  };
}

// ── The host's controls ───────────────────────────────────────────────────
export async function rotateInvite(viewer: Viewer, roomId: string) {
  const db = requireDb();
  const { room } = await requireAction(db, roomId, viewer.userId, "invite");
  if (room.visibility !== "private") throw new RoomError("not_allowed");
  const code = newInviteCode();
  await db
    .update(studyRooms)
    .set({ inviteHash: hashInvite(code) })
    .where(eq(studyRooms.id, roomId));
  return code;
}

export async function updateRoom(
  viewer: Viewer,
  roomId: string,
  input: {
    title?: string;
    capacity?: number;
    locked?: boolean;
    settings?: Partial<StudyRoomSettings>;
    bookId?: string | null;
  }
) {
  const db = requireDb();
  const { room } = await requireAction(db, roomId, viewer.userId, "edit_room");
  if (
    input.title !== undefined &&
    room.visibility === "public" &&
    !titleIsAllowed(input.title)
  ) {
    throw new RoomError("title_not_allowed");
  }
  if (input.bookId) await assertBookAllowed(db, viewer.userId, input.bookId);
  await db
    .update(studyRooms)
    .set({
      ...(input.title !== undefined ? { title: cleanText(input.title)! } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.locked !== undefined ? { locked: input.locked } : {}),
      ...(input.settings
        ? { settings: { ...room.settings, ...input.settings } }
        : {}),
      ...(input.bookId !== undefined
        ? { bookId: input.bookId, sharedPage: 1 }
        : {}),
      seq: sql`${studyRooms.seq} + 1`,
    })
    .where(eq(studyRooms.id, roomId));
  await logRoomEvent(db, {
    roomId,
    actorId: viewer.userId,
    type: "update",
    data: { fields: Object.keys(input).join(",") },
  });
}

// Mute, grants, co-host: acting on another member.
export async function setMember(
  viewer: Viewer,
  roomId: string,
  targetId: string,
  input: {
    muted?: boolean;
    grants?: StudyRoomGrants;
    role?: "cohost" | "member";
  }
) {
  const db = requireDb();
  const { actor, room } = await requireMember(db, roomId, viewer.userId);
  const target = await memberOf(db, roomId, targetId);
  if (!target || target.state !== "joined" || targetId === viewer.userId) {
    throw new RoomError("cannot_act_on_member");
  }
  const needs: RoomAction[] = [];
  if (input.muted !== undefined) needs.push("mute_member");
  if (input.grants !== undefined) needs.push("edit_room");
  if (input.role !== undefined) needs.push("manage_roles");
  if (!needs.length) return;
  if (needs.some(action => !can(actor, room.settings, action))) {
    throw new RoomError("not_allowed");
  }
  if (!canActOn(actor, { role: target.role as RoomRole })) {
    throw new RoomError("cannot_act_on_member");
  }
  await db
    .update(studyRoomMembers)
    .set({
      ...(input.muted !== undefined ? { mutedByHost: input.muted } : {}),
      ...(input.grants !== undefined
        ? { grants: { ...target.grants, ...input.grants } }
        : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
    })
    .where(
      and(
        eq(studyRoomMembers.roomId, roomId),
        eq(studyRoomMembers.userId, targetId)
      )
    );
  await db
    .update(studyRooms)
    .set({ seq: sql`${studyRooms.seq} + 1` })
    .where(eq(studyRooms.id, roomId));
  await logRoomEvent(db, {
    roomId,
    actorId: viewer.userId,
    type:
      input.muted !== undefined
        ? input.muted
          ? "mute"
          : "unmute"
        : "member_update",
    targetUserId: targetId,
  });
}

// Kick (may come back) or ban (may not).
export async function removeMember(
  viewer: Viewer,
  roomId: string,
  targetId: string,
  ban: boolean
) {
  const db = requireDb();
  await db.transaction(async tx => {
    const { actor, room } = await requireMember(tx, roomId, viewer.userId);
    if (!can(actor, room.settings, ban ? "ban_member" : "kick_member")) {
      throw new RoomError("not_allowed");
    }
    const target = await memberOf(tx, roomId, targetId);
    if (
      !target ||
      targetId === viewer.userId ||
      !canActOn(actor, { role: target.role as RoomRole })
    ) {
      throw new RoomError("cannot_act_on_member");
    }
    await tx
      .update(studyRoomMembers)
      .set({
        state: ban ? "banned" : "kicked",
        leftAt: new Date(),
        role: "member",
      })
      .where(
        and(
          eq(studyRoomMembers.roomId, roomId),
          eq(studyRoomMembers.userId, targetId)
        )
      );
    await refreshCountries(tx, roomId);
    await logRoomEvent(tx, {
      roomId,
      actorId: viewer.userId,
      type: ban ? "ban" : "kick",
      targetUserId: targetId,
    });
  });
}

export async function transferHost(
  viewer: Viewer,
  roomId: string,
  targetId: string
) {
  const db = requireDb();
  await db.transaction(async tx => {
    await requireAction(tx, roomId, viewer.userId, "manage_roles");
    const target = await memberOf(tx, roomId, targetId);
    if (!target || target.state !== "joined" || targetId === viewer.userId) {
      throw new RoomError("cannot_act_on_member");
    }
    await setHost(tx, roomId, viewer.userId, targetId);
    await logRoomEvent(tx, {
      roomId,
      actorId: viewer.userId,
      type: "transfer_host",
      targetUserId: targetId,
    });
  });
}

export async function endRoom(viewer: Viewer, roomId: string) {
  const db = requireDb();
  await requireAction(db, roomId, viewer.userId, "end_room");
  await closeRoom(db, roomId, viewer.userId, "end");
}

export async function closeRoom(
  db: Db | Tx,
  roomId: string,
  actorId: string | null,
  type: "end" | "admin_end" | "empty_end"
) {
  const now = new Date();
  await db
    .update(studyRooms)
    .set({ status: "ended", endedAt: now, inviteHash: null })
    .where(and(eq(studyRooms.id, roomId), eq(studyRooms.status, "active")));
  await db
    .update(studyRoomMembers)
    .set({ state: "left", leftAt: now })
    .where(
      and(
        eq(studyRoomMembers.roomId, roomId),
        eq(studyRoomMembers.state, "joined")
      )
    );
  await logRoomEvent(db, { roomId, actorId, type });
}

// Rooms nobody has been in for a while are closed (run by the daily /
// periodic cleanup, and cheap enough to call when listing).
export async function closeEmptyRooms(minutes: number): Promise<number> {
  const db = requireDb();
  const stale = await db
    .select({ id: studyRooms.id })
    .from(studyRooms)
    .where(
      and(
        eq(studyRooms.status, "active"),
        sql`${studyRooms.lastActiveAt} < now() - make_interval(mins => ${minutes})`,
        sql`not exists (
          select 1 from "study_room_members" m
          where m."roomId" = "study_rooms"."id" and m."state" = 'joined'
            and m."lastSeenAt" > now() - make_interval(mins => ${minutes})
        )`
      )
    )
    .limit(200);
  for (const room of stale) await closeRoom(db, room.id, null, "empty_end");
  return stale.length;
}

export { REPORTS_TO_HIDE };
