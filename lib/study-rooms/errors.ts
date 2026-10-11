// What a rooms operation refuses with. `reason` is a stable key the page
// translates (lib/study-rooms/i18n); the router maps `code` onto tRPC's.
// "not_available" is deliberately one answer for a room that does not
// exist, a private room without its invite, a room of the other age group
// and a women-only room for anyone else — none of them reveals the room.
export type RoomErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "BAD_REQUEST"
  | "TOO_MANY_REQUESTS"
  | "PRECONDITION_FAILED";

export type RoomErrorReason =
  | "not_available"
  | "bad_invite"
  | "room_full"
  | "room_locked"
  | "room_ended"
  | "banned_from_room"
  | "banned_from_rooms"
  | "rules_required"
  | "birth_date_required"
  | "gender_required"
  | "not_allowed"
  | "public_not_allowed"
  | "women_only_not_allowed"
  | "section_not_allowed"
  | "book_not_allowed"
  | "title_not_allowed"
  | "already_hosting"
  | "already_set"
  | "invalid_birth_date"
  | "rate_limited"
  | "already_reported"
  | "cannot_act_on_member"
  | "no_file"
  | "bad_page"
  | "limit_reached"
  | "message_empty"
  | "quiz_running"
  | "quiz_too_few"
  | "quiz_not_active"
  | "quiz_closed"
  | "already_answered"
  // 🎬 the room's video (lib/study-rooms/video.ts)
  | "video_invalid" // not a YouTube link / no video id in it
  | "video_unavailable" // no such video (deleted, mistyped)
  | "video_no_embed" // private, or its owner forbids playing it elsewhere
  | "video_bad_position"
  | "no_video"
  // ✉️ inviting a colleague (lib/study-rooms/invites.ts)
  | "invite_not_colleague"
  | "invite_refused" // this room is not one the colleague can be invited to
  | "invite_already_here"
  | "already_invited"
  // 🧭 a quiz of the Discover catalogue that is not there (any more)
  | "quiz_not_found";

const CODES: Record<RoomErrorReason, RoomErrorCode> = {
  not_available: "NOT_FOUND",
  bad_invite: "NOT_FOUND",
  room_full: "CONFLICT",
  room_locked: "FORBIDDEN",
  room_ended: "PRECONDITION_FAILED",
  banned_from_room: "FORBIDDEN",
  banned_from_rooms: "FORBIDDEN",
  rules_required: "PRECONDITION_FAILED",
  birth_date_required: "PRECONDITION_FAILED",
  gender_required: "PRECONDITION_FAILED",
  not_allowed: "FORBIDDEN",
  public_not_allowed: "FORBIDDEN",
  women_only_not_allowed: "FORBIDDEN",
  section_not_allowed: "FORBIDDEN",
  book_not_allowed: "BAD_REQUEST",
  title_not_allowed: "BAD_REQUEST",
  already_hosting: "CONFLICT",
  already_set: "FORBIDDEN",
  invalid_birth_date: "BAD_REQUEST",
  rate_limited: "TOO_MANY_REQUESTS",
  already_reported: "CONFLICT",
  cannot_act_on_member: "FORBIDDEN",
  no_file: "BAD_REQUEST",
  bad_page: "BAD_REQUEST",
  limit_reached: "CONFLICT",
  message_empty: "BAD_REQUEST",
  quiz_running: "CONFLICT",
  quiz_too_few: "BAD_REQUEST",
  quiz_not_active: "PRECONDITION_FAILED",
  quiz_closed: "PRECONDITION_FAILED",
  already_answered: "CONFLICT",
  video_invalid: "BAD_REQUEST",
  video_unavailable: "BAD_REQUEST",
  video_no_embed: "BAD_REQUEST",
  video_bad_position: "BAD_REQUEST",
  no_video: "PRECONDITION_FAILED",
  invite_not_colleague: "FORBIDDEN",
  invite_refused: "FORBIDDEN",
  invite_already_here: "CONFLICT",
  already_invited: "CONFLICT",
  quiz_not_found: "NOT_FOUND",
};

export class RoomError extends Error {
  readonly code: RoomErrorCode;
  readonly reason: RoomErrorReason;
  constructor(reason: RoomErrorReason) {
    super(reason);
    this.name = "RoomError";
    this.reason = reason;
    this.code = CODES[reason];
  }
}
