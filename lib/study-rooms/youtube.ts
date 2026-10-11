// 🎬 The room's shared YouTube video — the parts with no I/O, used by the
// server and by the page alike so both read a link and a clock the same way.
//
// Nothing of a video is ever fetched, stored or re-sent by this app: the
// official player plays it in each student's browser, and the room only
// agrees on WHICH video and WHERE in it everyone is.
import type { StudyRoomVideoState } from "../../drizzle/schema";

export type VideoState = StudyRoomVideoState;

// The only hosts a link may come from.
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
]);

// A video id is exactly 11 of these.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const isVideoId = (value: unknown): value is string =>
  typeof value === "string" && VIDEO_ID.test(value);

// The video id in a YouTube link, or null. Accepts the forms a student
// pastes — watch?v=, youtu.be/, /embed/, /shorts/, /live/ — with or without
// "https://", and nothing from any other site. The link itself is never
// kept: only the id that comes out of this.
export function parseYoutubeLink(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text || text.length > 300) return null;
  // No scheme but http(s) is ever read (javascript:, data:, …).
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be") {
    id = parts[0] ?? null;
  } else if (parts[0] === "watch") {
    id = url.searchParams.get("v");
  } else if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) {
    id = parts[1] ?? null;
  }
  return isVideoId(id) ? id : null;
}

// A day: no video is longer, and no position beyond it is believed.
export const MAX_POSITION_SECONDS = 24 * 60 * 60;

// A position a client may report: a finite number of seconds, not before
// the start, not beyond what the video is known to last.
export function cleanPosition(
  value: unknown,
  durationSeconds: number | null | undefined
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const limit =
    durationSeconds && durationSeconds > 0
      ? Math.min(durationSeconds + 2, MAX_POSITION_SECONDS)
      : MAX_POSITION_SECONDS;
  if (value > limit) return null;
  return Math.round(Math.min(value, limit) * 10) / 10;
}

// Where the video is NOW: where it was at its last change, plus the time
// since — if it is playing. Paused or ended, it is where it was left.
// `nowMs` is the server's clock (the page corrects its own with the
// offset the server tells it).
export function expectedPosition(state: VideoState, nowMs: number): number {
  if (state.status !== "playing") return state.positionSeconds;
  const elapsed = Math.max(
    0,
    (nowMs - Date.parse(state.stateChangedAt)) / 1000
  );
  const position = state.positionSeconds + elapsed;
  return state.durationSeconds && state.durationSeconds > 0
    ? Math.min(position, state.durationSeconds)
    : position;
}

// How far a screen may be from the room before it is moved: under this it
// is left alone (seeking for a fraction of a second is worse than the
// fraction), over it the player is sent to the room's place.
export const DRIFT_TOLERANCE_SECONDS = 2;

export type SyncVerdict = "in_sync" | "seek";

export function syncVerdict(
  localSeconds: number,
  expectedSeconds: number
): SyncVerdict {
  return Math.abs(localSeconds - expectedSeconds) > DRIFT_TOLERANCE_SECONDS
    ? "seek"
    : "in_sync";
}

// The player's own events come back for what the page itself just did
// (apply the room's state → the player says "playing"). Those must never
// be sent on as if the student had pressed something — that is the loop.
// A change is the student's own only when no command is still settling.
export const APPLY_SETTLE_MS = 1500;

export function isOwnAction(lastAppliedAtMs: number, nowMs: number): boolean {
  return nowMs - lastAppliedAtMs > APPLY_SETTLE_MS;
}

// 754 → "12:34", 3723 → "1:02:03".
export function formatVideoTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}
