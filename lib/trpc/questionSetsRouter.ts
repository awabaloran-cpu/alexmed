// 🔒 Protected Doctor Question Sets — the student's side. Redeeming a code
// creates an entitlement; reading a set goes through getQuestionSetAccess
// once and then reads the questions the existing pipeline already produced
// (no AI, no queue — the same data for every student).
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { readQuestionFileContent } from "../db-question-files";
import { hashIp } from "../db-phone";
import {
  getQuestionSetMeta,
  listMyQuestionSets,
  listQuestionSetCatalog,
  redeemAccessCode,
  RedeemError,
  watermarkFor,
} from "../db-question-sets";
import { doctorSetsEnabled } from "../doctor-sets-config";
import { AccessCodeKeyMissingError } from "../question-set-codes";
import {
  getQuestionSetAccess,
  questionSetImageUrl,
} from "../question-set-access";
import {
  clearSetAttempts,
  listSetAttempts,
  saveSetAttempt,
} from "../question-set-attempts";
import { doctorSetsProcedure, protectedProcedure, router } from "./trpc";

export const REDEEM_INVALID_MESSAGE =
  "هذا الكود غير صالح أو غير متاح. تأكد منه أو اطلب كودًا جديدًا من دكتورك.";

const viewerOf = (user: { id: string; role?: string | null }) => ({
  id: user.id,
  role: user.role,
});

function notAvailable(): never {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "هذه المجموعة غير متاحة حاليًا.",
  });
}

export const questionSetsRouter = router({
  // Lets shared UI (the "+" sheet, the question-files page) show the entry
  // point only when the feature is on.
  enabled: protectedProcedure.query(() => doctorSetsEnabled()),

  redeem: doctorSetsProcedure
    .input(z.object({ code: z.string().trim().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await redeemAccessCode(
          ctx.user.id,
          input.code,
          hashIp(ctx.ip ?? null)
        );
      } catch (error) {
        if (error instanceof RedeemError) {
          throw new TRPCError(
            error.kind === "rate_limited"
              ? {
                  code: "TOO_MANY_REQUESTS",
                  message: "محاولات كثيرة. حاول بعد ١٥ دقيقة.",
                }
              : { code: "BAD_REQUEST", message: REDEEM_INVALID_MESSAGE }
          );
        }
        if (error instanceof AccessCodeKeyMissingError) {
          console.error("[QuestionSets] QUESTION_SET_CODE_HMAC_KEY is not set");
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "إضافة الأكواد غير متاحة حاليًا.",
          });
        }
        throw error;
      }
    }),

  mine: doctorSetsProcedure.query(({ ctx }) => listMyQuestionSets(ctx.user.id)),

  catalog: doctorSetsProcedure.query(({ ctx }) =>
    listQuestionSetCatalog(ctx.user.id)
  ),

  // Authorized once per request; then one read of the set's questions
  // (three queries whatever the size). Never the PDF, never a storage key:
  // images are addressed by set + image id and streamed no-store.
  get: doctorSetsProcedure
    .input(z.object({ setId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const access = await getQuestionSetAccess(
        { id: ctx.user.id, role: ctx.user.role },
        input.setId
      );
      if (!access) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "هذه المجموعة غير متاحة حاليًا.",
        });
      }
      const [set, content] = await Promise.all([
        getQuestionSetMeta(access.setId),
        readQuestionFileContent(access.bookId, image =>
          questionSetImageUrl(access.setId, image.imageId)
        ),
      ]);
      return {
        set,
        role: access.role,
        questions: content.questions,
        watermark:
          access.role === "entitled" && access.entitlementId
            ? await watermarkFor(ctx.user.id, access.entitlementId)
            : null,
      };
    }),

  // ── The student's own answers in a set (lib/question-set-attempts.ts) ──
  // Kept on the server, so progress follows the student across devices.
  // Each call re-checks that the student may still open the set.
  attempts: doctorSetsProcedure
    .input(z.object({ setId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const answers = await listSetAttempts(viewerOf(ctx.user), input.setId);
      if (!answers) notAvailable();
      return answers;
    }),

  saveAttempt: doctorSetsProcedure
    .input(
      z.object({
        setId: z.string().uuid(),
        questionId: z.string().uuid(),
        selectedIndex: z.number().int().min(0).max(25),
      })
    )
    .mutation(async ({ ctx, input: { setId, ...answer } }) => {
      const saved = await saveSetAttempt(viewerOf(ctx.user), setId, answer);
      if (!saved) notAvailable();
      return saved;
    }),

  // Start again: every answer, or only the wrong ones.
  clearAttempts: doctorSetsProcedure
    .input(z.object({ setId: z.string().uuid(), onlyWrong: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await clearSetAttempts(
        viewerOf(ctx.user),
        input.setId,
        input.onlyWrong
      );
      if (removed === null) notAvailable();
      return { removed };
    }),
});
