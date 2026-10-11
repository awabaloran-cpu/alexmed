// 🌱 The Discover catalogue's first shelves: 20 Arabic and 20 English
// quizzes written for NiroLearn (seed-ar.json / seed-en.json), six longer
// Arabic ones of twenty questions each for the studio's channel
// (seed-ar-studio.json), three channels a language and the page's
// sections (seed-layout.json).
//
// `seedDiscover` writes them through whatever database it is handed and
// can be run again: every row is matched by its slug or key, so a second
// run updates the text and leaves the play counts and followers alone.
// The tests run it on PGlite; production gets the same three files from
// the owner's own script.
import { and, eq, gte } from "drizzle-orm";
import {
  discoverChannels,
  discoverQuestions,
  discoverQuizzes,
  discoverSections,
  type DiscoverSectionFilter,
} from "../../drizzle/schema";
import type { requireDb } from "../db";
import arabic from "./seed-ar.json";
import arabicStudio from "./seed-ar-studio.json";
import english from "./seed-en.json";
import layout from "./seed-layout.json";

type Db = ReturnType<typeof requireDb>;

export type SeedQuiz = {
  slug: string;
  title: string;
  description: string;
  category: string;
  art: string;
  color: string;
  channel: string;
  tags: string[];
  questions: { q: string; o: string[]; a: number }[];
};

export const SEED_QUIZZES: { language: "ar" | "en"; quiz: SeedQuiz }[] = [
  ...([...arabic, ...arabicStudio] as SeedQuiz[]).map(quiz => ({
    language: "ar" as const,
    quiz,
  })),
  ...(english as SeedQuiz[]).map(quiz => ({ language: "en" as const, quiz })),
];
export const SEED_CHANNELS = layout.channels;
export const SEED_SECTIONS = layout.sections as {
  key: string;
  type: string;
  language: string | null;
  order: number;
  titleAr?: string;
  titleEn?: string;
  subtitleAr?: string;
  subtitleEn?: string;
  filter: DiscoverSectionFilter;
}[];

export const QUESTION_SECONDS = 20;

export async function seedDiscover(db: Db) {
  await db.transaction(async tx => {
    const channelIds = new Map<string, string>();
    for (const [orderIndex, channel] of SEED_CHANNELS.entries()) {
      const values = { ...channel, orderIndex };
      const [row] = await tx
        .insert(discoverChannels)
        .values(values)
        .onConflictDoUpdate({ target: discoverChannels.slug, set: values })
        .returning({ id: discoverChannels.id });
      channelIds.set(channel.slug, row.id);
    }
    for (const { language, quiz } of SEED_QUIZZES) {
      const channel = SEED_CHANNELS.find(row => row.slug === quiz.channel);
      const values = {
        slug: quiz.slug,
        language,
        title: quiz.title,
        description: quiz.description,
        category: quiz.category,
        art: quiz.art,
        color: quiz.color,
        tags: quiz.tags,
        channelId: channelIds.get(quiz.channel) ?? null,
        creatorName: channel?.name ?? "NiroLearn",
        creatorVerified: channel?.verified ?? false,
        questionsCount: quiz.questions.length,
      };
      const [row] = await tx
        .insert(discoverQuizzes)
        .values(values)
        .onConflictDoUpdate({ target: discoverQuizzes.slug, set: values })
        .returning({ id: discoverQuizzes.id });
      // A question is its place in its quiz: the row at that place is
      // rewritten, never replaced, so its id stays the one a room in the
      // middle of a game (or a finished one) remembers.
      for (const [orderIndex, question] of quiz.questions.entries()) {
        const values = {
          text: question.q,
          options: question.o,
          correctIndex: question.a,
          timeLimit: QUESTION_SECONDS,
        };
        await tx
          .insert(discoverQuestions)
          .values({ quizId: row.id, orderIndex, ...values })
          .onConflictDoUpdate({
            target: [discoverQuestions.quizId, discoverQuestions.orderIndex],
            set: values,
          });
      }
      await tx
        .delete(discoverQuestions)
        .where(
          and(
            eq(discoverQuestions.quizId, row.id),
            gte(discoverQuestions.orderIndex, quiz.questions.length)
          )
        );
    }
    for (const section of SEED_SECTIONS) {
      const values = {
        key: section.key,
        type: section.type,
        language: section.language,
        titleAr: section.titleAr ?? "",
        titleEn: section.titleEn ?? "",
        subtitleAr: section.subtitleAr ?? "",
        subtitleEn: section.subtitleEn ?? "",
        orderIndex: section.order,
        filter: section.filter,
      };
      await tx
        .insert(discoverSections)
        .values(values)
        .onConflictDoUpdate({ target: discoverSections.key, set: values });
    }
  });
}
