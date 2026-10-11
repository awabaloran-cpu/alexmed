// 🎙️ Live voice in a room (LiveKit). Sound only, never recorded, and only
// between the students who are in the room right now.
//
// The browser talks to LiveKit directly; this server's part is to decide
// WHO may: it signs a short pass for one student and one room, saying
// whether they may speak or only listen — from the same rule every other
// permission comes from (lib/study-rooms/permissions.ts, action "speak":
// the room's setting, the host's grant, the host's mute).
//
// A pass is checked when it is used, not afterwards, so a change made in
// the room (a mute, a grant, a removal, the room ending) is pushed to the
// voice room as well (syncVoice): the muted student's microphone is taken
// down by LiveKit itself, not by asking their browser nicely.
//
// Off unless LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are all
// set: the rooms work without voice, and the page shows no microphone.
import { and, eq } from "drizzle-orm";
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} from "livekit-server-sdk";
import {
  studyRoomMembers,
  studyRooms,
  users,
  type StudyRoomGrants,
} from "../../drizzle/schema";
import { getDb, requireDb } from "../db";
import { can, type RoomRole } from "./permissions";
import type { Viewer } from "./profile";
import { requireMember } from "./rooms";

// A pass lasts a sitting; the page asks for a new one when it reconnects.
const PASS_SECONDS = 6 * 60 * 60;

export function voiceConfig(): {
  url: string;
  apiKey: string;
  apiSecret: string;
} | null {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

export const voiceEnabled = () => voiceConfig() !== null;

// What a student may do in the voice room. Everyone hears; raising a hand
// is a small data message, so everyone may send those.
const permissionFor = (maySpeak: boolean) => ({
  canSubscribe: true,
  canPublish: maySpeak,
  canPublishData: true,
  canPublishSources: [TrackSource.MICROPHONE],
});

export async function voicePass(viewer: Viewer, roomId: string) {
  const config = voiceConfig();
  if (!config) return null;
  const db = requireDb();
  const { room, actor } = await requireMember(db, roomId, viewer.userId);
  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, viewer.userId))
    .limit(1);
  const maySpeak = can(actor, room.settings, "speak");
  const pass = new AccessToken(config.apiKey, config.apiSecret, {
    identity: viewer.userId,
    name: user?.name ?? "",
    ttl: PASS_SECONDS,
  });
  pass.addGrant({ room: roomId, roomJoin: true, ...permissionFor(maySpeak) });
  return { url: config.url, token: await pass.toJwt(), maySpeak };
}

// The voice room is made to agree with the room: whoever is no longer in
// it (left, removed, banned, or the room ended) is put out, and whoever
// may no longer speak loses their microphone. Best effort and never in
// the way: the caller does not wait for it, and it never throws.
export async function syncVoice(roomId: string): Promise<void> {
  const config = voiceConfig();
  const db = getDb();
  if (!config || !db) return;
  try {
    const service = new RoomServiceClient(
      config.url.replace(/^ws/, "http"),
      config.apiKey,
      config.apiSecret
    );
    const present = await service.listParticipants(roomId).catch(() => []);
    if (!present.length) return;

    const [room] = await db
      .select({ status: studyRooms.status, settings: studyRooms.settings })
      .from(studyRooms)
      .where(eq(studyRooms.id, roomId))
      .limit(1);
    const members = await db
      .select({
        userId: studyRoomMembers.userId,
        role: studyRoomMembers.role,
        grants: studyRoomMembers.grants,
        mutedByHost: studyRoomMembers.mutedByHost,
      })
      .from(studyRoomMembers)
      .where(
        and(
          eq(studyRoomMembers.roomId, roomId),
          eq(studyRoomMembers.state, "joined")
        )
      );
    const byId = new Map(members.map(member => [member.userId, member]));

    for (const participant of present) {
      const member = byId.get(participant.identity);
      if (!room || room.status !== "active" || !member) {
        await service
          .removeParticipant(roomId, participant.identity)
          .catch(() => undefined);
        continue;
      }
      const maySpeak = can(
        {
          role: member.role as RoomRole,
          grants: member.grants as StudyRoomGrants,
          mutedByHost: member.mutedByHost,
        },
        room.settings,
        "speak"
      );
      if ((participant.permission?.canPublish ?? false) !== maySpeak) {
        await service
          .updateParticipant(
            roomId,
            participant.identity,
            undefined,
            permissionFor(maySpeak)
          )
          .catch(() => undefined);
      }
    }
  } catch (error) {
    console.error("[StudyRooms] Voice sync failed", error);
  }
}

// After anything that changes who may be heard. Not awaited.
export function syncVoiceSoon(roomId: string): void {
  if (!voiceEnabled()) return;
  void syncVoice(roomId);
}
