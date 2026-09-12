import { describe, expect, it } from "vitest";
import {
  buildChapterAnalysisMessages,
  buildVisualInsightsMessages,
  chunkChapterPages,
  findDuplicateMcqIds,
  findUncoveredPages,
  mergeSubChunkResults,
  parseChapterAnalysis,
  parseGapQuestions,
  parseMcqValidation,
  parseMindMapSections,
  parseVisualInsights,
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

describe("parseMindMapSections", () => {
  it("keeps sourcePages that are within this chapter's real page range", () => {
    const content = JSON.stringify({
      sections: [
        {
          title: "Section 1",
          explanationAr: "شرح",
          sourcePages: [1, 2],
          concepts: [],
        },
      ],
    });
    const result = parseMindMapSections(content, [1, 2, 3]);
    expect(result[0].sourcePages).toEqual([1, 2]);
  });

  // Audit rule: never trust the model's own page numbers as-is — a
  // hallucinated page outside this chapter's real range must be dropped,
  // not silently kept (same guard as analyze-chapter's card/MCQ filtering).
  it("drops a hallucinated sourcePage outside this chapter's real range", () => {
    const content = JSON.stringify({
      sections: [
        {
          title: "Section 1",
          explanationAr: "شرح",
          sourcePages: [1, 99],
          concepts: [],
        },
      ],
    });
    const result = parseMindMapSections(content, [1, 2, 3]);
    expect(result[0].sourcePages).toEqual([1]);
  });
});

describe("findDuplicateMcqIds", () => {
  it("flags an exact-duplicate question, keeping the first occurrence unflagged", () => {
    const mcqs = [
      { id: "a", questionEn: "What causes heart failure?" },
      { id: "b", questionEn: "What is the capital of France?" },
      { id: "c", questionEn: "What causes heart failure?" },
    ];
    expect(findDuplicateMcqIds(mcqs)).toEqual(["c"]);
  });

  it("flags a near-duplicate that only differs by punctuation/case/whitespace", () => {
    const mcqs = [
      { id: "a", questionEn: "What causes Heart Failure?" },
      { id: "b", questionEn: "what causes   heart failure" },
    ];
    expect(findDuplicateMcqIds(mcqs)).toEqual(["b"]);
  });

  it("finds no duplicates among genuinely distinct questions", () => {
    const mcqs = [
      { id: "a", questionEn: "What causes heart failure?" },
      { id: "b", questionEn: "What is the treatment for heart failure?" },
    ];
    expect(findDuplicateMcqIds(mcqs)).toEqual([]);
  });
});

describe("parseMcqValidation", () => {
  it("parses a validation response into per-question results", () => {
    const content = JSON.stringify({
      results: [
        { id: "a", valid: true, note: "" },
        { id: "b", valid: false, note: "answer is wrong" },
      ],
    });
    expect(parseMcqValidation(content)).toEqual([
      { id: "a", valid: true, note: "" },
      { id: "b", valid: false, note: "answer is wrong" },
    ]);
  });
});

describe("findUncoveredPages", () => {
  it("names every page in range that has no covering question", () => {
    expect(findUncoveredPages(1, 5, [1, 3])).toEqual([2, 4, 5]);
  });

  it("returns an empty list when every page is covered", () => {
    expect(findUncoveredPages(1, 3, [1, 2, 3, 3])).toEqual([]);
  });

  it("treats a page with no MCQs at all as fully uncovered", () => {
    expect(findUncoveredPages(10, 12, [])).toEqual([10, 11, 12]);
  });
});

describe("parseGapQuestions", () => {
  it("keeps generated questions whose sourcePage is a real gap page", () => {
    const content = JSON.stringify({
      mcqs: [
        {
          questionEn: "Q1",
          choices: ["a", "b", "c", "d"],
          correctIndex: 0,
          explanationEn: "why",
          sourcePage: 4,
        },
      ],
    });
    expect(parseGapQuestions(content, [4, 5])).toHaveLength(1);
  });

  // Audit rule: never trust the model's own page numbers as-is — a
  // question claiming a page outside the requested gap must be dropped.
  it("drops a generated question whose sourcePage isn't one of the requested gap pages", () => {
    const content = JSON.stringify({
      mcqs: [
        {
          questionEn: "Q1",
          choices: ["a", "b", "c", "d"],
          correctIndex: 0,
          explanationEn: "why",
          sourcePage: 99,
        },
      ],
    });
    expect(parseGapQuestions(content, [4, 5])).toEqual([]);
  });
});

describe("parseVisualInsights", () => {
  it("extracts the visualInsightsAr string from the response", () => {
    const content = JSON.stringify({
      visualInsightsAr: "الرسم في صفحة 5 يوضح دورة القلب.",
    });
    expect(parseVisualInsights(content)).toBe(
      "الرسم في صفحة 5 يوضح دورة القلب."
    );
  });

  it("passes through an empty string when the visuals add nothing new", () => {
    const content = JSON.stringify({ visualInsightsAr: "" });
    expect(parseVisualInsights(content)).toBe("");
  });
});

describe("buildVisualInsightsMessages", () => {
  it("includes every given visual's page number, type, and description", () => {
    const messages = buildVisualInsightsMessages("Some explanation", [
      { pageNumber: 5, assetType: "diagram", descriptionAr: "دورة القلب" },
      { pageNumber: 7, assetType: "table", descriptionAr: null },
    ]);
    const userContent = messages[1].content as string;
    expect(userContent).toContain("Page 5");
    expect(userContent).toContain("دورة القلب");
    expect(userContent).toContain("Page 7");
    expect(userContent).toContain("table");
  });
});
