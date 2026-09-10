import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  deleteBook,
  getBookCoverageReport,
  getBookForUser,
  getBookPageOwnedByUser,
  getBookStatsForUser,
  getChapterContentForUser,
  getChapterForUser,
  getDueCardsForUser,
  listBooksForUser,
  listBookPagesForUser,
  listMcqsForUser,
  rateBookCard,
  resetBookChapterForRetry,
  resetBookExtractionForRetry,
  resetBookPageTextForRetry,
  resetBookPageVisualForRetry,
  submitMcqAttemptForUser,
} from "../db-books";
import { publishMessage } from "../queue/client";
import { protectedProcedure, router } from "./trpc";

export const booksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return listBooksForUser(ctx.user.id);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getBookForUser(ctx.user.id, input.id);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
      }
      return result;
    }),

  getChapter: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getChapterContentForUser(ctx.user.id, input.id);
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chapter not found",
        });
      }
      return result;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await deleteBook(ctx.user.id, input.id);
      if (!ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
      }
      return { success: true } as const;
    }),

  dueCards: protectedProcedure.query(async ({ ctx }) => {
    return getDueCardsForUser(ctx.user.id);
  }),

  rateCard: protectedProcedure
    .input(
      z.object({
        cardId: z.string(),
        rating: z.enum(["hard", "good", "easy"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await rateBookCard(
        ctx.user.id,
        input.cardId,
        input.rating
      );
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
      }
      return result;
    }),

  listMcqs: protectedProcedure.query(async ({ ctx }) => {
    return listMcqsForUser(ctx.user.id);
  }),

  submitMcqAttempt: protectedProcedure
    .input(z.object({ mcqId: z.string(), selectedIndex: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const result = await submitMcqAttemptForUser(
        ctx.user.id,
        input.mcqId,
        input.selectedIndex
      );
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "MCQ not found" });
      }
      return result;
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    return getBookStatsForUser(ctx.user.id);
  }),

  // Student-initiated retry for a chapter that exhausted its automatic
  // QStash retry budget — resets it to "pending" with a fresh attempt count
  // and publishes a new message, same as the very first attempt.
  retryChapter: protectedProcedure
    .input(z.object({ chapterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const chapter = await getChapterForUser(ctx.user.id, input.chapterId);
      if (!chapter) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chapter not found",
        });
      }
      if (chapter.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only a failed chapter can be retried",
        });
      }
      await resetBookChapterForRetry(input.chapterId);
      await publishMessage({
        type: "analyze_book_chapter",
        chapterId: input.chapterId,
        bookId: chapter.bookId,
      });
      return { success: true } as const;
    }),

  // Student-initiated retry for a book that failed outright during
  // extraction (status "failed" — only reachable when literally zero pages
  // could be parsed from the PDF, see app/api/books/extract/route.ts).
  // Resets it to "extracting" with a clean attempt budget so the SAME
  // uploaded file is re-processed — the student never re-uploads.
  retryExtraction: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await getBookForUser(ctx.user.id, input.bookId);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
      }
      if (result.book.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only a failed book can have its extraction retried",
        });
      }
      await resetBookExtractionForRetry(input.bookId);
      await publishMessage(
        { type: "extract_book_job", bookId: input.bookId },
        { flowControl: { key: `books-extract-${input.bookId}`, parallelism: 1 } }
      );
      return { success: true } as const;
    }),

  // Student-initiated retry for a single page whose TEXT extraction
  // permanently exhausted its OCR retry budget (distinct from
  // retryPageVisual below, which retries that page's independent
  // image/diagram/table analysis) — same reset-then-republish pattern as
  // retryChapter/retryPageVisual.
  retryPageText: protectedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const page = await getBookPageOwnedByUser(ctx.user.id, input.pageId);
      if (!page) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Page not found" });
      }
      if (page.textStatus !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only a page whose text extraction failed can be retried",
        });
      }
      await resetBookPageTextForRetry(input.pageId);
      await publishMessage({
        type: "retry_book_page_text",
        pageId: input.pageId,
      });
      return { success: true } as const;
    }),

  // ── Page visuals (images/diagrams/tables) ───────────────────────────────
  listPages: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .query(async ({ ctx, input }) => {
      return listBookPagesForUser(ctx.user.id, input.bookId);
    }),

  getCoverageReport: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Ownership check first — getBookCoverageReport itself has no
      // per-user filter (it's a plain aggregate over one bookId), so the
      // caller must prove ownership before we run it.
      const owned = await getBookForUser(ctx.user.id, input.bookId);
      if (!owned) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
      }
      return getBookCoverageReport(input.bookId);
    }),

  // Student/admin-initiated retry for a page whose visual analysis failed —
  // same pattern as retryChapter above.
  retryPageVisual: protectedProcedure
    .input(z.object({ pageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const page = await getBookPageOwnedByUser(ctx.user.id, input.pageId);
      if (!page) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Page not found" });
      }
      if (page.visualStatus !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only a failed page can be retried",
        });
      }
      await resetBookPageVisualForRetry(input.pageId);
      await publishMessage(
        { type: "analyze_book_page_visuals", bookId: page.bookId },
        { flowControl: { key: `books-visual-${page.bookId}`, parallelism: 1 } }
      );
      return { success: true } as const;
    }),
});
