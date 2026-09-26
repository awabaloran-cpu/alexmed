import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { signOut } from "../auth";
import { getUserProfileForAccount, updateUserProfile } from "../db";
import { parsePhone } from "../phone";
import { deleteAccountCompletely } from "../db-account";
import { adminJobsRouter } from "./adminJobsRouter";
import { adminMaterialsRouter } from "./adminMaterialsRouter";
import { adminUsersRouter } from "./adminUsersRouter";
import { annotationsRouter } from "./annotationsRouter";
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
        const matches =
          (!!email && typed.toLowerCase() === email.toLowerCase()) ||
          (!!phone && typedPhone.ok && typedPhone.e164 === phone);
        if (!typed || !matches) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              phone && !email
                ? "رقم الهاتف غير مطابق لرقم حسابك."
                : "البريد الإلكتروني غير مطابق لبريد حسابك.",
          });
        }
        await deleteAccountCompletely(ctx.user.id);
        return { success: true } as const;
      }),
  }),
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
});

export type AppRouter = typeof appRouter;
