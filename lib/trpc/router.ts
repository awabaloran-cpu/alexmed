import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { signOut } from "../auth";
import { getUserProfileForAccount, updateUserProfile } from "../db";
import { parsePhone } from "../phone";
import { deleteAccountCompletely } from "../db-account";
import { hasLiveQuestionSets } from "../db-question-sets";
import {
  adminDoctorsRouter,
  adminQuestionSetsRouter,
} from "./adminDoctorSetsRouter";
import { doctorRouter } from "./doctorRouter";
import { questionSetsRouter } from "./questionSetsRouter";
import { adminBillingRouter } from "./adminBillingRouter";
import { adminJobsRouter } from "./adminJobsRouter";
import { adminMaterialsRouter } from "./adminMaterialsRouter";
import { adminUsersRouter } from "./adminUsersRouter";
import { annotationsRouter } from "./annotationsRouter";
import { billingRouter } from "./billingRouter";
import { booksRouter } from "./booksRouter";
import { brainGamesRouter } from "./brainGamesRouter";
import { bookPageMarksRouter } from "./bookPageMarksRouter";
import { cardMarksRouter } from "./cardMarksRouter";
import { chatRouter } from "./chatRouter";
import { decksRouter } from "./decksRouter";
import { examFocusRouter } from "./examFocusRouter";
import { mirrorRouter } from "./mirrorRouter";
import { questionFilesRouter } from "./questionFilesRouter";
import { sharingRouter } from "./sharingRouter";
import { studentMaterialsRouter } from "./studentMaterialsRouter";
import { subjectsRouter } from "./subjectsRouter";
import { protectedProcedure, publicProcedure, router } from "./trpc";
import { systemRouter } from "./systemRouter";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(async () => {
      await signOut({ redirect: false });
      return { success: true } as const;
    }),
    // PR18 — real profile fields (السنة الدراسية/التخصص) + real plan status
    // for /account. Separate from `me` (the session object) since these
    // live only in the DB row, never in the JWT/session.
    profile: protectedProcedure.query(async ({ ctx }) => {
      return getUserProfileForAccount(ctx.user.id);
    }),
    updateProfile: protectedProcedure
      .input(
        z.object({
          academicYear: z.string().max(120).nullable().optional(),
          specialty: z.string().max(120).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await updateUserProfile(ctx.user.id, input);
        return { success: true } as const;
      }),
    // "حذف حسابي" (/account) — permanent: the account, every file and all
    // study data (lib/db-account.ts; promised in app/privacy/page.tsx).
    // Always the session's own account; the student re-types their email
    // — or, for a phone sign-up account (no email), their phone number —
    // so it can't happen by accident. `confirmEmail` is the older name.
    deleteAccount: protectedProcedure
      .input(
        z.object({
          confirm: z.string().trim().max(320).optional(),
          confirmEmail: z.string().trim().max(320).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const typed = (input.confirm ?? input.confirmEmail ?? "").trim();
        const profile = await getUserProfileForAccount(ctx.user.id);
        const email = profile?.email ?? ctx.user.email ?? "";
        const phone = profile?.phone ?? null;
        const typedPhone = parsePhone(typed);
        // The confirmation dialog asks for the word «حذف»; the account's
        // own email / phone is still accepted (older app builds send it).
        const matches =
          typed === "حذف" ||
          (!!email && typed.toLowerCase() === email.toLowerCase()) ||
          (!!phone && typedPhone.ok && typedPhone.e164 === phone);
        if (!typed || !matches) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "للتأكيد اكتب كلمة «حذف».",
          });
        }
        // A doctor's published question sets would be deleted with the
        // account, and with them every student's access — archive first.
        if (await hasLiveQuestionSets(ctx.user.id)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "لديك مجموعات أسئلة منشورة لطلابك. أرشفها أولًا من لوحة الدكتور ثم احذف الحساب.",
          });
        }
        await deleteAccountCompletely(ctx.user.id);
        return { success: true } as const;
      }),
  }),
  // 💳 Plans, subscriptions & usage (lib/billing) — student side and admin.
  billing: billingRouter,
  adminBilling: adminBillingRouter,
  decks: decksRouter,
  books: booksRouter,
  examFocus: examFocusRouter,
  // 📤 Study Pack sharing (requests, access, notifications) — see
  // lib/db-sharing.ts; read authorization lives in lib/book-access.ts.
  sharing: sharingRouter,
  brainGames: brainGamesRouter,
  bookPageMarks: bookPageMarksRouter,
  mirror: mirrorRouter,
  subjects: subjectsRouter,
  questionFiles: questionFilesRouter,
  annotations: annotationsRouter,
  cardMarks: cardMarksRouter,
  chat: chatRouter,
  // مكتبة الأدمن — kept as two separate top-level namespaces (not nested
  // under one "admin" router) so the admin-only surface (adminMaterials) and
  // the student-facing surface (materials) stay obviously distinct at every
  // call site, matching adminProcedure vs protectedProcedure below them.
  adminMaterials: adminMaterialsRouter,
  materials: studentMaterialsRouter,
  // Admin-only Jobs monitoring (Phase 0) — gated by adminProcedure inside
  // adminJobsRouter itself, same pattern as adminMaterials above.
  adminJobs: adminJobsRouter,
  // Admin dashboard's user management (users list/detail/plan/suspend/
  // delete + platform-wide stats) — same adminProcedure gating pattern.
  adminUsers: adminUsersRouter,
  // 🔒 Protected Doctor Question Sets (behind DOCTOR_SETS_ENABLED): the
  // doctor's side, the student's side, and admin moderation. Read
  // authorization lives in lib/question-set-access.ts.
  doctor: doctorRouter,
  questionSets: questionSetsRouter,
  adminDoctors: adminDoctorsRouter,
  adminQuestionSets: adminQuestionSetsRouter,
});

export type AppRouter = typeof appRouter;
