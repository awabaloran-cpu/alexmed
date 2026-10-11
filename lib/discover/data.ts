// 🧭 Discover — what the page, a quiz's sheet, a channel and the two
// self-study modes read. Everything is one language at a time: a row of
// the other language is never mixed in, whatever is asked for.
//
// The page is assembled here, on the server, from `discover_sections`:
// which blocks, in what order, filled with what. Changing a row changes
// the page for everyone without a new build.
import { and, asc, count, eq, sql } from "drizzle-orm";
import {
  discoverChannelFollows,
  discoverChannels,
  discoverQuestions,
  discoverQuizzes,
  discoverSections,
  type DiscoverSectionFilter,
} from "../../drizzle/schema";
import { requireDb } from "../db";

export type DiscoverLanguage = "ar" | "en";
export const DISCOVER_CATEGORIES = [
  "general",
  "geography",
  "history",
  "science",
  "animals",
  "sports",
] as const;
export type DiscoverCategory = (typeof DISCOVER_CATEGORIES)[number];
// A tag that names an occasion ("occ:school") rather than a subject.
export const OCCASION_PREFIX = "occ:";
export const SEARCH_LIMIT = 30;
const SECTION_LIMIT = 12;

const quizCard = {
  slug: discoverQuizzes.slug,
  title: discoverQuizzes.title,
  coverImage: discoverQuizzes.coverImage,
  art: discoverQuizzes.art,
  color: discoverQuizzes.color,
  category: discoverQuizzes.category,
  tags: discoverQuizzes.tags,
  isFree: discoverQuizzes.isFree,
  channelId: discoverQuizzes.channelId,
  creatorName: discoverQuizzes.creatorName,
  creatorVerified: discoverQuizzes.creatorVerified,
  playsCount: discoverQuizzes.playsCount,
  questionsCount: discoverQuizzes.questionsCount,
  createdAt: discoverQuizzes.createdAt,
};

async function allQuizzes(language: DiscoverLanguage) {
  return requireDb()
    .select(quizCard)
    .from(discoverQuizzes)
    .where(
      and(
        eq(discoverQuizzes.language, language),
        eq(discoverQuizzes.isActive, true)
      )
    )
    .orderBy(asc(discoverQuizzes.createdAt), asc(discoverQuizzes.slug));
}
type QuizRow = Awaited<ReturnType<typeof allQuizzes>>[number];

async function allChannels(language: DiscoverLanguage) {
  return requireDb()
    .select({
      id: discoverChannels.id,
      slug: discoverChannels.slug,
      name: discoverChannels.name,
      description: discoverChannels.description,
      logo: discoverChannels.logo,
      cover: discoverChannels.cover,
      art: discoverChannels.art,
      color: discoverChannels.color,
      verified: discoverChannels.verified,
    })
    .from(discoverChannels)
    .where(
      and(
        eq(discoverChannels.language, language),
        eq(discoverChannels.isActive, true)
      )
    )
    .orderBy(asc(discoverChannels.orderIndex));
}
type ChannelRow = Awaited<ReturnType<typeof allChannels>>[number];

// What a card shows — never the internal ids.
const card = (quiz: QuizRow, channels: ChannelRow[]) => ({
  slug: quiz.slug,
  title: quiz.title,
  coverImage: quiz.coverImage,
  art: quiz.art,
  color: quiz.color,
  category: quiz.category,
  isFree: quiz.isFree,
  creatorName: quiz.creatorName,
  creatorVerified: quiz.creatorVerified,
  playsCount: quiz.playsCount,
  questionsCount: quiz.questionsCount,
  channelSlug:
    channels.find(channel => channel.id === quiz.channelId)?.slug ?? null,
});
export type DiscoverCard = ReturnType<typeof card>;

const channelCard = (channel: ChannelRow, quizzes: QuizRow[]) => ({
  slug: channel.slug,
  name: channel.name,
  description: channel.description,
  logo: channel.logo,
  cover: channel.cover,
  art: channel.art,
  color: channel.color,
  verified: channel.verified,
  quizzesCount: quizzes.filter(quiz => quiz.channelId === channel.id).length,
});
export type DiscoverChannelCard = ReturnType<typeof channelCard>;

type BlockBase = { key: string; title: string; subtitle: string };
// One block of the page, as the screen draws it.
export type DiscoverBlock = BlockBase &
  (
    | {
        type: "banner";
        banners: NonNullable<DiscoverSectionFilter["banners"]>;
      }
    | { type: "partners"; channels: DiscoverChannelCard[] }
    | {
        type: "featured_collections";
        collections: {
          category: string;
          art: string;
          color: string;
          count: number;
        }[];
      }
    | {
        type: "channel_block";
        channel: DiscoverChannelCard;
        quizzes: DiscoverCard[];
      }
    | {
        type: "ranked_list" | "horizontal_cards" | "learn_cards";
        quizzes: DiscoverCard[];
      }
  );

// The quizzes a section's filter names (pure: unit-tested).
export function pickQuizzes<
  T extends {
    slug: string;
    category: string;
    tags: string[];
    channelId: string | null;
    playsCount: number;
    createdAt: Date;
  },
>(quizzes: T[], filter: DiscoverSectionFilter, channelId?: string | null): T[] {
  let picked = quizzes;
  if (filter.quizSlugs?.length) {
    const order = filter.quizSlugs;
    picked = picked
      .filter(quiz => order.includes(quiz.slug))
      .sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
  }
  if (filter.category) {
    picked = picked.filter(quiz => quiz.category === filter.category);
  }
  if (filter.tag) {
    const tag = filter.tag;
    picked = picked.filter(quiz => quiz.tags.includes(tag));
  }
  if (filter.channelSlug) {
    picked = channelId
      ? picked.filter(quiz => quiz.channelId === channelId)
      : [];
  }
  if (filter.sort === "popular") {
    // Stable: quizzes nobody has played yet keep the catalogue's order.
    picked = [...picked].sort((a, b) => b.playsCount - a.playsCount);
  } else if (filter.sort === "newest") {
    picked = [...picked].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }
  return picked.slice(0, Math.min(filter.limit ?? SECTION_LIMIT, 24));
}

export async function discoverPage(language: DiscoverLanguage) {
  const db = requireDb();
  const [quizzes, channels, sections] = await Promise.all([
    allQuizzes(language),
    allChannels(language),
    db
      .select()
      .from(discoverSections)
      .where(
        and(
          eq(discoverSections.isActive, true),
          sql`(${discoverSections.language} is null or ${discoverSections.language} = ${language})`
        )
      )
      .orderBy(asc(discoverSections.orderIndex), asc(discoverSections.key)),
  ]);
  const channelBySlug = (slug?: string) =>
    channels.find(channel => channel.slug === slug);
  const quizBySlug = (slug?: string) =>
    quizzes.find(quiz => quiz.slug === slug);

  const blocks = sections.flatMap((section): DiscoverBlock[] => {
    const base = {
      key: section.key,
      title: language === "ar" ? section.titleAr : section.titleEn,
      subtitle: language === "ar" ? section.subtitleAr : section.subtitleEn,
    };
    const filter = section.filter;
    switch (section.type) {
      case "banner": {
        // A banner that points at something gone is not shown.
        const banners = (filter.banners ?? []).filter(
          banner =>
            (!banner.quizSlug || quizBySlug(banner.quizSlug)) &&
            (!banner.channelSlug || channelBySlug(banner.channelSlug))
        );
        return banners.length
          ? [{ ...base, type: "banner" as const, banners }]
          : [];
      }
      case "partners": {
        const items = channels.map(channel => channelCard(channel, quizzes));
        return items.length
          ? [{ ...base, type: "partners" as const, channels: items }]
          : [];
      }
      case "featured_collections": {
        const collections = (filter.collections ?? [])
          .map(collection => ({
            ...collection,
            count: quizzes.filter(quiz => quiz.category === collection.category)
              .length,
          }))
          .filter(collection => collection.count > 0);
        return collections.length
          ? [{ ...base, type: "featured_collections" as const, collections }]
          : [];
      }
      case "channel_block": {
        const channel = channelBySlug(filter.channelSlug);
        if (!channel) return [];
        const items = pickQuizzes(quizzes, filter, channel.id);
        return items.length
          ? [
              {
                ...base,
                type: "channel_block" as const,
                channel: channelCard(channel, quizzes),
                quizzes: items.map(quiz => card(quiz, channels)),
              },
            ]
          : [];
      }
      case "ranked_list":
      case "horizontal_cards":
      case "learn_cards": {
        const items = pickQuizzes(
          quizzes,
          filter,
          channelBySlug(filter.channelSlug)?.id
        );
        return items.length
          ? [
              {
                ...base,
                type: section.type,
                quizzes: items.map(quiz => card(quiz, channels)),
              },
            ]
          : [];
      }
      default:
        // A type this build does not know is skipped, not an error: the
        // sections table may run ahead of the code.
        return [];
    }
  });

  const occasions = [
    ...new Set(
      quizzes.flatMap(quiz =>
        quiz.tags.filter(tag => tag.startsWith(OCCASION_PREFIX))
      )
    ),
  ].sort();
  return {
    language,
    blocks,
    filters: {
      channels: channels.map(channel => ({
        slug: channel.slug,
        name: channel.name,
      })),
      occasions,
    },
  };
}

export async function searchQuizzes(
  language: DiscoverLanguage,
  input: { query?: string; category?: string; tag?: string }
) {
  const [quizzes, channels] = await Promise.all([
    allQuizzes(language),
    allChannels(language),
  ]);
  const wanted = (input.query ?? "").trim().toLowerCase();
  return quizzes
    .filter(
      quiz =>
        (!input.category || quiz.category === input.category) &&
        (!input.tag || quiz.tags.includes(input.tag)) &&
        (!wanted ||
          quiz.title.toLowerCase().includes(wanted) ||
          quiz.creatorName.toLowerCase().includes(wanted) ||
          quiz.tags.some(tag => tag.toLowerCase().includes(wanted)))
    )
    .slice(0, SEARCH_LIMIT)
    .map(quiz => card(quiz, channels));
}

async function quizBySlug(slug: string) {
  const [quiz] = await requireDb()
    .select()
    .from(discoverQuizzes)
    .where(
      and(eq(discoverQuizzes.slug, slug), eq(discoverQuizzes.isActive, true))
    )
    .limit(1);
  return quiz ?? null;
}

export async function quizDetail(slug: string) {
  const quiz = await quizBySlug(slug);
  if (!quiz) return null;
  const [channel] = quiz.channelId
    ? await requireDb()
        .select({
          slug: discoverChannels.slug,
          name: discoverChannels.name,
          art: discoverChannels.art,
          color: discoverChannels.color,
          logo: discoverChannels.logo,
        })
        .from(discoverChannels)
        .where(
          and(
            eq(discoverChannels.id, quiz.channelId),
            eq(discoverChannels.isActive, true)
          )
        )
        .limit(1)
    : [];
  return {
    slug: quiz.slug,
    language: quiz.language as DiscoverLanguage,
    title: quiz.title,
    description: quiz.description,
    coverImage: quiz.coverImage,
    art: quiz.art,
    color: quiz.color,
    category: quiz.category,
    tags: quiz.tags.filter(tag => !tag.startsWith(OCCASION_PREFIX)),
    isFree: quiz.isFree,
    creatorName: quiz.creatorName,
    creatorVerified: quiz.creatorVerified,
    playsCount: quiz.playsCount,
    questionsCount: quiz.questionsCount,
    channel: channel ?? null,
  };
}

// The questions with their answers: self-study is judged on the student's
// own screen (there is nobody to race). The game in a room never uses
// this — there the answer stays on the server (lib/study-rooms/quiz.ts).
export async function quizQuestions(slug: string) {
  const quiz = await quizBySlug(slug);
  if (!quiz) return null;
  const questions = await requireDb()
    .select({
      id: discoverQuestions.id,
      text: discoverQuestions.text,
      image: discoverQuestions.image,
      options: discoverQuestions.options,
      correctIndex: discoverQuestions.correctIndex,
    })
    .from(discoverQuestions)
    .where(eq(discoverQuestions.quizId, quiz.id))
    .orderBy(asc(discoverQuestions.orderIndex));
  return {
    slug: quiz.slug,
    language: quiz.language as DiscoverLanguage,
    title: quiz.title,
    art: quiz.art,
    color: quiz.color,
    coverImage: quiz.coverImage,
    questions,
  };
}

// One student's plays of one quiz count once in a while, so a refresh —
// or a script — does not run the number up. Counted in this process.
const PLAY_EVERY_MS = 30 * 60 * 1000;
const lastPlay = new Map<string, number>();

export async function recordPlay(userId: string, slug: string) {
  const key = `${userId}:${slug}`;
  const now = Date.now();
  if (now - (lastPlay.get(key) ?? 0) < PLAY_EVERY_MS) return { counted: false };
  lastPlay.set(key, now);
  if (lastPlay.size > 20_000) {
    for (const [entry, time] of lastPlay) {
      if (now - time >= PLAY_EVERY_MS) lastPlay.delete(entry);
    }
  }
  const updated = await requireDb()
    .update(discoverQuizzes)
    .set({ playsCount: sql`${discoverQuizzes.playsCount} + 1` })
    .where(
      and(eq(discoverQuizzes.slug, slug), eq(discoverQuizzes.isActive, true))
    )
    .returning({ id: discoverQuizzes.id });
  return { counted: updated.length > 0 };
}

export async function channelPage(slug: string, userId: string) {
  const db = requireDb();
  const [channel] = await db
    .select()
    .from(discoverChannels)
    .where(
      and(eq(discoverChannels.slug, slug), eq(discoverChannels.isActive, true))
    )
    .limit(1);
  if (!channel) return null;
  const language = channel.language as DiscoverLanguage;
  const [quizzes, channels, [followers], [mine]] = await Promise.all([
    allQuizzes(language),
    allChannels(language),
    db
      .select({ n: count() })
      .from(discoverChannelFollows)
      .where(eq(discoverChannelFollows.channelId, channel.id)),
    db
      .select({ userId: discoverChannelFollows.userId })
      .from(discoverChannelFollows)
      .where(
        and(
          eq(discoverChannelFollows.channelId, channel.id),
          eq(discoverChannelFollows.userId, userId)
        )
      )
      .limit(1),
  ]);
  const own = quizzes.filter(quiz => quiz.channelId === channel.id);
  return {
    slug: channel.slug,
    language,
    name: channel.name,
    description: channel.description,
    logo: channel.logo,
    cover: channel.cover,
    art: channel.art,
    color: channel.color,
    verified: channel.verified,
    followers: Number(followers?.n ?? 0),
    following: Boolean(mine),
    quizzes: own.map(quiz => card(quiz, channels)),
    // The most played, for "featured" — the catalogue's order until
    // something has been played.
    featured: pickQuizzes(own, { sort: "popular", limit: 4 }).map(quiz =>
      card(quiz, channels)
    ),
    categories: [...new Set(own.map(quiz => quiz.category))],
    questionsCount: own.reduce((sum, quiz) => sum + quiz.questionsCount, 0),
  };
}

export async function followChannel(
  userId: string,
  slug: string,
  follow: boolean
) {
  const db = requireDb();
  const [channel] = await db
    .select({ id: discoverChannels.id })
    .from(discoverChannels)
    .where(
      and(eq(discoverChannels.slug, slug), eq(discoverChannels.isActive, true))
    )
    .limit(1);
  if (!channel) return null;
  if (follow) {
    await db
      .insert(discoverChannelFollows)
      .values({ channelId: channel.id, userId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(discoverChannelFollows)
      .where(
        and(
          eq(discoverChannelFollows.channelId, channel.id),
          eq(discoverChannelFollows.userId, userId)
        )
      );
  }
  return { following: follow };
}
