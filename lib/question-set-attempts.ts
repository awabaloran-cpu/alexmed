// 📝 A student's answers inside a doctor's protected set.
//
// Until now a set kept nothing: leave the page and every answer was gone,
// and nothing followed the student to another device. The answers are kept
// the same way a question file's are (lib/db-question-attempts.ts, the
// question_attempts table — no new table), checked on the server against
// the stored answer.
//
// Every call decides again whether this student may open the set
// (lib/question-set-access.ts): a revoked entitlement, a closed window or a
// disabled set stops saving and reading at once. The doctor does not see
// any student's answers through this.
import {
  clearQuestionAttempts,
  listQuestionAttempts,
  saveAttemptInBook,
  type SavedAttempt,
} from "./db-question-attempts";
import {
  getQuestionSetAccess,
  type QuestionSetViewer,
} from "./question-set-access";

// questionId → the option last chosen. Null when the set is not open to
// this student.
export async function listSetAttempts(
  viewer: QuestionSetViewer,
  setId: string
): Promise<Record<string, number> | null> {
  const access = await getQuestionSetAccess(viewer, setId);
  if (!access) return null;
  return listQuestionAttempts(viewer.id, access.bookId);
}

// Null when the set is not open to this student, or the question is not
// one of the set's that a student may answer.
export async function saveSetAttempt(
  viewer: QuestionSetViewer,
  setId: string,
  answer: { questionId: string; selectedIndex: number }
): Promise<SavedAttempt | null> {
  const access = await getQuestionSetAccess(viewer, setId);
  if (!access) return null;
  return saveAttemptInBook(viewer.id, { bookId: access.bookId, ...answer });
}

export async function clearSetAttempts(
  viewer: QuestionSetViewer,
  setId: string,
  onlyWrong: boolean
): Promise<number | null> {
  const access = await getQuestionSetAccess(viewer, setId);
  if (!access) return null;
  return clearQuestionAttempts(viewer.id, access.bookId, onlyWrong);
}
