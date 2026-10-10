// 🪟 A student is at this question: make sure the questions just ahead are
// being prepared (lib/question-file-window.ts). Called when an answer is
// saved and when the page reports where the student is.
//
// It only ever STARTS work that the file is still owed; a file that is
// explained whole, a short file or a doctor's set returns false at once.
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
  // Null: the whole file is already being worked on.
  if (!(await getQuestionFileWindow(bookId, span))) return false;

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
