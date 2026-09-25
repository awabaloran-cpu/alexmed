// 🧠 Knowledge-based study tools — Flashcards and Questions built from the
// file's Knowledge Items instead of re-reading the PDF from scratch.
//
//   Document → Exam Focus extraction (whole file, deduped, sourcePages)
//            → Knowledge Items (= exam_focus_cards rows)
//            ├── Exam Focus  "What must I know?"      (unchanged)
//            ├── Flashcards  "Can I recall it?"       (this file)
//            └── Questions   "Can I apply / distinguish it?" (this file)
//
// Why: the V1 generators (lib/chapter-generation.ts) asked for ≤12 items
// per 8-page chunk from raw page text, so a 20-page file with 113 high-yield
// facts got ~36 cards/MCQs and nothing tied an item to the knowledge it
// tests. Here every card/question carries its knowledgeItemId and the fact's
// sourcePages, counts follow each fact's density and importance, and the
// result is judged per Knowledge Item (the Coverage Matrix), not per chunk.
//
// Pipeline per kind: batch the items → one call per batch (count requested
// per item) → deterministic Quality Gate → cross-batch dedupe → (questions
// only) AI verification against the items → one targeted retry for items
// left without output → coverage verdict. Pure logic; the LLM is injected
// (`llm`), so tests run this exact code. V1 stays the fallback when a file
// has no finished Exam Focus deck.
import type { ChapterFlashcard, ChapterMcq } from "./book-analysis";
import {
  generationBudget,
  mapWithConcurrency,
  type Llm,
} from "./chapter-generation";
import type { CoverageStatus } from "./document-coverage";
import type { ExamFocusCategory } from "./exam-focus-categories";
import { isDuplicateFact } from "./exam-focus";
import type { Message } from "./llm";
import {
  CARD_TYPES,
  QUESTION_TYPES,
  type CardType,
  type QuestionType,
} from "./knowledge-labels";
import { parseJsonResponse } from "./pdf-cards";

// ── Knowledge Items ──────────────────────────────────────────────────────
export type KnowledgeItem = {
  id: string; // exam_focus_cards.id
  category: ExamFocusCategory | string;
  topic: string;
  title: string;
  points: string[];
  highlightLabel: string;
  highlightText: string;
  sourcePages: number[];
};

// A fact belongs to the chapter holding its first cited page — so each
// Knowledge Item is studied in exactly one chapter, never twice.
export function primaryPage(item: Pick<KnowledgeItem, "sourcePages">): number {
  return item.sourcePages.length ? Math.min(...item.sourcePages) : 0;
}

export function itemsForPageRange<T extends Pick<KnowledgeItem, "sourcePages">>(
  items: T[],
  startPage: number,
  endPage: number
): T[] {
  return items.filter(item => {
    const page = primaryPage(item);
    return page >= startPage && page <= endPage;
  });
}

// Which question shapes fit a fact, by its Exam Focus category — so
// questions test application where the fact allows it, not just recall.
const QUESTION_TYPES_BY_CATEGORY: Record<string, QuestionType[]> = {
  emergency: ["next_best_step", "clinical_vignette", "management"],
  must_know: ["clinical_vignette", "recall"],
  high_yield: ["clinical_vignette", "association"],
  exam_trap: ["misconception", "differentiation"],
  numbers: ["recall", "clinical_vignette"],
  classification: ["recall", "differentiation"],
  comparison: ["differentiation", "clinical_vignette"],
  treatment: ["management", "next_best_step"],
  drug_dose: ["management", "recall"],
  contraindication: ["management", "misconception"],
  indication: ["management", "clinical_vignette"],
  clinical_clue: ["diagnosis", "clinical_vignette"],
  investigation: ["next_best_step", "diagnosis"],
  imaging: ["diagnosis", "next_best_step"],
  mechanism: ["association", "recall"],
  pathophysiology: ["association", "complication"],
  prognosis: ["complication", "recall"],
  definition: ["recall", "association"],
  association: ["association", "clinical_vignette"],
};

export function questionTypesFor(category: string): QuestionType[] {
  return QUESTION_TYPES_BY_CATEGORY[category] ?? ["recall", "association"];
}

const IMPORTANT = new Set([
  "emergency",
  "must_know",
  "high_yield",
  "exam_trap",
  "drug_dose",
  "contraindication",
]);

function factLines(item: KnowledgeItem): number {
  return (
    item.points.filter(point => point.trim()).length +
    (item.highlightText.trim() ? 1 : 0)
  );
}

// Cards per fact follow its density and importance: a one-line definition
// gets one card, a 5-line classification or a must-know drug fact up to 3 —
// never a fixed number, never one card per point by rote.
export function cardTargetFor(item: KnowledgeItem): number {
  const lines = factLines(item);
  let target = lines >= 3 ? 2 : 1;
  if (lines >= 5) target += 1;
  if (IMPORTANT.has(item.category) && lines >= 2) target += 1;
  return Math.min(3, target);
}

// Every fact is tested by at least one question; dense, important ones by
// two (different angles). Differentiation questions may cover two facts.
export function questionTargetFor(item: KnowledgeItem): number {
  return IMPORTANT.has(item.category) && factLines(item) >= 3 ? 2 : 1;
}

// ── Batching ─────────────────────────────────────────────────────────────
export function batchItems<T>(items: T[], maxItems: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += maxItems) {
    batches.push(items.slice(i, i + maxItems));
  }
  return batches;
}

type RefItem = KnowledgeItem & { ref: string };

function withRefs(items: KnowledgeItem[]): RefItem[] {
  return items.map((item, index) => ({ ...item, ref: `K${index + 1}` }));
}

function refNumber(ref: string): number {
  return Number(ref.slice(1)) || 0;
}

function renderItem(item: RefItem, extra: string): string {
  return [
    `### ${item.ref} [${item.category}] ${item.title} (pages ${item.sourcePages.join(", ")})${extra}`,
    item.topic ? `Topic: ${item.topic}` : "",
    ...item.points.map(point => `- ${point}`),
    item.highlightText
      ? `${item.highlightLabel || "KEY"}: ${item.highlightText}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Flashcards: prompt + schema ──────────────────────────────────────────
const cardsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cards"],
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "knowledgeRef",
          "cardType",
          "questionEn",
          "answerEn",
          "questionAr",
          "answerAr",
          "relatedTermEn",
        ],
        properties: {
          knowledgeRef: { type: "string" },
          cardType: { type: "string", enum: [...CARD_TYPES] },
          questionEn: { type: "string" },
          answerEn: { type: "string" },
          questionAr: { type: "string" },
          answerAr: { type: "string" },
          relatedTermEn: { type: "string" },
        },
      },
    },
  },
};

export const knowledgeCardsResponseSchema = {
  type: "json_schema" as const,
  json_schema: { name: "knowledge_cards", strict: true, schema: cardsSchema },
};

export function buildKnowledgeCardsMessages(
  title: string,
  items: RefItem[],
  targets: Map<string, number>,
  mustCover = false
): Message[] {
  return [
    {
      role: "system",
      content: [
        `You turn a medical student's Knowledge Items — verified high-yield facts already extracted from their file "${title}" — into ACTIVE-RECALL flashcards.`,
        "A flashcard is a question the student answers from memory BEFORE flipping it. It is not a copy of the fact.",
        "Rules:",
        '- For each Knowledge Item write exactly the number of cards requested for it ("cards: N"), each testing a DIFFERENT angle of that fact (e.g. definition, cause, key number, distinguishing feature, mechanism, the common confusion). Never two cards asking the same thing.',
        "- FRONT (questionEn): ONE focused English question with ONE short answer, at most ~25 words. Never 'Describe everything about X'. Never put the answer (or its key words) in the front.",
        "- BACK (answerEn): the direct answer only — at most ~25 words, or up to 4 very short items for a list (criteria, classification grades, steps). No paragraphs, no restating the question.",
        "- One concept per card. Keep exact numbers, doses, thresholds, durations and units from the item.",
        "- Prefer what exams test: numbers/doses, mechanisms, classifications, associations, clinical distinctions, and common confusions (for [exam_trap] items make a 'confusion' card that asks which of two things is true).",
        "- questionAr / answerAr: the same card in natural Arabic, keeping the English medical term in parentheses.",
        "- relatedTermEn: the key English term the card tests, or ''.",
        "- knowledgeRef: the item's ref (K1, K2, …). Use ONLY the information in that item — never add facts it does not contain.",
        mustCover
          ? "- A previous attempt produced no usable card for these items. Every item below MUST get its cards."
          : "",
        "Return JSON only.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      role: "user",
      content: `Knowledge Items:\n\n${items
        .map(item =>
          renderItem(item, ` — cards: ${targets.get(item.ref) ?? 1}`)
        )
        .join("\n\n")}`,
    },
  ];
}

// ── Questions: prompt + schema ───────────────────────────────────────────
const mcqsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "knowledgeRef",
          "relatedRefs",
          "questionType",
          "questionEn",
          "choices",
          "correctIndex",
          "explanationEn",
        ],
        properties: {
          knowledgeRef: { type: "string" },
          relatedRefs: { type: "array", items: { type: "string" } },
          questionType: { type: "string", enum: [...QUESTION_TYPES] },
          questionEn: { type: "string" },
          choices: {
            type: "array",
            items: { type: "string" },
            minItems: 4,
            maxItems: 4,
          },
          correctIndex: { type: "integer" },
          explanationEn: { type: "string" },
        },
      },
    },
  },
};

export const knowledgeMcqsResponseSchema = {
  type: "json_schema" as const,
  json_schema: { name: "knowledge_mcqs", strict: true, schema: mcqsSchema },
};

export function buildKnowledgeMcqsMessages(
  title: string,
  items: RefItem[],
  targets: Map<string, number>,
  mustCover = false
): Message[] {
  return [
    {
      role: "system",
      content: [
        `You are a medical board-exam question writer. You write single-best-answer questions from a student's Knowledge Items — verified high-yield facts from their file "${title}".`,
        "These are NOT flashcards with options: they test whether the student can APPLY and DISTINGUISH the knowledge.",
        "Question types (questionType):",
        "- clinical_vignette: a 2–4 sentence patient scenario (age, sex, presentation, key finding) whose answer follows from the fact.",
        "- diagnosis: a scenario → the most likely diagnosis (never name the diagnosis in the stem).",
        "- next_best_step / management: a scenario → the best next step / treatment (only when the item states management or steps).",
        "- differentiation: tell two similar entities apart (may use a second item as relatedRefs).",
        "- complication, association: the complication / association of a condition.",
        "- misconception: targets the common trap the item warns about.",
        "- recall: direct factual recall — use only when the fact allows nothing better (bare numbers, definitions).",
        "Rules:",
        '- For each item write the requested number of questions ("questions: N"), preferring the suggested types; vary the types across the batch.',
        "- Exactly 4 options of the same kind (all diagnoses, all drugs, all numbers…), similar length, all plausible to a student who half-knows the topic. Exactly ONE is correct according to the item; the other three must be clearly wrong according to it or to standard medical knowledge.",
        "- Never 'All of the above', 'None of the above', 'Both A and B'. Never give the answer away in the stem.",
        "- Build scenarios only with details consistent with the item; the correct answer must be supported by the item itself.",
        "- explanationEn: why the answer is correct (the fact behind it) and why the most tempting wrong option is wrong — at most ~60 words.",
        "- knowledgeRef: the main item's ref (K1, K2, …); relatedRefs: any other ref the question also relies on, or [].",
        mustCover
          ? "- A previous attempt produced no usable question for these items. Every item below MUST get its questions."
          : "",
        "Return JSON only.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      role: "user",
      content: `Knowledge Items:\n\n${items
        .map(item =>
          renderItem(
            item,
            ` — questions: ${targets.get(item.ref) ?? 1}; suggested types: ${questionTypesFor(item.category).join(", ")}`
          )
        )
        .join("\n\n")}`,
    },
  ];
}

// ── Question verification (answer correctness / clinical accuracy) ──────
type DraftCard = {
  knowledgeRef: string;
  cardType: string;
  questionEn: string;
  answerEn: string;
  questionAr: string;
  answerAr: string;
  relatedTermEn: string;
};

type DraftMcq = {
  knowledgeRef: string;
  relatedRefs: string[];
  questionType: string;
  questionEn: string;
  choices: string[];
  correctIndex: number;
  explanationEn: string;
};

const verificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["qid", "valid", "problem"],
        properties: {
          qid: { type: "string" },
          valid: { type: "boolean" },
          problem: { type: "string" },
        },
      },
    },
  },
};

export const mcqVerificationResponseSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "knowledge_mcq_verification",
    strict: true,
    schema: verificationSchema,
  },
};

export function buildMcqVerificationMessages(
  items: RefItem[],
  questions: { qid: string; mcq: DraftMcq }[]
): Message[] {
  const letters = ["A", "B", "C", "D"];
  return [
    {
      role: "system",
      content: [
        "You are a strict medical exam reviewer. Check each question against the Knowledge Items it cites.",
        "A question is valid only if ALL hold:",
        "1. The marked answer is correct according to the item(s) and standard medical knowledge.",
        "2. Exactly one option is defensibly correct — no second option is also right.",
        "3. The wrong options are plausible but clearly wrong.",
        "4. The stem is clinically accurate and does not give the answer away.",
        "For an invalid question give the problem in a few words; for a valid one, problem = ''.",
        "Return JSON only.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "Knowledge Items:",
        ...items.map(item => renderItem(item, "")),
        "",
        "Questions:",
        ...questions.map(({ qid, mcq }) =>
          [
            `### ${qid} (item ${mcq.knowledgeRef}${mcq.relatedRefs.length ? ` + ${mcq.relatedRefs.join(", ")}` : ""})`,
            mcq.questionEn,
            ...mcq.choices.map((choice, i) => `${letters[i]}) ${choice}`),
            `Marked answer: ${letters[mcq.correctIndex]}`,
          ].join("\n")
        ),
      ].join("\n\n"),
    },
  ];
}

// ── Parsing + Quality Gates ──────────────────────────────────────────────
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const STOPWORDS = new Set(
  "a an the of and or is are was were be been to in on at for with by as from this that these those it its than then which who what whom whose when where why how may can does do more most also into their there such not no".split(
    " "
  )
);

// Dedupe tokens for cards/questions. Unlike the Exam Focus fact tokens
// (6-letter stems — fine for long facts), short prompts need whole words:
// a 6-letter stem makes "hypertension" and "hypertrophy" the same token and
// would delete a question about a different disease as a "duplicate".
function tokensOf(...texts: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const word of texts
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9؀-ۿ.%-]+/)) {
    const clean = word.replace(/^[.-]+|[.-]+$/g, "");
    if (!clean || STOPWORDS.has(clean)) continue;
    tokens.add(clean.length > 4 ? clean.replace(/(es|s)$/, "") : clean);
  }
  return tokens;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
}

// Two outputs of the SAME fact are duplicates on the usual fact rule (the
// same angle asked twice). Across DIFFERENT facts only near-identical text
// counts: clinical vignettes share a template ("A 45-year-old presents…
// most likely diagnosis?") and must not delete each other.
export const CROSS_ITEM_DUPLICATE_JACCARD = 0.9;

function isDuplicateOutput(
  a: { itemId: string; tokens: Set<string> },
  b: { itemId: string; tokens: Set<string> }
): boolean {
  return a.itemId === b.itemId
    ? isDuplicateFact(a.tokens, b.tokens)
    : jaccard(a.tokens, b.tokens) >= CROSS_ITEM_DUPLICATE_JACCARD;
}

export type GateReason =
  | "unknown_item"
  | "empty"
  | "front_too_long"
  | "back_too_long"
  | "answer_in_front"
  | "multi_concept"
  | "bad_options"
  | "duplicate_options"
  | "banned_option"
  | "answer_in_stem"
  | "duplicate"
  | "failed_verification";

export type GateReport = Partial<Record<GateReason, number>>;

function tally(report: GateReport, reason: GateReason) {
  report[reason] = (report[reason] ?? 0) + 1;
}

// Flashcard gate: one focused prompt, a short direct answer, one concept,
// and the answer not already given away by the front.
export function checkCard(card: DraftCard): GateReason | null {
  if (!card.questionEn || !card.answerEn) return "empty";
  if (wordCount(card.questionEn) > 40) return "front_too_long";
  if (wordCount(card.answerEn) > 45) return "back_too_long";
  const listLines = card.answerEn.split(/\n|;|•/).filter(line => line.trim());
  if (listLines.length > 6) return "multi_concept";
  const answer = card.answerEn.toLowerCase().replace(/[.\s]+$/, "");
  if (answer.length >= 4 && card.questionEn.toLowerCase().includes(answer)) {
    return "answer_in_front";
  }
  return null;
}

const BANNED_OPTION =
  /\b(all|none|both|neither) of the (above|options)\b|^both [a-d] and [a-d]$/i;

function normalizeOption(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();
}

// Question gate: 4 distinct non-empty options, a valid key, no "all/none of
// the above", and the correct option's wording not sitting in the stem.
export function checkMcq(mcq: DraftMcq): GateReason | null {
  if (!mcq.questionEn) return "empty";
  if (
    mcq.choices.length !== 4 ||
    mcq.choices.some(choice => !choice) ||
    !Number.isInteger(mcq.correctIndex) ||
    mcq.correctIndex < 0 ||
    mcq.correctIndex > 3
  ) {
    return "bad_options";
  }
  const normalized = mcq.choices.map(normalizeOption);
  if (new Set(normalized).size !== 4) return "duplicate_options";
  if (mcq.choices.some(choice => BANNED_OPTION.test(choice))) {
    return "banned_option";
  }
  const correct = normalized[mcq.correctIndex];
  const stem = ` ${normalizeOption(mcq.questionEn)} `;
  // Only multi-word answers: a one-word answer (a drug name) can
  // legitimately recur in a stem that asks about something else.
  if (correct.split(" ").length >= 3 && stem.includes(` ${correct} `)) {
    return "answer_in_stem";
  }
  return null;
}

// Stable spread of the correct answer over A–D (models favour A/B); the
// same question always lands the same way.
function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function placeCorrectAnswer<
  T extends { questionEn: string; choices: string[]; correctIndex: number },
>(mcq: T): T {
  const target = hash(mcq.questionEn) % 4;
  if (target === mcq.correctIndex) return mcq;
  const choices = [...mcq.choices];
  [choices[target], choices[mcq.correctIndex]] = [
    choices[mcq.correctIndex],
    choices[target],
  ];
  return { ...mcq, choices, correctIndex: target };
}

function parseCards(content: unknown): DraftCard[] {
  const parsed = parseJsonResponse(content) as unknown as {
    cards?: unknown[];
  };
  return (parsed.cards ?? []).map(raw => {
    const card = (raw ?? {}) as Record<string, unknown>;
    return {
      knowledgeRef: str(card.knowledgeRef).toUpperCase(),
      cardType: str(card.cardType),
      questionEn: str(card.questionEn),
      answerEn: str(card.answerEn),
      questionAr: str(card.questionAr),
      answerAr: str(card.answerAr),
      relatedTermEn: str(card.relatedTermEn),
    };
  });
}

function parseMcqs(content: unknown): DraftMcq[] {
  const parsed = parseJsonResponse(content) as unknown as {
    questions?: unknown[];
  };
  return (parsed.questions ?? []).map(raw => {
    const mcq = (raw ?? {}) as Record<string, unknown>;
    return {
      knowledgeRef: str(mcq.knowledgeRef).toUpperCase(),
      relatedRefs: Array.isArray(mcq.relatedRefs)
        ? mcq.relatedRefs.map(ref => str(ref).toUpperCase()).filter(Boolean)
        : [],
      questionType: str(mcq.questionType),
      questionEn: str(mcq.questionEn),
      choices: Array.isArray(mcq.choices) ? mcq.choices.map(str) : [],
      correctIndex: Number(mcq.correctIndex),
      explanationEn: str(mcq.explanationEn),
    };
  });
}

function parseVerification(
  content: unknown
): Map<string, { valid: boolean; problem: string }> {
  const parsed = parseJsonResponse(content) as unknown as {
    results?: unknown[];
  };
  const map = new Map<string, { valid: boolean; problem: string }>();
  for (const raw of parsed.results ?? []) {
    const result = (raw ?? {}) as Record<string, unknown>;
    map.set(str(result.qid).toUpperCase(), {
      valid: result.valid === true,
      problem: str(result.problem),
    });
  }
  return map;
}

// ── Coverage Matrix verdict ──────────────────────────────────────────────
export type KnowledgeCoverage = {
  source: "knowledge";
  totalItems: number;
  coveredItems: number;
  uncoveredItemIds: string[];
  itemCoveragePercent: number;
  status: CoverageStatus;
  gate: GateReport;
};

export function knowledgeCoverage(
  items: KnowledgeItem[],
  coveredIds: Set<string>,
  gate: GateReport
): KnowledgeCoverage {
  const uncovered = items.filter(item => !coveredIds.has(item.id));
  const covered = items.length - uncovered.length;
  const percent = items.length
    ? Math.round((covered / items.length) * 100)
    : 100;
  return {
    source: "knowledge",
    totalItems: items.length,
    coveredItems: covered,
    uncoveredItemIds: uncovered.map(item => item.id),
    itemCoveragePercent: percent,
    status: percent >= 95 ? "COMPLETE" : percent >= 60 ? "PARTIAL" : "FAILED",
    gate,
  };
}

// ── Generation ───────────────────────────────────────────────────────────
export type KnowledgeCard = ChapterFlashcard & {
  knowledgeItemId: string;
  sourcePages: number[];
  cardType: CardType;
};

export type KnowledgeMcq = ChapterMcq & {
  knowledgeItemId: string;
  relatedKnowledgeItemIds: string[];
  sourcePages: number[];
  questionType: QuestionType;
  // "valid" once the AI reviewer passed it; "pending" if the review call
  // itself failed (kept, and the chapter's validate step can re-check it).
  validationStatus: "valid" | "pending";
};

export type KnowledgeResult<T> = {
  items: T[];
  coverage: KnowledgeCoverage;
  errors: string[];
};

const CONCURRENCY = 3;
const CARD_BATCH_ITEMS = 10;
const MCQ_BATCH_ITEMS = 8;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runBatches<T>(
  batches: RefItem[][],
  errors: string[],
  fn: (batch: RefItem[]) => Promise<T[]>
): Promise<T[]> {
  const results = await mapWithConcurrency(
    batches,
    CONCURRENCY,
    async batch => {
      try {
        return await fn(batch);
      } catch (error) {
        errors.push(
          `${batch[0].ref}–${batch[batch.length - 1].ref}: ${errorText(error)}`
        );
        return [];
      }
    }
  );
  return results.flat();
}

export async function generateKnowledgeFlashcards(
  title: string,
  knowledge: KnowledgeItem[],
  llm: Llm
): Promise<KnowledgeResult<KnowledgeCard>> {
  const items = withRefs(knowledge);
  const byRef = new Map(items.map(item => [item.ref, item]));
  const targets = new Map(items.map(item => [item.ref, cardTargetFor(item)]));
  const gate: GateReport = {};
  const errors: string[] = [];
  const kept: { card: KnowledgeCard; tokens: Set<string> }[] = [];

  async function generate(pending: RefItem[], mustCover: boolean) {
    const drafts = await runBatches(
      batchItems(pending, CARD_BATCH_ITEMS),
      errors,
      async batch => {
        const wanted = batch.reduce(
          (sum, item) => sum + (targets.get(item.ref) ?? 1),
          0
        );
        const response = await llm({
          max_tokens: generationBudget(wanted * 260),
          messages: buildKnowledgeCardsMessages(
            title,
            batch,
            targets,
            mustCover
          ),
          response_format: knowledgeCardsResponseSchema,
        });
        return parseCards(response.choices[0]?.message.content);
      }
    );
    // Item order, then the model's order — dedupe keeps the first angle.
    drafts.sort(
      (a, b) => refNumber(a.knowledgeRef) - refNumber(b.knowledgeRef)
    );
    for (const draft of drafts) {
      const item = byRef.get(draft.knowledgeRef);
      if (!item) {
        tally(gate, "unknown_item");
        continue;
      }
      const reason = checkCard(draft);
      if (reason) {
        tally(gate, reason);
        continue;
      }
      const tokens = tokensOf(draft.questionEn, draft.answerEn);
      const candidate = { itemId: item.id, tokens };
      if (
        kept.some(other =>
          isDuplicateOutput(candidate, {
            itemId: other.card.knowledgeItemId,
            tokens: other.tokens,
          })
        )
      ) {
        tally(gate, "duplicate");
        continue;
      }
      kept.push({
        tokens,
        card: {
          questionEn: draft.questionEn,
          answerEn: draft.answerEn,
          questionAr: draft.questionAr || draft.questionEn,
          answerAr: draft.answerAr || draft.answerEn,
          relatedTermEn: draft.relatedTermEn,
          sourcePage: primaryPage(item),
          knowledgeItemId: item.id,
          sourcePages: item.sourcePages,
          cardType: (CARD_TYPES as readonly string[]).includes(draft.cardType)
            ? (draft.cardType as CardType)
            : "recall",
        },
      });
    }
  }

  const coveredIds = () =>
    new Set(kept.map(entry => entry.card.knowledgeItemId));
  await generate(items, false);
  const missing = items.filter(item => !coveredIds().has(item.id));
  if (missing.length) await generate(missing, true);

  return {
    items: sortByItems(
      kept.map(entry => entry.card),
      knowledge
    ),
    coverage: knowledgeCoverage(knowledge, coveredIds(), gate),
    errors,
  };
}

export async function generateKnowledgeMcqs(
  title: string,
  knowledge: KnowledgeItem[],
  llm: Llm
): Promise<KnowledgeResult<KnowledgeMcq>> {
  const items = withRefs(knowledge);
  const byRef = new Map(items.map(item => [item.ref, item]));
  const targets = new Map(
    items.map(item => [item.ref, questionTargetFor(item)])
  );
  const gate: GateReport = {};
  const errors: string[] = [];
  const kept: { mcq: KnowledgeMcq; tokens: Set<string> }[] = [];

  async function generate(pending: RefItem[], mustCover: boolean) {
    const reviewed = await runBatches(
      batchItems(pending, MCQ_BATCH_ITEMS),
      errors,
      async batch => {
        const wanted = batch.reduce(
          (sum, item) => sum + (targets.get(item.ref) ?? 1),
          0
        );
        const response = await llm({
          max_tokens: generationBudget(wanted * 450),
          messages: buildKnowledgeMcqsMessages(
            title,
            batch,
            targets,
            mustCover
          ),
          response_format: knowledgeMcqsResponseSchema,
        });
        const passed: DraftMcq[] = [];
        for (const draft of parseMcqs(response.choices[0]?.message.content)) {
          if (!byRef.has(draft.knowledgeRef)) {
            tally(gate, "unknown_item");
            continue;
          }
          const reason = checkMcq(draft);
          if (reason) {
            tally(gate, reason);
            continue;
          }
          passed.push(placeCorrectAnswer(draft));
        }
        if (!passed.length) return [];

        // AI review against the cited items; a failed review call keeps the
        // questions as "pending" rather than throwing good work away.
        const questions = passed.map((mcq, i) => ({ qid: `Q${i + 1}`, mcq }));
        const cited = new Set(
          passed.flatMap(mcq => [mcq.knowledgeRef, ...mcq.relatedRefs])
        );
        try {
          const review = await llm({
            max_tokens: generationBudget(questions.length * 80),
            messages: buildMcqVerificationMessages(
              items.filter(item => cited.has(item.ref)),
              questions
            ),
            response_format: mcqVerificationResponseSchema,
          });
          const results = parseVerification(review.choices[0]?.message.content);
          return questions.flatMap(({ qid, mcq }) => {
            const result = results.get(qid);
            if (result && !result.valid) {
              tally(gate, "failed_verification");
              return [];
            }
            return [
              {
                mcq,
                status: result ? ("valid" as const) : ("pending" as const),
              },
            ];
          });
        } catch (error) {
          errors.push(`verification: ${errorText(error)}`);
          return questions.map(({ mcq }) => ({
            mcq,
            status: "pending" as const,
          }));
        }
      }
    );

    reviewed.sort(
      (a, b) => refNumber(a.mcq.knowledgeRef) - refNumber(b.mcq.knowledgeRef)
    );
    for (const { mcq: draft, status } of reviewed) {
      const item = byRef.get(draft.knowledgeRef)!;
      const related = draft.relatedRefs
        .filter(ref => ref !== draft.knowledgeRef)
        .map(ref => byRef.get(ref))
        .filter((other): other is RefItem => !!other);
      const tokens = tokensOf(
        draft.questionEn,
        draft.choices[draft.correctIndex]
      );
      const candidate = { itemId: item.id, tokens };
      if (
        kept.some(other =>
          isDuplicateOutput(candidate, {
            itemId: other.mcq.knowledgeItemId,
            tokens: other.tokens,
          })
        )
      ) {
        tally(gate, "duplicate");
        continue;
      }
      kept.push({
        tokens,
        mcq: {
          questionEn: draft.questionEn,
          choices: draft.choices,
          correctIndex: draft.correctIndex,
          explanationEn: draft.explanationEn,
          sourcePage: primaryPage(item),
          knowledgeItemId: item.id,
          relatedKnowledgeItemIds: related.map(other => other.id),
          sourcePages: Array.from(
            new Set([item, ...related].flatMap(other => other.sourcePages))
          ).sort((a, b) => a - b),
          questionType: (QUESTION_TYPES as readonly string[]).includes(
            draft.questionType
          )
            ? (draft.questionType as QuestionType)
            : "recall",
          validationStatus: status,
        },
      });
    }
  }

  // A fact counts as tested when a question relies on it — as the main
  // item or as the second fact of a differentiation question.
  const coveredIds = () =>
    new Set(
      kept.flatMap(entry => [
        entry.mcq.knowledgeItemId,
        ...entry.mcq.relatedKnowledgeItemIds,
      ])
    );
  await generate(items, false);
  const missing = items.filter(item => !coveredIds().has(item.id));
  if (missing.length) await generate(missing, true);

  return {
    items: sortByItems(
      kept.map(entry => entry.mcq),
      knowledge
    ),
    coverage: knowledgeCoverage(knowledge, coveredIds(), gate),
    errors,
  };
}

// Study order follows the file: the order of the Knowledge Items.
function sortByItems<T extends { knowledgeItemId: string }>(
  output: T[],
  knowledge: KnowledgeItem[]
): T[] {
  const order = new Map(knowledge.map((item, index) => [item.id, index]));
  return output
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        (order.get(a.entry.knowledgeItemId) ?? 0) -
          (order.get(b.entry.knowledgeItemId) ?? 0) || a.index - b.index
    )
    .map(({ entry }) => entry);
}
