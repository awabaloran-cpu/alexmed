// Did the question-file reader really find a question file? Pure.
//
// The reader (lib/question-document.ts) is built for numbered
// multiple-choice questions. Given lecture notes, a summary or an OSCE
// revision file it still returns "questions" — bullet lines without
// options — and the student is told their questions are ready. Measured on
// the live bot (2026-10-08): a 162-page OSCE file gave 44 items, 12 with
// options, none with an answer.
//
// `answerable` = items a student can actually answer (two options or more).
export type QuestionFileCounts = {
  total: number;
  answerable: number;
  pageCount: number;
};

// A real question file can carry a few stray items, and a short one has
// few questions; notes have few answerable items both among what was read
// AND for their length.
const MIN_ANSWERABLE = 3;
const MIN_ANSWERABLE_SHARE = 0.5;
const MIN_ANSWERABLE_PER_PAGE = 0.25;

export function looksLikeNotes(counts: QuestionFileCounts): boolean {
  const { total, answerable, pageCount } = counts;
  if (total <= 0) return false; // "no questions at all" is its own case
  if (answerable < MIN_ANSWERABLE) return true;
  const share = answerable / total;
  const perPage = pageCount > 0 ? answerable / pageCount : 1;
  return share < MIN_ANSWERABLE_SHARE && perPage < MIN_ANSWERABLE_PER_PAGE;
}
