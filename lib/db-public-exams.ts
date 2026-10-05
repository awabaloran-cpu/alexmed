import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  books,
  extractedQuestionImageRelations,
  extractedQuestionImages,
  extractedQuestions,
  publicExamAnswers,
  publicExamEvents,
  publicExamSessions,
  publicExams,
  type PublicExam,
  type PublicExamSession,
} from "../drizzle/schema";
import { requireDb } from "./db";

export class PublicExamError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "NOT_AVAILABLE"
      | "LOGIN_REQUIRED"
      | "SESSION_EXPIRED"
      | "SESSION_CLOSED"
      | "INVALID_SUBMISSION",
    message: string
  ) {
    super(message);
  }
}

type Db = ReturnType<typeof requireDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;
type ExamRow = PublicExam;
type SessionRow = PublicExamSession;

type TrackingInput = {
  source?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  telegramPayload?: Record<string, unknown> | null;
};

export type SafePublicExamQuestion = {
  id: string;
  index: number;
  total: number;
  questionText: string;
  questionTextAr: string | null;
  options: string[] | null;
  optionsAr: string[] | null;
  sourcePage: number;
  imageUrl: string | null;
  answered: boolean;
  selectedIndex: number | null;
};

export type PublicExamSessionView = {
  exam: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    freeQuestionsBeforeLogin: number;
    durationSeconds: number | null;
  };
  session: {
    id: string;
    anonymousId: string;
    currentQuestionIndex: number;
    answeredCount: number;
    totalQuestions: number;
    score: number;
    status: SessionRow["status"];
    startedAt: string;
    expiresAt: string | null;
    serverNow: string;
    requiresLogin: boolean;
  };
  question: SafePublicExamQuestion | null;
};

export function publicExamImageUrl(sessionId: string, imageId: string): string {
  return `/api/public-exams/sessions/${sessionId}/images/${imageId}`;
}

function clampText(value: string | null | undefined, max: number) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9؀-ۿ-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function fallbackSlug(title: string) {
  return normalizeSlug(title) || `exam-${randomUUID().slice(0, 8)}`;
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isExamOpen(exam: ExamRow, now = new Date()) {
  return (
    exam.status === "published" &&
    (!exam.startsAt || exam.startsAt.getTime() <= now.getTime()) &&
    (!exam.endsAt || exam.endsAt.getTime() > now.getTime())
  );
}

function correctIndexOf(question: {
  extractedAnswerIndex: number | null;
  aiInferredAnswerIndex: number | null;
}) {
  return question.extractedAnswerIndex ?? question.aiInferredAnswerIndex;
}

function explanationOf(question: {
  explanationText: string | null;
  aiExplanationAr: string | null;
}) {
  return question.explanationText ?? question.aiExplanationAr;
}

function loginGateReached(
  exam: ExamRow,
  session: SessionRow,
  answeredCount: number
) {
  return (
    session.status === "active" &&
    !session.userId &&
    answeredCount >= exam.freeQuestionsBeforeLogin
  );
}

async function questionImageMap(
  executor: Executor,
  bookId: string,
  questionIds: string[],
  sessionId: string
) {
  const byQuestion = new Map<string, string>();
  if (!questionIds.length) return byQuestion;
  const rows = await executor
    .select({
      questionId: extractedQuestionImageRelations.questionId,
      imageId: extractedQuestionImages.id,
      storageKey: extractedQuestionImages.storageKey,
    })
    .from(extractedQuestionImageRelations)
    .innerJoin(
      extractedQuestionImages,
      eq(extractedQuestionImages.id, extractedQuestionImageRelations.imageId)
    )
    .where(
      and(
        eq(extractedQuestionImages.bookId, bookId),
        inArray(extractedQuestionImageRelations.questionId, questionIds)
      )
    );
  for (const row of rows) {
    if (!byQuestion.has(row.questionId)) {
      byQuestion.set(row.questionId, publicExamImageUrl(sessionId, row.imageId));
    }
  }
  return byQuestion;
}

async function readSessionBundle(executor: Executor, sessionId: string) {
  const [row] = await executor
    .select({ session: publicExamSessions, exam: publicExams })
    .from(publicExamSessions)
    .innerJoin(publicExams, eq(publicExams.id, publicExamSessions.examId))
    .where(eq(publicExamSessions.id, sessionId))
    .limit(1);
  return row ?? null;
}

async function readSessionBundleForUpdate(executor: Tx, sessionId: string) {
  const [session] = await executor
    .select()
    .from(publicExamSessions)
    .where(eq(publicExamSessions.id, sessionId))
    .for("update")
    .limit(1);
  if (!session) return null;
  const [exam] = await executor
    .select()
    .from(publicExams)
    .where(eq(publicExams.id, session.examId))
    .limit(1);
  if (!exam) return null;
  return { session, exam };
}

async function answeredCount(executor: Executor, sessionId: string) {
  const [row] = await executor
    .select({ value: count(publicExamAnswers.id) })
    .from(publicExamAnswers)
    .where(eq(publicExamAnswers.sessionId, sessionId));
  return Number(row?.value ?? 0);
}

async function publicQuestion(
  executor: Executor,
  exam: ExamRow,
  session: SessionRow,
  questionId: string,
  index: number
): Promise<SafePublicExamQuestion | null> {
  const [question] = await executor
    .select({
      id: extractedQuestions.id,
      questionText: extractedQuestions.questionText,
      options: extractedQuestions.options,
      sourcePage: extractedQuestions.sourcePage,
      questionTextAr: extractedQuestions.questionTextAr,
      optionsAr: extractedQuestions.optionsAr,
    })
    .from(extractedQuestions)
    .where(
      and(
        eq(extractedQuestions.id, questionId),
        eq(extractedQuestions.bookId, exam.bookId),
        sql`${extractedQuestions.reviewStatus} IS DISTINCT FROM 'needs_review'`
      )
    )
    .limit(1);
  if (!question) return null;

  const [answer] = await executor
    .select({ selectedIndex: publicExamAnswers.selectedIndex })
    .from(publicExamAnswers)
    .where(
      and(
        eq(publicExamAnswers.sessionId, session.id),
        eq(publicExamAnswers.questionId, question.id)
      )
    )
    .limit(1);
  const images = await questionImageMap(executor, exam.bookId, [question.id], session.id);

  return {
    id: question.id,
    index,
    total: session.questionOrder.length,
    questionText: question.questionText,
    questionTextAr: question.questionTextAr,
    options: question.options,
    optionsAr: question.optionsAr,
    sourcePage: question.sourcePage,
    imageUrl: images.get(question.id) ?? null,
    answered: Boolean(answer),
    selectedIndex: answer?.selectedIndex ?? null,
  };
}

async function toSessionView(
  executor: Executor,
  exam: ExamRow,
  session: SessionRow
): Promise<PublicExamSessionView> {
  const count = await answeredCount(executor, session.id);
  const questionId = session.questionOrder[session.currentQuestionIndex] ?? null;
  const score = Number(session.score ?? 0);
  const question = questionId
    ? await publicQuestion(
        executor,
        exam,
        session,
        questionId,
        session.currentQuestionIndex
      )
    : null;
  return {
    exam: {
      id: exam.id,
      slug: exam.slug,
      title: exam.title,
      description: exam.description,
      freeQuestionsBeforeLogin: exam.freeQuestionsBeforeLogin,
      durationSeconds: exam.durationSeconds,
    },
    session: {
      id: session.id,
      anonymousId: session.anonymousId,
      currentQuestionIndex: session.currentQuestionIndex,
      answeredCount: count,
      totalQuestions: session.questionOrder.length,
      score,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      expiresAt: session.expiresAt?.toISOString() ?? null,
      serverNow: new Date().toISOString(),
      requiresLogin: loginGateReached(exam, session, count),
    },
    question,
  };
}

async function recordEvent(
  executor: Executor,
  input: {
    examId?: string | null;
    sessionId?: string | null;
    actorId?: string | null;
    anonymousId?: string | null;
    event: string;
    meta?: Record<string, string | number | boolean>;
  }
) {
  await executor.insert(publicExamEvents).values({
    examId: input.examId ?? null,
    sessionId: input.sessionId ?? null,
    actorId: input.actorId ?? null,
    anonymousId: input.anonymousId ?? null,
    event: input.event,
    meta: input.meta,
  });
}

async function linkSessionToUser(
  executor: Executor,
  exam: ExamRow,
  session: SessionRow,
  userId?: string | null
) {
  if (session.userId && session.userId !== userId) {
    throw new PublicExamError("NOT_FOUND", "الجلسة غير موجودة.");
  }
  if (!userId || session.userId) return session;

  const [updated] = await executor
    .update(publicExamSessions)
    .set({ userId, updatedAt: new Date() })
    .where(eq(publicExamSessions.id, session.id))
    .returning();
  await recordEvent(executor, {
    examId: exam.id,
    sessionId: session.id,
    actorId: userId,
    anonymousId: session.anonymousId,
    event: "linked_to_user",
  });
  return updated ?? session;
}

async function candidateQuestionIds(
  executor: Executor,
  bookId: string,
  limit: number | null,
  shuffled: boolean
) {
  const rows = await executor
    .select({ id: extractedQuestions.id })
    .from(extractedQuestions)
    .where(
      and(
        eq(extractedQuestions.bookId, bookId),
        sql`${extractedQuestions.reviewStatus} IS DISTINCT FROM 'needs_review'`
      )
    )
    .orderBy(asc(extractedQuestions.orderIndex));
  const ids = rows.map(row => row.id);
  const ordered = shuffled ? shuffle(ids) : ids;
  return limit && limit > 0 ? ordered.slice(0, limit) : ordered;
}

export async function listPublicExamsForAdmin() {
  const db = requireDb();
  return db
    .select({
      id: publicExams.id,
      slug: publicExams.slug,
      title: publicExams.title,
      description: publicExams.description,
      status: publicExams.status,
      questionLimit: publicExams.questionLimit,
      freeQuestionsBeforeLogin: publicExams.freeQuestionsBeforeLogin,
      durationSeconds: publicExams.durationSeconds,
      publishedAt: publicExams.publishedAt,
      createdAt: publicExams.createdAt,
      fileName: books.fileName,
      bookStatus: books.status,
      extractedQuestions: count(extractedQuestions.id),
    })
    .from(publicExams)
    .innerJoin(books, eq(books.id, publicExams.bookId))
    .leftJoin(
      extractedQuestions,
      and(
        eq(extractedQuestions.bookId, books.id),
        sql`${extractedQuestions.reviewStatus} IS DISTINCT FROM 'needs_review'`
      )
    )
    .groupBy(publicExams.id, books.id)
    .orderBy(desc(publicExams.createdAt));
}

export async function listQuestionFilesForPublicExamAdmin() {
  const db = requireDb();
  return db
    .select({
      id: books.id,
      fileName: books.fileName,
      status: books.status,
      createdAt: books.createdAt,
      questionCount: count(extractedQuestions.id),
    })
    .from(books)
    .leftJoin(
      extractedQuestions,
      and(
        eq(extractedQuestions.bookId, books.id),
        sql`${extractedQuestions.reviewStatus} IS DISTINCT FROM 'needs_review'`
      )
    )
    .where(eq(books.sourceType, "question_file"))
    .groupBy(books.id)
    .orderBy(desc(books.createdAt));
}

export async function createPublicExam(input: {
  actorId: string;
  bookId: string;
  title: string;
  slug?: string | null;
  description?: string | null;
  freeQuestionsBeforeLogin?: number;
  questionLimit?: number | null;
  durationSeconds?: number | null;
  shuffleQuestions?: boolean;
}) {
  const db = requireDb();
  const slug = input.slug?.trim() ? normalizeSlug(input.slug) : fallbackSlug(input.title);
  if (!slug) throw new PublicExamError("INVALID_SUBMISSION", "الرابط غير صالح.");
  const [book] = await db
    .select({ id: books.id, status: books.status, sourceType: books.sourceType })
    .from(books)
    .where(and(eq(books.id, input.bookId), eq(books.sourceType, "question_file")))
    .limit(1);
  if (!book) throw new PublicExamError("NOT_FOUND", "ملف الأسئلة غير موجود.");

  const [exam] = await db
    .insert(publicExams)
    .values({
      bookId: input.bookId,
      createdById: input.actorId,
      title: input.title.trim(),
      slug,
      description: input.description?.trim() || null,
      freeQuestionsBeforeLogin: input.freeQuestionsBeforeLogin ?? 40,
      questionLimit: input.questionLimit ?? null,
      durationSeconds: input.durationSeconds ?? null,
      shuffleQuestions: input.shuffleQuestions ?? true,
    })
    .returning();
  await recordEvent(db, {
    examId: exam.id,
    actorId: input.actorId,
    event: "created",
  });
  return exam;
}

export async function setPublicExamStatus(
  actorId: string,
  examId: string,
  status: "published" | "paused" | "archived"
) {
  const db = requireDb();
  return db.transaction(async tx => {
    const [current] = await tx
      .select({ exam: publicExams, book: books })
      .from(publicExams)
      .innerJoin(books, eq(books.id, publicExams.bookId))
      .where(eq(publicExams.id, examId))
      .for("update")
      .limit(1);
    if (!current) throw new PublicExamError("NOT_FOUND", "الامتحان غير موجود.");
    if (status === "published") {
      if (current.book.status !== "complete") {
        throw new PublicExamError(
          "NOT_AVAILABLE",
          "لا يمكن نشر امتحان قبل اكتمال معالجة ملف الأسئلة."
        );
      }
      const total = (
        await candidateQuestionIds(tx, current.exam.bookId, null, false)
      ).length;
      if (!total) {
        throw new PublicExamError("NOT_AVAILABLE", "لا توجد أسئلة صالحة للنشر.");
      }
    }
    const now = new Date();
    const [updated] = await tx
      .update(publicExams)
      .set({
        status,
        updatedAt: now,
        ...(status === "published"
          ? { publishedAt: current.exam.publishedAt ?? now, pausedAt: null }
          : status === "paused"
            ? { pausedAt: now }
            : { archivedAt: now }),
      })
      .where(eq(publicExams.id, examId))
      .returning();
    await recordEvent(tx, {
      examId,
      actorId,
      event: status,
    });
    return updated;
  });
}

export async function updatePublicExamSettings(
  actorId: string,
  examId: string,
  input: {
    title?: string;
    description?: string | null;
    freeQuestionsBeforeLogin?: number;
    questionLimit?: number | null;
    durationSeconds?: number | null;
    shuffleQuestions?: boolean;
  }
) {
  const db = requireDb();
  const [updated] = await db
    .update(publicExams)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.freeQuestionsBeforeLogin !== undefined
        ? { freeQuestionsBeforeLogin: input.freeQuestionsBeforeLogin }
        : {}),
      ...(input.questionLimit !== undefined
        ? { questionLimit: input.questionLimit }
        : {}),
      ...(input.durationSeconds !== undefined
        ? { durationSeconds: input.durationSeconds }
        : {}),
      ...(input.shuffleQuestions !== undefined
        ? { shuffleQuestions: input.shuffleQuestions }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(publicExams.id, examId))
    .returning();
  if (!updated) throw new PublicExamError("NOT_FOUND", "الامتحان غير موجود.");
  await recordEvent(db, { examId, actorId, event: "updated" });
  return updated;
}

export async function getPublicExamBySlug(slug: string) {
  const db = requireDb();
  const [exam] = await db
    .select({
      id: publicExams.id,
      slug: publicExams.slug,
      title: publicExams.title,
      description: publicExams.description,
      status: publicExams.status,
      freeQuestionsBeforeLogin: publicExams.freeQuestionsBeforeLogin,
      durationSeconds: publicExams.durationSeconds,
      startsAt: publicExams.startsAt,
      endsAt: publicExams.endsAt,
    })
    .from(publicExams)
    .where(eq(publicExams.slug, slug))
    .limit(1);
  if (!exam || exam.status !== "published") return null;
  return {
    ...exam,
    available: (!exam.startsAt || exam.startsAt <= new Date()) &&
      (!exam.endsAt || exam.endsAt > new Date()),
  };
}

export async function startOrResumePublicExam(input: {
  slug: string;
  anonymousId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  tracking?: TrackingInput;
}) {
  const db = requireDb();
  const anonymousId = clampText(input.anonymousId, 120) ?? randomUUID();
  return db.transaction(async tx => {
    const [exam] = await tx
      .select()
      .from(publicExams)
      .where(eq(publicExams.slug, input.slug))
      .limit(1);
    if (!exam) throw new PublicExamError("NOT_FOUND", "الامتحان غير موجود.");
    if (!isExamOpen(exam)) {
      throw new PublicExamError("NOT_AVAILABLE", "هذا الامتحان غير متاح الآن.");
    }

    if (input.sessionId) {
      const bundle = await readSessionBundleForUpdate(tx, input.sessionId);
      if (bundle && bundle.exam.id === exam.id) {
        const session = bundle.session;
        if (session.status !== "active") {
          throw new PublicExamError("SESSION_CLOSED", "انتهت هذه الجلسة.");
        }
        if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
          await tx
            .update(publicExamSessions)
            .set({ status: "expired", updatedAt: new Date() })
            .where(eq(publicExamSessions.id, session.id));
          throw new PublicExamError("SESSION_EXPIRED", "انتهى وقت الامتحان.");
        }
        const nextSession = await linkSessionToUser(
          tx,
          exam,
          session,
          input.userId
        );
        return toSessionView(tx, exam, nextSession);
      }
    }

    const order = await candidateQuestionIds(
      tx,
      exam.bookId,
      exam.questionLimit,
      exam.shuffleQuestions
    );
    if (!order.length) {
      throw new PublicExamError("NOT_AVAILABLE", "لا توجد أسئلة متاحة لهذا الامتحان.");
    }
    const now = new Date();
    const [session] = await tx
      .insert(publicExamSessions)
      .values({
        examId: exam.id,
        userId: input.userId ?? null,
        anonymousId,
        source: clampText(input.tracking?.source, 80),
        utmSource: clampText(input.tracking?.utmSource, 120),
        utmMedium: clampText(input.tracking?.utmMedium, 120),
        utmCampaign: clampText(input.tracking?.utmCampaign, 160),
        utmContent: clampText(input.tracking?.utmContent, 160),
        utmTerm: clampText(input.tracking?.utmTerm, 160),
        telegramPayload: input.tracking?.telegramPayload ?? null,
        questionOrder: order,
        startedAt: now,
        expiresAt: exam.durationSeconds
          ? new Date(now.getTime() + exam.durationSeconds * 1000)
          : null,
      })
      .returning();
    await recordEvent(tx, {
      examId: exam.id,
      sessionId: session.id,
      actorId: input.userId ?? null,
      anonymousId,
      event: "started",
      meta: input.tracking?.source ? { source: input.tracking.source } : undefined,
    });
    return toSessionView(tx, exam, session);
  });
}

export async function getPublicExamSession(input: {
  sessionId: string;
  userId?: string | null;
}) {
  const db = requireDb();
  return db.transaction(async tx => {
    const bundle = await readSessionBundle(tx, input.sessionId);
    if (!bundle) throw new PublicExamError("NOT_FOUND", "الجلسة غير موجودة.");
    const session = await linkSessionToUser(
      tx,
      bundle.exam,
      bundle.session,
      input.userId
    );
    if (session.status === "active" && !isExamOpen(bundle.exam)) {
      throw new PublicExamError("NOT_AVAILABLE", "هذا الامتحان غير متاح الآن.");
    }
    if (
      session.status === "active" &&
      session.expiresAt &&
      session.expiresAt.getTime() < Date.now()
    ) {
      await tx
        .update(publicExamSessions)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(publicExamSessions.id, session.id));
      throw new PublicExamError("SESSION_EXPIRED", "انتهى وقت الامتحان.");
    }
    return toSessionView(tx, bundle.exam, session);
  });
}

export async function submitPublicExamAnswer(input: {
  sessionId: string;
  questionId: string;
  selectedIndex: number;
  userId?: string | null;
}) {
  const db = requireDb();
  return db.transaction(async tx => {
    const bundle = await readSessionBundleForUpdate(tx, input.sessionId);
    if (!bundle) throw new PublicExamError("NOT_FOUND", "الجلسة غير موجودة.");
    const { exam, session } = bundle;
    if (session.userId && session.userId !== input.userId) {
      throw new PublicExamError("NOT_FOUND", "الجلسة غير موجودة.");
    }
    if (!isExamOpen(exam)) {
      throw new PublicExamError("NOT_AVAILABLE", "هذا الامتحان غير متاح الآن.");
    }
    if (session.status !== "submitted" && session.status !== "active") {
      throw new PublicExamError("SESSION_CLOSED", "انتهت هذه الجلسة.");
    }
    if (
      session.status === "active" &&
      session.expiresAt &&
      session.expiresAt.getTime() < Date.now()
    ) {
      await tx
        .update(publicExamSessions)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(publicExamSessions.id, session.id));
      throw new PublicExamError("SESSION_EXPIRED", "انتهى وقت الامتحان.");
    }
    const [question] = await tx
      .select({
        id: extractedQuestions.id,
        options: extractedQuestions.options,
        extractedAnswerIndex: extractedQuestions.extractedAnswerIndex,
        aiInferredAnswerIndex: extractedQuestions.aiInferredAnswerIndex,
        extractedAnswerText: extractedQuestions.extractedAnswerText,
        explanationText: extractedQuestions.explanationText,
        aiExplanationAr: extractedQuestions.aiExplanationAr,
      })
      .from(extractedQuestions)
      .where(
        and(
          eq(extractedQuestions.id, input.questionId),
          eq(extractedQuestions.bookId, exam.bookId),
          sql`${extractedQuestions.reviewStatus} IS DISTINCT FROM 'needs_review'`
        )
      )
      .limit(1);
    if (!question) {
      throw new PublicExamError("NOT_FOUND", "السؤال غير موجود.");
    }

    const [existingAnswer] = await tx
      .select({
        selectedIndex: publicExamAnswers.selectedIndex,
        correctIndex: publicExamAnswers.correctIndex,
        isCorrect: publicExamAnswers.isCorrect,
      })
      .from(publicExamAnswers)
      .where(
        and(
          eq(publicExamAnswers.sessionId, session.id),
          eq(publicExamAnswers.questionId, question.id)
        )
      )
      .limit(1);
    if (existingAnswer) {
      if (session.status !== "active" && session.status !== "submitted") {
        throw new PublicExamError("SESSION_CLOSED", "انتهت هذه الجلسة.");
      }
      return {
        isCorrect: existingAnswer.isCorrect,
        correctIndex: existingAnswer.correctIndex,
        extractedAnswerText: question.extractedAnswerText,
        explanation: explanationOf(question),
        finished: session.status === "submitted",
        next: await toSessionView(tx, exam, session),
      };
    }

    const countBefore = await answeredCount(tx, session.id);
    if (loginGateReached(exam, session, countBefore)) {
      throw new PublicExamError("LOGIN_REQUIRED", "سجّل الدخول لإكمال الامتحان.");
    }
    if (session.status !== "active") {
      throw new PublicExamError("SESSION_CLOSED", "انتهت هذه الجلسة.");
    }
    const currentQuestionId = session.questionOrder[session.currentQuestionIndex];
    if (!currentQuestionId || currentQuestionId !== input.questionId) {
      throw new PublicExamError("INVALID_SUBMISSION", "هذا السؤال ليس السؤال الحالي.");
    }
    const maxIndex = (question.options?.length ?? 0) - 1;
    if (maxIndex < 0 || input.selectedIndex > maxIndex) {
      throw new PublicExamError("INVALID_SUBMISSION", "اختيار غير صالح.");
    }
    const correctIndex = correctIndexOf(question);
    const isCorrect = correctIndex !== null && input.selectedIndex === correctIndex;
    const nextIndex = Math.min(
      session.currentQuestionIndex + 1,
      session.questionOrder.length
    );
    const newScore = Number(session.score ?? 0) + (isCorrect ? 1 : 0);

    await tx.insert(publicExamAnswers).values({
      sessionId: session.id,
      questionId: question.id,
      questionIndex: session.currentQuestionIndex,
      selectedIndex: input.selectedIndex,
      correctIndex,
      isCorrect,
    });

    const finished = nextIndex >= session.questionOrder.length;
    const now = new Date();
    const [updatedSession] = await tx
      .update(publicExamSessions)
      .set({
        currentQuestionIndex: nextIndex,
        score: newScore,
        status: finished ? "submitted" : "active",
        submittedAt: finished ? now : null,
        result: finished
          ? {
              score: newScore,
              total: session.questionOrder.length,
              completedAt: now.toISOString(),
            }
          : session.result,
        updatedAt: now,
      })
      .where(eq(publicExamSessions.id, session.id))
      .returning();
    await recordEvent(tx, {
      examId: exam.id,
      sessionId: session.id,
      actorId: input.userId ?? null,
      anonymousId: session.anonymousId,
      event: finished ? "submitted" : "answered",
      meta: { questionIndex: session.currentQuestionIndex, correct: isCorrect },
    });

    return {
      isCorrect,
      correctIndex,
      extractedAnswerText: question.extractedAnswerText,
      explanation: explanationOf(question),
      finished,
      next: await toSessionView(tx, exam, updatedSession),
    };
  });
}

export async function getPublicExamImage(input: {
  sessionId: string;
  imageId: string;
  userId?: string | null;
}) {
  const db = requireDb();
  const bundle = await readSessionBundle(db, input.sessionId);
  if (!bundle) return null;
  if (bundle.session.userId && bundle.session.userId !== input.userId) return null;
  if (!isExamOpen(bundle.exam) && bundle.session.status === "active") return null;
  const visibleQuestionIds = bundle.session.questionOrder.slice(
    0,
    Math.min(bundle.session.currentQuestionIndex + 1, bundle.session.questionOrder.length)
  );
  if (!visibleQuestionIds.length) return null;
  const [image] = await db
    .select({ storageKey: extractedQuestionImages.storageKey })
    .from(extractedQuestionImages)
    .innerJoin(
      extractedQuestionImageRelations,
      eq(extractedQuestionImageRelations.imageId, extractedQuestionImages.id)
    )
    .where(
      and(
        eq(extractedQuestionImages.id, input.imageId),
        eq(extractedQuestionImages.bookId, bundle.exam.bookId),
        inArray(extractedQuestionImageRelations.questionId, visibleQuestionIds)
      )
    )
    .limit(1);
  return image ?? null;
}
