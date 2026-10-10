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

// 📚 Is this "question file" really a study book? Decided once the whole
// file has been read, before any question is stored: the student uploaded a
// book under "questions", and it is started as a book instead of being
// answered with "no questions found" (or with a handful of stray lines
// presented as questions).
//
// `blocks` = everything the reader took for a question, valid or held
// back. A real question file — even an odd one the reader mostly holds
// back, or a list of open questions without options — has a block on about
// every page; a book has pages of prose and a few stray numbered lines.
// Three pages of text at least: a one-page file says too little either way.
const MIN_BOOK_TEXT_PAGES = 3;
const MAX_BOOK_BLOCKS_PER_PAGE = 0.5;

export function isBookNotQuestions(input: {
  textPages: number;
  blocks: number;
  valid: number;
  answerable: number;
}): boolean {
  const { textPages, blocks, valid, answerable } = input;
  if (textPages < MIN_BOOK_TEXT_PAGES) return false;
  if (blocks / textPages >= MAX_BOOK_BLOCKS_PER_PAGE) return false;
  return (
    valid === 0 ||
    looksLikeNotes({ total: valid, answerable, pageCount: textPages })
  );
}
