// The Discover catalogue: that its first shelves are sound, that the page
// is what the sections table says, one language at a time, and that a
// room can play one of its quizzes with the server as the judge.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import {
  createTestDb,
  insertUser,
  type TestDb,
} from "../test-fixtures/pglite-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));

import { discoverRouter } from "../trpc/discoverRouter";
import { roomsRouter } from "../trpc/roomsRouter";
import { DISCOVER_CATEGORIES, pickQuizzes } from "./data";
import {
  SEED_CHANNELS,
  SEED_QUIZZES,
  SEED_SECTIONS,
  seedDiscover,
} from "./seed";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AHMED = id(1);
const SARA = id(2);

let test: TestDb;
let medicine: string;

const ctx = (userId: string) =>
  ({
    user: { id: userId, role: "user", email: `${userId}@x.test`, name: null },
  }) as unknown as { user: User };
const discover = (userId: string) =>
  discoverRouter.createCaller(ctx(userId) as never);
const rooms = (userId: string) =>
  roomsRouter.createCaller(ctx(userId) as never);

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof TRPCError) return `${error.code}:${error.message}`;
    throw error;
  }
  return "allowed";
}

const ARABIC = /\p{Script=Arabic}/u;
// A name this product never carries, in either script — spelled letter by
// letter so that not even this file contains it.
const FORBIDDEN = new RegExp(
  [
    ["k", "a", "h", "o", "o", "t"].join("\\s*"),
    ["ك", "ا", "ه", "و", "ت"].join(""),
  ].join("|"),
  "i"
);

describe("the first shelves", () => {
  const of = (language: string) =>
    SEED_QUIZZES.filter(entry => entry.language === language);

  it("are twenty quizzes a language, across the six subjects", () => {
    for (const language of ["ar", "en"]) {
      expect(of(language).length).toBeGreaterThanOrEqual(20);
      for (const category of DISCOVER_CATEGORIES) {
        expect(
          of(language).some(entry => entry.quiz.category === category)
        ).toBe(true);
      }
    }
  });

  it("each has 8 to 15 questions, four different options and one right answer", () => {
    for (const { quiz } of SEED_QUIZZES) {
      expect(quiz.questions.length, quiz.slug).toBeGreaterThanOrEqual(8);
      expect(quiz.questions.length, quiz.slug).toBeLessThanOrEqual(15);
      for (const question of quiz.questions) {
        expect(question.o.length, question.q).toBe(4);
        expect(new Set(question.o).size, question.q).toBe(4);
        expect(question.a, question.q).toBeGreaterThanOrEqual(0);
        expect(question.a, question.q).toBeLessThan(4);
        expect(question.q.trim().length).toBeGreaterThan(5);
      }
      // No question twice in one quiz.
      expect(new Set(quiz.questions.map(q => q.q)).size).toBe(
        quiz.questions.length
      );
    }
  });

  it("the right answer is not always in the same place", () => {
    for (const { quiz } of SEED_QUIZZES) {
      expect(
        new Set(quiz.questions.map(q => q.a)).size,
        quiz.slug
      ).toBeGreaterThan(1);
    }
  });

  it("are written in their own language", () => {
    for (const { language, quiz } of SEED_QUIZZES) {
      expect(quiz.slug.startsWith(`${language}-`), quiz.slug).toBe(true);
      for (const text of [quiz.title, quiz.description]) {
        expect(ARABIC.test(text), text).toBe(language === "ar");
      }
      for (const question of quiz.questions) {
        expect(ARABIC.test(question.q), question.q).toBe(language === "ar");
      }
    }
  });

  it("have unique slugs, a channel of their language, and a known subject", () => {
    const slugs = SEED_QUIZZES.map(entry => entry.quiz.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const { language, quiz } of SEED_QUIZZES) {
      const channel = SEED_CHANNELS.find(row => row.slug === quiz.channel);
      expect(channel?.language, quiz.slug).toBe(language);
      expect(DISCOVER_CATEGORIES).toContain(quiz.category);
      expect(quiz.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("never carry another product's name", () => {
    const everything = JSON.stringify([
      SEED_QUIZZES,
      SEED_CHANNELS,
      SEED_SECTIONS,
    ]);
    expect(FORBIDDEN.test(everything)).toBe(false);
  });

  it("every section points at something that exists", () => {
    const slugs = new Set(SEED_QUIZZES.map(entry => entry.quiz.slug));
    const channels = new Set(SEED_CHANNELS.map(channel => channel.slug));
    for (const section of SEED_SECTIONS) {
      for (const banner of section.filter.banners ?? []) {
        if (banner.quizSlug) expect(slugs.has(banner.quizSlug)).toBe(true);
        if (banner.channelSlug) {
          expect(channels.has(banner.channelSlug)).toBe(true);
        }
      }
      if (section.filter.channelSlug) {
        expect(channels.has(section.filter.channelSlug)).toBe(true);
      }
    }
  });
});

describe("what fills a section", () => {
  const quiz = (
    slug: string,
    over: Partial<{
      category: string;
      tags: string[];
      channelId: string | null;
      playsCount: number;
      createdAt: Date;
    }> = {}
  ) => ({
    slug,
    category: "general",
    tags: [] as string[],
    channelId: null as string | null,
    playsCount: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
  });
  const all = [
    quiz("a", { category: "science", playsCount: 3, channelId: "c1" }),
    quiz("b", { tags: ["occ:school"], playsCount: 9 }),
    quiz("c", { category: "science", createdAt: new Date("2026-10-05") }),
  ];
  const slugs = (rows: { slug: string }[]) => rows.map(row => row.slug);

  it("is by subject, tag, channel or a named list", () => {
    expect(slugs(pickQuizzes(all, { category: "science" }))).toEqual([
      "a",
      "c",
    ]);
    expect(slugs(pickQuizzes(all, { tag: "occ:school" }))).toEqual(["b"]);
    expect(slugs(pickQuizzes(all, { channelSlug: "x" }, "c1"))).toEqual(["a"]);
    expect(slugs(pickQuizzes(all, { quizSlugs: ["c", "a"] }))).toEqual([
      "c",
      "a",
    ]);
  });

  it("a channel that is not there fills nothing", () => {
    expect(pickQuizzes(all, { channelSlug: "gone" }, undefined)).toEqual([]);
  });

  it("is sorted by plays or by date, and never longer than its limit", () => {
    expect(slugs(pickQuizzes(all, { sort: "popular" }))).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(slugs(pickQuizzes(all, { sort: "newest", limit: 1 }))).toEqual([
      "c",
    ]);
    expect(pickQuizzes(all, { limit: 999 }).length).toBe(3);
  });
});

describe("the catalogue on a real database", () => {
  beforeAll(async () => {
    test = await createTestDb();
    holder.db = test.db;
    await insertUser(test.client, { id: AHMED, name: "أحمد" });
    await insertUser(test.client, { id: SARA, name: "سارة" });
    await seedDiscover(test.db as never);
    process.env.STUDY_ROOMS_ENABLED = "true";
    const adult = new Date();
    adult.setUTCFullYear(adult.getUTCFullYear() - 22);
    for (const userId of [AHMED, SARA]) {
      await rooms(userId).setProfile({
        birthDate: adult.toISOString().slice(0, 10),
        stage: "university",
        gender: "male",
        country: "EG",
      });
      await rooms(userId).setProfile({ acceptRules: true });
    }
    const sections = await test.client.query<{ id: string; key: string }>(
      `SELECT id, key FROM study_sections`
    );
    medicine = sections.rows.find(row => row.key === "medicine")!.id;
  }, 120_000);

  it("seeding twice changes nothing", async () => {
    await test.client.query(
      `UPDATE discover_quizzes SET "playsCount" = 7 WHERE slug = 'ar-science-space'`
    );
    await seedDiscover(test.db as never);
    const counts = await test.client.query<{ q: number; n: number; p: number }>(
      `SELECT (SELECT count(*)::int FROM discover_quizzes) AS q,
              (SELECT count(*)::int FROM discover_questions) AS n,
              (SELECT "playsCount" FROM discover_quizzes WHERE slug = 'ar-science-space') AS p`
    );
    expect(counts.rows[0].q).toBe(SEED_QUIZZES.length);
    expect(counts.rows[0].n).toBe(
      SEED_QUIZZES.reduce((sum, entry) => sum + entry.quiz.questions.length, 0)
    );
    // The plays are the students', not the seed's.
    expect(counts.rows[0].p).toBe(7);
  });

  it("the page is the sections, in order, in one language only", async () => {
    for (const language of ["ar", "en"] as const) {
      const page = await discover(AHMED).page({ language });
      expect(page.blocks.map(block => block.type)).toEqual([
        "banner",
        "partners",
        "ranked_list",
        "featured_collections",
        "learn_cards",
        "channel_block",
        "horizontal_cards",
        "channel_block",
        "horizontal_cards",
      ]);
      const text = JSON.stringify(page.blocks);
      expect(text.includes(`"${language === "ar" ? "en" : "ar"}-`)).toBe(false);
      expect(page.filters.channels.length).toBe(3);
      expect(page.filters.occasions).toEqual([
        "occ:earth",
        "occ:school",
        "occ:worldcup",
      ]);
      const ranked = page.blocks.find(block => block.type === "ranked_list");
      expect(ranked && "quizzes" in ranked && ranked.quizzes.length).toBe(9);
    }
    // The most played leads "picked for you".
    const arabic = await discover(AHMED).page({ language: "ar" });
    const ranked = arabic.blocks.find(block => block.type === "ranked_list");
    expect(ranked && "quizzes" in ranked && ranked.quizzes[0].slug).toBe(
      "ar-science-space"
    );
  });

  it("a section switched off, or of a kind this build does not know, is left out", async () => {
    await test.client.exec(
      `UPDATE discover_sections SET "isActive" = false WHERE key = 'history';
       UPDATE discover_sections SET type = 'hologram' WHERE key = 'recommended'`
    );
    const page = await discover(AHMED).page({ language: "ar" });
    expect(page.blocks.map(block => block.key)).not.toContain("history");
    expect(page.blocks.map(block => block.key)).not.toContain("recommended");
    await test.client.exec(
      `UPDATE discover_sections SET "isActive" = true WHERE key = 'history';
       UPDATE discover_sections SET type = 'horizontal_cards' WHERE key = 'recommended'`
    );
  });

  it("a card never carries an internal id or an answer", async () => {
    const page = await discover(AHMED).page({ language: "en" });
    const text = JSON.stringify(page);
    expect(text).not.toMatch(/"(id|channelId|correctIndex)"/);
  });

  it("search is by title, creator or tag, inside the language", async () => {
    const space = await discover(AHMED).search({
      language: "ar",
      query: "الفضاء",
    });
    expect(space.map(quiz => quiz.slug)).toEqual(["ar-science-space"]);
    expect(
      (await discover(AHMED).search({ language: "en", query: "الفضاء" })).length
    ).toBe(0);
    const school = await discover(AHMED).search({
      language: "en",
      tag: "occ:school",
    });
    expect(school.length).toBe(2);
    const sports = await discover(AHMED).search({
      language: "en",
      category: "sports",
    });
    expect(sports.every(quiz => quiz.category === "sports")).toBe(true);
    expect(
      await discover(AHMED).search({ language: "en", query: "%" })
    ).toEqual([]);
    // A subject this build has no name for is searched like any other.
    expect(
      await discover(AHMED).search({ language: "en", category: "poetry" })
    ).toEqual([]);
  });

  it("a quiz's sheet and its questions; a quiz that is off is not found", async () => {
    const quiz = await discover(AHMED).quiz({ slug: "en-science-space" });
    expect(quiz.channel?.slug).toBe("en-curiosity");
    expect(quiz.tags).toEqual(["science", "space"]);
    const learn = await discover(AHMED).questions({ slug: "en-science-space" });
    expect(learn.questions.length).toBe(8);
    expect(learn.questions[0].options.length).toBe(4);
    // Nothing that could be matched to a question of a room's game.
    expect(Object.keys(learn.questions[0]).sort()).toEqual(
      ["correctIndex", "image", "key", "options", "text"].sort()
    );
    await test.client.query(
      `UPDATE discover_quizzes SET "isActive" = false WHERE slug = 'en-sports-olympics'`
    );
    for (const call of [
      discover(AHMED).quiz({ slug: "en-sports-olympics" }),
      discover(AHMED).questions({ slug: "en-sports-olympics" }),
      discover(AHMED).quiz({ slug: "no-such-quiz" }),
    ]) {
      expect(await refusal(call)).toBe("NOT_FOUND:not_found");
    }
    await test.client.query(
      `UPDATE discover_quizzes SET "isActive" = true WHERE slug = 'en-sports-olympics'`
    );
  });

  it("a play is counted once in a while per student", async () => {
    const before = (await discover(AHMED).quiz({ slug: "en-geo-continents" }))
      .playsCount;
    expect(
      (await discover(AHMED).played({ slug: "en-geo-continents" })).counted
    ).toBe(true);
    expect(
      (await discover(AHMED).played({ slug: "en-geo-continents" })).counted
    ).toBe(false);
    expect(
      (await discover(SARA).played({ slug: "en-geo-continents" })).counted
    ).toBe(true);
    expect(
      (await discover(AHMED).quiz({ slug: "en-geo-continents" })).playsCount
    ).toBe(before + 2);
  });

  it("a play of a quiz that does not exist is not counted, or remembered", async () => {
    expect(
      (await discover(AHMED).played({ slug: "no-such-quiz" })).counted
    ).toBe(false);
  });

  it("following a channel is one's own, once, and can be undone", async () => {
    await discover(AHMED).follow({ slug: "ar-atlas", follow: true });
    await discover(AHMED).follow({ slug: "ar-atlas", follow: true });
    expect(
      (await discover(AHMED).channel({ slug: "ar-atlas" })).followers
    ).toBe(1);
    expect(
      (await discover(AHMED).channel({ slug: "ar-atlas" })).following
    ).toBe(true);
    expect((await discover(SARA).channel({ slug: "ar-atlas" })).following).toBe(
      false
    );
    await discover(AHMED).follow({ slug: "ar-atlas", follow: false });
    const channel = await discover(AHMED).channel({ slug: "ar-atlas" });
    expect(channel.followers).toBe(0);
    expect(channel.quizzes.length).toBe(7);
    expect(channel.featured.length).toBe(4);
    expect(
      await refusal(
        discover(AHMED).follow({ slug: "no-channel", follow: true })
      )
    ).toBe("NOT_FOUND:not_found");
  });

  it("a room plays a catalogue quiz: the answer stays on the server until the reveal", async () => {
    const room = await rooms(AHMED).create({
      visibility: "private",
      title: "لعبة المعلومات العامة",
      sectionId: medicine,
    });
    expect(
      await refusal(
        rooms(AHMED).startCatalogQuiz({ roomId: room.roomId, slug: "no-quiz" })
      )
    ).toBe("NOT_FOUND:quiz_not_found");
    const started = await rooms(AHMED).startCatalogQuiz({
      roomId: room.roomId,
      slug: "ar-science-space",
      seconds: 20,
    });
    expect(started.questions).toBe(8);
    const current = await rooms(AHMED).quizCurrent({ roomId: room.roomId });
    expect(current?.question.text).toBe("ما أقرب الكواكب إلى الشمس؟");
    expect(current?.question.options.length).toBe(4);
    expect(current && "correctIndex" in current).toBe(false);

    // While the game runs, the study screens of this very quiz are shut to
    // the players — they are its answer sheet. Another quiz is not.
    expect(
      await refusal(discover(AHMED).questions({ slug: "ar-science-space" }))
    ).toBe("PRECONDITION_FAILED:playing");
    expect(
      (await discover(AHMED).questions({ slug: "ar-science-physics" }))
        .questions.length
    ).toBe(8);
    // Someone who is not in the room is studying, not playing.
    expect(
      (await discover(SARA).questions({ slug: "ar-science-space" })).questions
        .length
    ).toBe(8);

    // The catalogue reseeded in the middle of the game: the questions keep
    // their ids, so the game goes on.
    await seedDiscover(test.db as never);
    const after = await rooms(AHMED).quizCurrent({ roomId: room.roomId });
    expect(after?.question.id).toBe(current!.question.id);
    expect(after?.question.text).toBe(current!.question.text);

    // Right (index 1), and one answer only.
    await rooms(AHMED).quizAnswer({
      quizId: started.quizId,
      questionId: current!.question.id,
      selectedIndex: 1,
    });
    // Everyone in the room has answered: the answer is shown, and the
    // question takes no more answers.
    const revealed = await rooms(AHMED).quizCurrent({ roomId: room.roomId });
    expect(revealed?.state).toBe("reveal");
    expect(
      revealed && "correctIndex" in revealed && revealed.correctIndex
    ).toBe(1);
    expect(
      await refusal(
        rooms(AHMED).quizAnswer({
          quizId: started.quizId,
          questionId: current!.question.id,
          selectedIndex: 0,
        })
      )
    ).toBe("PRECONDITION_FAILED:quiz_closed");
    const row = await test.client.query<{ isCorrect: boolean; points: number }>(
      `SELECT "isCorrect", points FROM study_room_quiz_answers`
    );
    expect(row.rows[0].isCorrect).toBe(true);
    expect(row.rows[0].points).toBeGreaterThanOrEqual(100);
    // Starting it counted a play.
    const plays = await test.client.query<{ n: number }>(
      `SELECT "playsCount" AS n FROM discover_quizzes WHERE slug = 'ar-science-space'`
    );
    expect(plays.rows[0].n).toBe(8);
    // A second quiz cannot start over a running one.
    expect(
      await refusal(
        rooms(AHMED).startCatalogQuiz({
          roomId: room.roomId,
          slug: "ar-general-start",
        })
      )
    ).toBe("CONFLICT:quiz_running");
  });

  it("only someone who may start a quiz starts one", async () => {
    expect(
      await refusal(
        rooms(SARA).startCatalogQuiz({
          roomId: id(404),
          slug: "ar-general-start",
        })
      )
    ).toBe("NOT_FOUND:not_available");
  });
});
