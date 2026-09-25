// Full-document coverage for كتبي generation — pure, no I/O, so every rule
// here is unit-testable and the same code runs in the workers and in the
// 40-page regression test.
//
// The core distinction this file exists for: FULL EXTRACTION IS NOT FULL
// GENERATION. A book can have 40/40 pages extracted and still produce
// cards/questions/mind-map built only from its first chunk. So coverage is
// tracked at three levels — pages extracted, pages placed into chunks, and
// chunks that actually produced output (via each item's sourcePages) — and
// the Quality Gate judges the last one.
import type { KnowledgeCoverage } from "./knowledge-study";
import { chunkChapterPages, type BookPageInput } from "./book-analysis";

// ── Page classification ──────────────────────────────────────────────────
// Labels only. A "metadata" page (lecturer bio, objectives, references) is
// NEVER removed from processing — it is still extracted, chunked and sent
// to the model; the label just tells the model (and the manifest) what the
// page is, and lets the Quality Gate not demand exam questions from a
// title page.
export type PageType = "metadata" | "educational_content" | "mixed" | "unknown";

const METADATA_PATTERNS: RegExp[] = [
  /\b(dr|prof|professor|lecturer|assistant professor|consultant)\b\.?/i,
  /\b(prepared|presented|written|compiled|edited)\s+by\b/i,
  /\b(learning\s+)?(objectives|outcomes|aims)\b/i,
  /\b(course|module|syllabus|semester|academic year|lecture\s+\d+)\b/i,
  /\b(university|faculty|college|department|school of)\b/i,
  /\b(table of contents|contents|index)\b/i,
  /\b(references|bibliography|further reading|acknowledg(e)?ments?)\b/i,
  /\b(copyright|all rights reserved|isbn)\b/i,
  /\b(about the (author|lecturer)|biography|curriculum vitae|cv)\b/i,
  /[\w.+-]+@[\w-]+\.[\w.]+/, // e-mail address
  /(الدكتور|الدكتورة|د\.|أ\.د|إعداد|تقديم|أهداف|الأهداف|جامعة|كلية|قسم|المحاضرة|المراجع|الفهرس|مقدمة|نبذة)/,
];

const EDUCATIONAL_PATTERNS: RegExp[] = [
  /\b(diagnos\w*|differential|investigations?|work-?up)\b/i,
  /\b(treatment|management|therapy|drug of choice|first[- ]line|dose|mg|surgery|surgical)\b/i,
  /\b(clinical (features|presentation|picture)|signs?|symptoms?|presents? with)\b/i,
  /\b(patho(physiology|genesis|logy)|a?etiology|causes?|risk factors?|mechanism)\b/i,
  /\b(complications?|prognosis|incidence|prevalence|epidemiology)\b/i,
  /\b(syndrome|disease|disorder|infection|tumou?r|carcinoma|deficiency|inflammation)\b/i,
  /\b(anatomy|artery|vein|nerve|muscle|gland|hormone|enzyme|receptor)\b/i,
  /\b(ct|mri|x-?ray|ultrasound|ecg|biopsy|culture|serum|level)\b/i,
  /\b(defined as|is characteri[sz]ed by|classification|types? of|stages?)\b/i,
  /(تشخيص|علاج|أعراض|مرض|متلازمة|أسباب|مضاعفات|جرعة|التهاب|تصنيف|آلية)/,
];

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce(
    (sum, pattern) => sum + (pattern.test(text) ? 1 : 0),
    0
  );
}

export function classifyPageType(text: string): PageType {
  const trimmed = text.trim();
  if (trimmed.length < 40) return "unknown";
  const metadata = countMatches(trimmed, METADATA_PATTERNS);
  const educational = countMatches(trimmed, EDUCATIONAL_PATTERNS);
  // A table of contents / course-info page names diseases too, but its
  // metadata signals clearly dominate — that's still a metadata page.
  if (metadata >= 3 && metadata > educational) return "metadata";
  if (educational >= 2 && metadata >= 2) return "mixed";
  if (educational >= 2) return "educational_content";
  if (metadata >= 2) return educational ? "mixed" : "metadata";
  if (educational === 1) return "educational_content";
  if (metadata === 1) return "metadata";
  return "unknown";
}

export function classifyPages(
  pages: BookPageInput[]
): Record<number, PageType> {
  const result: Record<number, PageType> = {};
  for (const page of pages) result[page.page] = classifyPageType(page.text);
  return result;
}

// ── Extraction coverage ──────────────────────────────────────────────────
export type CoverageStatus = "COMPLETE" | "PARTIAL" | "FAILED";

export type ExtractionCoverage = {
  totalPages: number;
  extractedPages: number;
  failedPages: number[];
  missingPages: number[];
  coveragePercent: number;
  status: CoverageStatus;
};

export function validateExtractionCoverage(
  totalPages: number,
  pages: { page: number; text: string; failed?: boolean }[]
): ExtractionCoverage {
  const byPage = new Map(pages.map(page => [page.page, page]));
  const missingPages: number[] = [];
  const failedPages: number[] = [];
  let extractedPages = 0;
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    const page = byPage.get(pageNumber);
    if (!page) missingPages.push(pageNumber);
    else if (page.failed) failedPages.push(pageNumber);
    else extractedPages += 1;
  }
  const coveragePercent =
    totalPages > 0 ? Math.round((extractedPages / totalPages) * 100) : 0;
  return {
    totalPages,
    extractedPages,
    failedPages,
    missingPages,
    coveragePercent,
    status:
      totalPages === 0 || extractedPages === 0
        ? "FAILED"
        : extractedPages === totalPages
          ? "COMPLETE"
          : "PARTIAL",
  };
}

// ── Chunking the ENTIRE document ─────────────────────────────────────────
export type DocumentChunk = {
  id: string;
  index: number;
  pageStart: number;
  pageEnd: number;
  pages: number[];
  charCount: number;
  tokenEstimate: number;
};

// Rough, provider-agnostic estimate (~4 chars/token for English, Arabic
// denser) — used for the manifest and budgeting, never to cut text.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// Every page goes into exactly one chunk, in order (chunkChapterPages never
// drops text: an over-long page is split across chunks, not truncated).
export function buildDocumentChunks(
  pages: BookPageInput[],
  maxPagesPerChunk?: number,
  maxCharsPerChunk?: number
): { chunks: DocumentChunk[]; chunkPages: BookPageInput[][] } {
  const ordered = [...pages].sort((a, b) => a.page - b.page);
  const chunkPages = chunkChapterPages(
    ordered,
    maxPagesPerChunk,
    maxCharsPerChunk
  );
  const chunks = chunkPages.map((group, index) => {
    const pageNumbers = Array.from(new Set(group.map(page => page.page)));
    const text = group.map(page => page.text).join("\n");
    return {
      id: `chunk-${index + 1}`,
      index,
      pageStart: Math.min(...pageNumbers),
      pageEnd: Math.max(...pageNumbers),
      pages: pageNumbers,
      charCount: text.length,
      tokenEstimate: estimateTokens(text),
    };
  });
  return { chunks, chunkPages };
}

export function validateChunkCoverage(
  pages: BookPageInput[],
  chunks: DocumentChunk[]
): { missingPages: number[]; complete: boolean } {
  const chunked = new Set(chunks.flatMap(chunk => chunk.pages));
  const missingPages = pages
    .filter(page => page.text.trim().length > 0 && !chunked.has(page.page))
    .map(page => page.page)
    .sort((a, b) => a - b);
  return { missingPages, complete: missingPages.length === 0 };
}

// How many items to ask for from one chunk — proportional to how much real
// content it holds (metadata pages count at a quarter weight: still sent,
// just not worth ten exam questions), never a fixed per-chunk number.
export function targetItemCount(
  chunkPages: BookPageInput[],
  pageTypes: Record<number, PageType>,
  charsPerItem = 900,
  max = 12
): number {
  const weighted = chunkPages.reduce((sum, page) => {
    const weight = pageTypes[page.page] === "metadata" ? 0.25 : 1;
    return sum + page.text.trim().length * weight;
  }, 0);
  return Math.max(1, Math.min(max, Math.round(weighted / charsPerItem)));
}

// ── Generation coverage (the Quality Gate) ───────────────────────────────
export type OutputKind =
  | "summary"
  | "flashcards"
  | "mcqs"
  | "mindmap"
  | "notes";

export type OutputCoverage = {
  kind: OutputKind;
  itemCount: number;
  totalChunks: number;
  requiredChunks: string[];
  coveredChunks: string[];
  uncoveredChunks: string[];
  coveredPages: number[];
  chunkCoveragePercent: number;
  status: CoverageStatus;
  reasons: string[];
  // 🧠 Set when the output was derived from Knowledge Items (Exam Focus
  // facts) — coverage judged per fact, not only per chunk.
  knowledge?: KnowledgeCoverage;
};

// A chunk "requires" output when it holds any non-metadata text — a chunk
// that is purely a title/bio page isn't a coverage failure for having no
// exam questions. (If the whole document is metadata-only, every chunk is
// required, so nothing can pass by being labelled.)
function requiredChunkIds(
  chunks: DocumentChunk[],
  pageTypes: Record<number, PageType>
): string[] {
  const required = chunks.filter(chunk =>
    chunk.pages.some(page => pageTypes[page] !== "metadata")
  );
  return (required.length ? required : chunks).map(chunk => chunk.id);
}

// Judges whether an output was generated from the WHOLE document: every
// item's sourcePages are mapped back to the chunk(s) they came from.
// FAILED when fewer than half the required chunks produced anything, or
// when nothing at all came from the second half of the document — i.e.
// exactly the "40 pages extracted, questions only from pages 1–3" bug —
// regardless of extraction coverage being 100%.
export function validateOutputCoverage(
  kind: OutputKind,
  chunks: DocumentChunk[],
  pageTypes: Record<number, PageType>,
  itemSourcePages: number[][]
): OutputCoverage {
  const chunkByPage = new Map<number, string[]>();
  for (const chunk of chunks) {
    for (const page of chunk.pages) {
      chunkByPage.set(page, [...(chunkByPage.get(page) ?? []), chunk.id]);
    }
  }
  const covered = new Set<string>();
  const coveredPages = new Set<number>();
  for (const sourcePages of itemSourcePages) {
    for (const page of sourcePages) {
      const ids = chunkByPage.get(page);
      if (!ids) continue;
      coveredPages.add(page);
      for (const id of ids) covered.add(id);
    }
  }

  const required = requiredChunkIds(chunks, pageTypes);
  const coveredRequired = required.filter(id => covered.has(id));
  const uncovered = required.filter(id => !covered.has(id));
  const percent = required.length
    ? Math.round((coveredRequired.length / required.length) * 100)
    : 100;

  const reasons: string[] = [];
  let status: CoverageStatus = "COMPLETE";
  if (!itemSourcePages.length && required.length) {
    status = "FAILED";
    reasons.push("No output was generated.");
  } else if (required.length) {
    const secondHalf = required.slice(Math.floor(required.length / 2));
    const anyLate = secondHalf.some(id => covered.has(id));
    if (percent < 50) {
      status = "FAILED";
      reasons.push(
        `Only ${coveredRequired.length}/${required.length} content chunks produced output.`
      );
    }
    if (required.length >= 2 && !anyLate) {
      status = "FAILED";
      reasons.push(
        "Nothing was generated from the second half of the document — output is concentrated at the beginning."
      );
    }
    if (status !== "FAILED" && uncovered.length) {
      status = "PARTIAL";
      reasons.push(`Chunks without output: ${uncovered.join(", ")}.`);
    }
  }

  return {
    kind,
    itemCount: itemSourcePages.length,
    totalChunks: chunks.length,
    requiredChunks: required,
    coveredChunks: coveredRequired,
    uncoveredChunks: uncovered,
    coveredPages: [...coveredPages].sort((a, b) => a - b),
    chunkCoveragePercent: percent,
    status,
    reasons,
  };
}

// ── Processing manifest ──────────────────────────────────────────────────
export type SummarySection = {
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  summary: string;
};

export type ChapterCoverageManifest = {
  version: 1;
  updatedAt: string;
  totalPages: number;
  extractedPages: number;
  failedPages: number[];
  pageTypes: Record<number, PageType>;
  chunks: DocumentChunk[];
  chunksAnalyzed?: number;
  summarySections?: SummarySection[];
  outputs: Partial<Record<OutputKind, OutputCoverage>>;
  status: CoverageStatus;
  errors: string[];
};

export function worstStatus(statuses: CoverageStatus[]): CoverageStatus {
  if (statuses.includes("FAILED")) return "FAILED";
  if (statuses.includes("PARTIAL")) return "PARTIAL";
  return "COMPLETE";
}

// Builds (or refreshes) a chapter manifest from its pages. `previous`
// carries forward outputs recorded by earlier steps (analysis, then the
// on-demand generators each add their own entry).
export function buildChapterManifest(
  chapterPages: { page: number; text: string; failed?: boolean }[],
  previous: ChapterCoverageManifest | null,
  patch: Partial<
    Pick<
      ChapterCoverageManifest,
      "chunksAnalyzed" | "summarySections" | "errors"
    >
  > & { output?: OutputCoverage } = {}
): ChapterCoverageManifest {
  const inputs = chapterPages.map(({ page, text }) => ({ page, text }));
  const { chunks } = buildDocumentChunks(inputs);
  const failedPages = chapterPages
    .filter(page => page.failed || !page.text.trim())
    .map(page => page.page);
  const outputs = { ...(previous?.outputs ?? {}) };
  if (patch.output) outputs[patch.output.kind] = patch.output;
  const errors = patch.errors ?? previous?.errors ?? [];
  const statuses = Object.values(outputs).map(output => output!.status);
  if (failedPages.length) statuses.push("PARTIAL");
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    totalPages: chapterPages.length,
    extractedPages: chapterPages.length - failedPages.length,
    failedPages,
    pageTypes: classifyPages(inputs),
    chunks,
    chunksAnalyzed: patch.chunksAnalyzed ?? previous?.chunksAnalyzed,
    summarySections: patch.summarySections ?? previous?.summarySections,
    outputs,
    status: worstStatus(statuses),
    errors,
  };
}
