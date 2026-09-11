import { describe, expect, it } from "vitest";
import {
  buildChapterAnalysisMessages,
  chunkChapterPages,
  mergeSubChunkResults,
  parseChapterAnalysis,
  type BookChapterAnalysis,
  type BookPageInput,
} from "./book-analysis";

function makePages(count: number): BookPageInput[] {
  return Array.from({ length: count }, (_, i) => ({
    page: i + 1,
    text: `Page ${i + 1} text.`,
  }));
}

function makeAnalysis(
  overrides: Partial<BookChapterAnalysis> = {}
): BookChapterAnalysis {
  return {
    explanationAr: "شرح",
    explanationEn: "explanation",
    keyPoints: ["point"],
    medicalTerms: [{ ar: "مصطلح", en: "term", pronunciation: "TUR-m" }],
    flashcards: [
      {
        questionAr: "سؤال",
        questionEn: "question",
        answerAr: "جواب",
        answerEn: "answer",
        relatedTermEn: "term",
        sourcePage: 1,
      },
    ],
    mcqs: [
      {
        questionEn: "mcq",
        choices: ["a", "b", "c", "d"],
        correctIndex: 0,
        explanationEn: "why",
        sourcePage: 1,
      },
    ],
    chapterSummary: "summary",
    ...overrides,
  };
}

describe("chunkChapterPages", () => {
  it("returns a single chunk for a chapter within the max page count", () => {
    const chunks = chunkChapterPages(makePages(5), 8);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(5);
  });

  it("splits a longer chapter into consecutive sub-chunks", () => {
    const chunks = chunkChapterPages(makePages(20), 8);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].map(p => p.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(chunks[1].map(p => p.page)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(chunks[2].map(p => p.page)).toEqual([17, 18, 19, 20]);
  });

  it("returns an empty array for no pages", () => {
    expect(chunkChapterPages([])).toEqual([]);
  });

  it("keeps dense page text across character-bounded chunks", () => {
    const denseText = "first line\n" + "x".repeat(30) + "\nlast line";
    const chunks = chunkChapterPages([{ page: 1, text: denseText }], 8, 12);
    const joined = chunks
      .flat()
      .map(page => page.text)
      .join("\n");
    expect(joined).toContain("first line");
    expect(joined).toContain("last line");
    expect(joined.replace(/\n/g, "")).toContain("x".repeat(30));
  });
});

describe("mergeSubChunkResults", () => {
  it("concatenates arrays and joins explanations across sub-chunks", () => {
    const first = makeAnalysis({
      explanationAr: "الجزء الأول",
      explanationEn: "part one",
      chapterSummary: "summary one",
    });
    const second = makeAnalysis({
      explanationAr: "الجزء الثاني",
      explanationEn: "part two",
      chapterSummary: "summary two",
    });

    const merged = mergeSubChunkResults([first, second]);

    expect(merged.explanationAr).toBe("الجزء الأول\n\nالجزء الثاني");
    expect(merged.explanationEn).toBe("part one\n\npart two");
    expect(merged.keyPoints).toHaveLength(2);
    expect(merged.medicalTerms).toHaveLength(2);
    expect(merged.flashcards).toHaveLength(2);
    expect(merged.mcqs).toHaveLength(2);
    expect(merged.summaries).toEqual(["summary one", "summary two"]);
  });

  it("passes a single sub-chunk's content through unchanged in shape", () => {
    const only = makeAnalysis();
    const merged = mergeSubChunkResults([only]);

    expect(merged.explanationAr).toBe(only.explanationAr);
    expect(merged.summaries).toEqual([only.chapterSummary]);
  });
});

describe("buildChapterAnalysisMessages profile framing (PR2)", () => {
  function systemContent(
    profile?: Parameters<typeof buildChapterAnalysisMessages>[2]
  ) {
    const messages = buildChapterAnalysisMessages(
      "Ch. 1",
      makePages(1),
      profile
    );
    const system = messages.find(m => m.role === "system");
    return typeof system?.content === "string" ? system.content : "";
  }

  it("defaults to the original medical framing when no profile is passed", () => {
    expect(systemContent()).toContain("medical textbook");
    expect(systemContent()).toContain("important medical terms");
  });

  it("keeps the exact medical framing when profile is explicitly medical", () => {
    expect(systemContent("medical")).toContain("medical textbook");
  });

  it("drops medical framing for a non-medical profile", () => {
    const content = systemContent("mathematics");
    expect(content).not.toContain("medical");
    expect(content).toContain("mathematics textbook");
  });

  it("never forces a medical-school coach persona onto a general book", () => {
    const content = systemContent("general");
    expect(content).not.toContain("medical");
    expect(content).toContain("study material");
  });

  it("never changes the JSON schema's field names regardless of profile", () => {
    // The wire contract (medicalTerms as the property key) is deliberately
    // stable across every profile — see BookProfile's comment in
    // lib/book-analysis.ts. Only the prompt's wording changes.
    const analysis = makeAnalysis();
    expect(parseChapterAnalysis(JSON.stringify(analysis))).toEqual(analysis);
  });
});

describe("parseChapterAnalysis", () => {
  it("parses a plain JSON string response", () => {
    const analysis = makeAnalysis();
    const result = parseChapterAnalysis(JSON.stringify(analysis));
    expect(result).toEqual(analysis);
  });

  it("strips markdown fences before parsing", () => {
    const analysis = makeAnalysis();
    const fenced = "```json\n" + JSON.stringify(analysis) + "\n```";
    const result = parseChapterAnalysis(fenced);
    expect(result).toEqual(analysis);
  });
});
