import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  listQuestionAttempts,
  saveQuestionAttempt,
} from "../db-question-attempts";
import {
  getQuestionFileForViewer,
  isOwnStudyBook,
  listQuestionFilesForUser,
  listSharedQuestionFiles,
  retryQuestionFileExtraction,
} from "../db-question-files";
import { publishMessage } from "../queue/client";
import { getQuestionFileAccess } from "../question-file-access";
import { prepareQuestionsFrom } from "../question-file-progress";
import { protectedProcedure, router } from "./trpc";

// PR16 — separate from booksRouter since question files are a distinct
// concept from study books in the UI (their own "ملفات الأسئلة" section),
// even though both live in the same books table (sourceType distinguishes
// them) and share the ownership-checked getDb() conventions.
// What questionFiles.get answers for a file that became a study book.
export const CONVERTED_TO_BOOK = "converted_to_book";

export const questionFilesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return listQuestionFilesForUser(ctx.user.id);
  }),

  // Question files classmates shared with this student by link
  // (lib/share-links.ts).
  sharedWithMe: protectedProcedure.query(({ ctx }) =>
    listSharedQuestionFiles(ctx.user.id)
  ),

  get: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .query(async ({ ctx, input }) => {
      // The owner, or a classmate the file was shared with.
      const result = await getQuestionFileForViewer(ctx.user.id, input.bookId);
      if (!result) {
        // 📚 The file was a study book and is now one (same id): the page
        // goes to it instead of saying "not found".
        throw new TRPCError({
          code: "NOT_FOUND",
          message: (await isOwnStudyBook(ctx.user.id, input.bookId))
            ? CONVERTED_TO_BOOK
            : "Question file not found",
        });
      }
      return result;
    }),

  // The student's saved answers for one of their own files (questionId →
  // chosen option), so the viewer resumes where they stopped.
  attempts: protectedProcedure
    .input(z.object({ bookId: z.string().uuid() }))
    .query(({ ctx, input }) => listQuestionAttempts(ctx.user.id, input.bookId)),

  // Saves one answer; correctness is decided on the server.
  saveAttempt: protectedProcedure
    .input(
      z.object({
        bookId: z.string().uuid(),
        questionId: z.string().uuid(),
        selectedIndex: z.number().int().min(0).max(25),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const saved = await saveQuestionAttempt(ctx.user.id, input);
      if (!saved) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Question not found",
        });
      }
      // The questions just ahead are prepared while the student reads this
      // one. Never part of saving the answer: not awaited, never thrown.
      void prepareQuestionsFrom(input.bookId, input.questionId).catch(error =>
        console.error("[QuestionFiles] Could not prepare ahead", error)
      );
      return saved;
    }),

  // The page says which question the student is at (moving through the
  // questions saves nothing by itself), so the ones ahead are prepared
  // before they get there. `preparing` tells the page to watch for them.
  reached: protectedProcedure
    .input(
      z.object({ bookId: z.string().uuid(), questionId: z.string().uuid() })
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await getQuestionFileAccess(ctx.user.id, input.bookId))) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Question file not found",
        });
      }
      try {
        return {
          preparing: await prepareQuestionsFrom(input.bookId, input.questionId),
        };
      } catch (error) {
        console.error("[QuestionFiles] Could not prepare ahead", error);
        return { preparing: false };
      }
    }),

  retryExtraction: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await retryQuestionFileExtraction(ctx.user.id, input.bookId);
      if (!ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "إعادة المحاولة متاحة فقط لملف فشلت قراءته.",
        });
      }
      await publishMessage({
        type: "extract_question_file_job",
        bookId: input.bookId,
      });
      return { success: true } as const;
    }),
});
