import type { MetadataRoute } from "next";
import { INDEXABLE_LEARN_ARTICLES, learnPath } from "@/content/learn/articles";
import { PUBLIC_QUIZZES, QUIZZES_PATH, quizPath } from "@/lib/discover/public";
import {
  BOT_PAGE_PATH,
  PAST_QUESTIONS_PATH,
  SOLVE_QUESTIONS_PATH,
  PUBLIC_BASE_PATHS,
  SITE_URL,
  TOGETHER_PAGES,
  TOOL_PAGES,
} from "@/lib/site";

// Only the public, indexable pages — never app pages behind sign-in.
export default function sitemap(): MetadataRoute.Sitemap {
  const learnPaths = [
    "/learn",
    "/learn/glossary",
    ...INDEXABLE_LEARN_ARTICLES.map(article => learnPath(article.slug)),
  ];
  // The catalogue's public quizzes (app/quizzes): the index, then each.
  const quizPaths = [
    QUIZZES_PATH,
    ...PUBLIC_QUIZZES.map(quiz => quizPath(quiz.slug)),
  ];
  const paths = [...PUBLIC_BASE_PATHS, ...learnPaths, ...quizPaths];

  return paths.map(path => ({
    url: `${SITE_URL}${path}`,
    changeFrequency:
      path === "/" || path.startsWith("/learn") || path === QUIZZES_PATH
        ? "weekly"
        : "monthly",
    priority:
      path === "/"
        ? 1
        : path === "/learn"
          ? 0.9
          : path === QUIZZES_PATH
            ? 0.9
            : path.startsWith("/learn") || path.startsWith(QUIZZES_PATH)
              ? 0.75
              : path === "/pricing" || path === "/register"
                ? 0.8
                : TOOL_PAGES.some(page => page.href === path) ||
                    TOGETHER_PAGES.some(page => page.href === path) ||
                    path === BOT_PAGE_PATH ||
                    path === PAST_QUESTIONS_PATH ||
                    path === SOLVE_QUESTIONS_PATH
                  ? 0.9
                  : 0.5,
  }));
}
