// Book chapter analysis — the core AI call for كتبي (Book Study). Mirrors
// lib/pdf-cards.ts's conventions (strict JSON-schema objects, manually
// synced TS types, pure message-builder functions with no I/O) but scoped
// to one chapter's worth of content instead of a handful of flashcard-only
// pages. No model is ever passed to invokeLLM here — same reasoning as the
// rest of the app: the active provider (OmniRoute) owns model selection.
import type { Message } from "./llm";
import { parseJsonResponse } from "./pdf-cards";

// PR2: drives which framing buildChapterAnalysisMessages uses below — see
// that function's comment. Deliberately does NOT change the JSON schema's
// field names (still "medicalTerms" for every profile, see bookChapterSchema
// below) — only the prompt wording changes per profile. This keeps the wire
// contract, BookChapterAnalysis's shape, and every downstream parse/merge/
// persist function completely unchanged, so no previously-completed
// chapter's stored data is affected and no chapter is ever forced to
// re-analyze just because this column now exists on its book.
export type BookProfile =
  | "general"
  | "medical"
  | "english"
  | "mathematics"
  | "aptitude"
  | "programming"
  | "custom";

const PROFILE_SUBJECT_LABEL: Record<BookProfile, string> = {
  general: "study material",
  medical: "medical textbook",
  english: "English-language learning material",
  mathematics: "mathematics textbook",
  aptitude: "aptitude/reasoning test-prep material",
  programming: "programming/technical material",
  custom: "study material",
};

export const bookChapterSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    explanationAr: {
      type: "string",
      description:
        "A clear, simple Arabic explanation of this chapter's content, for a student who struggles with English and forgets quickly.",
    },
    explanationEn: {
      type: "string",
      description:
        "A concise, exam-focused English explanation of the same content.",
    },
    keyPoints: {
      type: "array",
      items: { type: "string" },
      description: "The most important points to remember from this chapter.",
    },
    // Field name kept as "medicalTerms" for every profile (not just
    // medical) — see the BookProfile comment above for why: this is a
    // deliberate wire-contract stability choice, not an oversight. What
    // actually generalizes per profile is the prompt's own instruction
    // (see buildChapterAnalysisMessages) about what "important terms" means
    // for that subject.
    medicalTerms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ar: { type: "string" },
          en: { type: "string" },
          pronunciation: {
            type: "string",
            description:
              "A simple syllable-hyphenated pronunciation guide for the term, e.g. 'ven-TRIK-yoo-lar' — leave as an empty string when pronunciation isn't meaningful (e.g. a math symbol or a code keyword).",
          },
        },
        required: ["ar", "en", "pronunciation"],
      },
    },
    flashcards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          questionAr: { type: "string" },
          questionEn: { type: "string" },
          answerAr: { type: "string" },
          answerEn: { type: "string" },
          relatedTermEn: {
            type: "string",
            description:
              "The term (English) from medicalTerms this card tests, or an empty string if none.",
          },
          sourcePage: { type: "integer" },
        },
        required: [
          "questionAr",
          "questionEn",
          "answerAr",
          "answerEn",
          "relatedTermEn",
          "sourcePage",
        ],
      },
    },
    mcqs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          questionEn: { type: "string" },
          choices: {
            type: "array",
            items: { type: "string" },
            minItems: 4,
            maxItems: 4,
          },
          correctIndex: {
            type: "integer",
            description: "0-based index into choices of the correct answer.",
          },
          explanationEn: { type: "string" },
          sourcePage: { type: "integer" },
        },
        required: [
          "questionEn",
          "choices",
          "correctIndex",
          "explanationEn",
          "sourcePage",
        ],
      },
    },
    chapterSummary: {
      type: "string",
      description:
        "A short Arabic summary of the whole chapter (this call's slice of it).",
    },
  },
  required: [
    "explanationAr",
    "explanationEn",
    "keyPoints",
    "medicalTerms",
    "flashcards",
    "mcqs",
    "chapterSummary",
  ],
};

export const bookChapterResponseSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "book_chapter_analysis",
    strict: true,
    schema: bookChapterSchema,
  },
};

export type BookChapterAnalysis = {
  explanationAr: string;
  explanationEn: string;
  keyPoints: string[];
  medicalTerms: { ar: string; en: string; pronunciation: string }[];
  flashcards: {
    questionAr: string;
    questionEn: string;
    answerAr: string;
    answerEn: string;
    relatedTermEn: string;
    sourcePage: number;
  }[];
  mcqs: {
    questionEn: string;
    choices: string[];
    correctIndex: number;
    explanationEn: string;
    sourcePage: number;
  }[];
  chapterSummary: string;
};

export type BookPageInput = { page: number; text: string };

// Existing GENERATE_MAX_TOKENS (lib/pdf-cards.ts) is 14000 for a much
// smaller, single-content-type output (flashcards only, 4 pages). A chapter
// call covers up to 8 pages and produces five separate content types.
export const BOOK_CHAPTER_MAX_TOKENS = 16000;
export const SUMMARY_MERGE_MAX_TOKENS = 1500;

const SUB_CHUNK_MAX_PAGES = 8;
const SUB_CHUNK_MAX_CHARS = 12_000;

// Any chapter longer than the page or character budget is split into
// consecutive sub-chunks. Dense pages are split only at line boundaries, so
// every extracted character remains in exactly one AI request.
export function chunkChapterPages(
  pages: BookPageInput[],
  maxPagesPerChunk = SUB_CHUNK_MAX_PAGES,
  maxCharsPerChunk = SUB_CHUNK_MAX_CHARS
): BookPageInput[][] {
  if (!pages.length) return [];
  if (maxPagesPerChunk <= 0 || maxCharsPerChunk <= 0) {
    throw new Error("Chunk limits must be positive");
  }

  const chunks: BookPageInput[][] = [];
  let chunk: BookPageInput[] = [];
  let chunkChars = 0;
  const flush = () => {
    if (chunk.length) chunks.push(chunk);
    chunk = [];
    chunkChars = 0;
  };

  for (const page of pages) {
    const lines = page.text.split("\n");
    let segment = "";
    const segments: string[] = [];
    for (const line of lines) {
      const pieces =
        line.length > maxCharsPerChunk
          ? (line.match(new RegExp(`.{1,${maxCharsPerChunk}}`, "g")) ?? [line])
          : [line];
      for (const piece of pieces) {
        if (segment && segment.length + piece.length + 1 > maxCharsPerChunk) {
          segments.push(segment);
          segment = "";
        }
        segment += `${segment ? "\n" : ""}${piece}`;
      }
    }
    if (segment) segments.push(segment);

    for (const text of segments) {
      const wouldExceedPages = chunk.length >= maxPagesPerChunk;
      const wouldExceedChars =
        chunk.length > 0 && chunkChars + text.length > maxCharsPerChunk;
      if (wouldExceedPages || wouldExceedChars) flush();
      chunk.push({ page: page.page, text });
      chunkChars += text.length;
    }
  }
  flush();
  return chunks;
}

// profile defaults to "medical" — matches this migration's own backfill
// decision (every book that existed before the profile column did was
// created by this pipeline back when it only ever did medical content), so
// a caller that doesn't pass a profile keeps getting the exact original
// behavior rather than silently drifting to generic wording.
export function buildChapterAnalysisMessages(
  chapterTitle: string,
  pages: BookPageInput[],
  profile: BookProfile = "medical"
): Message[] {
  const source = pages
    .map(page => `\n===== PDF PAGE ${page.page} =====\n${page.text}`)
    .join("\n");
  const subjectLabel = PROFILE_SUBJECT_LABEL[profile];
  const termsInstruction =
    profile === "medical"
      ? "important medical terms (Arabic + English + a simple pronunciation guide)"
      : "important terms/vocabulary a student of this subject should memorize (Arabic + English + a simple pronunciation guide when relevant, otherwise leave pronunciation empty)";

  return [
    {
      role: "system",
      content: [
        `You are a meticulous, encouraging study coach writing for a student who finds English difficult and forgets quickly.`,
        `You are given the raw text of one chapter (or part of one) from a ${subjectLabel}, titled "${chapterTitle}".`,
        `Produce: a simple Arabic explanation, a concise exam-focused English explanation, key points, ${termsInstruction}, flashcards, and 4-option multiple-choice questions.`,
        "Cover the material thoroughly — do not skip sections. Every flashcard and MCQ must cite the real PDF page number (sourcePage) it came from, using the PDF PAGE markers below.",
        "Do not invent facts not present in the source text. If the source text is too thin or unclear to extract real content from, say so plainly in explanationAr/explanationEn instead of inventing filler.",
        "Write ONLY in Arabic and English — every field in every language, never any third language, never mix scripts within a field.",
        "Return JSON only.",
      ].join("\n"),
    },
    { role: "user", content: `Analyze this chapter:\n${source}` },
  ];
}

// Used only when a chapter was split into more than one sub-chunk — merges
// each sub-chunk's own partial summary into one coherent whole-chapter
// summary, rather than either losing earlier content (keeping only the last
// sub-chunk's summary) or wastefully re-summarizing for the common case of
// a single sub-chunk.
export function buildSummaryMergeMessages(
  summaries: string[],
  keyPoints: string[]
): Message[] {
  return [
    {
      role: "system",
      content:
        "You merge partial chapter summaries into ONE coherent Arabic summary of the whole chapter, 3-5 sentences, simple language. Return JSON only, matching the given schema.",
    },
    {
      role: "user",
      content: `Partial summaries:\n${summaries.map((summary, i) => `(${i + 1}) ${summary}`).join("\n")}\n\nKey points:\n${keyPoints.map(point => `- ${point}`).join("\n")}`,
    },
  ];
}

export const summaryMergeResponseSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "chapter_summary_merge",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { chapterSummary: { type: "string" } },
      required: ["chapterSummary"],
    },
  },
};

export function parseChapterAnalysis(content: unknown): BookChapterAnalysis {
  return parseJsonResponse(content) as unknown as BookChapterAnalysis;
}

export function parseSummaryMerge(content: unknown): {
  chapterSummary: string;
} {
  return parseJsonResponse(content) as unknown as { chapterSummary: string };
}

export type MergedChapterAnalysis = {
  explanationAr: string;
  explanationEn: string;
  keyPoints: string[];
  medicalTerms: BookChapterAnalysis["medicalTerms"];
  flashcards: BookChapterAnalysis["flashcards"];
  mcqs: BookChapterAnalysis["mcqs"];
  summaries: string[];
};

// Audit Phase 6 — real hierarchical mind map generation. Deliberately reads
// ONLY this chapter's own already-generated explanation/keyPoints/terms
// (never the raw PDF text again) — it is purely reorganizing content this
// chapter already produced into Sections -> Key concepts, so it can never
// introduce a fact the chapter's own analysis didn't already contain. The
// real page numbers come from the chapter's own flashcards/MCQs' sourcePage
// values (validPages), and the model's own sourcePages are then intersected
// back against that known-real set (parseMindMapSections) so a section can
// never claim a page this chapter never actually covered.
export const mindMapSectionsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          explanationAr: {
            type: "string",
            description:
              "A short (1-2 sentence) Arabic explanation of this section.",
          },
          sourcePages: {
            type: "array",
            items: { type: "integer" },
            description:
              "Real page numbers (from the ones given below) this section covers.",
          },
          concepts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                termAr: { type: "string" },
                termEn: { type: "string" },
                explanationAr: { type: "string" },
              },
              required: ["termAr", "termEn", "explanationAr"],
            },
          },
        },
        required: ["title", "explanationAr", "sourcePages", "concepts"],
      },
    },
  },
  required: ["sections"],
};

export const mindMapSectionsResponseSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "chapter_mind_map_sections",
    strict: true,
    schema: mindMapSectionsSchema,
  },
};

export type ChapterMindMapSection = {
  title: string;
  explanationAr: string;
  sourcePages: number[];
  concepts: { termAr: string; termEn: string; explanationAr: string }[];
};

export function buildMindMapSectionsMessages(
  chapterTitle: string,
  explanationAr: string,
  keyPoints: string[],
  terms: { ar: string; en: string }[],
  validPages: number[]
): Message[] {
  return [
    {
      role: "system",
      content: [
        `You organize an already-written Arabic chapter explanation into a hierarchical mind map: a few real Sections, each with its own key concepts.`,
        `Use ONLY the content given below — do not add any fact, term, or page number that isn't already present in it.`,
        `Every section's sourcePages must be a subset of this chapter's real pages: ${validPages.join(", ")}.`,
        "Return JSON only.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Chapter: "${chapterTitle}"`,
        `Explanation:\n${explanationAr}`,
        `Key points:\n${keyPoints.map(point => `- ${point}`).join("\n")}`,
        `Terms:\n${terms.map(term => `- ${term.ar} / ${term.en}`).join("\n")}`,
      ].join("\n\n"),
    },
  ];
}

export function parseMindMapSections(
  content: unknown,
  validPages: number[]
): ChapterMindMapSection[] {
  const parsed = parseJsonResponse(content) as unknown as {
    sections: ChapterMindMapSection[];
  };
  const validPageSet = new Set(validPages);
  return parsed.sections.map(section => ({
    ...section,
    // Defensive intersection (see comment above) — never trust the model's
    // own page numbers as-is, only what this chapter can actually prove.
    sourcePages: section.sourcePages.filter(page => validPageSet.has(page)),
  }));
}

// Audit Phase 5 — Question Validation Agent, part 1: deterministic duplicate
// detection (no LLM needed — two questions asking literally the same thing
// don't need a model to notice). Pure and DB-free, same rationale as
// computeCoverageDetail/computeBookRollupStatus.
function normalizeForDuplicateCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();
}

export function findDuplicateMcqIds(
  mcqs: { id: string; questionEn: string }[]
): string[] {
  const seen = new Map<string, string>();
  const duplicateIds: string[] = [];
  for (const mcq of mcqs) {
    const key = normalizeForDuplicateCheck(mcq.questionEn);
    if (!key) continue;
    if (seen.has(key)) {
      duplicateIds.push(mcq.id);
    } else {
      seen.set(key, mcq.id);
    }
  }
  return duplicateIds;
}

// Audit Phase 5, part 2 — an LLM pass auditing the REMAINING (non-duplicate)
// MCQs for answer correctness and source grounding against this chapter's
// own explanation text. Never asked to invent new questions here — only to
// judge ones that already exist, so it can't introduce new ungrounded
// content itself.
export const mcqValidationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          valid: {
            type: "boolean",
            description:
              "true only if correctIndex is genuinely correct AND the question is answerable from the given chapter explanation.",
          },
          note: {
            type: "string",
            description:
              "Empty string if valid. Otherwise, briefly say why (wrong answer, not grounded in the given text, etc.).",
          },
        },
        required: ["id", "valid", "note"],
      },
    },
  },
  required: ["results"],
};

export const mcqValidationResponseSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "mcq_validation",
    strict: true,
    schema: mcqValidationSchema,
  },
};

export type McqValidationResult = { id: string; valid: boolean; note: string };

export function buildMcqValidationMessages(
  explanationEn: string,
  mcqs: {
    id: string;
    questionEn: string;
    choices: string[];
    correctIndex: number;
    explanationEn: string;
  }[]
): Message[] {
  return [
    {
      role: "system",
      content: [
        "You are a strict exam-question auditor. For each multiple-choice question given, judge ONLY from the chapter text provided below:",
        "1) Is the marked correct answer actually correct?",
        "2) Is the question answerable from this text (not testing something absent from it)?",
        "Mark valid=false for any question that fails either check. Return JSON only, one result per question id given, in the same order.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Chapter text:\n${explanationEn}`,
        `Questions:\n${mcqs
          .map(
            mcq =>
              `id=${mcq.id}: ${mcq.questionEn}\nChoices: ${mcq.choices.join(" | ")}\nMarked correct: ${mcq.choices[mcq.correctIndex]}\nExplanation given: ${mcq.explanationEn}`
          )
          .join("\n\n")}`,
      ].join("\n\n"),
    },
  ];
}

export function parseMcqValidation(content: unknown): McqValidationResult[] {
  const parsed = parseJsonResponse(content) as unknown as {
    results: McqValidationResult[];
  };
  return parsed.results;
}

// Audit Phase 5, part 3 — coverage-based gap-filling: pages within a
// chapter's own real range that no trustworthy (non-flagged) MCQ currently
// covers. Pure and DB-free, same rationale as the other compute* helpers.
export function findUncoveredPages(
  startPage: number,
  endPage: number,
  coveredPages: number[]
): number[] {
  const covered = new Set(coveredPages);
  const uncovered: number[] = [];
  for (let page = startPage; page <= endPage; page++) {
    if (!covered.has(page)) uncovered.push(page);
  }
  return uncovered;
}

// Generates MCQs for exactly the given gap pages, grounded in this
// chapter's own already-extracted page text (the same text
// buildChapterAnalysisMessages used originally) — never invented from
// nothing, and never asked to touch any page outside the given gap.
export const gapQuestionsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mcqs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          questionEn: { type: "string" },
          choices: {
            type: "array",
            items: { type: "string" },
            minItems: 4,
            maxItems: 4,
          },
          correctIndex: {
            type: "integer",
            description: "0-based index into choices of the correct answer.",
          },
          explanationEn: { type: "string" },
          sourcePage: { type: "integer" },
        },
        required: [
          "questionEn",
          "choices",
          "correctIndex",
          "explanationEn",
          "sourcePage",
        ],
      },
    },
  },
  required: ["mcqs"],
};

export const gapQuestionsResponseSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "gap_fill_mcqs",
    strict: true,
    schema: gapQuestionsSchema,
  },
};

export type GapMcq = {
  questionEn: string;
  choices: string[];
  correctIndex: number;
  explanationEn: string;
  sourcePage: number;
};

export function buildGapQuestionsMessages(
  chapterTitle: string,
  gapPages: BookPageInput[]
): Message[] {
  const source = gapPages
    .map(page => `\n===== PDF PAGE ${page.page} =====\n${page.text}`)
    .join("\n");
  return [
    {
      role: "system",
      content: [
        `You write 4-option multiple-choice questions for a chapter titled "${chapterTitle}".`,
        "One question per page given below is enough — every question's sourcePage must be one of the exact page numbers given.",
        "Do not invent facts not present in the given text.",
        "Return JSON only.",
      ].join("\n"),
    },
    { role: "user", content: `Pages needing questions:\n${source}` },
  ];
}

export function parseGapQuestions(
  content: unknown,
  gapPages: number[]
): GapMcq[] {
  const parsed = parseJsonResponse(content) as unknown as { mcqs: GapMcq[] };
  const gapPageSet = new Set(gapPages);
  return parsed.mcqs.filter(mcq => gapPageSet.has(mcq.sourcePage));
}

// Audit Phase 7 — connects a chapter's already-written explanation to its
// real, already-extracted visual assets (images/diagrams/tables). Runs
// LATER than and independently of chapter analysis (visual analysis itself
// finishes on its own schedule, per-page, often after chapter analysis) —
// this never re-reads the raw PDF and never touches explanationAr/En
// themselves; it only writes a separate, additive note connecting the two,
// grounded strictly in the visual descriptions given below.
export const visualInsightsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    visualInsightsAr: {
      type: "string",
      description:
        "A short Arabic paragraph (2-4 sentences) explaining how the chapter's images/diagrams/tables relate to its explanation, citing real page numbers. Empty string if the visuals given add nothing beyond what the explanation already covers.",
    },
  },
  required: ["visualInsightsAr"],
};

export const visualInsightsResponseSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "chapter_visual_insights",
    strict: true,
    schema: visualInsightsSchema,
  },
};

export function buildVisualInsightsMessages(
  explanationAr: string,
  visuals: {
    pageNumber: number;
    assetType: string;
    descriptionAr: string | null;
  }[]
): Message[] {
  return [
    {
      role: "system",
      content: [
        "You connect a chapter's Arabic explanation to its real images/diagrams/tables, described below.",
        "Use ONLY the descriptions given — never guess what a figure shows beyond its given description.",
        "Cite real page numbers from the list given. If the visuals genuinely add nothing new beyond the explanation, return an empty string.",
        "Return JSON only.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Chapter explanation:\n${explanationAr}`,
        `Visuals:\n${visuals
          .map(
            v =>
              `Page ${v.pageNumber} (${v.assetType}): ${v.descriptionAr || "(no description)"}`
          )
          .join("\n")}`,
      ].join("\n\n"),
    },
  ];
}

export function parseVisualInsights(content: unknown): string {
  const parsed = parseJsonResponse(content) as unknown as {
    visualInsightsAr: string;
  };
  return parsed.visualInsightsAr;
}

export function mergeSubChunkResults(
  results: BookChapterAnalysis[]
): MergedChapterAnalysis {
  return {
    explanationAr: results.map(result => result.explanationAr).join("\n\n"),
    explanationEn: results.map(result => result.explanationEn).join("\n\n"),
    keyPoints: results.flatMap(result => result.keyPoints),
    medicalTerms: results.flatMap(result => result.medicalTerms),
    flashcards: results.flatMap(result => result.flashcards),
    mcqs: results.flatMap(result => result.mcqs),
    summaries: results.map(result => result.chapterSummary),
  };
}
