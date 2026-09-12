import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getQuestionFileForUser,
  listQuestionFilesForUser,
  retryQuestionFileExtraction,
} from "../db-question-files";
import { publishMessage } from "../queue/client";
import { protectedProcedure, router } from "./trpc";

// PR16 — separate from booksRouter since question files are a distinct
// concept from study books in the UI (their own "ملفات الأسئلة" section),
// even though both live in the same books table (sourceType distinguishes
// them) and share the ownership-checked getDb() conventions.
export const questionFilesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return listQuestionFilesForUser(ctx.user.id);
  }),

  get: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getQuestionFileForUser(ctx.user.id, input.bookId);
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Question file not found",
        });
      }
      return result;
    }),

  retryExtraction: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await retryQuestionFileExtraction(ctx.user.id, input.bookId);
      if (!ok) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Question file not found",
        });
      }
      await publishMessage({
        type: "extract_question_file_job",
        bookId: input.bookId,
      });
      return { success: true } as const;
    }),
});
