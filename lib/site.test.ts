import { describe, expect, it } from "vitest";
import {
  BASE_OPEN_GRAPH,
  PUBLIC_BASE_PATHS,
  PUBLIC_PATHS,
  SITE_DESCRIPTION,
  SITE_ENTITY_DESCRIPTION_AR,
  SITE_ENTITY_DESCRIPTION_EN,
  SITE_ENTITY_IDS,
  SITE_TITLE,
  SITE_URL,
  TOOL_PAGES,
} from "./site";

describe("site constants", () => {
  it("keeps the canonical public origin and marketing copy stable", () => {
    expect(SITE_URL).toBe("https://nirolearn.com");
    expect(SITE_TITLE).toBe("NiroLearn | تلخيص PDF وفلاش كارد واختبارات بالذكاء الاصطناعي");
    expect(SITE_DESCRIPTION).toContain("فلاش كارد واختبارات وخريطة ذهنية");
    expect(BASE_OPEN_GRAPH).toEqual({
      type: "website",
      siteName: "NiroLearn",
      locale: "ar_AR",
    });
    expect(SITE_ENTITY_DESCRIPTION_EN).toContain("AI-powered learning platform");
    expect(SITE_ENTITY_DESCRIPTION_AR).toContain("نيـرو ليرن (NiroLearn)");
    expect(SITE_ENTITY_IDS).toEqual({
      organization: "https://nirolearn.com/#organization",
      website: "https://nirolearn.com/#website",
      software: "https://nirolearn.com/#software",
    });
  });

  it("publishes only the intentional base public paths and tool pages", () => {
    expect(PUBLIC_BASE_PATHS).toEqual([
      "/",
      "/pdf-summary",
      "/flashcards",
      "/mind-map",
      "/how-to-study",
      "/telegram-bot",
      "/past-exam-questions",
      "/pricing",
      "/register",
      "/contact",
      "/privacy",
      "/terms",
    ]);

    expect(PUBLIC_PATHS).toBe(PUBLIC_BASE_PATHS);

    expect(TOOL_PAGES).toEqual([
      { href: "/pdf-summary", label: "تلخيص PDF" },
      { href: "/flashcards", label: "فلاش كارد" },
      { href: "/mind-map", label: "خريطة ذهنية" },
      { href: "/how-to-study", label: "طريقة المذاكرة" },
    ]);
  });
});
