// 🚩 Reports and bans. A member reports a room or another member with a
// ready-made reason; an admin decides. Three different members reporting a
// public room hide it from discovery until an admin has looked (it keeps
// working for the people in it).
import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import {
  studyRoomBans,
  studyRoomMembers,
  studyRoomReports,
  studyRooms,
  users,
} from "../../drizzle/schema";
import { requireDb } from "../db";
import { REPORTS_TO_HIDE, type ReportReason } from "./config";
import { RoomError } from "./errors";
import type { Viewer } from "./profile";
import { closeRoom, logRoomEvent } from "./rooms";

const REPORTS_PER_DAY = 5;

export async function reportRoom(
  viewer: Viewer,
  input: {
    roomId: string;
    targetUserId?: string | null;
    reason: ReportReason;
    details?: string | null;
  }
) {
  const db = requireDb();
  // Only someone who has been in the room can report it or its members.
  const [membership] = await db
    .select({ state: studyRoomMembers.state })
    .from(studyRoomMembers)
    .where(
      and(
        eq(studyRoomMembers.roomId, input.roomId),
        eq(studyRoomMembers.userId, viewer.userId)
      )
    )
    .limit(1);
  if (!membership) throw new RoomError("not_available");
  const targetUserId = input.targetUserId ?? null;
  if (targetUserId === viewer.userId)
    throw new RoomError("cannot_act_on_member");
  if (targetUserId) {
    const [target] = await db
      .select({ userId: studyRoomMembers.userId })
      .from(studyRoomMembers)
      .where(
        and(
          eq(studyRoomMembers.roomId, input.roomId),
          eq(studyRoomMembers.userId, targetUserId)
        )
      )
      .limit(1);
    if (!target) throw new RoomError("cannot_act_on_member");
  }

  const [today] = await db
    .select({ n: count() })
    .from(studyRoomReports)
    .where(
      and(
        eq(studyRoomReports.reporterId, viewer.userId),
        gt(studyRoomReports.createdAt, new Date(Date.now() - 24 * 60 * 60_000))
      )
    );
  if (Number(today?.n ?? 0) >= REPORTS_PER_DAY)
    throw new RoomError("rate_limited");

  // One report per target from each reporter.
  const [again] = await db
    .select({ id: studyRoomReports.id })
    .from(studyRoomReports)
    .where(
      and(
        eq(studyRoomReports.reporterId, viewer.userId),
        eq(studyRoomReports.roomId, input.roomId),
        targetUserId
          ? eq(studyRoomReports.targetUserId, targetUserId)
          : sql`${studyRoomReports.targetUserId} is null`
      )
    )
    .limit(1);
  if (again) throw new RoomError("already_reported");

  await db.insert(studyRoomReports).values({
    reporterId: viewer.userId,
    roomId: input.roomId,
    targetUserId,
    reason: input.reason,
    details: (input.details ?? "").trim().slice(0, 500) || null,
  });
  await logRoomEvent(db, {
    roomId: input.roomId,
    actorId: viewer.userId,
    type: "report",
    targetUserId,
    data: { reason: input.reason },
  });

  const [reporters] = await db
    .select({
      n: sql<number>`count(distinct ${studyRoomReports.reporterId})::int`,
    })
    .from(studyRoomReports)
    .where(
      and(
        eq(studyRoomReports.roomId, input.roomId),
        eq(studyRoomReports.status, "open")
      )
    );
  if (Number(reporters?.n ?? 0) >= REPORTS_TO_HIDE) {
    await db
      .update(studyRooms)
      .set({ hiddenAt: new Date() })
      .where(
        and(
          eq(studyRooms.id, input.roomId),
          eq(studyRooms.visibility, "public"),
          sql`${studyRooms.hiddenAt} is null`
        )
      );
  }
}

// ── Admin ─────────────────────────────────────────────────────────────────
export async function listReports(
  status: "open" | "actioned" | "dismissed" = "open"
) {
  const db = requireDb();
  return (
    db
      .select({
        id: studyRoomReports.id,
        roomId: studyRoomReports.roomId,
        roomTitle: studyRooms.title,
        roomStatus: studyRooms.status,
        roomHidden: sql<boolean>`${studyRooms.hiddenAt} is not null`,
        targetUserId: studyRoomReports.targetUserId,
        targetName: users.name,
        reason: studyRoomReports.reason,
        details: studyRoomReports.details,
        status: studyRoomReports.status,
        createdAt: studyRoomReports.createdAt,
      })
      .from(studyRoomReports)
      .leftJoin(studyRooms, eq(studyRooms.id, studyRoomReports.roomId))
      .leftJoin(users, eq(users.id, studyRoomReports.targetUserId))
      .where(eq(studyRoomReports.status, status))
      // The two age reasons and "not a female student" come first.
      .orderBy(
        sql`case when ${studyRoomReports.reason} in ('looks_minor', 'adult_in_minor_room', 'not_female') then 0 else 1 end`,
        desc(studyRoomReports.createdAt)
      )
      .limit(200)
  );
}

export async function resolveReport(
  adminId: string,
  input: {
    reportId: string;
    action: "dismiss" | "end_room" | "ban_user" | "unhide_room";
    banDays?: number | null;
  }
) {
  const db = requireDb();
  const [report] = await db
    .select()
    .from(studyRoomReports)
    .where(eq(studyRoomReports.id, input.reportId))
    .limit(1);
  if (!report) throw new RoomError("not_available");

  if (input.action === "end_room" && report.roomId) {
    await closeRoom(db, report.roomId, adminId, "admin_end");
  }
  if (input.action === "unhide_room" && report.roomId) {
    await db
      .update(studyRooms)
      .set({ hiddenAt: null })
      .where(eq(studyRooms.id, report.roomId));
  }
  if (input.action === "ban_user" && report.targetUserId) {
    await banFromRooms(adminId, {
      userId: report.targetUserId,
      days: input.banDays ?? null,
      reason: report.reason,
    });
  }
  await db
    .update(studyRoomReports)
    .set({
      status:
        input.action === "dismiss" || input.action === "unhide_room"
          ? "dismissed"
          : "actioned",
      handledById: adminId,
      handledAt: new Date(),
    })
    .where(eq(studyRoomReports.id, input.reportId));
}

// From the rooms only; the rest of the account is untouched. The user is
// taken out of every room they are in, and a room they led is handed over
// by the normal rule the next time someone acts in it — here simply ended
// if they were its host.
export async function banFromRooms(
  adminId: string,
  input: { userId: string; days: number | null; reason?: string | null }
) {
  const db = requireDb();
  const until = input.days
    ? new Date(Date.now() + input.days * 24 * 60 * 60_000)
    : null;
  await db
    .insert(studyRoomBans)
    .values({
      userId: input.userId,
      until,
      reason: input.reason ?? null,
      byAdminId: adminId,
    })
    .onConflictDoUpdate({
      target: studyRoomBans.userId,
      set: {
        until,
        reason: input.reason ?? null,
        byAdminId: adminId,
        createdAt: new Date(),
      },
    });
  const hosted = await db
    .select({ id: studyRooms.id })
    .from(studyRooms)
    .where(
      and(eq(studyRooms.hostId, input.userId), eq(studyRooms.status, "active"))
    );
  for (const room of hosted) await closeRoom(db, room.id, adminId, "admin_end");
  await db
    .update(studyRoomMembers)
    .set({ state: "left", leftAt: new Date() })
    .where(
      and(
        eq(studyRoomMembers.userId, input.userId),
        eq(studyRoomMembers.state, "joined")
      )
    );
  await logRoomEvent(db, {
    actorId: adminId,
    type: "platform_ban",
    targetUserId: input.userId,
    data: { days: input.days },
  });
}

export async function unbanFromRooms(adminId: string, userId: string) {
  const db = requireDb();
  await db.delete(studyRoomBans).where(eq(studyRoomBans.userId, userId));
  await logRoomEvent(db, {
    actorId: adminId,
    type: "platform_unban",
    targetUserId: userId,
  });
}
