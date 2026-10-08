// A student's answers to the questions of a question file they may read —
// their own, or one shared with them (lib/question-file-access.ts) — what
// lets the viewer resume where they stopped and keeps the "answered /
// correct" tally across visits and devices. The answer is checked here, on
// the server, against the same rule the card uses (the file's stated
// answer, else the pipeline's suggestion); a question with neither is
// stored with isCorrect = null.
import { and, eq, sql } from "drizzle-orm";
import { extractedQuestions, questionAttempts } from "../drizzle/schema";
import { requireDb } from "./db";
import { studentVisibleQuestion } from "./db-question-files";
import { getQuestionFileAccess } from "./question-file-access";

export type SavedAttempt = { isCorrect: boolean | null };

// Null when the question isn't one the student may answer: a file they may
// not read, not a question file, hidden for review, or an option that
// doesn't exist.
export async function saveQuestionAttempt(
  userId: string,
  input: { bookId: string; questionId: string; selectedIndex: number }
): Promise<SavedAttempt | null> {
  const db = requireDb();
  if (!(await getQuestionFileAccess(userId, input.bookId))) return null;
  const [question] = await db
    .select({
      options: extractedQuestions.options,
      extractedAnswerIndex: extractedQuestions.extractedAnswerIndex,
      aiInferredAnswerIndex: extractedQuestions.aiInferredAnswerIndex,
    })
    .from(extractedQuestions)
    .where(
      and(
        eq(extractedQuestions.id, input.questionId),
        eq(extractedQuestions.bookId, input.bookId),
        studentVisibleQuestion
      )
    )
    .limit(1);
  if (!question) return null;
  const optionCount = question.options?.length ?? 0;
  if (input.selectedIndex < 0 || input.selectedIndex >= optionCount) {
    return null;
  }

  const correct =
    question.extractedAnswerIndex ?? question.aiInferredAnswerIndex;
  const isCorrect = correct === null ? null : correct === input.selectedIndex;

  await db
    .insert(questionAttempts)
    .values({
      userId,
      bookId: input.bookId,
      questionId: input.questionId,
      selectedIndex: input.selectedIndex,
      isCorrect,
    })
    .onConflictDoUpdate({
      target: [questionAttempts.userId, questionAttempts.questionId],
      set: {
        selectedIndex: input.selectedIndex,
        isCorrect,
        answeredAt: sql`now()`,
      },
    });
  return { isCorrect };
}

// questionId → the option the student last chose, for one of their files.
export async function listQuestionAttempts(
  userId: string,
  bookId: string
): Promise<Record<string, number>> {
  const rows = await requireDb()
    .select({
      questionId: questionAttempts.questionId,
      selectedIndex: questionAttempts.selectedIndex,
    })
    .from(questionAttempts)
    .where(
      and(
        eq(questionAttempts.userId, userId),
        eq(questionAttempts.bookId, bookId)
      )
    );
  return Object.fromEntries(rows.map(row => [row.questionId, row.selectedIndex]));
}
