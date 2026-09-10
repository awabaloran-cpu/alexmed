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
