// ✉️ Inviting a colleague to a room. An invitation is a notice with a way
// in attached — it opens nothing by itself: the invited student still
// enters through `joinRoom`, which checks the age group, women-only rooms,
// bans, blocks, the lock and the seats exactly as for anyone else.
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import {
  notifications,
  studyConnections,
  studyRoomInvites,
  studyRoomMembers,
  studyRooms,
  users,
} from "../../drizzle/schema";
import { isBlockedEitherWay, listColleagues } from "../colleagues";
import { requireDb } from "../db";
import { RoomError } from "./errors";
import { getViewer, type Viewer } from "./profile";
import {
  countEvents,
  hasLiveInvite,
  logRoomEvent,
  requireAction,
  requireMember,
  visibleTo,
} from "./rooms";

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_INVITES_PER_HOUR = 30;

type Db = ReturnType<typeof requireDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function settleInviteNotice(
  db: Db | Tx,
  userId: string,
  inviteId: string,
  how: "read" | "delete"
) {
  const mine = and(
    eq(notifications.userId, userId),
    eq(notifications.type, "room_invite"),
    sql`${notifications.data}->>'inviteId' = ${inviteId}`
  );
  if (how === "delete") await db.delete(notifications).where(mine);
  else await db.update(notifications).set({ readAt: new Date() }).where(mine);
}

// Whoever is in the room may invite to a public one; a private room
// follows its "who may invite" setting, like its link.
async function requireInviter(db: Db | Tx, viewer: Viewer, roomId: string) {
  if (viewer.banned) throw new RoomError("banned_from_rooms");
  const found = await requireMember(db, roomId, viewer.userId);
  if (found.room.visibility === "private") {
    await requireAction(db, roomId, viewer.userId, "invite");
  }
  return found.room;
}

export async function inviteColleague(
  viewer: Viewer,
  input: { roomId: string; inviteeId: string }
) {
  const db = requireDb();
  const room = await requireInviter(db, viewer, input.roomId);
  if (input.inviteeId === viewer.userId) throw new RoomError("invite_refused");
  if (room.locked) throw new RoomError("room_locked");

  // Read on its own connection, before the transaction; judged only after
  // the colleague check below, so it says nothing about a stranger.
  const invitee = await getViewer(input.inviteeId);

  return db.transaction(async tx => {
    // The colleagueship is held for the length of this: ending it or a
    // block (lib/colleagues.ts) waits, then cancels what is written here.
    // Not a colleague, or a block between the two: one answer for both.
    const [bond] = await tx
      .select({ id: studyConnections.id })
      .from(studyConnections)
      .where(
        and(
          eq(studyConnections.status, "accepted"),
          or(
            and(
              eq(studyConnections.requesterId, viewer.userId),
              eq(studyConnections.addresseeId, input.inviteeId)
            ),
            and(
              eq(studyConnections.requesterId, input.inviteeId),
              eq(studyConnections.addresseeId, viewer.userId)
            )
          )
        )
      )
      .for("update");
    if (
      !bond ||
      (await isBlockedEitherWay(tx, viewer.userId, input.inviteeId))
    ) {
      throw new RoomError("invite_not_colleague");
    }
    if (
      (await countEvents(tx, viewer.userId, "invite_sent", 60)) >=
      MAX_INVITES_PER_HOUR
    ) {
      throw new RoomError("rate_limited");
    }

    // A room the colleague could not enter anyway is not offered to them.
    // Whatever the reason — the room is not for them, they were put out of
    // it, or they already said no to this inviter — the answer is the same
    // one sentence, so it tells the inviter nothing about them.
    if (invitee.banned || !visibleTo(invitee, room)) {
      throw new RoomError("invite_refused");
    }
    const [membership] = await tx
      .select({ state: studyRoomMembers.state })
      .from(studyRoomMembers)
      .where(
        and(
          eq(studyRoomMembers.roomId, room.id),
          eq(studyRoomMembers.userId, input.inviteeId)
        )
      )
      .limit(1);
    if (membership?.state === "joined") {
      throw new RoomError("invite_already_here");
    }
    if (membership?.state === "kicked" || membership?.state === "banned") {
      throw new RoomError("invite_refused");
    }

    const earlier = await tx
      .select({
        id: studyRoomInvites.id,
        status: studyRoomInvites.status,
        inviterId: studyRoomInvites.inviterId,
        expiresAt: studyRoomInvites.expiresAt,
      })
      .from(studyRoomInvites)
      .where(
        and(
          eq(studyRoomInvites.roomId, room.id),
          eq(studyRoomInvites.inviteeId, input.inviteeId),
          inArray(studyRoomInvites.status, ["pending", "declined"])
        )
      )
      .for("update");
    // They said no to this inviter for this room: not asked again by them.
    if (
      earlier.some(
        invite =>
          invite.status === "declined" && invite.inviterId === viewer.userId
      )
    ) {
      throw new RoomError("invite_refused");
    }
    const waiting = earlier.find(invite => invite.status === "pending");
    if (waiting) {
      if (waiting.expiresAt.getTime() > Date.now()) {
        throw new RoomError("already_invited");
      }
      await tx
        .update(studyRoomInvites)
        .set({ status: "cancelled", respondedAt: new Date() })
        .where(eq(studyRoomInvites.id, waiting.id));
      await settleInviteNotice(tx, input.inviteeId, waiting.id, "delete");
    }
    const [invite] = await tx
      .insert(studyRoomInvites)
      .values({
        roomId: room.id,
        inviterId: viewer.userId,
        inviteeId: input.inviteeId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .onConflictDoNothing()
      .returning({ id: studyRoomInvites.id });
    if (!invite) throw new RoomError("already_invited");
    await tx.insert(notifications).values({
      userId: input.inviteeId,
      type: "room_invite",
      actorId: viewer.userId,
      data: { inviteId: invite.id, roomId: room.id, roomTitle: room.title },
    });
    await logRoomEvent(tx, {
      roomId: room.id,
      actorId: viewer.userId,
      type: "invite_sent",
      targetUserId: input.inviteeId,
    });
    return { inviteId: invite.id };
  });
}

// The invitations waiting for this student: rooms still open, that they
// may enter, from people they have not blocked since.
export async function listMyInvites(viewer: Viewer) {
  const db = requireDb();
  const rows = await db
    .select({
      inviteId: studyRoomInvites.id,
      createdAt: studyRoomInvites.createdAt,
      inviterId: users.id,
      inviterName: users.name,
      inviterImage: users.image,
      room: studyRooms,
    })
    .from(studyRoomInvites)
    .innerJoin(studyRooms, eq(studyRooms.id, studyRoomInvites.roomId))
    .innerJoin(users, eq(users.id, studyRoomInvites.inviterId))
    .where(
      and(
        eq(studyRoomInvites.inviteeId, viewer.userId),
        eq(studyRoomInvites.status, "pending"),
        gt(studyRoomInvites.expiresAt, new Date()),
        eq(studyRooms.status, "active"),
        sql`${studyRooms.hiddenAt} is null`,
        sql`not exists (
          select 1 from "user_blocks" ub
          where (ub."blockerId" = ${viewer.userId} and ub."blockedId" = "study_room_invites"."inviterId")
             or (ub."blockerId" = "study_room_invites"."inviterId" and ub."blockedId" = ${viewer.userId})
        )`
      )
    )
    .orderBy(desc(studyRoomInvites.createdAt))
    .limit(30);
  if (viewer.banned) return [];
  // Only what would still open the room: the same test joinRoom applies.
  const good = [];
  for (const row of rows) {
    if (!visibleTo(viewer, row.room)) continue;
    if (!(await hasLiveInvite(db, row.room, viewer.userId))) continue;
    good.push(row);
  }
  // One line per room, however many colleagues invited to it.
  const seen = new Set<string>();
  return good
    .filter(row => !seen.has(row.room.id) && seen.add(row.room.id))
    .map(row => ({
      inviteId: row.inviteId,
      createdAt: row.createdAt,
      roomId: row.room.id,
      roomTitle: row.room.title,
      visibility: row.room.visibility as "public" | "private",
      inviter: {
        id: row.inviterId,
        name: row.inviterName,
        image: row.inviterImage,
      },
    }));
}

export async function countMyInvites(viewer: Viewer) {
  return (await listMyInvites(viewer)).length;
}

export async function declineInvite(viewer: Viewer, inviteId: string) {
  const db = requireDb();
  const [invite] = await db
    .update(studyRoomInvites)
    .set({ status: "declined", respondedAt: new Date() })
    .where(
      and(
        eq(studyRoomInvites.id, inviteId),
        eq(studyRoomInvites.inviteeId, viewer.userId),
        eq(studyRoomInvites.status, "pending")
      )
    )
    .returning({ id: studyRoomInvites.id });
  if (!invite) throw new RoomError("not_available");
  await settleInviteNotice(db, viewer.userId, inviteId, "read");
  return { status: "declined" as const };
}

// The one who invited takes it back.
export async function cancelInvite(viewer: Viewer, inviteId: string) {
  const db = requireDb();
  const [invite] = await db
    .update(studyRoomInvites)
    .set({ status: "cancelled", respondedAt: new Date() })
    .where(
      and(
        eq(studyRoomInvites.id, inviteId),
        eq(studyRoomInvites.inviterId, viewer.userId),
        eq(studyRoomInvites.status, "pending")
      )
    )
    .returning({
      id: studyRoomInvites.id,
      inviteeId: studyRoomInvites.inviteeId,
    });
  if (!invite) throw new RoomError("not_available");
  await settleInviteNotice(db, invite.inviteeId, invite.id, "delete");
  return { status: "cancelled" as const };
}

export type InviteCandidateState = "can_invite" | "here" | "invited";

// The inviter's own colleagues, and how each stands with this room. Only
// what the inviter already knows or did: who is in the room in front of
// them, and whom they (or someone) already invited.
export async function inviteCandidates(viewer: Viewer, roomId: string) {
  const db = requireDb();
  await requireInviter(db, viewer, roomId);
  const colleagues = await listColleagues(viewer.userId);
  if (!colleagues.length) return [];
  const ids = colleagues.map(colleague => colleague.id);
  const [here, invited] = await Promise.all([
    db
      .select({ userId: studyRoomMembers.userId })
      .from(studyRoomMembers)
      .where(
        and(
          eq(studyRoomMembers.roomId, roomId),
          eq(studyRoomMembers.state, "joined"),
          inArray(studyRoomMembers.userId, ids)
        )
      ),
    db
      .select({
        inviteId: studyRoomInvites.id,
        inviteeId: studyRoomInvites.inviteeId,
        inviterId: studyRoomInvites.inviterId,
      })
      .from(studyRoomInvites)
      .where(
        and(
          eq(studyRoomInvites.roomId, roomId),
          eq(studyRoomInvites.status, "pending"),
          gt(studyRoomInvites.expiresAt, new Date()),
          inArray(studyRoomInvites.inviteeId, ids)
        )
      ),
  ]);
  return colleagues.map(colleague => {
    const invite = invited.find(row => row.inviteeId === colleague.id);
    const state: InviteCandidateState = here.some(
      row => row.userId === colleague.id
    )
      ? "here"
      : invite
        ? "invited"
        : "can_invite";
    return {
      id: colleague.id,
      name: colleague.name,
      image: colleague.image,
      state,
      // Only one's own invitation can be taken back.
      inviteId: invite?.inviterId === viewer.userId ? invite.inviteId : null,
    };
  });
}
