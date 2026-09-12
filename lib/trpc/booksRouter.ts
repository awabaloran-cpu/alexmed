import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  deleteBook,
  getBookCoverageDetail,
  getBookCoverageReport,
  getBookForUser,
  getBookMindMapForUser,
  getBookPageOwnedByUser,
  getBookStatsForUser,
  getChapterContentForUser,
  getChapterForUser,
  getChapterMcqsForValidation,
  getDueCardsForUser,
  getUpcomingReviewForecastForUser,
  getWeakPointsForUser,
  listBooksForUser,
  listBookPagesForUser,
  listMcqsForUser,
  rateBookCard,
  resetBookChapterForRetry,
  resetBookExtractionForRetry,
  resetBookPageTextForRetry,
  resetBookPageVisualForRetry,
  saveMcqValidationResults,
  insertBookMcqs,
  submitMcqAttemptForUser,
} from "../db-books";
import { assignBookToSubject } from "../db-subjects";
import {
  generateAndSaveMindMapSections,
  generateAndSaveVisualInsights,
} from "../book-enrichment";
import {
  buildGapQuestionsMessages,
  buildMcqValidationMessages,
  findDuplicateMcqIds,
  findUncoveredPages,
  gapQuestionsResponseSchema,
  mcqValidationResponseSchema,
  parseGapQuestions,
  parseMcqValidation,
} from "../book-analysis";
import { invokeLLM } from "../llm";
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

  getMindMap: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getBookMindMapForUser(ctx.user.id, input.id);
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

  // PR2: move a book into a subject, or out of one (subjectId: null) — both
  // sides' ownership are re-checked inside assignBookToSubject.
  setSubject: protectedProcedure
    .input(z.object({ bookId: z.string(), subjectId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await assignBookToSubject(
        ctx.user.id,
        input.bookId,
        input.subjectId
      );
      if (!ok) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Book or subject not found",
        });
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
        rating: z.enum(["again", "hard", "good", "easy"]),
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

  // نقاط الضعف (PR6) — questions whose most recent attempt was wrong,
  // grouped by chapter so the student sees where to focus, not just a flat
  // list. See lib/db-books.ts's computeWeakPoints for the exact definition.
  listWeakPoints: protectedProcedure.query(async ({ ctx }) => {
    return getWeakPointsForUser(ctx.user.id);
  }),

  // خطة الدراسة (PR7) — 7-day forecast of bookCards' real FSRS-computed
  // dueAt values.
  upcomingForecast: protectedProcedure.query(async ({ ctx }) => {
    return getUpcomingReviewForecastForUser(ctx.user.id);
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
        {
          flowControl: { key: `books-extract-${input.bookId}`, parallelism: 1 },
        }
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

  // Audit Phase 3 — the real page-numbered Document Coverage Engine, distinct
  // from getCoverageReport above (which only returns aggregate counts): this
  // names the exact missing/failed page numbers so a caller never has to
  // trust an aggregate count (or the LLM) as proof of completeness.
  getCoverageDetail: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .query(async ({ ctx, input }) => {
      const owned = await getBookForUser(ctx.user.id, input.bookId);
      if (!owned) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
      }
      return getBookCoverageDetail(input.bookId);
    }),

  // Audit Phase 6 — generates (and caches) this chapter's hierarchical mind
  // map sections on first request (or returns whatever the automatic
  // QStash trigger already generated — see app/api/books/analyze-chapter/
  // route.ts and app/api/books/generate-mindmap-sections/route.ts). The
  // actual generation is shared with that automatic path via
  // lib/book-enrichment.ts; this procedure's own job is just the ownership/
  // status checks a worker route doesn't need.
  generateMindMapSections: protectedProcedure
    .input(z.object({ chapterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const chapter = await getChapterForUser(ctx.user.id, input.chapterId);
      if (!chapter) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chapter not found",
        });
      }
      if (chapter.status !== "complete") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Chapter analysis must complete first",
        });
      }
      return generateAndSaveMindMapSections(chapter.id);
    }),

  // Audit Phase 7 — connects this chapter's explanation to its real visual
  // assets (images/diagrams/tables). Lazy + idempotent; only meaningful
  // once BOTH chapter analysis AND page-visual analysis have produced
  // something, which finish on independent schedules — so this stays a
  // student-triggered action here rather than an automatic one (unlike
  // generateMindMapSections above, which only needs the chapter itself).
  // Generation logic shared via lib/book-enrichment.ts.
  generateVisualInsights: protectedProcedure
    .input(z.object({ chapterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const chapter = await getChapterForUser(ctx.user.id, input.chapterId);
      if (!chapter) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chapter not found",
        });
      }
      if (chapter.status !== "complete") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Chapter analysis must complete first",
        });
      }
      const visualInsightsAr = await generateAndSaveVisualInsights(chapter.id);
      return { visualInsightsAr: visualInsightsAr ?? "" };
    }),

  // Audit Phase 5 — Question Validation Agent. Lazy + idempotent, same
  // pattern as generateMindMapSections above: skips straight to using the
  // cached statuses once every MCQ in the chapter has already been checked,
  // so re-opening a quiz never re-runs (or re-pays for) validation.
  // Duplicates are caught deterministically first (findDuplicateMcqIds, no
  // LLM needed); only the remaining, non-duplicate MCQs go through the LLM
  // correctness/grounding check against this chapter's own explanation.
  //
  // Coverage-based gap-filling (audit Phase 5's "generate additional
  // questions for uncovered sections") then runs on every call, using the
  // FINAL statuses above: a page whose only MCQ just got flagged is a gap
  // again just as much as a page that never had one. New questions are
  // generated only from this chapter's own already-stored page text (never
  // invented), and only for the exact pages still missing coverage.
  validateChapterMcqs: protectedProcedure
    .input(z.object({ chapterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const chapter = await getChapterForUser(ctx.user.id, input.chapterId);
      if (!chapter) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chapter not found",
        });
      }
      if (chapter.status !== "complete") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Chapter analysis must complete first",
        });
      }

      let mcqs = await getChapterMcqsForValidation(chapter.id);
      const alreadyValidated = mcqs.every(
        mcq => mcq.validationStatus !== "pending"
      );

      if (!alreadyValidated) {
        // Only the still-pending ones — duplicates are checked across the
        // WHOLE chapter (a fresh gap-filled question can duplicate an
        // already-valid older one), but an already-valid/flagged MCQ is
        // never re-sent to the LLM just because some other MCQ in the same
        // chapter is still pending.
        const duplicateIds = new Set(findDuplicateMcqIds(mcqs));
        const toValidate = mcqs.filter(
          mcq => !duplicateIds.has(mcq.id) && mcq.validationStatus === "pending"
        );

        const results: {
          id: string;
          status: "valid" | "flagged";
          note: string | null;
        }[] = Array.from(duplicateIds, id => ({
          id,
          status: "flagged" as const,
          note: "سؤال مكرر داخل هذا الفصل.",
        }));

        if (toValidate.length) {
          const response = await invokeLLM({
            max_tokens: 2000,
            messages: buildMcqValidationMessages(
              chapter.explanationEn ?? "",
              toValidate
            ),
            response_format: mcqValidationResponseSchema,
          });
          const validation = parseMcqValidation(
            response.choices[0]?.message.content
          );
          const validationById = new Map(validation.map(v => [v.id, v]));
          for (const mcq of toValidate) {
            const result = validationById.get(mcq.id);
            results.push({
              id: mcq.id,
              status: result?.valid ? "valid" : "flagged",
              note: result?.valid ? null : (result?.note ?? "لم يجتز التحقق."),
            });
          }
        }

        await saveMcqValidationResults(results);
        const resultById = new Map(results.map(r => [r.id, r]));
        mcqs = mcqs.map(mcq => {
          const result = resultById.get(mcq.id);
          return result ? { ...mcq, validationStatus: result.status } : mcq;
        });
      }

      const coveredPages = mcqs
        .filter(mcq => mcq.validationStatus !== "flagged")
        .map(mcq => mcq.sourcePage);
      const uncoveredPages = findUncoveredPages(
        chapter.startPage,
        chapter.endPage,
        coveredPages
      );
      let generatedCount = 0;
      if (uncoveredPages.length && chapter.pageTexts?.length) {
        const gapPages = chapter.pageTexts.filter(page =>
          uncoveredPages.includes(page.page)
        );
        if (gapPages.length) {
          const response = await invokeLLM({
            max_tokens: 2000,
            messages: buildGapQuestionsMessages(chapter.title, gapPages),
            response_format: gapQuestionsResponseSchema,
          });
          const generated = parseGapQuestions(
            response.choices[0]?.message.content,
            uncoveredPages
          );
          if (generated.length) {
            await insertBookMcqs(chapter.id, generated);
            generatedCount = generated.length;
          }
        }
      }

      return {
        total: mcqs.length + generatedCount,
        valid: mcqs.filter(mcq => mcq.validationStatus === "valid").length,
        flagged: mcqs.filter(mcq => mcq.validationStatus === "flagged").length,
        generated: generatedCount,
      };
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
