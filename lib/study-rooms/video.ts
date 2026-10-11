// 🎬 Watching a YouTube video together in a room: which video, and where in
// it everyone is. The server keeps the shared state and decides who may
// change it; the video itself is played by YouTube's own player in each
// browser and never passes through here.
//
// Every change is one conditional UPDATE: it goes through only if the room
// is still on the SAME video and at the SAME revision the caller saw. Two
// people pressing at once, a slow phone sending an old "pause", a change
// arriving after the video was swapped — one wins, the other is told the
// state as it now is. The time of a change is the server's own clock.
//
// The room's file is untouched by any of this: the video sits beside it,
// and `contentType` only says which of the two the room is looking at.
import { and, eq, sql } from "drizzle-orm";
import { studyRooms } from "../../drizzle/schema";
import { requireDb } from "../db";
import { RoomError } from "./errors";
import type { Viewer } from "./profile";
import { logRoomEvent, requireAction, requireMember } from "./rooms";
import { thumbnailOf, videoOf } from "./video-view";
import {
  cleanPosition,
  expectedPosition,
  isVideoId,
  parseYoutubeLink,
  type VideoState,
} from "./youtube";

const TITLE_MAX = 200;
const LOOKUP_TIMEOUT_MS = 6000;

export type VideoInfo = {
  videoId: string;
  title: string | null;
  // YouTube's own thumbnail address for this id (shown as an image only).
  thumbnail: string;
};

// Plain text, one line, bounded — whatever YouTube sent.
function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_MAX);
  return text || null;
}

// Is this a video that exists and may be played inside another site?
// Asked of YouTube's public oEmbed address (no key, nothing of the
// student's sent) — the only request this feature ever makes, to that one
// host, with an id that has already passed isVideoId.
//   200 → playable here   401/403 → private, or embedding switched off
//   400/404 → no such video
// If YouTube cannot be reached the video is accepted without a title: the
// player itself reports a video it cannot play, and the page says so.
export async function lookupVideo(videoId: string): Promise<VideoInfo> {
  if (!isVideoId(videoId)) throw new RoomError("video_invalid");
  const info: VideoInfo = {
    videoId,
    title: null,
    thumbnail: thumbnailOf(videoId),
  };
  const address = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`
  )}`;
  let response: Response;
  try {
    response = await fetch(address, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      headers: { accept: "application/json" },
      redirect: "error",
    });
  } catch {
    return info;
  }
  if (response.status === 401 || response.status === 403) {
    throw new RoomError("video_no_embed");
  }
  if (response.status === 400 || response.status === 404) {
    throw new RoomError("video_unavailable");
  }
  if (!response.ok) return info;
  try {
    const body = (await response.json()) as { title?: unknown };
    info.title = cleanTitle(body.title);
  } catch {
    // A reply that is not JSON tells nothing more than "it exists".
  }
  return info;
}

// A link as typed → the video it names, checked. For the "check" button.
export async function checkYoutubeLink(link: string): Promise<VideoInfo> {
  const videoId = parseYoutubeLink(link);
  if (!videoId) throw new RoomError("video_invalid");
  return lookupVideo(videoId);
}

const freshState = (userId: string, revision: number): VideoState => ({
  status: "paused",
  positionSeconds: 0,
  stateChangedAt: new Date().toISOString(),
  controlledBy: userId,
  revision,
  durationSeconds: null,
});

// The leader puts a video in the room (or replaces the one there). It
// starts paused at the beginning, for everyone. The room's file stays.
export async function setRoomVideo(
  viewer: Viewer,
  roomId: string,
  input: { link?: string; videoId?: string }
) {
  const db = requireDb();
  const { room } = await requireAction(db, roomId, viewer.userId, "edit_room");
  const videoId = input.videoId ?? parseYoutubeLink(input.link);
  if (!videoId || !isVideoId(videoId)) throw new RoomError("video_invalid");
  const info = await lookupVideo(videoId);
  const revision = (room.youtubeState?.revision ?? 0) + 1;
  const [row] = await db
    .update(studyRooms)
    .set({
      contentType: "youtube",
      youtubeVideoId: info.videoId,
      youtubeTitle: info.title,
      youtubeState: freshState(viewer.userId, revision),
      seq: sql`${studyRooms.seq} + 1`,
      lastActiveAt: new Date(),
    })
    .where(and(eq(studyRooms.id, roomId), eq(studyRooms.status, "active")))
    .returning();
  if (!row) throw new RoomError("room_ended");
  await logRoomEvent(db, {
    roomId,
    actorId: viewer.userId,
    type: "video_set",
    data: { videoId: info.videoId, replaced: room.youtubeVideoId ?? null },
  });
  return videoOf(row);
}

// Which of the two the room looks at: its file, or its video. Neither is
// removed by looking at the other.
export async function setRoomContent(
  viewer: Viewer,
  roomId: string,
  contentType: "pdf" | "youtube"
) {
  const db = requireDb();
  const { room } = await requireAction(db, roomId, viewer.userId, "edit_room");
  if (contentType === "youtube" && !room.youtubeVideoId) {
    throw new RoomError("no_video");
  }
  // Turning away from a playing video stops it where it is, for everyone.
  const state = room.youtubeState;
  const stopped: VideoState | null =
    contentType === "pdf" && state && state.status === "playing"
      ? {
          ...state,
          status: "paused",
          positionSeconds: expectedPosition(state, Date.now()),
          stateChangedAt: new Date().toISOString(),
          controlledBy: viewer.userId,
          revision: state.revision + 1,
        }
      : null;
  const [row] = await db
    .update(studyRooms)
    .set({
      contentType,
      ...(stopped ? { youtubeState: stopped } : {}),
      seq: sql`${studyRooms.seq} + 1`,
      lastActiveAt: new Date(),
    })
    .where(and(eq(studyRooms.id, roomId), eq(studyRooms.status, "active")))
    .returning();
  if (!row) throw new RoomError("room_ended");
  return videoOf(row);
}

// The video is taken out of the room; the room goes back to its file.
export async function clearRoomVideo(viewer: Viewer, roomId: string) {
  const db = requireDb();
  const { room } = await requireAction(db, roomId, viewer.userId, "edit_room");
  const [row] = await db
    .update(studyRooms)
    .set({
      contentType: "pdf",
      youtubeVideoId: null,
      youtubeTitle: null,
      youtubeState: null,
      seq: sql`${studyRooms.seq} + 1`,
      lastActiveAt: new Date(),
    })
    .where(and(eq(studyRooms.id, roomId), eq(studyRooms.status, "active")))
    .returning();
  if (!row) throw new RoomError("room_ended");
  if (room.youtubeVideoId) {
    await logRoomEvent(db, {
      roomId,
      actorId: viewer.userId,
      type: "video_clear",
      data: { videoId: room.youtubeVideoId },
    });
  }
  return videoOf(row);
}

export async function roomVideo(viewer: Viewer, roomId: string) {
  const db = requireDb();
  const { room } = await requireMember(db, roomId, viewer.userId);
  return videoOf(room);
}

// Play, pause, seek, the end — by whoever may control the video.
// `baseRevision` is the revision the caller's screen was showing: the
// change is applied only on top of exactly that, and only to the video the
// caller means. Otherwise nothing is written and the answer says so
// (`applied: false`) with the state as it is — an old event never undoes a
// newer one.
export async function updateVideoState(
  viewer: Viewer,
  roomId: string,
  input: {
    videoId: string;
    status: VideoState["status"];
    positionSeconds: number;
    baseRevision: number;
    durationSeconds?: number | null;
  }
) {
  const db = requireDb();
  const { room } = await requireAction(
    db,
    roomId,
    viewer.userId,
    "control_video"
  );
  const current = room.youtubeState;
  if (!room.youtubeVideoId || !current) throw new RoomError("no_video");
  if (
    room.youtubeVideoId !== input.videoId ||
    current.revision !== input.baseRevision
  ) {
    return { applied: false as const, ...videoOf(room) };
  }
  // What the player says the video lasts, kept the first time it is told.
  const reported =
    typeof input.durationSeconds === "number" &&
    Number.isFinite(input.durationSeconds) &&
    input.durationSeconds > 0 &&
    input.durationSeconds <= 24 * 60 * 60
      ? Math.round(input.durationSeconds)
      : null;
  const durationSeconds = current.durationSeconds ?? reported;
  const positionSeconds = cleanPosition(input.positionSeconds, durationSeconds);
  if (positionSeconds === null) throw new RoomError("video_bad_position");

  const next: VideoState = {
    status: input.status,
    positionSeconds,
    stateChangedAt: new Date().toISOString(),
    controlledBy: viewer.userId,
    revision: current.revision + 1,
    durationSeconds,
  };
  const [row] = await db
    .update(studyRooms)
    .set({
      youtubeState: next,
      seq: sql`${studyRooms.seq} + 1`,
      lastActiveAt: new Date(),
    })
    .where(
      and(
        eq(studyRooms.id, roomId),
        eq(studyRooms.status, "active"),
        eq(studyRooms.youtubeVideoId, input.videoId),
        sql`(${studyRooms.youtubeState}->>'revision')::int = ${input.baseRevision}`
      )
    )
    .returning();
  if (!row) {
    // Someone else's change landed between the read and the write.
    const { room: latest } = await requireMember(db, roomId, viewer.userId);
    return { applied: false as const, ...videoOf(latest) };
  }
  return { applied: true as const, ...videoOf(row) };
}

// "Bring everyone here": whoever controls the video re-states where it is
// now, as a new revision, so every screen — however far it had drifted or
// been left paused — is sent to the same place.
export async function resyncVideo(viewer: Viewer, roomId: string) {
  const db = requireDb();
  const { room } = await requireAction(
    db,
    roomId,
    viewer.userId,
    "control_video"
  );
  const current = room.youtubeState;
  if (!room.youtubeVideoId || !current) throw new RoomError("no_video");
  return updateVideoState(viewer, roomId, {
    videoId: room.youtubeVideoId,
    status: current.status,
    positionSeconds: expectedPosition(current, Date.now()),
    baseRevision: current.revision,
  });
}

// For a procedure that must refuse before doing anything else.
export async function requireRoomAction(
  viewer: Viewer,
  roomId: string,
  action: "edit_room" | "control_video"
): Promise<void> {
  await requireAction(requireDb(), roomId, viewer.userId, action);
}
