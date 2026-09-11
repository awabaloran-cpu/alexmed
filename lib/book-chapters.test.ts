import { describe, expect, it } from "vitest";
import { detectChapters } from "./book-chapters";
import type { PageInput } from "./pdf-cards";

function makePages(
  totalPages: number,
  headings: Record<number, string>
): PageInput[] {
  const pages: PageInput[] = [];
  for (let page = 1; page <= totalPages; page++) {
    const heading = headings[page];
    pages.push({
      page,
      text: heading
        ? `${heading}\nSome body text on page ${page}.`
        : `Regular body text on page ${page}. Nothing special here.`,
    });
  }
  return pages;
}

describe("detectChapters", () => {
  it("uses heading detection when clear chapter headings are found", () => {
    const pages = makePages(20, {
      1: "Chapter 1",
      8: "Chapter 2",
      15: "Chapter 3",
    });

    const result = detectChapters(pages);

    expect(result.method).toBe("headings");
    // 3 boundaries meets the "comfortably reliable" bar, not just the bare
    // isHeadingResultReliable() minimum of 2 — see classifyDetectionConfidence.
    expect(result.confidence).toBe("high");
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0]).toEqual({
      startPage: 1,
      endPage: 7,
      title: "Chapter 1",
    });
    expect(result.chapters[1]).toEqual({
      startPage: 8,
      endPage: 14,
      title: "Chapter 2",
    });
    expect(result.chapters[2]).toEqual({
      startPage: 15,
      endPage: 20,
      title: "Chapter 3",
    });
  });

  it("detects Arabic chapter headings", () => {
    const pages = makePages(16, {
      1: "الفصل الأول",
      9: "الفصل الثاني",
    });

    const result = detectChapters(pages);

    expect(result.method).toBe("headings");
    expect(result.chapters).toHaveLength(2);
  });

  it("marks exactly-2-boundaries headings as only medium confidence", () => {
    // Passes isHeadingResultReliable()'s bare minimum (2 boundaries) but
    // isn't the "comfortably reliable" 3+ case — the UI should still hint
    // the student toward reviewing the split.
    const pages = makePages(20, { 1: "Chapter 1", 12: "Chapter 2" });

    const result = detectChapters(pages);

    expect(result.method).toBe("headings");
    expect(result.confidence).toBe("medium");
  });

  it("falls back to fixed 8-page windows when no headings are found", () => {
    const pages = makePages(20, {});

    const result = detectChapters(pages);

    expect(result.method).toBe("fixed_windows");
    expect(result.confidence).toBe("low");
    // 20 pages / 8-page windows -> [1-8],[9-16],[17-20] (remainder 4 kept
    // separate since it isn't < MIN_WINDOW_REMAINDER)
    expect(result.chapters).toEqual([
      { startPage: 1, endPage: 8, title: "الجزء 1" },
      { startPage: 9, endPage: 16, title: "الجزء 2" },
      { startPage: 17, endPage: 20, title: "الجزء 3" },
    ]);
  });

  it("absorbs a small trailing remainder into the last window", () => {
    const pages = makePages(18, {});

    const result = detectChapters(pages);

    expect(result.method).toBe("fixed_windows");
    // [1-8],[9-16] then only 2 pages left (< MIN_WINDOW_REMAINDER of 4) ->
    // absorbed into the previous window's continuation, not a dangling chapter
    expect(result.chapters).toEqual([
      { startPage: 1, endPage: 8, title: "الجزء 1" },
      { startPage: 9, endPage: 18, title: "الجزء 2" },
    ]);
  });

  it("falls back to fixed windows when headings appear far too often to be real chapters", () => {
    const headings: Record<number, string> = {};
    for (let page = 1; page <= 20; page += 1) {
      if (page % 2 === 0) headings[page] = "Chapter X"; // heading on every other page
    }
    const pages = makePages(20, headings);

    const result = detectChapters(pages);

    expect(result.method).toBe("fixed_windows");
  });

  it("falls back to fixed windows when only a single heading is found", () => {
    const pages = makePages(20, { 1: "Chapter 1" });

    const result = detectChapters(pages);

    expect(result.method).toBe("fixed_windows");
  });

  it("returns no chapters for an empty page list", () => {
    const result = detectChapters([]);

    expect(result).toEqual({
      chapters: [],
      method: "fixed_windows",
      confidence: "low",
    });
  });
});
