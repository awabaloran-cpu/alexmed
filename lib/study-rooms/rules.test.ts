import { describe, expect, it } from "vitest";
import {
  ageOn,
  audienceOf,
  isValidBirthDate,
  mayEnterRoom,
  mayOpenPublicRoom,
  mayUseSection,
  stageDisagrees,
} from "./age";
import {
  can,
  canActOn,
  DEFAULT_SETTINGS,
  type Actor,
  type RoomAction,
} from "./permissions";
import { normalizeKey, subjectMatches, titleIsAllowed } from "./text";

const TODAY = new Date("2026-10-10T12:00:00Z");

describe("age groups", () => {
  it("counts whole years to the day", () => {
    expect(ageOn("2008-10-10", TODAY)).toBe(18);
    expect(ageOn("2008-10-11", TODAY)).toBe(17);
    expect(ageOn("2000-01-01", TODAY)).toBe(26);
  });

  it("turning 18 today is an adult today; one day short is not", () => {
    expect(audienceOf({ birthDate: "2008-10-10" }, TODAY)).toBe("adult");
    expect(audienceOf({ birthDate: "2008-10-11" }, TODAY)).toBe("minor");
  });

  it("no date of birth is the most restricted group", () => {
    expect(audienceOf(null, TODAY)).toBe("minor");
    expect(audienceOf({ birthDate: null }, TODAY)).toBe("minor");
  });

  it("refuses impossible and implausible dates", () => {
    expect(isValidBirthDate("2005-03-14", TODAY)).toBe(true);
    expect(isValidBirthDate("2005-02-31", TODAY)).toBe(false);
    expect(isValidBirthDate("14/03/2005", TODAY)).toBe(false);
    expect(isValidBirthDate("2022-01-01", TODAY)).toBe(false); // 4 years old
    expect(isValidBirthDate("1900-01-01", TODAY)).toBe(false);
    expect(isValidBirthDate("2030-01-01", TODAY)).toBe(false);
  });

  it("flags a stage that does not fit the age", () => {
    expect(stageDisagrees("2012-01-01", "university", TODAY)).toBe(true);
    expect(stageDisagrees("2000-01-01", "high_school", TODAY)).toBe(true);
    expect(stageDisagrees("2005-01-01", "university", TODAY)).toBe(false);
    expect(stageDisagrees("2010-01-01", "high_school", TODAY)).toBe(false);
  });

  const university = { audience: "adult", publicRooms: true };
  const highSchool = { audience: "minor", publicRooms: false };

  it("a section is for one group only", () => {
    expect(mayUseSection("adult", university)).toBe(true);
    expect(mayUseSection("adult", highSchool)).toBe(false);
    expect(mayUseSection("minor", highSchool)).toBe(true);
    expect(mayUseSection("minor", university)).toBe(false);
  });

  it("public rooms: adults in a section that has them, nobody else", () => {
    expect(mayOpenPublicRoom("adult", university)).toBe(true);
    expect(mayOpenPublicRoom("minor", university)).toBe(false);
    expect(mayOpenPublicRoom("minor", highSchool)).toBe(false);
    expect(mayOpenPublicRoom("adult", highSchool)).toBe(false);
    // Even if a minor section were ever given public rooms by mistake.
    expect(
      mayOpenPublicRoom("minor", { audience: "minor", publicRooms: true })
    ).toBe(false);
  });

  it("the two groups never share a room", () => {
    expect(mayEnterRoom("adult", { audience: "adult" })).toBe(true);
    expect(mayEnterRoom("minor", { audience: "minor" })).toBe(true);
    expect(mayEnterRoom("adult", { audience: "minor" })).toBe(false);
    expect(mayEnterRoom("minor", { audience: "adult" })).toBe(false);
  });
});

describe("search keys", () => {
  it("one key for the spellings students actually type", () => {
    expect(normalizeKey("جامعة الإسكندريّة ")).toBe(
      normalizeKey("جامعه الاسكندرية")
    );
    expect(normalizeKey("  Pharmacology—Renal  ")).toBe("pharmacology renal");
    expect(normalizeKey("مُستشفى")).toBe("مستشفي");
  });

  const pharma = {
    nameEn: "Pharmacology",
    nameAr: "علم الأدوية",
    aliases: ["pharmacology", "علم الادويه", "فارما", "pharma"],
  };

  it("finds a subject by its name, its Arabic name or an alias", () => {
    for (const query of [
      "pharm",
      "Pharmacology",
      "فارما",
      "علم الأدويه",
      "الادويه",
      "",
    ]) {
      expect(subjectMatches(pharma, query), query).toBe(true);
    }
    expect(subjectMatches(pharma, "anatomy")).toBe(false);
  });

  it("keeps the worst words out of public titles", () => {
    expect(titleIsAllowed("أدوية الكلى قبل الميدتيرم")).toBe(true);
    expect(titleIsAllowed("Sexual reproduction — biology")).toBe(true);
    expect(titleIsAllowed("free porn")).toBe(false);
    expect(titleIsAllowed("سِكس")).toBe(false);
  });
});

describe("what a member may do", () => {
  const open = DEFAULT_SETTINGS.private;
  const strict = {
    ...DEFAULT_SETTINGS.public,
    freeNav: false,
    marks: false,
    chat: false,
    speak: "host" as const,
    quizStart: "host" as const,
  };
  const actor = (
    role: Actor["role"],
    grants: Actor["grants"] = {},
    muted = false
  ): Actor => ({
    role,
    grants,
    mutedByHost: muted,
  });
  const allowed = (who: Actor, settings: typeof open, actions: RoomAction[]) =>
    actions.filter(action => can(who, settings, action));

  const HOST_ONLY: RoomAction[] = [
    "ban_member",
    "edit_room",
    "manage_roles",
    "end_room",
  ];
  const STAFF: RoomAction[] = [
    "delete_any_mark",
    "delete_any_message",
    "mute_member",
    "kick_member",
  ];
  const EVERY: RoomAction[] = [
    "read",
    "free_nav",
    "lead_page",
    "mark",
    "delete_any_mark",
    "chat",
    "delete_any_message",
    "speak",
    "mute_member",
    "kick_member",
    "ban_member",
    "edit_room",
    "manage_roles",
    "end_room",
    "start_quiz",
    "invite",
    "report",
  ];

  it("the host may do everything, whatever the settings", () => {
    expect(allowed(actor("host"), strict, EVERY)).toEqual(EVERY);
  });

  it("a member in an open private room: studies, and nothing of the host's", () => {
    expect(allowed(actor("member"), open, EVERY)).toEqual([
      "read",
      "free_nav",
      "mark",
      "chat",
      "speak",
      "report",
    ]);
  });

  it("a member in a strict room: reads and reports only", () => {
    expect(allowed(actor("member"), strict, EVERY)).toEqual(["read", "report"]);
  });

  it("a public room starts with speaking by request", () => {
    expect(can(actor("member"), DEFAULT_SETTINGS.public, "speak")).toBe(false);
    expect(can(actor("member"), DEFAULT_SETTINGS.public, "chat")).toBe(true);
  });

  it("a co-host moderates but never owns the room", () => {
    const cohost = actor("cohost");
    expect(allowed(cohost, strict, STAFF)).toEqual(STAFF);
    expect(allowed(cohost, strict, HOST_ONLY)).toEqual([]);
    expect(can(cohost, strict, "lead_page")).toBe(false);
    expect(can(cohost, strict, "start_quiz")).toBe(false);
    expect(can(cohost, open, "start_quiz")).toBe(true);
    expect(can(cohost, strict, "invite")).toBe(true);
  });

  it("a grant overrides the room for one member, both ways", () => {
    expect(can(actor("member", { chat: true }), strict, "chat")).toBe(true);
    expect(can(actor("member", { chat: false }), open, "chat")).toBe(false);
    expect(can(actor("member", { mark: false }), open, "mark")).toBe(false);
    expect(can(actor("member", { speak: true }), strict, "speak")).toBe(true);
    expect(can(actor("member", { lead: true }), strict, "lead_page")).toBe(
      true
    );
    // A grant never reaches the host's or the staff's powers.
    const generous = actor("member", {
      chat: true,
      mark: true,
      speak: true,
      lead: true,
    });
    expect(allowed(generous, open, [...HOST_ONLY, ...STAFF])).toEqual([]);
  });

  it("a host's mute holds over the setting and over a grant", () => {
    expect(can(actor("member", {}, true), open, "speak")).toBe(false);
    expect(can(actor("member", { speak: true }, true), open, "speak")).toBe(
      false
    );
    expect(can(actor("cohost", {}, true), open, "speak")).toBe(false);
    expect(can(actor("host", {}, true), open, "speak")).toBe(true);
  });

  it("nobody acts on the host; a co-host acts on members only", () => {
    expect(canActOn(actor("host"), { role: "cohost" })).toBe(true);
    expect(canActOn(actor("host"), { role: "member" })).toBe(true);
    expect(canActOn(actor("cohost"), { role: "member" })).toBe(true);
    expect(canActOn(actor("cohost"), { role: "cohost" })).toBe(false);
    expect(canActOn(actor("cohost"), { role: "host" })).toBe(false);
    expect(canActOn(actor("member"), { role: "member" })).toBe(false);
    expect(canActOn(actor("host"), { role: "host" })).toBe(false);
  });
});
