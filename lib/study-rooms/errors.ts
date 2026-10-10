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
  | "cannot_act_on_member";

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
