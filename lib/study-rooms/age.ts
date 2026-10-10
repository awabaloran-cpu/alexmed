// 🛡 Who may be in which rooms, by age (docs/study-rooms/06-round-3.md §3).
//
// Two groups that never share a room:
//   "adult" — 18 or older: the university sections, public and private rooms.
//   "minor" — under 18, OR no date of birth on file: the high-school
//             section only, private rooms by invitation only.
// The group is worked out from the date of birth on every request, so a
// student who turns 18 today is an adult today.
//
// The date of birth is the student's own declaration. Nothing here verifies
// it; these rules only make sure the declared group is enforced everywhere.
export type Audience = "adult" | "minor";
export type Stage = "university" | "high_school";

export const ADULT_AGE = 18;
// A date of birth outside these ages is refused as a typing mistake.
export const MIN_AGE = 10;
export const MAX_AGE = 90;

// `birthDate` is "YYYY-MM-DD". Whole years on `today` (UTC).
export function ageOn(birthDate: string, today: Date = new Date()): number {
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = today.getUTCFullYear() - year;
  const beforeBirthday =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (beforeBirthday) age--;
  return age;
}

export function isValidBirthDate(
  birthDate: string,
  today: Date = new Date()
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const parsed = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // 2005-02-31 parses to March: the date must read back as it was typed.
  if (parsed.toISOString().slice(0, 10) !== birthDate) return false;
  const age = ageOn(birthDate, today);
  return age >= MIN_AGE && age <= MAX_AGE;
}

// No date of birth is the most restricted group, never the least.
export function audienceOf(
  profile: { birthDate: string | null } | null | undefined,
  today: Date = new Date()
): Audience {
  if (!profile?.birthDate) return "minor";
  return ageOn(profile.birthDate, today) >= ADULT_AGE ? "adult" : "minor";
}

// The declared stage and the declared age disagree (a "university" student
// of 14, a "high school" student of 25) — the age decides, and the account
// is flagged for an admin.
export function stageDisagrees(
  birthDate: string,
  stage: Stage,
  today: Date = new Date()
): boolean {
  const age = ageOn(birthDate, today);
  if (stage === "university") return age < 16;
  return age >= 21;
}

export type SectionRule = { audience: string; publicRooms: boolean };

// A section is for one group only.
export function mayUseSection(
  audience: Audience,
  section: SectionRule
): boolean {
  return section.audience === audience;
}

// Public rooms: adults only, in a section that has them.
export function mayOpenPublicRoom(
  audience: Audience,
  section: SectionRule
): boolean {
  return (
    audience === "adult" && section.audience === "adult" && section.publicRooms
  );
}

// A room is only ever entered by its own group.
export function mayEnterRoom(
  audience: Audience,
  room: { audience: string }
): boolean {
  return room.audience === audience;
}
