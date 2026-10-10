// 🪟 Which questions of a question file are worked on NOW.
//
// A long file used to be explained whole the moment it was uploaded: a
// 5,057-page bank cost thousands of AI calls for questions nobody opened.
// Now the questions all appear at once (they come from the text, no AI),
// and the AI work — the page pictures and each question's explanation —
// follows the student:
//   - the first WINDOW_FIRST_QUESTIONS questions, right away;
//   - WINDOW_AHEAD questions past every question a student has answered;
//   - WINDOW_AHEAD questions past wherever a student currently is, asked
//     for by the page as they move (`requested`, carried by the queue
//     message — it is not stored).
// So the next questions are ready before the student reaches them, and a
// jump to a far question is prepared on the spot.
//
// `null` means "the whole file", exactly as before: a file short enough to
// be covered by the first two steps, a doctor's protected set (it is
// published only once every question is done), or the switch turned off
// (QUESTION_FILE_PROGRESSIVE=false).
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";

export const WINDOW_FIRST_QUESTIONS = 40;
export const WINDOW_AHEAD = 30;

// Inclusive [from, to] spans of orderIndex, sorted, never touching.
export type QuestionWindow = [number, number][];
export type RequestedSpan = { from: number; to: number };

export function progressiveQuestionFiles(): boolean {
  return (
    process.env.QUESTION_FILE_PROGRESSIVE?.trim().toLowerCase() !== "false"
  );
}

// The span prepared around a question the student is at.
export function spanFrom(orderIndex: number): RequestedSpan {
  return { from: orderIndex, to: orderIndex + WINDOW_AHEAD };
}

// A span as it arrives in a queue message — anything odd is no span.
export function readRequestedSpan(body: {
  from?: unknown;
  to?: unknown;
}): RequestedSpan | undefined {
  const from = Number(body.from);
  const to = Number(body.to);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return undefined;
  if (from < 0 || to < from) return undefined;
  return { from, to };
}

// Pure. `lastIndex` is the file's highest orderIndex.
export function buildQuestionWindow(
  lastIndex: number,
  answered: number[],
  requested?: RequestedSpan
): QuestionWindow | null {
  if (lastIndex < WINDOW_FIRST_QUESTIONS + WINDOW_AHEAD) return null;
  const spans: [number, number][] = [
    [0, WINDOW_FIRST_QUESTIONS - 1],
    ...answered.map((index): [number, number] => [index, index + WINDOW_AHEAD]),
    ...(requested ? [[requested.from, requested.to] as [number, number]] : []),
  ]
    .map(([from, to]): [number, number] => [
      Math.max(0, from),
      Math.min(lastIndex, to),
    ])
    .filter(([from, to]) => from <= to)
    .sort((a, b) => a[0] - b[0]);

  const merged: QuestionWindow = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1] + 1) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  // Everything is wanted: the same as no window.
  if (merged.length === 1 && merged[0][0] === 0 && merged[0][1] >= lastIndex) {
    return null;
  }
  return merged;
}

// `column` inside any of the window's spans.
export function inQuestionWindow(window: QuestionWindow, column: SQL): SQL {
  return sql`(${sql.join(
    window.map(([from, to]) => sql`${column} between ${from} and ${to}`),
    sql` or `
  )})`;
}

type WindowFacts = {
  last_index: number | null;
  protected_set: boolean;
  answered: number[] | null;
};

// One round trip: the file's size, whether it is a doctor's set, and the
// questions students have answered.
export async function getQuestionFileWindow(
  bookId: string,
  requested?: RequestedSpan
): Promise<QuestionWindow | null> {
  if (!progressiveQuestionFiles()) return null;
  const db = getDb();
  if (!db) return null;
  const [facts] = await db.execute<WindowFacts>(sql`
    select
      (select max(q."orderIndex") from "extracted_questions" q
        where q."bookId" = ${bookId}) as last_index,
      exists (select 1 from "question_sets" s
        where s."bookId" = ${bookId}) as protected_set,
      (select array_agg(distinct q."orderIndex")
        from "question_attempts" a
        join "extracted_questions" q on q."id" = a."questionId"
        where a."bookId" = ${bookId}) as answered
  `);
  if (!facts || facts.last_index === null || facts.protected_set) return null;
  return buildQuestionWindow(
    Number(facts.last_index),
    (facts.answered ?? []).map(Number),
    requested
  );
}
