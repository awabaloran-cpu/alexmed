// Study rooms through the REAL router on a real Postgres (PGlite): opening,
// finding, entering, leaving, leading, moderating — and every refusal that
// keeps the wrong person out.
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import {
  createTestDb,
  insertQuestionFile,
  insertUser,
  type TestDb,
} from "../test-fixtures/pglite-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));

import { roomsRouter } from "../trpc/roomsRouter";
import { closeEmptyRooms } from "./rooms";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AHMED = id(1); // adult, Egypt
const SARA = id(2); // adult woman, Jordan
const LAYAN = id(3); // adult woman, Egypt
const OMAR = id(4); // adult, Saudi Arabia
const YARA = id(5); // 16, high school
const ZAID = id(6); // 16, high school
const NEWBIE = id(7); // no profile at all
const ADMIN = id(9);
const BOOK = id(101); // Ahmed's file
const SARA_BOOK = id(102);
const SET_BOOK = id(103); // Ahmed's, but a doctor's protected set

let test: TestDb;
let medicine: string;
let highSchool: string;
let pharmacology: string;

const as = (userId: string, role: "user" | "admin" = "user") =>
  roomsRouter.createCaller({
    user: {
      id: userId,
      role,
      email: `${userId}@x.test`,
      name: null,
    } as unknown as User,
  } as never);

// The reason key of a refusal.
async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof TRPCError) return `${error.code}:${error.message}`;
    throw error;
  }
  return "allowed";
}

const yearsAgo = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - 3);
  return date.toISOString().slice(0, 10);
};

async function profile(
  userId: string,
  input: {
    age?: number;
    gender?: "female" | "male";
    country?: string;
    rules?: boolean;
  }
) {
  await as(userId).setProfile({
    ...(input.age ? { birthDate: yearsAgo(input.age) } : {}),
    ...(input.age
      ? { stage: input.age >= 18 ? "university" : "high_school" }
      : {}),
    ...(input.gender ? { gender: input.gender } : {}),
    ...(input.country ? { country: input.country } : {}),
  });
  if (input.rules) await as(userId).setProfile({ acceptRules: true });
}

async function resetRooms() {
  await test.client.exec(
    `DELETE FROM study_room_reports; DELETE FROM study_room_events; DELETE FROM study_rooms; DELETE FROM study_room_bans; DELETE FROM user_blocks;`
  );
}

const publicRoom = (overrides: Record<string, unknown> = {}) => ({
  visibility: "public" as const,
  title: "أدوية الكلى قبل الميدتيرم",
  sectionId: medicine,
  subjectId: pharmacology,
  topic: "Renal drugs",
  ...overrides,
});
const privateRoom = (overrides: Record<string, unknown> = {}) => ({
  visibility: "private" as const,
  title: "مذاكرة مع الشلّة",
  sectionId: medicine,
  ...overrides,
});

beforeAll(async () => {
  test = await createTestDb();
  holder.db = test.db;
  for (const [userId, name] of [
    [AHMED, "أحمد"],
    [SARA, "سارة"],
    [LAYAN, "ليان"],
    [OMAR, "عمر"],
    [YARA, "يارا"],
    [ZAID, "زيد"],
    [NEWBIE, "جديد"],
  ] as const) {
    await insertUser(test.client, { id: userId, name });
  }
  await insertUser(test.client, { id: ADMIN, name: "Admin", role: "admin" });
  await insertQuestionFile(test.client, { id: BOOK, userId: AHMED });
  await insertQuestionFile(test.client, { id: SARA_BOOK, userId: SARA });
  await insertQuestionFile(test.client, { id: SET_BOOK, userId: AHMED });
  await test.client.query(
    `INSERT INTO question_sets ("bookId", "ownerId", title) VALUES ($1, $2, 'Set')`,
    [SET_BOOK, AHMED]
  );

  process.env.STUDY_ROOMS_ENABLED = "true";
  await profile(AHMED, { age: 22, gender: "male", country: "EG", rules: true });
  await profile(SARA, {
    age: 21,
    gender: "female",
    country: "JO",
    rules: true,
  });
  await profile(LAYAN, {
    age: 23,
    gender: "female",
    country: "EG",
    rules: true,
  });
  await profile(OMAR, { age: 24, country: "SA", rules: true });
  await profile(YARA, { age: 16, gender: "female", country: "EG" });
  await profile(ZAID, { age: 16, gender: "male", country: "EG" });

  const sections = await test.client.query<{ id: string; key: string }>(
    `SELECT id, key FROM study_sections`
  );
  medicine = sections.rows.find(row => row.key === "medicine")!.id;
  highSchool = sections.rows.find(row => row.key === "high_school")!.id;
  const subject = await test.client.query<{ id: string }>(
    `SELECT id FROM study_subjects WHERE "nameEn" = 'Pharmacology' AND "sectionId" = $1`,
    [medicine]
  );
  pharmacology = subject.rows[0].id;
}, 120_000);

beforeEach(async () => {
  process.env.STUDY_ROOMS_ENABLED = "true";
  await resetRooms();
});
afterEach(() => {
  process.env.STUDY_ROOMS_ENABLED = "true";
});

describe("the feature switch", () => {
  it("while off, every procedure answers as if the feature did not exist", async () => {
    process.env.STUDY_ROOMS_ENABLED = "false";
    expect(await as(AHMED).enabled()).toEqual({ enabled: false });
    expect(await refusal(as(AHMED).sections())).toBe("NOT_FOUND:not_available");
    expect(await refusal(as(AHMED).create(publicRoom()))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(await refusal(as(ADMIN, "admin").adminReports())).toBe(
      "NOT_FOUND:not_available"
    );
  });

  it("a stray space or capital in the switch does not keep it off", async () => {
    for (const value of ["true ", " true", "TRUE", "True\n"]) {
      process.env.STUDY_ROOMS_ENABLED = value;
      expect(await as(AHMED).enabled()).toEqual({ enabled: true });
    }
    for (const value of ["", "1", "yes", "truee"]) {
      process.env.STUDY_ROOMS_ENABLED = value;
      expect(await as(AHMED).enabled()).toEqual({ enabled: false });
    }
  });

  it("a signed-out caller gets nothing", async () => {
    const anonymous = roomsRouter.createCaller({ user: null } as never);
    await expect(anonymous.sections()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("the student's profile for rooms", () => {
  it("the age group follows the declared date of birth", async () => {
    expect(await as(AHMED).me()).toMatchObject({
      audience: "adult",
      rulesAccepted: true,
    });
    expect(await as(YARA).me()).toMatchObject({
      audience: "minor",
      rulesAccepted: false,
    });
    // Nothing declared: the most restricted group.
    expect(await as(NEWBIE).me()).toMatchObject({
      audience: "minor",
      birthDateSet: false,
    });
  });

  it("the date of birth and the gender are set once", async () => {
    expect(
      await refusal(as(YARA).setProfile({ birthDate: yearsAgo(25) }))
    ).toBe("FORBIDDEN:already_set");
    expect(await refusal(as(ZAID).setProfile({ gender: "female" }))).toBe(
      "FORBIDDEN:already_set"
    );
    // The same value again is not a change.
    expect(await refusal(as(ZAID).setProfile({ gender: "male" }))).toBe(
      "allowed"
    );
    // The country and the language may change freely.
    expect(
      await as(ZAID).setProfile({ country: "jo", uiLanguage: "en" })
    ).toMatchObject({
      country: "JO",
      uiLanguage: "en",
    });
    await as(ZAID).setProfile({ country: "EG" });
  });

  it("a minor has no public rules to accept", async () => {
    expect(await refusal(as(YARA).setProfile({ acceptRules: true }))).toBe(
      "FORBIDDEN:public_not_allowed"
    );
    expect(
      await refusal(as(NEWBIE).setProfile({ birthDate: "2005-02-31" }))
    ).toBe("BAD_REQUEST:invalid_birth_date");
  });

  it("an admin corrects a declared age", async () => {
    await as(ADMIN, "admin").adminSetProfile({
      userId: ZAID,
      birthDate: yearsAgo(19),
    });
    expect((await as(ZAID).me()).audience).toBe("adult");
    await as(ADMIN, "admin").adminSetProfile({
      userId: ZAID,
      birthDate: yearsAgo(16),
    });
    expect((await as(ZAID).me()).audience).toBe("minor");
    expect(
      await refusal(
        as(AHMED).adminSetProfile({ userId: ZAID, gender: "female" })
      )
    ).toBe("FORBIDDEN:" + "You do not have required permission (10002)");
  });
});

describe("sections and subjects", () => {
  it("an adult sees the university sections, a minor only high school", async () => {
    const adult = (await as(AHMED).sections()).map(section => section.key);
    expect(adult).toEqual([
      "medicine",
      "pharmacy",
      "engineering",
      "science",
      "programming",
    ]);
    const minor = await as(YARA).sections();
    expect(minor.map(section => section.key)).toEqual(["high_school"]);
    expect(minor[0].publicRooms).toBe(false);
  });

  it("each card counts its live public rooms", async () => {
    await as(AHMED).create(publicRoom());
    const sections = await as(SARA).sections();
    expect(
      sections.find(section => section.key === "medicine")?.liveRooms
    ).toBe(1);
    expect(
      sections.find(section => section.key === "pharmacy")?.liveRooms
    ).toBe(0);
  });

  it("a subject is found by name, Arabic name or nickname, inside its group", async () => {
    const found = async (q: string) =>
      (await as(AHMED).suggestSubjects({ q })).map(subject => subject.nameEn);
    expect(await found("فارما")).toContain("Pharmacology");
    expect(await found("pharm")).toEqual(
      expect.arrayContaining(["Pharmacology", "Pharmaceutics"])
    );
    expect(await found("علم الأدويه")).toContain("Pharmacology");
    // A minor is offered high-school subjects only.
    const minor = await as(YARA).suggestSubjects({ q: "" });
    expect(minor.every(subject => subject.sectionId === highSchool)).toBe(true);
    expect((await as(YARA).suggestSubjects({ q: "pharm" })).length).toBe(0);
  });
});

describe("opening a room", () => {
  it("a public room is found by subject, topic and country — across countries", async () => {
    const { roomId, inviteCode } = await as(AHMED).create(publicRoom());
    expect(inviteCode).toBeNull();
    await as(SARA).join({ roomId });

    const titles = async (input?: Record<string, unknown>) =>
      (await as(OMAR).explore(input as never)).map(room => room.title);
    expect(await titles()).toEqual(["أدوية الكلى قبل الميدتيرم"]);
    expect(await titles({ q: "renal" })).toHaveLength(1);
    expect(await titles({ q: "فارما" })).toHaveLength(1);
    expect(await titles({ subjectId: pharmacology })).toHaveLength(1);
    expect(await titles({ country: "JO" })).toHaveLength(1);
    expect(await titles({ country: "MA" })).toHaveLength(0);
    expect(await titles({ q: "anatomy" })).toHaveLength(0);

    const [room] = await as(OMAR).explore();
    expect(room).toMatchObject({
      subjectEn: "Pharmacology",
      topic: "Renal drugs",
      memberCount: 2,
      womenOnly: false,
    });
    expect([...room.countries].sort()).toEqual(["EG", "JO"]);
    expect(room.members.map(member => member.country).sort()).toEqual([
      "EG",
      "JO",
    ]);
  });

  it("a private room has an invite and is never in discovery", async () => {
    const { roomId, inviteCode } = await as(AHMED).create(privateRoom());
    expect(inviteCode).toMatch(/^[\w-]{20,}$/);
    expect(await as(SARA).explore()).toEqual([]);
    // Only a hash is stored.
    const stored = await test.client.query<{ inviteHash: string }>(
      `SELECT "inviteHash" FROM study_rooms WHERE id = $1`,
      [roomId]
    );
    expect(stored.rows[0].inviteHash).not.toContain(inviteCode!);
    expect(stored.rows[0].inviteHash).toHaveLength(64);
  });

  it("only one's own file, and never a doctor's protected set", async () => {
    expect(await refusal(as(AHMED).create(privateRoom({ bookId: BOOK })))).toBe(
      "allowed"
    );
    await resetRooms();
    expect(
      await refusal(as(AHMED).create(privateRoom({ bookId: SARA_BOOK })))
    ).toBe("BAD_REQUEST:book_not_allowed");
    expect(
      await refusal(as(AHMED).create(privateRoom({ bookId: SET_BOOK })))
    ).toBe("BAD_REQUEST:book_not_allowed");
    expect(await refusal(as(AHMED).createForBook({ bookId: SET_BOOK }))).toBe(
      "BAD_REQUEST:book_not_allowed"
    );
  });

  it("“study with classmates” opens one private room on the file, not two", async () => {
    const first = await as(AHMED).createForBook({ bookId: BOOK });
    const again = await as(AHMED).createForBook({ bookId: BOOK });
    expect(again.roomId).toBe(first.roomId);
    expect(again.inviteCode).toBeTruthy();
    expect(
      (await as(AHMED).state({ roomId: first.roomId })).room
    ).toMatchObject({
      visibility: "private",
      bookId: BOOK,
    });
  });

  it("one room led at a time, a few rooms an hour", async () => {
    await as(AHMED).create(publicRoom());
    expect(await refusal(as(AHMED).create(privateRoom()))).toBe(
      "CONFLICT:already_hosting"
    );
    for (let i = 0; i < 4; i++) {
      const [room] = (
        await test.client.query<{ id: string }>(
          `SELECT id FROM study_rooms WHERE "hostId" = $1 AND status = 'active'`,
          [AHMED]
        )
      ).rows;
      await as(AHMED).end({ roomId: room.id });
      await as(AHMED).create(privateRoom());
    }
    const [open] = (
      await test.client.query<{ id: string }>(
        `SELECT id FROM study_rooms WHERE "hostId" = $1 AND status = 'active'`,
        [AHMED]
      )
    ).rows;
    await as(AHMED).end({ roomId: open.id });
    expect(await refusal(as(AHMED).create(privateRoom()))).toBe(
      "TOO_MANY_REQUESTS:rate_limited"
    );
  });

  it("refuses a bad title in public, and input the schema does not allow", async () => {
    expect(
      await refusal(as(AHMED).create(publicRoom({ title: "free porn here" })))
    ).toBe("BAD_REQUEST:title_not_allowed");
    await expect(
      as(AHMED).create(publicRoom({ title: "ab" }))
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      as(AHMED).create(publicRoom({ capacity: 500 }))
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      as(AHMED).create(publicRoom({ sectionId: "not-a-uuid" }))
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("protection by age", () => {
  it("a minor has no public rooms by any route", async () => {
    const { roomId } = await as(AHMED).create(publicRoom());
    expect(await refusal(as(YARA).explore())).toBe(
      "FORBIDDEN:public_not_allowed"
    );
    expect(await refusal(as(YARA).preview({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(await refusal(as(YARA).join({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(
      await refusal(
        as(YARA).create(publicRoom({ sectionId: highSchool, subjectId: null }))
      )
    ).toBe("FORBIDDEN:public_not_allowed");
    expect(await refusal(as(YARA).create(privateRoom()))).toBe(
      "FORBIDDEN:section_not_allowed"
    );
  });

  it("minors study together in private high-school rooms", async () => {
    const { roomId, inviteCode } = await as(YARA).create(
      privateRoom({ sectionId: highSchool })
    );
    expect(await refusal(as(ZAID).join({ roomId, invite: inviteCode! }))).toBe(
      "allowed"
    );
    expect((await as(YARA).state({ roomId })).members).toHaveLength(2);
  });

  it("an adult never enters a minor's room, even with its invite — and the reverse", async () => {
    const minors = await as(YARA).create(
      privateRoom({ sectionId: highSchool })
    );
    expect(
      await refusal(
        as(AHMED).join({ roomId: minors.roomId, invite: minors.inviteCode! })
      )
    ).toBe("NOT_FOUND:not_available");
    expect(
      await refusal(as(AHMED).preview({ invite: minors.inviteCode! }))
    ).toBe("NOT_FOUND:not_available");
    const adults = await as(AHMED).create(privateRoom());
    expect(
      await refusal(
        as(ZAID).join({ roomId: adults.roomId, invite: adults.inviteCode! })
      )
    ).toBe("NOT_FOUND:not_available");
    await as(AHMED).end({ roomId: adults.roomId });
    expect(
      await refusal(as(AHMED).create(privateRoom({ sectionId: highSchool })))
    ).toBe("FORBIDDEN:section_not_allowed");
  });

  it("an account with no date of birth is asked for it before anything", async () => {
    expect(
      await refusal(as(NEWBIE).create(privateRoom({ sectionId: highSchool })))
    ).toBe("PRECONDITION_FAILED:birth_date_required");
    expect(await refusal(as(NEWBIE).explore())).toBe(
      "FORBIDDEN:public_not_allowed"
    );
  });

  it("public rooms need the rules accepted once", async () => {
    const { roomId } = await as(AHMED).create(publicRoom());
    await test.client.query(
      `UPDATE study_room_profiles SET "rulesAcceptedAt" = NULL WHERE "userId" = $1`,
      [OMAR]
    );
    expect((await as(OMAR).preview({ roomId })).needsRules).toBe(true);
    expect(await refusal(as(OMAR).join({ roomId }))).toBe(
      "PRECONDITION_FAILED:rules_required"
    );
    await as(OMAR).setProfile({ acceptRules: true });
    expect(await refusal(as(OMAR).join({ roomId }))).toBe("allowed");
  });
});

describe("women-only rooms", () => {
  it("only a woman opens one, and only as a public room", async () => {
    expect(
      await refusal(as(AHMED).create(publicRoom({ womenOnly: true })))
    ).toBe("FORBIDDEN:women_only_not_allowed");
    expect(
      await refusal(as(OMAR).create(publicRoom({ womenOnly: true })))
    ).toBe("PRECONDITION_FAILED:gender_required");
    expect(
      await refusal(as(SARA).create(privateRoom({ womenOnly: true })))
    ).toBe("FORBIDDEN:women_only_not_allowed");
    expect(
      await refusal(as(SARA).create(publicRoom({ womenOnly: true })))
    ).toBe("allowed");
  });

  it("is seen and entered by women only — a man, or an unset gender, gets “not available”", async () => {
    const { roomId } = await as(SARA).create(publicRoom({ womenOnly: true }));
    expect((await as(LAYAN).explore()).map(room => room.id)).toEqual([roomId]);
    expect((await as(LAYAN).explore({ womenOnly: true })).length).toBe(1);
    expect(await refusal(as(LAYAN).join({ roomId }))).toBe("allowed");

    for (const other of [AHMED, OMAR]) {
      expect(await as(other).explore()).toEqual([]);
      expect(await refusal(as(other).preview({ roomId }))).toBe(
        "NOT_FOUND:not_available"
      );
      expect(await refusal(as(other).join({ roomId }))).toBe(
        "NOT_FOUND:not_available"
      );
    }
    const medicineCard = (await as(AHMED).sections()).find(
      s => s.key === "medicine"
    );
    expect(medicineCard?.liveRooms).toBe(0);
  });
});

describe("entering and leaving", () => {
  it("a private room opens with its invite only, and wrong codes are counted", async () => {
    const { roomId, inviteCode } = await as(AHMED).create(privateRoom());
    expect(await refusal(as(SARA).join({ roomId }))).toBe(
      "NOT_FOUND:bad_invite"
    );
    expect(await refusal(as(SARA).preview({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(
      await refusal(as(SARA).join({ roomId, invite: "wrong-code-123" }))
    ).toBe("NOT_FOUND:bad_invite");
    expect((await as(SARA).preview({ invite: inviteCode! })).title).toBe(
      "مذاكرة مع الشلّة"
    );
    expect(await refusal(as(SARA).join({ roomId, invite: inviteCode! }))).toBe(
      "allowed"
    );

    // A new link makes the old one useless.
    const { inviteCode: fresh } = await as(AHMED).rotateInvite({ roomId });
    expect(await refusal(as(OMAR).join({ roomId, invite: inviteCode! }))).toBe(
      "NOT_FOUND:bad_invite"
    );
    expect(await refusal(as(OMAR).join({ roomId, invite: fresh }))).toBe(
      "allowed"
    );

    for (let i = 0; i < 9; i++) {
      await refusal(as(LAYAN).join({ roomId, invite: `guess-number-${i}` }));
    }
    await refusal(as(LAYAN).join({ roomId, invite: "guess-number-9" }));
    expect(await refusal(as(LAYAN).join({ roomId, invite: fresh }))).toBe(
      "TOO_MANY_REQUESTS:rate_limited"
    );
  });

  it("entering twice is one member, and the last seat goes to one student only", async () => {
    const { roomId } = await as(AHMED).create(publicRoom({ capacity: 2 }));
    const results = await Promise.all(
      [SARA, LAYAN, OMAR].map(userId => refusal(as(userId).join({ roomId })))
    );
    expect(results.filter(result => result === "allowed")).toHaveLength(1);
    expect(
      results.filter(result => result === "CONFLICT:room_full")
    ).toHaveLength(2);
    const winner = [SARA, LAYAN, OMAR][results.indexOf("allowed")];
    expect(await refusal(as(winner).join({ roomId }))).toBe("allowed");
    expect((await as(AHMED).state({ roomId })).members).toHaveLength(2);
    expect((await as(AHMED).preview({ roomId })).full).toBe(false);
  });

  it("a locked room lets nobody new in; those inside stay", async () => {
    const { roomId } = await as(AHMED).create(publicRoom());
    await as(SARA).join({ roomId });
    await as(AHMED).update({ roomId, locked: true });
    expect(await refusal(as(OMAR).join({ roomId }))).toBe(
      "FORBIDDEN:room_locked"
    );
    expect(await refusal(as(SARA).state({ roomId }))).toBe("allowed");
  });

  it("when the host leaves, the longest-present member leads", async () => {
    const { roomId } = await as(AHMED).create(publicRoom());
    await as(SARA).join({ roomId });
    await as(OMAR).join({ roomId });
    const { newHostId } = await as(AHMED).leave({ roomId });
    expect(newHostId).toBe(SARA);
    const state = await as(SARA).state({ roomId });
    expect(state.room.hostId).toBe(SARA);
    expect(state.me.role).toBe("host");
    expect(state.me.can.end_room).toBe(true);
    // The former host comes back as an ordinary member.
    await as(AHMED).join({ roomId });
    expect((await as(AHMED).state({ roomId })).me.role).toBe("member");
    // A member leaving changes nothing.
    expect((await as(OMAR).leave({ roomId })).newHostId).toBeNull();
  });

  it("an empty room is led by whoever returns first, and closed if nobody does", async () => {
    const { roomId } = await as(AHMED).create(publicRoom());
    await as(SARA).join({ roomId });
    await as(SARA).leave({ roomId });
    await as(AHMED).leave({ roomId });
    await as(SARA).join({ roomId });
    expect((await as(SARA).state({ roomId })).me.role).toBe("host");
    await as(SARA).leave({ roomId });

    await test.client.query(
      `UPDATE study_rooms SET "lastActiveAt" = now() - interval '20 minutes' WHERE id = $1`,
      [roomId]
    );
    await test.client.query(
      `UPDATE study_room_members SET "lastSeenAt" = now() - interval '20 minutes' WHERE "roomId" = $1`,
      [roomId]
    );
    expect(await closeEmptyRooms(10)).toBe(1);
    expect(await refusal(as(OMAR).join({ roomId }))).toBe(
      "PRECONDITION_FAILED:room_ended"
    );
  });

  it("someone outside the room sees nothing of its inside", async () => {
    const { roomId } = await as(AHMED).create(publicRoom());
    expect(await refusal(as(SARA).state({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    await as(SARA).join({ roomId });
    await as(SARA).leave({ roomId });
    expect(await refusal(as(SARA).state({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
  });
});

describe("the host's controls", () => {
  let roomId: string;
  beforeEach(async () => {
    ({ roomId } = await as(AHMED).create(publicRoom()));
    await as(SARA).join({ roomId });
    await as(OMAR).join({ roomId });
  });

  it("a member can do none of them", async () => {
    const sara = as(SARA);
    for (const attempt of [
      sara.update({ roomId, locked: true }),
      sara.update({ roomId, settings: { chat: false } }),
      sara.setMember({ roomId, userId: OMAR, muted: true }),
      sara.setMember({ roomId, userId: OMAR, role: "cohost" }),
      sara.setMember({ roomId, userId: OMAR, grants: { lead: true } }),
      sara.remove({ roomId, userId: OMAR, ban: false }),
      sara.remove({ roomId, userId: OMAR, ban: true }),
      sara.transferHost({ roomId, userId: SARA }),
      sara.end({ roomId }),
    ]) {
      expect(await refusal(attempt)).toMatch(/^FORBIDDEN:/);
    }
    expect(await refusal(sara.rotateInvite({ roomId }))).toMatch(/^FORBIDDEN:/);
    expect((await as(AHMED).state({ roomId })).members).toHaveLength(3);
  });

  it("mute, settings and grants change what a member may do at once", async () => {
    expect((await as(SARA).state({ roomId })).me.can.chat).toBe(true);
    await as(AHMED).update({ roomId, settings: { chat: false } });
    expect((await as(SARA).state({ roomId })).me.can.chat).toBe(false);
    await as(AHMED).setMember({
      roomId,
      userId: SARA,
      grants: { chat: true, speak: true },
    });
    const sara = await as(SARA).state({ roomId });
    expect(sara.me.can).toMatchObject({ chat: true, speak: true });
    expect((await as(OMAR).state({ roomId })).me.can.chat).toBe(false);
    await as(AHMED).setMember({ roomId, userId: SARA, muted: true });
    expect((await as(SARA).state({ roomId })).me.can.speak).toBe(false);
    // Every change moves the room's sequence number on.
    expect(sara.room.seq).toBeGreaterThan(0);
  });

  it("a kicked member may come back; a banned one may not", async () => {
    await as(AHMED).remove({ roomId, userId: SARA, ban: false });
    expect(await refusal(as(SARA).state({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(await refusal(as(SARA).join({ roomId }))).toBe("allowed");

    await as(AHMED).remove({ roomId, userId: OMAR, ban: true });
    expect(await refusal(as(OMAR).join({ roomId }))).toBe(
      "FORBIDDEN:banned_from_room"
    );
    expect((await as(OMAR).preview({ roomId })).banned).toBe(true);
  });

  it("a co-host mutes and kicks members, never the host or another co-host", async () => {
    await as(LAYAN).join({ roomId });
    await as(AHMED).setMember({ roomId, userId: SARA, role: "cohost" });
    await as(AHMED).setMember({ roomId, userId: LAYAN, role: "cohost" });
    const sara = as(SARA);
    expect(
      await refusal(sara.setMember({ roomId, userId: OMAR, muted: true }))
    ).toBe("allowed");
    expect(
      await refusal(sara.remove({ roomId, userId: AHMED, ban: false }))
    ).toBe("FORBIDDEN:cannot_act_on_member");
    expect(
      await refusal(sara.remove({ roomId, userId: LAYAN, ban: false }))
    ).toBe("FORBIDDEN:cannot_act_on_member");
    expect(
      await refusal(sara.remove({ roomId, userId: OMAR, ban: true }))
    ).toBe("FORBIDDEN:not_allowed");
    expect(
      await refusal(sara.remove({ roomId, userId: OMAR, ban: false }))
    ).toBe("allowed");
    expect(await refusal(sara.end({ roomId }))).toBe("FORBIDDEN:not_allowed");
  });

  it("the host hands leadership over, and ends the room for everyone", async () => {
    await as(AHMED).transferHost({ roomId, userId: OMAR });
    expect((await as(OMAR).state({ roomId })).me.role).toBe("host");
    expect((await as(AHMED).state({ roomId })).me.role).toBe("member");
    expect(await refusal(as(AHMED).end({ roomId }))).toBe(
      "FORBIDDEN:not_allowed"
    );
    await as(OMAR).end({ roomId });
    expect(await refusal(as(SARA).state({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(await as(LAYAN).explore()).toEqual([]);
  });
});

describe("blocks, reports and bans", () => {
  it("a blocked student neither sees nor enters the blocker's room", async () => {
    const { roomId } = await as(AHMED).create(publicRoom());
    await test.client.query(
      `INSERT INTO user_blocks ("blockerId", "blockedId") VALUES ($1, $2)`,
      [AHMED, OMAR]
    );
    expect(await as(OMAR).explore()).toEqual([]);
    expect(await refusal(as(OMAR).join({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    // …and the blocker does not see the blocked student's rooms either.
    await as(AHMED).end({ roomId });
    await as(OMAR).create(publicRoom());
    expect(await as(AHMED).explore()).toEqual([]);
    expect((await as(SARA).explore()).length).toBe(1);
  });

  it("three members reporting a public room hide it until an admin looks", async () => {
    const { roomId } = await as(AHMED).create(publicRoom());
    for (const userId of [SARA, LAYAN, OMAR]) await as(userId).join({ roomId });

    expect(await refusal(as(SARA).report({ roomId, reason: "abuse" }))).toBe(
      "allowed"
    );
    expect(await refusal(as(SARA).report({ roomId, reason: "spam" }))).toBe(
      "CONFLICT:already_reported"
    );
    // About a member is a different report.
    expect(
      await refusal(
        as(SARA).report({
          roomId,
          targetUserId: AHMED,
          reason: "abuse",
          details: "<script>x</script>",
        })
      )
    ).toBe("allowed");
    expect(
      await refusal(
        as(SARA).report({ roomId, targetUserId: SARA, reason: "abuse" })
      )
    ).toBe("FORBIDDEN:cannot_act_on_member");
    await as(LAYAN).report({ roomId, reason: "off_topic" });
    await as(LAYAN).leave({ roomId });
    expect((await as(LAYAN).explore()).length).toBe(1);
    await as(OMAR).report({ roomId, reason: "not_female" });

    // Hidden from discovery and from newcomers; still working inside.
    expect(await as(LAYAN).explore()).toEqual([]);
    expect(await refusal(as(LAYAN).join({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(await refusal(as(SARA).state({ roomId }))).toBe("allowed");

    const admin = as(ADMIN, "admin");
    const reports = await admin.adminReports();
    expect(reports).toHaveLength(4);
    // The age and gender reasons come first.
    expect(reports[0].reason).toBe("not_female");
    // The text is stored as text.
    expect(reports.find(report => report.details)?.details).toBe(
      "<script>x</script>"
    );
    expect(await refusal(as(SARA).adminReports())).toMatch(/^FORBIDDEN:/);

    await admin.adminResolve({
      reportId: reports[0].id,
      action: "unhide_room",
    });
    expect((await as(LAYAN).explore()).length).toBe(1);
  });

  it("only someone who was in the room can report it", async () => {
    const { roomId } = await as(AHMED).create(publicRoom());
    expect(await refusal(as(OMAR).report({ roomId, reason: "abuse" }))).toBe(
      "NOT_FOUND:not_available"
    );
  });

  it("an admin's ban takes the student out of every room and keeps them out", async () => {
    const { roomId } = await as(AHMED).create(publicRoom());
    await as(OMAR).join({ roomId });
    const admin = as(ADMIN, "admin");
    await admin.adminBan({ userId: OMAR, days: 7, reason: "abuse" });
    expect((await as(OMAR).me()).banned).toBe(true);
    expect(await refusal(as(OMAR).state({ roomId }))).toBe(
      "NOT_FOUND:not_available"
    );
    expect(await refusal(as(OMAR).join({ roomId }))).toBe(
      "FORBIDDEN:banned_from_rooms"
    );
    expect(await refusal(as(OMAR).create(privateRoom()))).toBe(
      "FORBIDDEN:banned_from_rooms"
    );
    expect(await refusal(as(OMAR).explore())).toBe(
      "FORBIDDEN:banned_from_rooms"
    );

    // A host who is banned: their room ends.
    await admin.adminBan({ userId: AHMED, days: null });
    expect(await refusal(as(SARA).join({ roomId }))).toBe(
      "PRECONDITION_FAILED:room_ended"
    );

    await admin.adminUnban({ userId: OMAR });
    await admin.adminUnban({ userId: AHMED });
    expect((await as(OMAR).me()).banned).toBe(false);
    // An expired ban no longer holds.
    await admin.adminBan({ userId: OMAR, days: 1 });
    await test.client.query(
      `UPDATE study_room_bans SET "until" = now() - interval '1 minute' WHERE "userId" = $1`,
      [OMAR]
    );
    expect((await as(OMAR).me()).banned).toBe(false);
  });
});

describe("no procedure is left without a refusal test", () => {
  it("every rooms procedure refuses while the feature is off", async () => {
    process.env.STUDY_ROOMS_ENABLED = "false";
    const names = Object.keys(roomsRouter._def.procedures).filter(
      name => name !== "enabled"
    );
    expect(names.length).toBeGreaterThan(20);
    const caller = as(ADMIN, "admin") as unknown as Record<
      string,
      (input?: unknown) => Promise<unknown>
    >;
    for (const name of names) {
      const result = await refusal(
        caller[name]({ roomId: id(999), userId: id(998) })
      );
      // Refused by the switch, or by the input schema before it — never run.
      expect(result, name).toMatch(/^(NOT_FOUND:not_available|BAD_REQUEST:)/);
    }
  });
});
