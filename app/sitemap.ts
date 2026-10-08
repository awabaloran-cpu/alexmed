import type { MetadataRoute } from "next";
import { INDEXABLE_LEARN_ARTICLES, learnPath } from "@/content/learn/articles";
import {
  BOT_PAGE_PATH,
  PUBLIC_BASE_PATHS,
  SITE_URL,
  TOOL_PAGES,
} from "@/lib/site";

// Only the public, indexable pages — never app pages behind sign-in.
export default function sitemap(): MetadataRoute.Sitemap {
  const learnPaths = [
    "/learn",
    "/learn/glossary",
    ...INDEXABLE_LEARN_ARTICLES.map(article => learnPath(article.slug)),
  ];
  const paths = [...PUBLIC_BASE_PATHS, ...learnPaths];

  return paths.map(path => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "/" || path.startsWith("/learn") ? "weekly" : "monthly",
    priority:
      path === "/"
        ? 1
        : path === "/learn"
          ? 0.9
          : path.startsWith("/learn")
            ? 0.75
            : path === "/pricing" || path === "/register"
              ? 0.8
              : TOOL_PAGES.some(page => page.href === path) ||
                  path === BOT_PAGE_PATH
                ? 0.9
                : 0.5,
  }));
}
