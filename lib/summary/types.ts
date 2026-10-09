// 📝 The summary a student gets as a PDF: what the AI writes (lib/summary/
// markup.ts turns its text into these blocks) and what the page is drawn
// from (lib/summary/render.ts).

export type SummaryBlock =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "list"; ordered: boolean; items: string[] }
  // Term / explanation pairs.
  | { t: "kv"; items: [string, string][] }
  | { t: "callout"; kind: SummaryCalloutKind; text: string; title?: string }
  | { t: "formula"; tex: string; note?: string }
  | { t: "example"; title: string; steps: string[]; answer?: string }
  | { t: "table"; head: string[]; rows: string[][] }
  // Two sentences of simple Arabic under material in another language.
  | { t: "ar"; text: string };

export type SummaryCalloutKind = "key" | "exam" | "warn" | "tip";

export type SummarySection = {
  title: string;
  // The source pages this section covers — what the coverage check counts.
  pages: number[];
  blocks: SummaryBlock[];
};

export type SummaryDoc = {
  lang: "ar" | "en";
  title: string;
  subtitle?: string;
  chips?: string[];
  meta?: string;
  sections: SummarySection[];
  checklist?: string[];
};

export const SUMMARY_THEMES = [
  "studio",
  "bloom",
  "dusk",
  "paper",
  "classic",
] as const;
export type SummaryTheme = (typeof SUMMARY_THEMES)[number];

// The first set of looks (2026-10-09) was replaced; a job or a button that
// still names one gets the look that took its place.
const RETIRED_THEMES: Record<string, SummaryTheme> = {
  niro: "studio",
  mint: "bloom",
  violet: "dusk",
};
export const toSummaryTheme = (value: unknown): SummaryTheme =>
  isSummaryTheme(value)
    ? value
    : (RETIRED_THEMES[String(value)] ?? SUMMARY_THEMES[0]);

export const SUMMARY_STYLES = ["full", "exam"] as const;
export type SummaryStyle = (typeof SUMMARY_STYLES)[number];

export const isSummaryTheme = (value: unknown): value is SummaryTheme =>
  SUMMARY_THEMES.includes(value as SummaryTheme);
export const isSummaryStyle = (value: unknown): value is SummaryStyle =>
  SUMMARY_STYLES.includes(value as SummaryStyle);
