// Public-site facts shared by metadata, sitemap, robots and structured data.
// The canonical origin is the production domain; NEXT_PUBLIC_SITE_URL can
// point previews elsewhere without touching the code.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://nirolearn.com"
).replace(/\/$/, "");

export const SITE_NAME = "NiroLearn";

export const SITE_ENTITY_DESCRIPTION_EN =
  "NiroLearn is an AI-powered learning platform that helps students turn study materials into structured learning resources such as summaries, flashcards, questions, quizzes, mind maps, exam-focused revision, and interactive educational experiences.";

export const SITE_ENTITY_DESCRIPTION_AR =
  "نيـرو ليرن (NiroLearn) منصة تعليمية مدعومة بالذكاء الاصطناعي تساعد الطلاب على تحويل موادهم الدراسية إلى ملخصات وفلاش كارد وأسئلة واختبارات وخرائط ذهنية ومراجعة مركزة للامتحانات وتجارب تعليمية تفاعلية.";

export const SITE_ENTITY_IDS = {
  organization: `${SITE_URL}/#organization`,
  website: `${SITE_URL}/#website`,
  software: `${SITE_URL}/#software`,
} as const;

// Title and description lead with the terms Arab students actually search
// for (OpenSEO, Saudi market, 2026-09: "تلخيص ملف pdf" 260/mo, "فلاش كارد"
// 320/mo, "تلخيص pdf بالذكاء الاصطناعي" 110/mo, all KD 0), in plain words.
export const SITE_TITLE =
  "NiroLearn | تلخيص PDF وفلاش كارد واختبارات بالذكاء الاصطناعي";

export const SITE_DESCRIPTION =
  "ارفع ملف PDF لكتابك أو محاضرتك، وNiroLearn يلخّصه ويستخرج أهم معلومات الامتحان ويحوّله إلى فلاش كارد واختبارات وخريطة ذهنية. منصة مذاكرة عربية، ابدأ مجانًا.";

// Public pages worth indexing, in priority order (app pages sit behind
// sign-in and are kept out of the sitemap; /login is noindex).
// The Telegram bot's public page (app/telegram-bot). A public, indexable
// page like the tool pages, but not one of the header's tools.
export const BOT_PAGE_PATH = "/telegram-bot";
// The page for students who study from past-exam question files
// (app/past-exam-questions). Public and indexable, like the bot's page.
export const PAST_QUESTIONS_PATH = "/past-exam-questions";

export const PUBLIC_BASE_PATHS = [
  "/",
  "/pdf-summary",
  "/flashcards",
  "/mind-map",
  "/how-to-study",
  BOT_PAGE_PATH,
  PAST_QUESTIONS_PATH,
  "/pricing",
  "/register",
  "/contact",
  "/privacy",
  "/terms",
] as const;

export const PUBLIC_PATHS = PUBLIC_BASE_PATHS;

// Public tool pages and the study guide: header nav, footer, "related"
// links and the sitemap all read this list.
export const TOOL_PAGES = [
  { href: "/pdf-summary", label: "تلخيص PDF" },
  { href: "/flashcards", label: "فلاش كارد" },
  { href: "/mind-map", label: "خريطة ذهنية" },
  { href: "/how-to-study", label: "طريقة المذاكرة" },
] as const;

export type ToolPath = (typeof TOOL_PAGES)[number]["href"];

// Open Graph fields every page shares. Next.js replaces (not merges) a
// parent's openGraph when a page sets its own, so pages spread this in.
export const BASE_OPEN_GRAPH = {
  type: "website",
  siteName: SITE_NAME,
  locale: "ar_AR",
} as const;
