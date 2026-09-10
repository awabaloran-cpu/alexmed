// Chapter-boundary detection for كتبي (Book Study) — pure, no I/O. Regex
// heading detection is the primary pass, with a hard fallback to fixed-size
// page windows when the result looks unreliable, per the approved plan
// (see ~/.claude/plans/bright-sprouting-parrot.md, "Chapter detection").
import type { PageInput } from "./pdf-cards";

export type ChapterBoundary = {
  startPage: number;
  endPage: number;
  title: string;
};

export type DetectionConfidence = "high" | "medium" | "low";

export type ChapterDetectionResult = {
  chapters: ChapterBoundary[];
  method: "headings" | "fixed_windows";
  confidence: DetectionConfidence;
};

// Matches an English "Chapter/Unit/Part/Section N" or an Arabic
// "الفصل/فصل/الباب/الوحدة" heading, tested against a page's first few lines.
// Note: no trailing `\b` after the Arabic alternatives — Arabic letters
// aren't `\w` in JS regex, so a `\b` right after one never matches.
const CHAPTER_HEADING_RE =
  /^(chapter|unit|part|section)\s+\d+\b|^(الفصل|فصل)\s+(الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)|^(الباب|الوحدة)\s+(الأول|الثاني|الثالث|\d+)/im;

const FIXED_WINDOW_SIZE = 8;
const MIN_WINDOW_REMAINDER = 4;

function findHeadingTitle(text: string): string | null {
  const firstLines = text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const line of firstLines) {
    if (CHAPTER_HEADING_RE.test(line)) return line.slice(0, 120);
  }
  return null;
}

function detectHeadingBoundaries(
  pages: PageInput[]
): { page: number; title: string }[] {
  const boundaries: { page: number; title: string }[] = [];
  for (const page of pages) {
    const title = findHeadingTitle(page.text);
    if (title) boundaries.push({ page: page.page, title });
  }
  return boundaries;
}

// Rejects the regex pass (falls back to fixed windows) when it found too
// few headings to be meaningful, too many to be anything but running
// headers/footers, or implies chapters too short to be real chapters.
function isHeadingResultReliable(
  boundaries: { page: number; title: string }[],
  totalPages: number
): boolean {
  if (boundaries.length < 2) return false;
  if (boundaries.length > totalPages / 3) return false;
  const averageChapterLength = totalPages / boundaries.length;
  if (averageChapterLength < 3) return false;
  return true;
}

function boundariesToChapters(
  boundaries: { page: number; title: string }[],
  totalPages: number
): ChapterBoundary[] {
  return boundaries.map((boundary, index) => ({
    // The first chapter absorbs any front matter before the first detected
    // heading (title page, preface, table of contents) rather than losing it.
    startPage: index === 0 ? 1 : boundary.page,
    endPage:
      index + 1 < boundaries.length
        ? boundaries[index + 1].page - 1
        : totalPages,
    title: boundary.title,
  }));
}

// Full-featured chapter editing (renaming/resizing boundaries) is deferred
// to a later PR — this only classifies how much a student should trust the
// detected split, so the UI can show a "we guessed" banner for fixed_windows
// and for the weakest heading result (exactly 2 boundaries, the bare minimum
// isHeadingResultReliable() accepts).
function classifyDetectionConfidence(
  method: "headings" | "fixed_windows",
  boundaryCount: number
): DetectionConfidence {
  if (method === "fixed_windows") return "low";
  return boundaryCount >= 3 ? "high" : "medium";
}

function fixedWindowChapters(totalPages: number): ChapterBoundary[] {
  const chapters: ChapterBoundary[] = [];
  let start = 1;
  let index = 1;
  while (start <= totalPages) {
    let end = Math.min(start + FIXED_WINDOW_SIZE - 1, totalPages);
    // Absorb a small remainder into the last window instead of leaving a
    // dangling tiny chapter at the very end of the book.
    if (totalPages - end > 0 && totalPages - end < MIN_WINDOW_REMAINDER) {
      end = totalPages;
    }
    chapters.push({ startPage: start, endPage: end, title: `الجزء ${index}` });
    start = end + 1;
    index += 1;
  }
  return chapters;
}

export function detectChapters(pages: PageInput[]): ChapterDetectionResult {
  const totalPages = pages.length
    ? Math.max(...pages.map(page => page.page))
    : 0;
  if (!totalPages) {
    return { chapters: [], method: "fixed_windows", confidence: "low" };
  }

  const boundaries = detectHeadingBoundaries(pages);
  if (isHeadingResultReliable(boundaries, totalPages)) {
    return {
      chapters: boundariesToChapters(boundaries, totalPages),
      method: "headings",
      confidence: classifyDetectionConfidence("headings", boundaries.length),
    };
  }
  return {
    chapters: fixedWindowChapters(totalPages),
    method: "fixed_windows",
    confidence: "low",
  };
}
