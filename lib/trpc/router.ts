import { signOut } from "../auth";
import { adminJobsRouter } from "./adminJobsRouter";
import { adminMaterialsRouter } from "./adminMaterialsRouter";
import { annotationsRouter } from "./annotationsRouter";
import { booksRouter } from "./booksRouter";
import { chatRouter } from "./chatRouter";
import { decksRouter } from "./decksRouter";
import { mirrorRouter } from "./mirrorRouter";
import { studentMaterialsRouter } from "./studentMaterialsRouter";
import { subjectsRouter } from "./subjectsRouter";
import { publicProcedure, router } from "./trpc";
import { systemRouter } from "./systemRouter";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(async () => {
      await signOut({ redirect: false });
      return { success: true } as const;
    }),
  }),
  decks: decksRouter,
  books: booksRouter,
  mirror: mirrorRouter,
  subjects: subjectsRouter,
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
});

export type AppRouter = typeof appRouter;
