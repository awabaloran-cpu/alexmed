import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  PublicExamError,
  createPublicExam,
  getPublicExamBySlug,
  getPublicExamSession,
  listPublicExamsForAdmin,
  listQuestionFilesForPublicExamAdmin,
  setPublicExamStatus,
  startOrResumePublicExam,
  submitPublicExamAnswer,
  updatePublicExamSettings,
} from "../db-public-exams";
import { adminProcedure, publicProcedure, router } from "./trpc";

const id = z.string().uuid();
const slug = z.string().trim().min(1).max(160);

const trackingSchema = z
  .object({
    source: z.string().trim().max(80).nullable().optional(),
    utmSource: z.string().trim().max(120).nullable().optional(),
    utmMedium: z.string().trim().max(120).nullable().optional(),
    utmCampaign: z.string().trim().max(160).nullable().optional(),
    utmContent: z.string().trim().max(160).nullable().optional(),
    utmTerm: z.string().trim().max(160).nullable().optional(),
    telegramPayload: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .optional();

const CODE_MAP = {
  NOT_FOUND: "NOT_FOUND",
  NOT_AVAILABLE: "PRECONDITION_FAILED",
  LOGIN_REQUIRED: "UNAUTHORIZED",
  SESSION_EXPIRED: "PRECONDITION_FAILED",
  SESSION_CLOSED: "CONFLICT",
  INVALID_SUBMISSION: "BAD_REQUEST",
} as const;

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "غير موجود." });
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PublicExamError) {
      throw new TRPCError({ code: CODE_MAP[error.code], message: error.message });
    }
    throw error;
  }
}

export const publicExamsRouter = router({
  get: publicProcedure.input(z.object({ slug })).query(async ({ input }) => {
    const exam = await run(() => getPublicExamBySlug(input.slug));
    if (!exam) notFound();
    return exam;
  }),

  startOrResume: publicProcedure
    .input(
      z.object({
        slug,
        anonymousId: z.string().trim().max(120).nullable().optional(),
        sessionId: id.nullable().optional(),
        tracking: trackingSchema,
      })
    )
    .mutation(({ ctx, input }) =>
      run(() =>
        startOrResumePublicExam({
          slug: input.slug,
          anonymousId: input.anonymousId,
          sessionId: input.sessionId,
          userId: ctx.user?.id ?? null,
          tracking: input.tracking,
        })
      )
    ),

  session: publicProcedure
    .input(z.object({ sessionId: id }))
    .query(({ ctx, input }) =>
      run(() =>
        getPublicExamSession({
          sessionId: input.sessionId,
          userId: ctx.user?.id ?? null,
        })
      )
    ),

  submitAnswer: publicProcedure
    .input(
      z.object({
        sessionId: id,
        questionId: id,
        selectedIndex: z.number().int().min(0).max(25),
      })
    )
    .mutation(({ ctx, input }) =>
      run(() =>
        submitPublicExamAnswer({
          sessionId: input.sessionId,
          questionId: input.questionId,
          selectedIndex: input.selectedIndex,
          userId: ctx.user?.id ?? null,
        })
      )
    ),
});

export const adminPublicExamsRouter = router({
  list: adminProcedure.query(() => listPublicExamsForAdmin()),

  questionFiles: adminProcedure.query(() => listQuestionFilesForPublicExamAdmin()),

  create: adminProcedure
    .input(
      z.object({
        bookId: id,
        title: z.string().trim().min(3).max(200),
        slug: z.string().trim().max(160).nullable().optional(),
        description: z.string().trim().max(1000).nullable().optional(),
        freeQuestionsBeforeLogin: z.number().int().min(1).max(500).optional(),
        questionLimit: z.number().int().min(1).max(1000).nullable().optional(),
        durationSeconds: z.number().int().min(60).max(24 * 3600).nullable().optional(),
        shuffleQuestions: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      run(() =>
        createPublicExam({
          actorId: ctx.user.id,
          bookId: input.bookId,
          title: input.title,
          slug: input.slug,
          description: input.description,
          freeQuestionsBeforeLogin: input.freeQuestionsBeforeLogin,
          questionLimit: input.questionLimit,
          durationSeconds: input.durationSeconds,
          shuffleQuestions: input.shuffleQuestions,
        })
      )
    ),

  update: adminProcedure
    .input(
      z.object({
        examId: id,
        title: z.string().trim().min(3).max(200).optional(),
        description: z.string().trim().max(1000).nullable().optional(),
        freeQuestionsBeforeLogin: z.number().int().min(1).max(500).optional(),
        questionLimit: z.number().int().min(1).max(1000).nullable().optional(),
        durationSeconds: z.number().int().min(60).max(24 * 3600).nullable().optional(),
        shuffleQuestions: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { examId, ...settings } = input;
      return run(() => updatePublicExamSettings(ctx.user.id, examId, settings));
    }),

  publish: adminProcedure
    .input(z.object({ examId: id }))
    .mutation(({ ctx, input }) =>
      run(() => setPublicExamStatus(ctx.user.id, input.examId, "published"))
    ),

  pause: adminProcedure
    .input(z.object({ examId: id }))
    .mutation(({ ctx, input }) =>
      run(() => setPublicExamStatus(ctx.user.id, input.examId, "paused"))
    ),

  archive: adminProcedure
    .input(z.object({ examId: id }))
    .mutation(({ ctx, input }) =>
      run(() => setPublicExamStatus(ctx.user.id, input.examId, "archived"))
    ),
});
