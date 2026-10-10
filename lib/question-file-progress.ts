// 🪟 A student is at this question: make sure the questions just ahead are
// being prepared (lib/question-file-window.ts). Called when an answer is
// saved and when the page reports where the student is.
//
// It only ever STARTS work that the file is still owed. A file that is
// explained whole (a short file, a doctor's set) has its own run; that run
// is started again here only when it has stopped with questions left.
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { publishMessage } from "./queue/client";
import {
  getQuestionFileWindow,
  progressiveQuestionFiles,
  spanFrom,
  WINDOW_AHEAD,
} from "./question-file-window";

// One start per file, per stretch of questions, per minute — a student
// stepping through questions does not queue a run for each step.
const START_EVERY_MS = 60_000;
const STRETCH = 10;
// A whole-file run that has stopped is started again at most this often.
const RESUME_EVERY_MS = 10 * 60_000;

// True when a run was started (or one for the same stretch was, a moment
// ago): the page then watches for the explanations to arrive.
export async function prepareQuestionsFrom(
  bookId: string,
  questionId: string
): Promise<boolean> {
  if (!progressiveQuestionFiles()) return false;
  const db = getDb();
  if (!db) return false;
  const [at] = await db.execute<{ order_index: number; owed: boolean }>(sql`
    select q."orderIndex" as order_index,
      exists (
        select 1 from "extracted_questions" n
        where n."bookId" = ${bookId}
          and n."orderIndex" between q."orderIndex" and q."orderIndex" + ${WINDOW_AHEAD}
          and n."aiStatus" in ('pending', 'failed')
          and n."aiAttemptCount" < 3
      ) as owed
    from "extracted_questions" q
    where q."id" = ${questionId} and q."bookId" = ${bookId}
  `);
  if (!at || !at.owed) return false;

  const span = spanFrom(Number(at.order_index));
  // Null: the file is explained whole, by a run that hands itself on until
  // nothing is owed. If questions are still owed here and none is being
  // explained, that run has stopped — it gave up after a long AI outage, or
  // a restart killed it — and nothing else would ever start it again.
  if (!(await getQuestionFileWindow(bookId, span))) {
    // Never for a doctor's set: it is prepared before it is published, and
    // nothing a student does starts work on it.
    const [state] = await db.execute<{ busy: boolean; set: boolean }>(sql`
      select
        exists (
          select 1 from "extracted_questions"
          where "bookId" = ${bookId} and "aiStatus" = 'processing'
        ) as busy,
        exists (
          select 1 from "question_sets" s where s."bookId" = ${bookId}
        ) as set
    `);
    if (!state || state.set) return false;
    if (state.busy) return true;
    await publishMessage(
      { type: "generate_question_file_content", bookId },
      {
        flowControl: { key: `question-file-content-${bookId}`, parallelism: 1 },
        deduplicationId: [
          "qf-resume",
          bookId,
          Math.floor(Date.now() / RESUME_EVERY_MS),
        ].join("-"),
      }
    );
    return true;
  }

  // The page stage first: it settles the pages these questions sit on,
  // then hands the same span to the explanations.
  await publishMessage(
    { type: "extract_question_file_images", bookId, ...span },
    {
      flowControl: { key: `question-file-images-${bookId}`, parallelism: 1 },
      deduplicationId: [
        "qf-window",
        bookId,
        Math.floor(span.from / STRETCH),
        Math.floor(Date.now() / START_EVERY_MS),
      ].join("-"),
    }
  );
  return true;
}
