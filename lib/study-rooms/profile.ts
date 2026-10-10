// The student as the rooms see them: age group, gender, country, whether
// the public rules were accepted, and whether they are banned from rooms.
// Read once per request (`getViewer`) and passed to every decision.
import { eq, sql } from "drizzle-orm";
import { studyRoomProfiles } from "../../drizzle/schema";
import { requireDb } from "../db";
import {
  audienceOf,
  isValidBirthDate,
  stageDisagrees,
  type Audience,
  type Stage,
} from "./age";
import { RoomError } from "./errors";

export type Viewer = {
  userId: string;
  audience: Audience;
  gender: "female" | "male" | null;
  country: string | null;
  birthDateSet: boolean;
  rulesAccepted: boolean;
  uiLanguage: "ar" | "en" | null;
  // Banned from the rooms (lib/study-rooms/moderation.ts).
  banned: boolean;
};

type ViewerRow = {
  gender: string | null;
  country: string | null;
  birth_date: string | null;
  rules_accepted_at: string | null;
  ui_language: string | null;
  banned: boolean;
};

export async function getViewer(userId: string): Promise<Viewer> {
  const db = requireDb();
  const [row] = await db.execute<ViewerRow>(sql`
    select p."gender", p."country", p."birthDate"::text as birth_date,
      p."rulesAcceptedAt"::text as rules_accepted_at,
      p."uiLanguage" as ui_language,
      exists (
        select 1 from "study_room_bans" b
        where b."userId" = ${userId} and (b."until" is null or b."until" > now())
      ) as banned
    from (select 1) one
    left join "study_room_profiles" p on p."userId" = ${userId}
  `);
  const birthDate = row?.birth_date ?? null;
  return {
    userId,
    audience: audienceOf({ birthDate }),
    gender:
      row?.gender === "female" || row?.gender === "male" ? row.gender : null,
    country: row?.country ?? null,
    birthDateSet: !!birthDate,
    rulesAccepted: !!row?.rules_accepted_at,
    uiLanguage:
      row?.ui_language === "ar" || row?.ui_language === "en"
        ? row.ui_language
        : null,
    banned: !!row?.banned,
  };
}

export type ProfileInput = {
  country?: string;
  uiLanguage?: "ar" | "en";
  gender?: "female" | "male";
  birthDate?: string;
  stage?: Stage;
  acceptRules?: boolean;
};

// Country and language may change. Gender and the date of birth are set
// once: a second, different value is refused (an admin corrects mistakes).
export async function setProfile(
  userId: string,
  input: ProfileInput
): Promise<Viewer> {
  const db = requireDb();
  if (input.birthDate !== undefined && !isValidBirthDate(input.birthDate)) {
    throw new RoomError("invalid_birth_date");
  }
  await db.transaction(async tx => {
    await tx.insert(studyRoomProfiles).values({ userId }).onConflictDoNothing();
    const [current] = await tx
      .select()
      .from(studyRoomProfiles)
      .where(eq(studyRoomProfiles.userId, userId))
      .for("update");

    const set: Partial<typeof studyRoomProfiles.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.country !== undefined) set.country = input.country.toUpperCase();
    if (input.uiLanguage !== undefined) set.uiLanguage = input.uiLanguage;
    if (input.gender !== undefined) {
      if (current.gender && current.gender !== input.gender) {
        throw new RoomError("already_set");
      }
      if (!current.gender) {
        set.gender = input.gender;
        set.genderSetAt = new Date();
      }
    }
    if (input.birthDate !== undefined) {
      if (current.birthDate && current.birthDate !== input.birthDate) {
        throw new RoomError("already_set");
      }
      if (!current.birthDate) {
        set.birthDate = input.birthDate;
        set.birthDateSetAt = new Date();
      }
    }
    if (input.stage !== undefined && !current.stage) set.stage = input.stage;
    const birthDate = set.birthDate ?? current.birthDate;
    const stage = (set.stage ?? current.stage) as Stage | null;
    if (birthDate && stage) set.ageFlag = stageDisagrees(birthDate, stage);
    if (input.acceptRules && !current.rulesAcceptedAt) {
      // The rules of PUBLIC rooms: only an adult has any to accept.
      if (audienceOf({ birthDate: birthDate ?? null }) !== "adult") {
        throw new RoomError("public_not_allowed");
      }
      set.rulesAcceptedAt = new Date();
    }
    await tx
      .update(studyRoomProfiles)
      .set(set)
      .where(eq(studyRoomProfiles.userId, userId));
  });
  return getViewer(userId);
}

// An admin corrects a declared age or gender (a support request, or a
// report that turned out true).
export async function adminSetProfile(
  userId: string,
  input: { birthDate?: string; gender?: "female" | "male"; stage?: Stage }
): Promise<void> {
  const db = requireDb();
  if (input.birthDate !== undefined && !isValidBirthDate(input.birthDate)) {
    throw new RoomError("invalid_birth_date");
  }
  const now = new Date();
  const set = {
    ...(input.birthDate !== undefined
      ? { birthDate: input.birthDate, birthDateSetAt: now }
      : {}),
    ...(input.gender !== undefined
      ? { gender: input.gender, genderSetAt: now }
      : {}),
    ...(input.stage !== undefined ? { stage: input.stage } : {}),
    ageFlag: false,
    updatedAt: now,
  };
  await db
    .insert(studyRoomProfiles)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: studyRoomProfiles.userId, set });
}
