// 🔑 What a member may do in a room — the one place that decides it
// (docs/study-rooms/03-data-and-api.md §3). Every rooms.* procedure asks
// can() on the server; a button being visible means nothing.
//
// A room has settings; a member may carry `grants` that override a setting
// for that member alone, in either direction. Host and co-host powers are
// fixed and not overridable by grants.
import type { StudyRoomGrants, StudyRoomSettings } from "../../drizzle/schema";

export type RoomRole = "host" | "cohost" | "member";

export type RoomAction =
  | "read" // the shared file
  | "free_nav" // move through the file on one's own
  | "lead_page" // change the page everyone follows
  | "mark" // add a shared highlight
  | "delete_any_mark"
  | "chat"
  | "delete_any_message"
  | "speak" // open the microphone without asking
  | "mute_member"
  | "kick_member"
  | "ban_member"
  | "edit_room" // settings, grants, title, capacity, lock, file
  | "manage_roles" // promote, demote, hand over leadership
  | "end_room"
  | "start_quiz"
  | "invite"
  | "report";

export const DEFAULT_SETTINGS: Record<"public" | "private", StudyRoomSettings> =
  {
    private: {
      freeNav: true,
      marks: true,
      chat: true,
      speak: "open",
      quizStart: "cohost",
      invite: "host",
    },
    // Strangers: speaking is by request until the host decides otherwise.
    public: {
      freeNav: true,
      marks: true,
      chat: true,
      speak: "request",
      quizStart: "cohost",
      invite: "host",
    },
  };

export type Actor = {
  role: RoomRole;
  grants: StudyRoomGrants;
  mutedByHost?: boolean;
};

export function can(
  actor: Actor,
  settings: StudyRoomSettings,
  action: RoomAction
): boolean {
  const host = actor.role === "host";
  const staff = host || actor.role === "cohost";
  switch (action) {
    case "read":
    case "report":
      return true;
    case "free_nav":
      return staff || settings.freeNav;
    case "lead_page":
      return host || actor.grants.lead === true;
    case "mark":
      return staff || (actor.grants.mark ?? settings.marks);
    case "chat":
      return staff || (actor.grants.chat ?? settings.chat);
    case "speak":
      // A host's mute holds whatever the room's setting says.
      if (actor.mutedByHost && !host) return false;
      if (staff) return true;
      return actor.grants.speak ?? settings.speak === "open";
    case "delete_any_mark":
    case "delete_any_message":
    case "mute_member":
    case "kick_member":
      return staff;
    case "start_quiz":
      return (
        host || (actor.role === "cohost" && settings.quizStart === "cohost")
      );
    case "invite":
      return staff || settings.invite === "anyone";
    case "ban_member":
    case "edit_room":
    case "manage_roles":
    case "end_room":
      return host;
  }
}

// Acting ON another member: nobody acts on the host, and a co-host does not
// act on another co-host.
export function canActOn(actor: Actor, target: { role: RoomRole }): boolean {
  if (target.role === "host") return false;
  if (actor.role === "host") return true;
  return actor.role === "cohost" && target.role === "member";
}
