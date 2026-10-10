// 👥 Study Rooms (docs/study-rooms). Off unless the server sets
// STUDY_ROOMS_ENABLED=true: every rooms.* procedure answers NOT_FOUND while
// it is off and no page links to the feature, so nothing else changes.
export function studyRoomsEnabled(): boolean {
  return process.env.STUDY_ROOMS_ENABLED === "true";
}

export const ROOM_CAPACITY_MIN = 2;
export const ROOM_CAPACITY_MAX = 20;
export const ROOM_CAPACITY_DEFAULT = 8;
export const ROOM_TITLE_MIN = 3;
export const ROOM_TITLE_MAX = 80;

// A room nobody is in is closed after this long.
export const EMPTY_ROOM_MINUTES = 10;
// A public room this many different members reported is hidden from
// discovery until an admin looks at it (it keeps working for its members).
export const REPORTS_TO_HIDE = 3;

export const ROOM_LANGUAGES = ["ar", "en", "mixed"] as const;
export type RoomLanguage = (typeof ROOM_LANGUAGES)[number];

export const REPORT_REASONS = [
  "abuse",
  "spam",
  "off_topic",
  "copyright",
  "not_female",
  "looks_minor",
  "adult_in_minor_room",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
