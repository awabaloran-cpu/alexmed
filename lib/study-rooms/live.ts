// 📄 What members share while they are in a room: the file, the page
// everyone follows, the highlights and the chat. Each call checks the
// member and the permission on the server (requireAction); the room's `seq`
// moves on with every change, so a page that polls — or, later, listens —
// knows when to read again.
import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import {
  books,
  studyRoomMarks,
  studyRoomMessages,
  studyRooms,
  users,
  type StudyMarkRect,
} from "../../drizzle/schema";
import { getDb, requireDb } from "../db";
import { studyRoomsEnabled } from "./config";
import { RoomError } from "./errors";
import { can } from "./permissions";
import type { Viewer } from "./profile";
import { logRoomEvent, requireAction, requireMember } from "./rooms";

type Db = ReturnType<typeof requireDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const MESSAGE_MAX = 500;
export const MARK_COLORS = ["yellow", "green", "pink", "blue"] as const;
export type MarkColor = (typeof MARK_COLORS)[number];
export const MARK_MAX_RECTS = 40;
export const MARK_TEXT_MAX = 600;
// Shared highlights one member may leave in a room, and on one page.
export const MARKS_PER_MEMBER = 60;
export const MARKS_PER_PAGE = 200;

// The next sequence number of the room, taken inside the caller's write.
async function nextSeq(tx: Db | Tx, roomId: string): Promise<number> {
  const [row] = await tx
    .update(studyRooms)
    .set({ seq: sql`${studyRooms.seq} + 1`, lastActiveAt: new Date() })
    .where(eq(studyRooms.id, roomId))
    .returning({ seq: studyRooms.seq });
  return row.seq;
}

// Neither of the two has blocked the other.
const notBlocked = (
  viewerId: string,
  authorColumn: ReturnType<typeof sql>
) => sql`not exists (
  select 1 from "user_blocks" ub
  where (ub."blockerId" = ${viewerId} and ub."blockedId" = ${authorColumn})
     or (ub."blockerId" = ${authorColumn} and ub."blockedId" = ${viewerId})
)`;

// ── The file ──────────────────────────────────────────────────────────────
// For reading only, and only while the student is in the room: no cards, no
// generation, no sharing of it onwards. Leaving, being removed or the room
// ending stops it at once — see isRoomFileKey below.
export async function roomFile(viewer: Viewer, roomId: string) {
  const db = requireDb();
  const { room } = await requireAction(db, roomId, viewer.userId, "read");
  if (!room.bookId) return null;
  const [book] = await db
    .select({
      id: books.id,
      fileName: books.fileName,
      fileKey: books.fileKey,
      pageCount: books.pageCount,
    })
    .from(books)
    .where(eq(books.id, room.bookId))
    .limit(1);
  if (!book?.fileKey) return null;
  return {
    bookId: book.id,
    fileName: book.fileName,
    pageCount: book.pageCount,
    // The same checked route every file goes through (app/api/files).
    url: `/api/files/${book.fileKey}?stream=1`,
    sharedPage: Math.min(
      Math.max(1, room.sharedPage),
      Math.max(1, book.pageCount)
    ),
  };
}

// lib/db-file-access.ts asks this for a stored key nobody else explained:
// the key is the file of an ACTIVE room the user is IN right now. A
// doctor's protected set never passes, whatever a room row says.
export async function isRoomFileKey(
  userId: string,
  fileKey: string
): Promise<boolean> {
  if (!studyRoomsEnabled()) return false;
  const db = getDb();
  if (!db) return false;
  const [row] = await db.execute<{ ok: boolean }>(sql`
    select exists (
      select 1
      from "books" b
      join "study_rooms" r on r."bookId" = b."id" and r."status" = 'active'
      join "study_room_members" m on m."roomId" = r."id"
        and m."userId" = ${userId} and m."state" = 'joined'
      where b."fileKey" = ${fileKey}
        and not exists (select 1 from "question_sets" qs where qs."bookId" = b."id")
    ) as ok
  `);
  return !!row?.ok;
}

// The page everyone "with the host" is on. Only whoever leads the page.
export async function setSharedPage(
  viewer: Viewer,
  roomId: string,
  page: number
) {
  const db = requireDb();
  const { room } = await requireAction(db, roomId, viewer.userId, "lead_page");
  if (!room.bookId) throw new RoomError("no_file");
  const [book] = await db
    .select({ pageCount: books.pageCount })
    .from(books)
    .where(eq(books.id, room.bookId))
    .limit(1);
  if (!book || page < 1 || (book.pageCount > 0 && page > book.pageCount)) {
    throw new RoomError("bad_page");
  }
  if (page === room.sharedPage) return { sharedPage: page, seq: room.seq };
  const [row] = await db
    .update(studyRooms)
    .set({
      sharedPage: page,
      seq: sql`${studyRooms.seq} + 1`,
      lastActiveAt: new Date(),
    })
    .where(eq(studyRooms.id, roomId))
    .returning({ seq: studyRooms.seq });
  return { sharedPage: page, seq: row.seq };
}

// ── Chat ──────────────────────────────────────────────────────────────────
async function countRecent(
  db: Db,
  roomId: string,
  userId: string,
  table: typeof studyRoomMessages | typeof studyRoomMarks,
  seconds: number
) {
  const [row] = await db
    .select({ n: count() })
    .from(table)
    .where(
      and(
        eq(table.roomId, roomId),
        eq(table.userId, userId),
        gt(table.createdAt, new Date(Date.now() - seconds * 1000))
      )
    );
  return Number(row?.n ?? 0);
}

export async function sendMessage(
  viewer: Viewer,
  roomId: string,
  input: { body: string; page?: number | null; clientId: string }
) {
  const db = requireDb();
  await requireAction(db, roomId, viewer.userId, "chat");
  const body = input.body.replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX);
  if (!body) throw new RoomError("message_empty");

  // The same message sent twice (a retry) is the same message.
  const [sent] = await db
    .select({ id: studyRoomMessages.id, seq: studyRoomMessages.seq })
    .from(studyRoomMessages)
    .where(
      and(
        eq(studyRoomMessages.roomId, roomId),
        eq(studyRoomMessages.userId, viewer.userId),
        eq(studyRoomMessages.clientId, input.clientId)
      )
    )
    .limit(1);
  if (sent) return sent;

  if (
    (await countRecent(db, roomId, viewer.userId, studyRoomMessages, 10)) >= 5
  ) {
    throw new RoomError("rate_limited");
  }
  if (
    (await countRecent(db, roomId, viewer.userId, studyRoomMessages, 300)) >= 60
  ) {
    throw new RoomError("rate_limited");
  }
  return db.transaction(async tx => {
    const seq = await nextSeq(tx, roomId);
    const [message] = await tx
      .insert(studyRoomMessages)
      .values({
        roomId,
        userId: viewer.userId,
        body,
        page: input.page ?? null,
        clientId: input.clientId,
        seq,
      })
      .returning({ id: studyRoomMessages.id, seq: studyRoomMessages.seq });
    return message;
  });
}

export async function listMessages(
  viewer: Viewer,
  roomId: string,
  afterSeq = 0
) {
  const db = requireDb();
  await requireMember(db, roomId, viewer.userId);
  const rows = await db
    .select({
      id: studyRoomMessages.id,
      userId: studyRoomMessages.userId,
      name: users.name,
      body: studyRoomMessages.body,
      page: studyRoomMessages.page,
      seq: studyRoomMessages.seq,
      deleted: sql<boolean>`${studyRoomMessages.deletedAt} is not null`,
      createdAt: studyRoomMessages.createdAt,
    })
    .from(studyRoomMessages)
    .leftJoin(users, eq(users.id, studyRoomMessages.userId))
    .where(
      and(
        eq(studyRoomMessages.roomId, roomId),
        gt(studyRoomMessages.seq, afterSeq),
        notBlocked(viewer.userId, sql`"study_room_messages"."userId"`)
      )
    )
    .orderBy(asc(studyRoomMessages.seq))
    .limit(200);
  // A deleted message keeps its place and loses its words.
  return rows.map(row => (row.deleted ? { ...row, body: "" } : row));
}

export async function deleteMessage(
  viewer: Viewer,
  roomId: string,
  messageId: string
) {
  const db = requireDb();
  const { actor, room } = await requireMember(db, roomId, viewer.userId);
  const [message] = await db
    .select({ userId: studyRoomMessages.userId })
    .from(studyRoomMessages)
    .where(
      and(
        eq(studyRoomMessages.id, messageId),
        eq(studyRoomMessages.roomId, roomId)
      )
    )
    .limit(1);
  if (!message) throw new RoomError("not_available");
  const own = message.userId === viewer.userId;
  if (!own && !can(actor, room.settings, "delete_any_message")) {
    throw new RoomError("not_allowed");
  }
  await db
    .update(studyRoomMessages)
    .set({ deletedAt: new Date() })
    .where(eq(studyRoomMessages.id, messageId));
  await nextSeq(db, roomId);
  if (!own) {
    await logRoomEvent(db, {
      roomId,
      actorId: viewer.userId,
      type: "delete_message",
      targetUserId: message.userId,
    });
  }
}

// ── Shared highlights ─────────────────────────────────────────────────────
const inUnit = (value: number) =>
  Number.isFinite(value) && value >= 0 && value <= 1;

// Rectangles as fractions of the page; anything else is refused whole.
export function cleanRects(rects: StudyMarkRect[]): StudyMarkRect[] | null {
  if (!Array.isArray(rects) || !rects.length || rects.length > MARK_MAX_RECTS) {
    return null;
  }
  const cleaned: StudyMarkRect[] = [];
  for (const rect of rects) {
    if (![rect?.x, rect?.y, rect?.w, rect?.h].every(inUnit)) return null;
    if (
      rect.w <= 0 ||
      rect.h <= 0 ||
      rect.x + rect.w > 1.001 ||
      rect.y + rect.h > 1.001
    ) {
      return null;
    }
    const round = (value: number) => Math.round(value * 10_000) / 10_000;
    cleaned.push({
      x: round(rect.x),
      y: round(rect.y),
      w: round(rect.w),
      h: round(rect.h),
    });
  }
  return cleaned;
}

export async function addMark(
  viewer: Viewer,
  roomId: string,
  input: {
    page: number;
    color: MarkColor;
    rects: StudyMarkRect[];
    text?: string | null;
    clientId: string;
  }
) {
  const db = requireDb();
  const { room } = await requireAction(db, roomId, viewer.userId, "mark");
  if (!room.bookId) throw new RoomError("no_file");
  const rects = cleanRects(input.rects);
  if (!rects || input.page < 1) throw new RoomError("bad_page");

  const [again] = await db
    .select({ id: studyRoomMarks.id })
    .from(studyRoomMarks)
    .where(
      and(
        eq(studyRoomMarks.roomId, roomId),
        eq(studyRoomMarks.userId, viewer.userId),
        eq(studyRoomMarks.clientId, input.clientId)
      )
    )
    .limit(1);
  if (again) return again;

  if (
    (await countRecent(db, roomId, viewer.userId, studyRoomMarks, 60)) >= 20
  ) {
    throw new RoomError("rate_limited");
  }
  const live = sql`${studyRoomMarks.deletedAt} is null`;
  const [mine] = await db
    .select({ n: count() })
    .from(studyRoomMarks)
    .where(
      and(
        eq(studyRoomMarks.roomId, roomId),
        eq(studyRoomMarks.userId, viewer.userId),
        live
      )
    );
  const [onPage] = await db
    .select({ n: count() })
    .from(studyRoomMarks)
    .where(
      and(
        eq(studyRoomMarks.roomId, roomId),
        eq(studyRoomMarks.pageNumber, input.page),
        live
      )
    );
  if (
    Number(mine?.n ?? 0) >= MARKS_PER_MEMBER ||
    Number(onPage?.n ?? 0) >= MARKS_PER_PAGE
  ) {
    throw new RoomError("limit_reached");
  }

  const [mark] = await db
    .insert(studyRoomMarks)
    .values({
      roomId,
      userId: viewer.userId,
      bookId: room.bookId,
      pageNumber: input.page,
      color: input.color,
      rects,
      text: (input.text ?? "").trim().slice(0, MARK_TEXT_MAX) || null,
      clientId: input.clientId,
    })
    .returning({ id: studyRoomMarks.id });
  await nextSeq(db, roomId);
  return mark;
}

export async function listMarks(viewer: Viewer, roomId: string, page?: number) {
  const db = requireDb();
  const { room } = await requireMember(db, roomId, viewer.userId);
  if (!room.bookId) return [];
  return db
    .select({
      id: studyRoomMarks.id,
      userId: studyRoomMarks.userId,
      name: users.name,
      pageNumber: studyRoomMarks.pageNumber,
      color: studyRoomMarks.color,
      rects: studyRoomMarks.rects,
      text: studyRoomMarks.text,
      createdAt: studyRoomMarks.createdAt,
    })
    .from(studyRoomMarks)
    .leftJoin(users, eq(users.id, studyRoomMarks.userId))
    .where(
      and(
        eq(studyRoomMarks.roomId, roomId),
        // Highlights belong to the file they were made on.
        eq(studyRoomMarks.bookId, room.bookId),
        sql`${studyRoomMarks.deletedAt} is null`,
        page ? eq(studyRoomMarks.pageNumber, page) : undefined,
        notBlocked(viewer.userId, sql`"study_room_marks"."userId"`)
      )
    )
    .orderBy(asc(studyRoomMarks.createdAt))
    .limit(2000);
}

export async function deleteMark(
  viewer: Viewer,
  roomId: string,
  markId: string
) {
  const db = requireDb();
  const { actor, room } = await requireMember(db, roomId, viewer.userId);
  const [mark] = await db
    .select({ userId: studyRoomMarks.userId })
    .from(studyRoomMarks)
    .where(
      and(eq(studyRoomMarks.id, markId), eq(studyRoomMarks.roomId, roomId))
    )
    .limit(1);
  if (!mark) throw new RoomError("not_available");
  if (
    mark.userId !== viewer.userId &&
    !can(actor, room.settings, "delete_any_mark")
  ) {
    throw new RoomError("not_allowed");
  }
  await db
    .update(studyRoomMarks)
    .set({ deletedAt: new Date() })
    .where(eq(studyRoomMarks.id, markId));
  await nextSeq(db, roomId);
}
