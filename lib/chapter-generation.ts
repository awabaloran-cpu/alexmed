// Chunk-by-chunk generation for كتبي study tools — the fix for "cards /
// questions / mind map / notes built from the beginning of the document".
//
// Before: each generator sent the whole chapter in ONE call with a small
// output budget (3000 tokens for cards/MCQs), so the model wrote a handful
// of items, mostly from the first pages, and nothing checked where they
// came from. Now every generator:
//   1. splits the chapter into chunks covering every page (buildDocumentChunks),
//   2. makes one call per chunk, asking for a count proportional to that
//      chunk's real content (targetItemCount),
//   3. keeps only items whose sourcePage really belongs to that chunk,
//   4. de-duplicates across chunks,
//   5. runs the Quality Gate (validateOutputCoverage) and retries, once,
//      exactly the content chunks that produced nothing,
//   6. returns the items WITH the coverage verdict, so it can be stored in
//      the manifest and shown — never a silent "complete".
//
// The LLM is injected (`llm`), so the real pipeline and the 40-page
// regression test run this exact code.
import {
  buildChapterFlashcardsMessages,
  buildChapterMcqsMessages,
  buildMindMapSectionsMessages,
  chapterFlashcardsResponseSchema,
  chapterMcqsResponseSchema,
  mindMapSectionsResponseSchema,
  parseChapterFlashcards,
  parseChapterMcqs,
  parseMindMapSections,
  type BookPageInput,
  type ChapterFlashcard,
  type ChapterMcq,
  type ChapterMindMapSection,
} from "./book-analysis";
import {
  buildDocumentChunks,
  classifyPages,
  targetItemCount,
  validateOutputCoverage,
  type DocumentChunk,
  type OutputCoverage,
  type OutputKind,
  type PageType,
  type SummarySection,
} from "./document-coverage";
import type { InvokeParams, InvokeResult } from "./llm";
import {
  buildMedicalNoteComposerMessages,
  medicalNotePagesResponseSchema,
  parseMedicalNotePages,
  type MedicalNotePage,
} from "./medical-note-composer";

export type Llm = (params: InvokeParams) => Promise<InvokeResult>;

export type ChunkedResult<T> = {
  items: T[];
  coverage: OutputCoverage;
  chunks: DocumentChunk[];
  pageTypes: Record<number, PageType>;
  errors: string[];
};

// A few chunks at a time — enough to keep a long chapter fast, low enough
// not to trip provider rate limits or the per-user queue budget.
const CHUNK_CONCURRENCY = 3;

// Output budgets include room for "thinking": the gateway's models are
// reasoning models (nemotron-3, glm-5.3, gemini-2.5), and their hidden
// reasoning counts against max_tokens — observed live 2026-09-24, a 5000-token
// mind-map budget ran out before any JSON was written, on every model.
// max_tokens is a ceiling, not a cost: short answers still stop early.
export const REASONING_HEADROOM_TOKENS = 6000;
export function generationBudget(answerTokens: number): number {
  return Math.min(16000, REASONING_HEADROOM_TOKENS + 1500 + answerTokens);
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

function partLabel(chunk: DocumentChunk, total: number): string {
  return `part ${chunk.index + 1} of ${total}, pages ${chunk.pageStart}–${chunk.pageEnd}`;
}

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();
}

// An item's sourcePage must be a page of the chunk it was generated from.
// A single-page chunk can only have come from that page, so an off-by-one
// or missing citation there is repaired; otherwise it's dropped (never
// guessed onto a page it may not be grounded in).
function groundToChunk<T extends { sourcePage: number }>(
  items: T[],
  chunk: DocumentChunk
): T[] {
  const pages = new Set(chunk.pages);
  return items.flatMap(item => {
    // Some models (gpt-5.6-luna, observed 2026-09-24) write the page number
    // as a string ("35") despite the integer schema — normalize, never drop.
    const sourcePage = Number(item.sourcePage);
    if (pages.has(sourcePage)) return [{ ...item, sourcePage }];
    if (chunk.pages.length === 1)
      return [{ ...item, sourcePage: chunk.pages[0] }];
    return [];
  });
}

type PerChunkGenerator<T> = (
  chunkPages: BookPageInput[],
  chunk: DocumentChunk,
  options: { targetCount: number; mustCover: boolean }
) => Promise<T[]>;

async function generateAcrossChunks<T>(
  kind: OutputKind,
  pages: BookPageInput[],
  generateForChunk: PerChunkGenerator<T>,
  sourcePagesOf: (item: T) => number[],
  dedupeKey: (item: T) => string
): Promise<ChunkedResult<T>> {
  const pageTypes = classifyPages(pages);
  const { chunks, chunkPages } = buildDocumentChunks(pages);
  const errors: string[] = [];
  const perChunk: T[][] = chunks.map(() => []);

  async function run(chunkIndexes: number[], mustCover: boolean) {
    await mapWithConcurrency(chunkIndexes, CHUNK_CONCURRENCY, async index => {
      const chunk = chunks[index];
      try {
        const items = await generateForChunk(chunkPages[index], chunk, {
          targetCount: targetItemCount(chunkPages[index], pageTypes),
          mustCover,
        });
        perChunk[index] = [...perChunk[index], ...items];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(
          `${chunk.id} (pages ${chunk.pageStart}–${chunk.pageEnd}): ${message}`
        );
      }
    });
  }

  function collect(): T[] {
    const seen = new Set<string>();
    const items: T[] = [];
    for (const group of perChunk) {
      for (const item of group) {
        const key = dedupeKey(item);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        items.push(item);
      }
    }
    return items;
  }

  await run(
    chunks.map(chunk => chunk.index),
    false
  );
  let items = collect();
  let coverage = validateOutputCoverage(
    kind,
    chunks,
    pageTypes,
    items.map(sourcePagesOf)
  );

  // Quality Gate retry — only the content chunks that produced nothing.
  if (coverage.uncoveredChunks.length) {
    const retryIndexes = chunks
      .filter(chunk => coverage.uncoveredChunks.includes(chunk.id))
      .map(chunk => chunk.index);
    await run(retryIndexes, true);
    items = collect();
    coverage = validateOutputCoverage(
      kind,
      chunks,
      pageTypes,
      items.map(sourcePagesOf)
    );
  }
  if (errors.length)
    coverage = { ...coverage, reasons: [...coverage.reasons, ...errors] };

  return { items, coverage, chunks, pageTypes, errors };
}

// ── Flashcards ────────────────────────────────────────────────────────────
export async function generateChapterFlashcardsCovered(
  title: string,
  pages: BookPageInput[],
  llm: Llm
): Promise<ChunkedResult<ChapterFlashcard>> {
  const chunkCount = buildDocumentChunks(pages).chunks.length;
  const pageTypes = classifyPages(pages);
  return generateAcrossChunks<ChapterFlashcard>(
    "flashcards",
    pages,
    async (chunkPages, chunk, { targetCount, mustCover }) => {
      const response = await llm({
        max_tokens: generationBudget(targetCount * 450),
        messages: buildChapterFlashcardsMessages(title, chunkPages, {
          targetCount,
          pageTypes,
          partLabel: chunkCount > 1 ? partLabel(chunk, chunkCount) : undefined,
          mustCover,
        }),
        response_format: chapterFlashcardsResponseSchema,
      });
      return groundToChunk(
        parseChapterFlashcards(response.choices[0]?.message.content),
        chunk
      );
    },
    card => [card.sourcePage],
    card => normalizeKey(card.questionEn)
  );
}

// ── MCQs ──────────────────────────────────────────────────────────────────
function isWellFormedMcq(mcq: ChapterMcq): boolean {
  return (
    Array.isArray(mcq.choices) &&
    mcq.choices.length === 4 &&
    Number.isInteger(mcq.correctIndex) &&
    mcq.correctIndex >= 0 &&
    mcq.correctIndex < 4 &&
    !!mcq.questionEn?.trim()
  );
}

export async function generateChapterMcqsCovered(
  title: string,
  pages: BookPageInput[],
  llm: Llm
): Promise<ChunkedResult<ChapterMcq>> {
  const chunkCount = buildDocumentChunks(pages).chunks.length;
  const pageTypes = classifyPages(pages);
  return generateAcrossChunks<ChapterMcq>(
    "mcqs",
    pages,
    async (chunkPages, chunk, { targetCount, mustCover }) => {
      const response = await llm({
        max_tokens: generationBudget(targetCount * 500),
        messages: buildChapterMcqsMessages(title, chunkPages, {
          targetCount,
          pageTypes,
          partLabel: chunkCount > 1 ? partLabel(chunk, chunkCount) : undefined,
          mustCover,
        }),
        response_format: chapterMcqsResponseSchema,
      });
      return groundToChunk(
        parseChapterMcqs(response.choices[0]?.message.content).filter(
          isWellFormedMcq
        ),
        chunk
      );
    },
    mcq => [mcq.sourcePage],
    mcq => normalizeKey(mcq.questionEn)
  );
}

// ── Structured summary (AI medical notes) ─────────────────────────────────
export async function generateChapterNotesCovered(
  input: Omit<
    Parameters<typeof buildMedicalNoteComposerMessages>[0],
    "pages" | "partLabel"
  >,
  pages: BookPageInput[],
  summarySections: SummarySection[] | undefined,
  llm: Llm
): Promise<ChunkedResult<MedicalNotePage>> {
  const chunkCount = buildDocumentChunks(pages).chunks.length;
  return generateAcrossChunks<MedicalNotePage>(
    "notes",
    pages,
    async (chunkPages, chunk) => {
      const section = summarySections?.find(
        s => s.pageStart <= chunk.pageEnd && s.pageEnd >= chunk.pageStart
      );
      const response = await llm({
        max_tokens: REASONING_HEADROOM_TOKENS + 7000,
        messages: buildMedicalNoteComposerMessages({
          ...input,
          // Per part: its own analysis summary instead of re-sending the
          // whole-chapter explanation with every chunk.
          ...(chunkCount > 1
            ? {
                explanationEn: "",
                explanationAr: "",
                summary: section?.summary ?? input.summary,
                partLabel: partLabel(chunk, chunkCount),
              }
            : {}),
          visuals: input.visuals.filter(v =>
            chunk.pages.includes(v.pageNumber)
          ),
          pages: chunkPages,
        }),
        response_format: medicalNotePagesResponseSchema,
      });
      return parseMedicalNotePages(
        response.choices[0]?.message.content,
        chunk.pages
      );
    },
    page =>
      Array.from(
        new Set([
          ...page.sourcePages,
          ...page.blocks.flatMap(block => block.sourcePages),
        ])
      ),
    page => normalizeKey(page.title) + "|" + page.sourcePages.join(",")
  );
}

// ── Mind map ──────────────────────────────────────────────────────────────
// Built from the chapter's already-generated content (unchanged grounding
// rule), but now organized over every chunk: each part's own analysis
// summary + page range is given, sections are validated against chunks,
// and uncovered parts get one targeted retry.
export async function generateChapterMindMapCovered(
  args: {
    title: string;
    explanationEn: string;
    explanationAr: string;
    keyPoints: string[];
    terms: { ar: string; en: string }[];
    flashcards: { questionEn: string; answerEn: string; sourcePage: number }[];
    mcqs: { questionEn: string; explanationEn: string; sourcePage: number }[];
    validPages: number[];
    summarySections?: SummarySection[];
  },
  pages: BookPageInput[],
  llm: Llm
): Promise<ChunkedResult<ChapterMindMapSection>> {
  const pageTypes = classifyPages(pages);
  const { chunks } = buildDocumentChunks(pages);
  const parts = chunks.map(chunk => ({
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    summary:
      args.summarySections?.find(
        s => s.pageStart <= chunk.pageEnd && s.pageEnd >= chunk.pageStart
      )?.summary ?? "",
  }));
  const errors: string[] = [];

  async function attempt(mustCover?: { pageStart: number; pageEnd: number }[]) {
    const response = await llm({
      max_tokens: REASONING_HEADROOM_TOKENS + 5000,
      messages: buildMindMapSectionsMessages(
        args.title,
        args.explanationEn,
        args.explanationAr,
        args.keyPoints,
        args.terms,
        args.flashcards,
        args.mcqs,
        args.validPages,
        chunks.length > 1 ? parts : undefined,
        mustCover
      ),
      response_format: mindMapSectionsResponseSchema,
    });
    return parseMindMapSections(
      response.choices[0]?.message.content,
      args.validPages
    );
  }

  // One retry on a malformed (non-JSON) response before giving up — seen
  // live with a free-tier model answering in prose.
  let sections: ChapterMindMapSection[];
  try {
    sections = await attempt();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    sections = await attempt();
  }
  let coverage = validateOutputCoverage(
    "mindmap",
    chunks,
    pageTypes,
    sections.map(section => section.sourcePages)
  );
  if (coverage.uncoveredChunks.length) {
    try {
      const missing = chunks
        .filter(chunk => coverage.uncoveredChunks.includes(chunk.id))
        .map(chunk => ({
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
        }));
      const retried = await attempt(missing);
      const retriedCoverage = validateOutputCoverage(
        "mindmap",
        chunks,
        pageTypes,
        retried.map(section => section.sourcePages)
      );
      if (
        retriedCoverage.chunkCoveragePercent >= coverage.chunkCoveragePercent
      ) {
        sections = retried;
        coverage = retriedCoverage;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { items: sections, coverage, chunks, pageTypes, errors };
}

// ── Summary coverage (from chapter analysis) ──────────────────────────────
// The chapter summary is already hierarchical (analyze-chapter: one analysis
// per sub-chunk, then a merge call over ALL sub-chunk summaries). This turns
// that into provable coverage: each sub-chunk that produced a non-empty
// summary covers its own pages.
export function summaryCoverageFromSections(
  pages: BookPageInput[],
  sections: SummarySection[]
): OutputCoverage {
  const pageTypes = classifyPages(pages);
  const { chunks } = buildDocumentChunks(pages);
  return validateOutputCoverage(
    "summary",
    chunks,
    pageTypes,
    sections
      .filter(section => section.summary.trim())
      .map(section =>
        chunks
          .filter(
            chunk =>
              chunk.pageStart <= section.pageEnd &&
              chunk.pageEnd >= section.pageStart
          )
          .flatMap(chunk => chunk.pages)
      )
  );
}
