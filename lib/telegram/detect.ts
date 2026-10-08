// ✈️ Is this PDF a question file or a study book? Pure — no AI, no I/O.
//
// It reuses the question-file pipeline's own deterministic reader
// (lib/question-document.ts) on the first pages: a file whose opening pages
// parse into many question blocks is a question file; one with plenty of
// text and almost none is a book. Anything in between — and every scanned
// file, which has no text to read yet — is "unsure", and the student's own
// choice (or a question from the bot) decides.
import { analyzeQuestionDocument } from "../question-extraction";

export type DocumentKind = "question_file" | "book";
export type DetectedKind = DocumentKind | "unsure";

// How many leading pages the bot reads to decide.
export const DETECTION_SAMPLE_PAGES = 12;

const MIN_TEXT_CHARS = 80;

export function detectDocumentKind(
  pages: { page: number; text: string }[]
): DetectedKind {
  const textPages = pages.filter(
    page => page.text.trim().length >= MIN_TEXT_CHARS
  );
  if (textPages.length === 0) return "unsure";

  const analysis = analyzeQuestionDocument(textPages);
  const blocks = analysis.questions.length + analysis.needsReview.length;
  const perPage = blocks / textPages.length;

  if (blocks >= 5 && perPage >= 1) return "question_file";
  if (analysis.questions.length >= 3 && perPage >= 1.5) return "question_file";
  if (textPages.length >= 3 && blocks <= 1) return "book";
  return "unsure";
}

// What to process the file as, or "ask" when the bot must put the question
// to the student: the file clearly contradicts what they said, or nobody
// knows.
export function resolveDocumentKind(
  requested: DocumentKind | null,
  detected: DetectedKind
): DocumentKind | "ask" {
  if (detected === "unsure") return requested ?? "ask";
  if (!requested || requested === detected) return detected;
  return "ask";
}

export function isDocumentKind(value: unknown): value is DocumentKind {
  return value === "question_file" || value === "book";
}
