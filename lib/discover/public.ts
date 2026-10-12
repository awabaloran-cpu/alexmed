// 🌍 The catalogue's public face: the same quizzes the Discover screens
// show to signed-in students, as pages anyone — and a search engine — can
// read (app/quizzes). They are built from the catalogue's own content
// files, not from the database, so a page never waits on a query and is
// there whether or not anyone is signed in.
//
// The content is general knowledge written for NiroLearn; nothing of a
// student's ever comes through here. Publishing it means a quiz's answers
// can be read by anyone, which the owner decided (2026-10-12): in a room's
// game the answer still comes from the server at the reveal, but a player
// who looks the quiz up beforehand knows it, as with any open quiz.
import type { DiscoverLanguage } from "./data";
import arabic from "./seed-ar.json";
import arabicStudio from "./seed-ar-studio.json";
import english from "./seed-en.json";
import layout from "./seed-layout.json";

export const QUIZZES_PATH = "/quizzes";
export const quizPath = (slug: string) => `${QUIZZES_PATH}/${slug}`;

type Source = {
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

export type PublicQuiz = {
  slug: string;
  language: DiscoverLanguage;
  title: string;
  description: string;
  category: string;
  art: string;
  color: string;
  channelName: string;
  // Subjects only: a tag that names an occasion is the app's own filter.
  tags: string[];
  questions: { text: string; options: string[]; correctIndex: number }[];
};

const channelName = (slug: string) =>
  layout.channels.find(channel => channel.slug === slug)?.name ?? "NiroLearn";

const publish = (language: DiscoverLanguage, quiz: Source): PublicQuiz => ({
  slug: quiz.slug,
  language,
  title: quiz.title,
  description: quiz.description,
  category: quiz.category,
  art: quiz.art,
  color: quiz.color,
  channelName: channelName(quiz.channel),
  tags: quiz.tags.filter(tag => !tag.startsWith("occ:")),
  questions: quiz.questions.map(question => ({
    text: question.q,
    options: question.o,
    correctIndex: question.a,
  })),
});

export const PUBLIC_QUIZZES: PublicQuiz[] = [
  ...([...arabicStudio, ...arabic] as Source[]).map(quiz =>
    publish("ar", quiz)
  ),
  ...(english as Source[]).map(quiz => publish("en", quiz)),
];

export const publicQuiz = (slug: string) =>
  PUBLIC_QUIZZES.find(quiz => quiz.slug === slug) ?? null;

export const quizzesIn = (language: DiscoverLanguage) =>
  PUBLIC_QUIZZES.filter(quiz => quiz.language === language);

// Other quizzes of the same subject and language, then of the language,
// for "more like this" under a quiz.
export function relatedQuizzes(quiz: PublicQuiz, count = 4): PublicQuiz[] {
  const others = quizzesIn(quiz.language).filter(
    other => other.slug !== quiz.slug
  );
  return [
    ...others.filter(other => other.category === quiz.category),
    ...others.filter(other => other.category !== quiz.category),
  ].slice(0, count);
}

export const totalQuestions = (quizzes: PublicQuiz[]) =>
  quizzes.reduce((sum, quiz) => sum + quiz.questions.length, 0);

// schema.org's Quiz, so a search engine reads the page as what it is.
export function quizJsonLd(quiz: PublicQuiz, siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Quiz",
    name: quiz.title,
    description: quiz.description,
    inLanguage: quiz.language,
    url: `${siteUrl}${quizPath(quiz.slug)}`,
    isAccessibleForFree: true,
    educationalUse: "self-assessment",
    about: quiz.tags,
    publisher: { "@type": "Organization", name: "NiroLearn", url: siteUrl },
    hasPart: quiz.questions.map(question => ({
      "@type": "Question",
      eduQuestionType: "Multiple choice",
      name: question.text,
      acceptedAnswer: {
        "@type": "Answer",
        text: question.options[question.correctIndex],
      },
      suggestedAnswer: question.options
        .filter((_, index) => index !== question.correctIndex)
        .map(text => ({ "@type": "Answer", text })),
    })),
  };
}
