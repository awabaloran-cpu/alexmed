// 🔒 Protected Doctor Question Sets — the doctor's side. Everything below
// `apply`/`status` runs through doctorProcedure (approved doctor, read from
// the database per call); every data function it calls scopes by
// ownerId = ctx.user.id inside its own query.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { toTrpcError } from "../billing/http";
import {
  assertFileSizeAllowed,
  consumeUsage,
  releaseUsage,
  type UsageReceipt,
} from "../billing/usage";
import {
  applyForDoctor,
  getDoctorProfile,
  isApprovedDoctor,
} from "../db-doctors";
import {
  markQuestionFileFailed,
  readQuestionFileContent,
} from "../db-question-files";
import {
  archiveQuestionSet,
  createQuestionSet,
  disableQuestionSet,
  enableQuestionSet,
  generateAccessCodes,
  getDoctorStats,
  getQuestionSetForOwner,
  listAccessCodes,
  listQuestionSetsForOwner,
  listSetAudit,
  listSetStudents,
  MAX_CODES_PER_BATCH,
  publishQuestionSet,
  QuestionSetWindowError,
  draftQuestionSetBook,
  resetDraftProcessing,
  resumeDraftProcessing,
  revokeAccessCode,
  revokeStudentAccess,
  updateQuestionSetSettings,
} from "../db-question-sets";
import { deleteBook } from "../db-books";
import { getQuestionFileCoverage } from "../db-question-file-images";
import { AccessCodeKeyMissingError } from "../question-set-codes";
import {
  getQuestionSetAccess,
  questionSetImageUrl,
} from "../question-set-access";
import { publishMessage } from "../queue/client";
import { assertJobCreationAllowed, RateLimitedError } from "../queue/rateLimit";
import { storageObjectSize } from "../storage";
import { isOwnUploadKey } from "../upload-keys";
import { doctorProcedure, doctorSetsProcedure, router } from "./trpc";

const id = z.string().uuid();
const shortText = z.string().trim().max(120).nullable().optional();

export const questionSetSettingsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  subjectLabel: shortText,
  academicYear: shortText,
  examType: shortText,
  visibility: z.enum(["listed", "unlisted"]),
  startsAt: z.date().nullable().optional(),
  endsAt: z.date().nullable().optional(),
});

const applicationSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  university: z.string().trim().min(2).max(160),
  faculty: z.string().trim().min(2).max(160),
  department: z.string().trim().min(2).max(160),
  universityEmail: z.string().trim().email().max(320).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "المجموعة غير موجودة." });
}

function windowError(error: unknown): never {
  if (error instanceof QuestionSetWindowError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

function codeKeyError(error: unknown): never {
  if (error instanceof AccessCodeKeyMissingError) {
    console.error("[QuestionSets] QUESTION_SET_CODE_HMAC_KEY is not set");
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "توليد الأكواد غير مفعّل على الخادم بعد.",
    });
  }
  throw error;
}

const setsRouter = router({
  list: doctorProcedure.query(({ ctx }) =>
    listQuestionSetsForOwner(ctx.user.id)
  ),

  get: doctorProcedure
    .input(z.object({ setId: id }))
    .query(async ({ ctx, input }) => {
      const set = await getQuestionSetForOwner(ctx.user.id, input.setId);
      if (!set) notFound();
      return { set, coverage: await getQuestionFileCoverage(set.bookId) };
    }),

  // The doctor's preview: the same questions, through the same reader and
  // the same image route as a student — without the watermark.
  preview: doctorProcedure
    .input(z.object({ setId: id }))
    .query(async ({ ctx, input }) => {
      const access = await getQuestionSetAccess(
        { id: ctx.user.id },
        input.setId
      );
      if (!access || access.role !== "owner") notFound();
      // The doctor also gets the needs-review blocks (with their reasons),
      // which students never receive.
      return readQuestionFileContent(
        access.bookId,
        image => questionSetImageUrl(input.setId, image.imageId),
        { includeNeedsReview: true }
      );
    }),

  // The PDF was already PUT to storage via /api/books/upload-url (the same
  // upload every question file uses). Same checks as
  // /api/books/extract-questions-and-plan: rate limit, key issued to this
  // user, real stored size, one QUESTION_FILE from the plan's quota — then
  // the SAME extract_question_file_job starts the existing pipeline.
  create: doctorProcedure
    .input(
      questionSetSettingsSchema.extend({
        key: z.string().min(1).max(600),
        fileName: z.string().trim().min(1).max(300),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { key, fileName, ...settings } = input;
      try {
        await assertJobCreationAllowed(ctx.user.id, "books");
      } catch (error) {
        if (error instanceof RateLimitedError) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: error.message,
          });
        }
        throw error;
      }
      if (!fileName.toLowerCase().endsWith(".pdf")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "الملف يجب أن يكون بصيغة PDF.",
        });
      }
      if (!isOwnUploadKey(key, ctx.user.id)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "ارفع ملف PDF أولًا.",
        });
      }
      const size = await storageObjectSize(key);
      if (size === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "لم يكتمل رفع الملف. ارفعه مرة ثانية.",
        });
      }

      let receipt: UsageReceipt;
      try {
        await assertFileSizeAllowed(ctx.user.id, size);
        receipt = await consumeUsage(ctx.user.id, "QUESTION_FILE");
      } catch (error) {
        toTrpcError(error);
      }
      const release = () =>
        releaseUsage(receipt).catch(error =>
          console.error("[Billing] Failed to release usage", error)
        );

      let set: { id: string; bookId: string };
      try {
        set = await createQuestionSet(ctx.user.id, settings, {
          fileName,
          fileKey: key,
        });
      } catch (error) {
        await release();
        windowError(error);
      }

      try {
        await publishMessage({
          type: "extract_question_file_job",
          bookId: set.bookId,
        });
      } catch (error) {
        console.error("[QuestionSets] Failed to enqueue extraction", error);
        await markQuestionFileFailed(
          set.bookId,
          "تعذر بدء معالجة الملف. اضغط إعادة المعالجة."
        );
        await release();
      }
      return { setId: set.id };
    }),

  // A draft whose extraction failed goes through the same pipeline again.
  retryProcessing: doctorProcedure
    .input(z.object({ setId: id }))
    .mutation(async ({ ctx, input }) => {
      const bookId = await resetDraftProcessing(ctx.user.id, input.setId);
      if (!bookId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "إعادة المعالجة متاحة فقط لمسودة فشلت معالجتها.",
        });
      }
      await publishMessage({ type: "extract_question_file_job", bookId });
      return { success: true } as const;
    }),

  // ▶️ A draft whose preparation stopped short is sent round again — only
  // what is still owed (lib/db-question-sets.ts).
  resume: doctorProcedure
    .input(z.object({ setId: id }))
    .mutation(async ({ ctx, input }) => {
      const owed = await resumeDraftProcessing(ctx.user.id, input.setId);
      if (!owed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "الاستئناف متاح لمسودة قُرئ ملفها ولم تكتمل معالجتها.",
        });
      }
      // One start per file every two minutes, however often it is pressed.
      const bucket = Math.floor(Date.now() / 120_000);
      await publishMessage(
        { type: "extract_question_file_images", bookId: owed.bookId },
        {
          flowControl: {
            key: `question-file-images-${owed.bookId}`,
            parallelism: 1,
          },
          deduplicationId: `qs-resume-images-${owed.bookId}-${bucket}`,
        }
      );
      await publishMessage(
        { type: "generate_question_file_content", bookId: owed.bookId },
        {
          flowControl: {
            key: `question-file-content-${owed.bookId}`,
            parallelism: 1,
          },
          deduplicationId: `qs-resume-content-${owed.bookId}-${bucket}`,
        }
      );
      return { questions: owed.questions, pages: owed.pages };
    }),

  // 🗑️ The wrong file: the draft and its file go, and the preparation stops.
  cancel: doctorProcedure
    .input(z.object({ setId: id }))
    .mutation(async ({ ctx, input }) => {
      const bookId = await draftQuestionSetBook(ctx.user.id, input.setId);
      if (!bookId || !(await deleteBook(ctx.user.id, bookId))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "الحذف متاح للمسودة فقط. المجموعة المنشورة تُؤرشف ولا تُحذف.",
        });
      }
      return { success: true } as const;
    }),

  update: doctorProcedure
    .input(questionSetSettingsSchema.extend({ setId: id }))
    .mutation(async ({ ctx, input }) => {
      const { setId, ...settings } = input;
      let ok = false;
      try {
        ok = await updateQuestionSetSettings(ctx.user.id, setId, settings);
      } catch (error) {
        windowError(error);
      }
      if (!ok) notFound();
      return { success: true } as const;
    }),

  publish: doctorProcedure
    .input(z.object({ setId: id }))
    .mutation(async ({ ctx, input }) => {
      const result = await publishQuestionSet(ctx.user.id, input.setId);
      if (result.ok) return result;
      if (result.reason === "not_found") notFound();
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          result.reason === "not_draft"
            ? "هذه المجموعة منشورة أو مؤرشفة بالفعل."
            : "لا يمكن النشر قبل اكتمال معالجة الملف ووجود أسئلة.",
      });
    }),

  disable: doctorProcedure
    .input(z.object({ setId: id }))
    .mutation(async ({ ctx, input }) => {
      const ok = await disableQuestionSet(
        { id: ctx.user.id, role: "doctor" },
        input.setId
      );
      if (!ok) notFound();
      return { success: true } as const;
    }),

  enable: doctorProcedure
    .input(z.object({ setId: id }))
    .mutation(async ({ ctx, input }) => {
      const ok = await enableQuestionSet(
        { id: ctx.user.id, role: "doctor" },
        input.setId
      );
      if (!ok) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "لا يمكن تفعيل هذه المجموعة (أو أوقفتها الإدارة).",
        });
      }
      return { success: true } as const;
    }),

  archive: doctorProcedure
    .input(z.object({ setId: id }))
    .mutation(async ({ ctx, input }) => {
      const ok = await archiveQuestionSet(
        { id: ctx.user.id, role: "doctor" },
        input.setId
      );
      if (!ok) notFound();
      return { success: true } as const;
    }),
});

const codesRouter = router({
  // The plaintext codes are in this response only — the doctor's browser
  // shows them and offers the CSV once; the server keeps hashes.
  generate: doctorProcedure
    .input(
      z.object({
        setId: id,
        count: z.number().int().min(1).max(MAX_CODES_PER_BATCH),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let result: Awaited<ReturnType<typeof generateAccessCodes>> = null;
      try {
        result = await generateAccessCodes(
          ctx.user.id,
          input.setId,
          input.count
        );
      } catch (error) {
        codeKeyError(error);
      }
      if (!result) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "توليد الأكواد متاح فقط لمجموعة منشورة.",
        });
      }
      return result;
    }),

  list: doctorProcedure
    .input(
      z.object({
        setId: id,
        status: z.enum(["unused", "claimed", "revoked"]).optional(),
        search: z.string().max(40).optional(),
      })
    )
    .query(({ ctx, input }) =>
      listAccessCodes(ctx.user.id, input.setId, input)
    ),

  revoke: doctorProcedure
    .input(z.object({ codeId: id }))
    .mutation(async ({ ctx, input }) => {
      const ok = await revokeAccessCode(ctx.user.id, input.codeId);
      if (!ok) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "يمكن إلغاء الأكواد غير المستخدمة فقط.",
        });
      }
      return { success: true } as const;
    }),
});

const studentsRouter = router({
  list: doctorProcedure
    .input(z.object({ setId: id }))
    .query(({ ctx, input }) => listSetStudents(ctx.user.id, input.setId)),

  revoke: doctorProcedure
    .input(z.object({ entitlementId: id }))
    .mutation(async ({ ctx, input }) => {
      const ok = await revokeStudentAccess(
        { id: ctx.user.id, role: "doctor" },
        input.entitlementId
      );
      if (!ok) notFound();
      return { success: true } as const;
    }),
});

export const doctorRouter = router({
  // The caller's own application state — drives /account and /doctor.
  status: doctorSetsProcedure.query(async ({ ctx }) => ({
    profile: await getDoctorProfile(ctx.user.id),
    approved: await isApprovedDoctor(ctx.user.id),
  })),

  submitApplication: doctorSetsProcedure
    .input(applicationSchema)
    .mutation(async ({ ctx, input }) => {
      const ok = await applyForDoctor(ctx.user.id, input);
      if (!ok) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "لديك طلب دكتور قائم بالفعل.",
        });
      }
      return { success: true } as const;
    }),

  stats: doctorProcedure.query(({ ctx }) => getDoctorStats(ctx.user.id)),

  audit: doctorProcedure
    .input(z.object({ setId: id }))
    .query(({ ctx, input }) => listSetAudit(ctx.user.id, input.setId)),

  sets: setsRouter,
  codes: codesRouter,
  students: studentsRouter,
});
