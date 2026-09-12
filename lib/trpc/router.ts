import { z } from "zod";
import { signOut } from "../auth";
import { getUserProfileForAccount, updateUserProfile } from "../db";
import { adminJobsRouter } from "./adminJobsRouter";
import { adminMaterialsRouter } from "./adminMaterialsRouter";
import { adminUsersRouter } from "./adminUsersRouter";
import { annotationsRouter } from "./annotationsRouter";
import { booksRouter } from "./booksRouter";
import { chatRouter } from "./chatRouter";
import { decksRouter } from "./decksRouter";
import { mirrorRouter } from "./mirrorRouter";
import { questionFilesRouter } from "./questionFilesRouter";
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
  }),
  decks: decksRouter,
  books: booksRouter,
  mirror: mirrorRouter,
  subjects: subjectsRouter,
  questionFiles: questionFilesRouter,
  annotations: annotationsRouter,
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
