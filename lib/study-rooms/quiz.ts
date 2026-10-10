// 🏁 The group quiz: a room answers the questions of a question file
// together, one at a time, against the clock.
//
// The server is the judge:
//   - the correct answer never leaves the server before the reveal;
//   - time is the server's (`stateSince` + `secondsPerQuestion`), not the
//     phone's;
//   - an answer is one row per question and student, and cannot change.
// No timer runs anywhere: the state is moved forward by whoever asks next
// (quizCurrent / quizAdvance) with a conditional update, so two phones — or
// two server replicas — asking at the same instant move it once.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  books,
  extractedQuestions,
  studyRoomMembers,
  studyRoomQuizAnswers,
  studyRoomQuizzes,
  studyRooms,
  users,
} from "../../drizzle/schema";
import { requireDb } from "../db";
import { RoomError } from "./errors";
import { can } from "./permissions";
import type { Viewer } from "./profile";
import { logRoomEvent, requireAction, requireMember } from "./rooms";

type Db = ReturnType<typeof requireDb>;

export const QUIZ_MIN_QUESTIONS = 3;
export const QUIZ_COUNT_MIN = 3;
export const QUIZ_COUNT_MAX = 30;
export const QUIZ_SECONDS_MIN = 15;
export const QUIZ_SECONDS_MAX = 90;
// After this long on a reveal, any member may move the quiz on (the host
// may have dropped out).
export const REVEAL_SECONDS = 8;

// 100 for a right answer, and up to 50 more for speed.
export function quizPoints(
  correct: boolean,
  answerMs: number,
  totalMs: number
): number {
  if (!correct) return 0;
  const left = Math.max(0, Math.min(1, 1 - answerMs / totalMs));
  return 100 + Math.round(50 * left);
}

const correctIndexOf = (question: {
  extractedAnswerIndex: number | null;
  aiInferredAnswerIndex: number | null;
}) => question.extractedAnswerIndex ?? question.aiInferredAnswerIndex;

export async function startQuiz(
  viewer: Viewer,
  roomId: string,
  input: { bookId: string; count: number; seconds: number }
) {
  const db = requireDb();
  await requireAction(db, roomId, viewer.userId, "start_quiz");
  // The starter's own question file, never a doctor's protected set.
  const [book] = await db
    .select({
      userId: books.userId,
      sourceType: books.sourceType,
      protectedSet: sql<boolean>`exists (
        select 1 from "question_sets" qs where qs."bookId" = "books"."id"
      )`,
    })
    .from(books)
    .where(eq(books.id, input.bookId))
    .limit(1);
  if (
    !book ||
    book.userId !== viewer.userId ||
    book.sourceType !== "question_file" ||
    book.protectedSet
  ) {
    throw new RoomError("book_not_allowed");
  }
  // Questions a student may see, with options and a known answer.
  const eligible = await db
    .select({ id: extractedQuestions.id })
    .from(extractedQuestions)
    .where(
      and(
        eq(extractedQuestions.bookId, input.bookId),
        sql`${extractedQuestions.reviewStatus} is distinct from 'needs_review'`,
        sql`jsonb_array_length(coalesce(${extractedQuestions.options}, '[]'::jsonb)) >= 2`,
        sql`coalesce(${extractedQuestions.extractedAnswerIndex}, ${extractedQuestions.aiInferredAnswerIndex}) is not null`
      )
    )
    .orderBy(asc(extractedQuestions.orderIndex));
  if (eligible.length < QUIZ_MIN_QUESTIONS) throw new RoomError("quiz_too_few");

  // A random sample, kept in the file's order.
  const pool = eligible.map((question, index) => ({ id: question.id, index }));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const questionIds = pool
    .slice(0, Math.min(input.count, pool.length))
    .sort((a, b) => a.index - b.index)
    .map(question => question.id);

  const [running] = await db
    .select({ id: studyRoomQuizzes.id })
    .from(studyRoomQuizzes)
    .where(
      and(
        eq(studyRoomQuizzes.roomId, roomId),
        inArray(studyRoomQuizzes.state, ["question", "reveal"])
      )
    )
    .limit(1);
  if (running) throw new RoomError("quiz_running");
  let quiz: { id: string };
  try {
    [quiz] = await db
      .insert(studyRoomQuizzes)
      .values({
        roomId,
        bookId: input.bookId,
        startedById: viewer.userId,
        questionIds,
        secondsPerQuestion: input.seconds,
      })
      .returning({ id: studyRoomQuizzes.id });
  } catch {
    // Two starts at the same instant: the unique index let one through.
    throw new RoomError("quiz_running");
  }
  await db
    .update(studyRooms)
    .set({ seq: sql`${studyRooms.seq} + 1`, lastActiveAt: new Date() })
    .where(eq(studyRooms.id, roomId));
  await logRoomEvent(db, {
    roomId,
    actorId: viewer.userId,
    type: "quiz_start",
    data: { questions: questionIds.length },
  });
  return { quizId: quiz.id, questions: questionIds.length };
}

type Quiz = typeof studyRoomQuizzes.$inferSelect;

const bumpRoom = (db: Db, roomId: string) =>
  db
    .update(studyRooms)
    .set({ seq: sql`${studyRooms.seq} + 1`, lastActiveAt: new Date() })
    .where(eq(studyRooms.id, roomId));

// question → reveal, once, whoever asks.
async function reveal(db: Db, quiz: Quiz): Promise<boolean> {
  const moved = await db
    .update(studyRoomQuizzes)
    .set({ state: "reveal", questionStartedAt: new Date() })
    .where(
      and(
        eq(studyRoomQuizzes.id, quiz.id),
        eq(studyRoomQuizzes.state, "question"),
        eq(studyRoomQuizzes.currentIndex, quiz.currentIndex)
      )
    )
    .returning({ id: studyRoomQuizzes.id });
  if (moved.length) await bumpRoom(db, quiz.roomId);
  return moved.length > 0;
}

async function presentIds(db: Db, roomId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: studyRoomMembers.userId })
    .from(studyRoomMembers)
    .where(
      and(
        eq(studyRoomMembers.roomId, roomId),
        eq(studyRoomMembers.state, "joined")
      )
    );
  return rows.map(row => row.userId);
}

// Time is up, or everyone here has answered: the question is over.
async function settle(db: Db, quiz: Quiz): Promise<Quiz> {
  if (quiz.state !== "question") return quiz;
  const elapsed = Date.now() - quiz.questionStartedAt.getTime();
  let over = elapsed >= quiz.secondsPerQuestion * 1000;
  if (!over) {
    const present = await presentIds(db, quiz.roomId);
    const answered = await db
      .select({ userId: studyRoomQuizAnswers.userId })
      .from(studyRoomQuizAnswers)
      .where(
        and(
          eq(studyRoomQuizAnswers.quizId, quiz.id),
          eq(
            studyRoomQuizAnswers.questionId,
            quiz.questionIds[quiz.currentIndex]
          )
        )
      );
    const done = new Set(answered.map(row => row.userId));
    over = present.length > 0 && present.every(userId => done.has(userId));
  }
  if (!over) return quiz;
  await reveal(db, quiz);
  const [fresh] = await db
    .select()
    .from(studyRoomQuizzes)
    .where(eq(studyRoomQuizzes.id, quiz.id))
    .limit(1);
  return fresh ?? quiz;
}

async function leaderboard(db: Db, quizId: string) {
  const rows = await db
    .select({
      userId: studyRoomQuizAnswers.userId,
      name: users.name,
      points: sql<number>`sum(${studyRoomQuizAnswers.points})::int`,
      correct: sql<number>`count(*) filter (where ${studyRoomQuizAnswers.isCorrect})::int`,
    })
    .from(studyRoomQuizAnswers)
    .innerJoin(users, eq(users.id, studyRoomQuizAnswers.userId))
    .where(eq(studyRoomQuizAnswers.quizId, quizId))
    .groupBy(studyRoomQuizAnswers.userId, users.name);
  return rows
    .map(row => ({
      ...row,
      points: Number(row.points),
      correct: Number(row.correct),
    }))
    .sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));
}

// What a member's screen needs right now. In the "question" state the
// answer is NOT in it.
export async function quizCurrent(viewer: Viewer, roomId: string) {
  const db = requireDb();
  await requireMember(db, roomId, viewer.userId);
  const [found] = await db
    .select()
    .from(studyRoomQuizzes)
    .where(
      and(
        eq(studyRoomQuizzes.roomId, roomId),
        inArray(studyRoomQuizzes.state, ["question", "reveal"])
      )
    )
    .limit(1);
  if (!found) return null;
  const quiz = await settle(db, found);
  const questionId = quiz.questionIds[quiz.currentIndex];
  const [question] = await db
    .select({
      id: extractedQuestions.id,
      questionText: extractedQuestions.questionText,
      options: extractedQuestions.options,
      questionTextAr: extractedQuestions.questionTextAr,
      optionsAr: extractedQuestions.optionsAr,
      extractedAnswerIndex: extractedQuestions.extractedAnswerIndex,
      aiInferredAnswerIndex: extractedQuestions.aiInferredAnswerIndex,
      explanationText: extractedQuestions.explanationText,
      aiExplanationAr: extractedQuestions.aiExplanationAr,
    })
    .from(extractedQuestions)
    .where(eq(extractedQuestions.id, questionId))
    .limit(1);
  const answers = await db
    .select({
      userId: studyRoomQuizAnswers.userId,
      selectedIndex: studyRoomQuizAnswers.selectedIndex,
    })
    .from(studyRoomQuizAnswers)
    .where(
      and(
        eq(studyRoomQuizAnswers.quizId, quiz.id),
        eq(studyRoomQuizAnswers.questionId, questionId)
      )
    );
  const mine = answers.find(answer => answer.userId === viewer.userId);
  const revealed = quiz.state === "reveal";
  const options = question?.options ?? [];
  const sinceMs = Date.now() - quiz.questionStartedAt.getTime();

  return {
    quizId: quiz.id,
    state: quiz.state as "question" | "reveal",
    index: quiz.currentIndex,
    total: quiz.questionIds.length,
    seconds: quiz.secondsPerQuestion,
    remainingMs: revealed
      ? 0
      : Math.max(0, quiz.secondsPerQuestion * 1000 - sinceMs),
    // Any member may move on once the reveal has been up long enough.
    canAdvance: revealed && sinceMs >= REVEAL_SECONDS * 1000,
    question: {
      id: questionId,
      text: question?.questionText ?? "",
      options,
      textAr: question?.questionTextAr ?? null,
      optionsAr: question?.optionsAr ?? null,
    },
    answeredUserIds: answers.map(answer => answer.userId),
    mySelectedIndex: mine?.selectedIndex ?? null,
    ...(revealed && question
      ? {
          correctIndex: correctIndexOf(question),
          distribution: options.map(
            (_, i) =>
              answers.filter(answer => answer.selectedIndex === i).length
          ),
          explanation: question.explanationText,
          explanationAr: question.aiExplanationAr,
          leaderboard: await leaderboard(db, quiz.id),
        }
      : {}),
  };
}

export async function answerQuiz(
  viewer: Viewer,
  input: { quizId: string; questionId: string; selectedIndex: number }
) {
  const db = requireDb();
  const [quiz] = await db
    .select()
    .from(studyRoomQuizzes)
    .where(eq(studyRoomQuizzes.id, input.quizId))
    .limit(1);
  if (!quiz) throw new RoomError("quiz_not_active");
  await requireMember(db, quiz.roomId, viewer.userId);
  const answerMs = Date.now() - quiz.questionStartedAt.getTime();
  const totalMs = quiz.secondsPerQuestion * 1000;
  if (
    quiz.state !== "question" ||
    quiz.questionIds[quiz.currentIndex] !== input.questionId ||
    answerMs > totalMs
  ) {
    throw new RoomError("quiz_closed");
  }
  const [question] = await db
    .select({
      options: extractedQuestions.options,
      extractedAnswerIndex: extractedQuestions.extractedAnswerIndex,
      aiInferredAnswerIndex: extractedQuestions.aiInferredAnswerIndex,
    })
    .from(extractedQuestions)
    .where(eq(extractedQuestions.id, input.questionId))
    .limit(1);
  const optionCount = question?.options?.length ?? 0;
  if (
    !question ||
    input.selectedIndex < 0 ||
    input.selectedIndex >= optionCount
  ) {
    throw new RoomError("quiz_closed");
  }
  const correct = correctIndexOf(question) === input.selectedIndex;
  const inserted = await db
    .insert(studyRoomQuizAnswers)
    .values({
      quizId: quiz.id,
      questionId: input.questionId,
      userId: viewer.userId,
      selectedIndex: input.selectedIndex,
      isCorrect: correct,
      answerMs,
      points: quizPoints(correct, answerMs, totalMs),
    })
    .onConflictDoNothing()
    .returning({ userId: studyRoomQuizAnswers.userId });
  if (!inserted.length) throw new RoomError("already_answered");
  // The last one in closes the question for everyone.
  await settle(db, quiz);
  // Whether it was right is told at the reveal, with everyone else's.
  return { accepted: true };
}

// The host (or whoever may start quizzes) moves it on at any time; any
// member may, once a reveal has been up for REVEAL_SECONDS.
export async function advanceQuiz(viewer: Viewer, quizId: string) {
  const db = requireDb();
  const [quiz] = await db
    .select()
    .from(studyRoomQuizzes)
    .where(eq(studyRoomQuizzes.id, quizId))
    .limit(1);
  if (!quiz || !["question", "reveal"].includes(quiz.state)) {
    throw new RoomError("quiz_not_active");
  }
  const { actor, room } = await requireMember(db, quiz.roomId, viewer.userId);
  const leader = can(actor, room.settings, "start_quiz");
  if (quiz.state === "question") {
    if (!leader) throw new RoomError("not_allowed");
    await reveal(db, quiz);
    return { state: "reveal" as const };
  }
  const waited =
    Date.now() - quiz.questionStartedAt.getTime() >= REVEAL_SECONDS * 1000;
  if (!leader && !waited) throw new RoomError("not_allowed");

  const last = quiz.currentIndex >= quiz.questionIds.length - 1;
  const moved = await db
    .update(studyRoomQuizzes)
    .set(
      last
        ? { state: "finished", finishedAt: new Date() }
        : {
            state: "question",
            currentIndex: quiz.currentIndex + 1,
            questionStartedAt: new Date(),
          }
    )
    .where(
      and(
        eq(studyRoomQuizzes.id, quiz.id),
        eq(studyRoomQuizzes.state, "reveal"),
        eq(studyRoomQuizzes.currentIndex, quiz.currentIndex)
      )
    )
    .returning({ id: studyRoomQuizzes.id });
  if (moved.length) {
    await bumpRoom(db, quiz.roomId);
    if (last) {
      await logRoomEvent(db, {
        roomId: quiz.roomId,
        actorId: viewer.userId,
        type: "quiz_end",
      });
    }
  }
  return { state: last ? ("finished" as const) : ("question" as const) };
}

export async function cancelQuiz(viewer: Viewer, quizId: string) {
  const db = requireDb();
  const [quiz] = await db
    .select()
    .from(studyRoomQuizzes)
    .where(eq(studyRoomQuizzes.id, quizId))
    .limit(1);
  if (!quiz) throw new RoomError("quiz_not_active");
  await requireAction(db, quiz.roomId, viewer.userId, "start_quiz");
  await db
    .update(studyRoomQuizzes)
    .set({ state: "cancelled", finishedAt: new Date() })
    .where(
      and(
        eq(studyRoomQuizzes.id, quizId),
        inArray(studyRoomQuizzes.state, ["question", "reveal"])
      )
    );
  await bumpRoom(db, quiz.roomId);
}

// The end of a quiz: the ranking, the student's own result, and the
// question the room found hardest. For anyone who was a member of the room.
export async function quizResults(viewer: Viewer, quizId: string) {
  const db = requireDb();
  const [quiz] = await db
    .select()
    .from(studyRoomQuizzes)
    .where(eq(studyRoomQuizzes.id, quizId))
    .limit(1);
  if (!quiz) throw new RoomError("quiz_not_active");
  const [membership] = await db
    .select({ state: studyRoomMembers.state })
    .from(studyRoomMembers)
    .where(
      and(
        eq(studyRoomMembers.roomId, quiz.roomId),
        eq(studyRoomMembers.userId, viewer.userId)
      )
    )
    .limit(1);
  if (!membership || membership.state === "banned")
    throw new RoomError("not_available");
  if (quiz.state !== "finished") throw new RoomError("quiz_not_active");

  const ranking = await leaderboard(db, quiz.id);
  const perQuestion = await db
    .select({
      questionId: studyRoomQuizAnswers.questionId,
      answers: sql<number>`count(*)::int`,
      correct: sql<number>`count(*) filter (where ${studyRoomQuizAnswers.isCorrect})::int`,
    })
    .from(studyRoomQuizAnswers)
    .where(eq(studyRoomQuizAnswers.quizId, quiz.id))
    .groupBy(studyRoomQuizAnswers.questionId);
  const hardest = perQuestion
    .filter(row => Number(row.answers) > 0)
    .sort(
      (a, b) =>
        Number(a.correct) / Number(a.answers) -
        Number(b.correct) / Number(b.answers)
    )[0];
  const [hardestQuestion] = hardest
    ? await db
        .select({
          text: extractedQuestions.questionText,
          sourcePage: extractedQuestions.sourcePage,
        })
        .from(extractedQuestions)
        .where(eq(extractedQuestions.id, hardest.questionId))
        .limit(1)
    : [];
  const me = ranking.find(row => row.userId === viewer.userId);
  return {
    total: quiz.questionIds.length,
    ranking,
    me: me
      ? {
          ...me,
          rank: ranking.findIndex(row => row.userId === viewer.userId) + 1,
        }
      : null,
    hardest:
      hardest && hardestQuestion
        ? {
            text: hardestQuestion.text,
            sourcePage: hardestQuestion.sourcePage,
            correct: Number(hardest.correct),
            answers: Number(hardest.answers),
          }
        : null,
  };
}
