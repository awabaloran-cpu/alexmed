// Real, non-AI extraction of pre-existing questions from a "question_file"
// book's own text (PR16) — this is regex/heuristic parsing of the literal
// PDF content, never an LLM call, and never invents an answer the source
// doesn't state. A field the parser can't confidently identify is left
// null rather than guessed — see extractedQuestions' schema comment for why
// that distinction (extracted vs. AI-inferred) matters.
export type ExtractedQuestionInput = {
  orderIndex: number;
  questionText: string;
  options: string[] | null;
  extractedAnswerIndex: number | null;
  extractedAnswerText: string | null;
  explanationText: string | null;
  sourcePage: number;
};

const QUESTION_START = /^\s*(\d{1,3})[.)]\s+(.+)$/;
const OPTION_LINE = /^\s*([A-Da-d])[.)]\s+(.+)$/;
const ANSWER_LINE =
  /^\s*(?:correct answer|answer|ans|الإجابة الصحيحة|الإجابة|الجواب)\s*[:\-]\s*(.+)$/i;
const EXPLANATION_LINE =
  /^\s*(?:explanation|rationale|why|التفسير|الشرح|السبب)\s*[:\-]\s*(.+)$/i;
const ARABIC_LETTER_TO_INDEX: Record<string, number> = {
  أ: 0,
  ا: 0,
  ب: 1,
  ج: 2,
  د: 3,
};

function letterToIndex(letter: string): number | null {
  const upper = letter.trim().toUpperCase();
  if (upper.length === 1 && upper >= "A" && upper <= "D") {
    return upper.charCodeAt(0) - "A".charCodeAt(0);
  }
  const arabic = ARABIC_LETTER_TO_INDEX[letter.trim()];
  return arabic ?? null;
}

// Resolves an answer line's free-text value against this question's own
// option list first (handles "Answer: B", "Answer: (B)", and the fairly
// common "Answer: <the full option text>" all at once); falls back to
// keeping the raw text with no index when neither matches, rather than
// guessing.
function resolveAnswer(
  raw: string,
  options: string[]
): { index: number | null; text: string } {
  const trimmed = raw.trim();
  const letterMatch = trimmed.match(/^\(?([A-Da-dأابجد])\)?\.?$/);
  if (letterMatch) {
    const index = letterToIndex(letterMatch[1]);
    if (index !== null && index < options.length) {
      return { index, text: options[index] };
    }
  }
  const byText = options.findIndex(
    option => option.trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (byText !== -1) return { index: byText, text: options[byText] };
  return { index: null, text: trimmed };
}

// pages must already be real extracted/OCR'd text (same pipeline books use
// today — see app/api/books/extract-questions/route.ts) — this function is
// pure text parsing, no I/O.
export function extractQuestionsFromPages(
  pages: { page: number; text: string }[]
): ExtractedQuestionInput[] {
  const results: ExtractedQuestionInput[] = [];
  let orderIndex = 0;

  type Draft = {
    questionLines: string[];
    options: string[];
    answerRaw: string | null;
    explanationLines: string[];
    sourcePage: number;
  };
  let draft: Draft | null = null;
  let mode: "question" | "explanation" = "question";

  function flush() {
    if (!draft) return;
    const questionText = draft.questionLines.join(" ").trim();
    if (questionText) {
      const options = draft.options.length ? draft.options : null;
      const answer = draft.answerRaw
        ? resolveAnswer(draft.answerRaw, draft.options)
        : null;
      results.push({
        orderIndex: orderIndex++,
        questionText,
        options,
        extractedAnswerIndex: answer?.index ?? null,
        extractedAnswerText: answer ? answer.text : null,
        explanationText: draft.explanationLines.length
          ? draft.explanationLines.join(" ").trim()
          : null,
        sourcePage: draft.sourcePage,
      });
    }
    draft = null;
    mode = "question";
  }

  for (const { page, text } of pages) {
    const lines = text.split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const questionStart = line.match(QUESTION_START);
      if (questionStart) {
        flush();
        draft = {
          questionLines: [questionStart[2]],
          options: [],
          answerRaw: null,
          explanationLines: [],
          sourcePage: page,
        };
        mode = "question";
        continue;
      }
      if (!draft) continue; // Text before the first detected question — skip.

      const optionMatch = line.match(OPTION_LINE);
      if (optionMatch) {
        draft.options.push(optionMatch[2].trim());
        mode = "question";
        continue;
      }

      const answerMatch = line.match(ANSWER_LINE);
      if (answerMatch) {
        draft.answerRaw = answerMatch[1].trim();
        mode = "question";
        continue;
      }

      const explanationMatch = line.match(EXPLANATION_LINE);
      if (explanationMatch) {
        draft.explanationLines.push(explanationMatch[1].trim());
        mode = "explanation";
        continue;
      }

      // A continuation line with no marker of its own — attach it to
      // whichever section we most recently saw (question stem, wrapped
      // across lines, or a multi-line explanation).
      if (mode === "explanation") {
        draft.explanationLines.push(line);
      } else if (draft.options.length === 0) {
        draft.questionLines.push(line);
      }
    }
  }
  flush();

  return results;
}
