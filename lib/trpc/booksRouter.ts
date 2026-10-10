import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  deleteBook,
  getBookCoverageDetail,
  getBookCoverageReport,
  getBookCardForUser,
  getBookForUser,
  getBookMindMapForUser,
  getBookStudyContentForUser,
  getBookPageOwnedByUser,
  getBookStatsForUser,
  getChapterContentForUser,
  getChapterForUser,
  getDueCardsForUser,
  getUpcomingReviewForecastForUser,
  getWeakPointsForUser,
  listBooksForUser,
  listBookPagesForUser,
  listMcqsForUser,
  listStalledBookChaptersForUser,
  rateBookCard,
  rateSharedBookCard,
  recordMcqAttempt,
  resetBookChapterForRetry,
  resetBookExtractionForRetry,
  resetBookPageTextForRetry,
  resetBookPageVisualForRetry,
} from "../db-books";
import {
  getBookAccess,
  getBookCardAccess,
  getChapterAccess,
  getMcqAccess,
  personalizeCards,
  shareSafeBook,
  type BookAccess,
} from "../book-access";
import { assignBookToSubject } from "../db-subjects";
import {
  enqueueChapterGeneration,
  listGenerationJobsForBook,
} from "../generation-jobs";
import { bookHasPublishedQuestionSet } from "../db-question-sets";
import {
  buildExplainCardMessages,
  explainCardResponseSchema,
  parseExplainCard,
} from "../book-analysis";
import { toTrpcError } from "../billing/http";
import { consumeUsage, releaseUsage } from "../billing/usage";
import {
  acquireInteractiveSlot,
  INTERACTIVE_LIMIT_MESSAGE_AR,
} from "../ai/interactive-limit";
import { invokeLLM } from "../llm";
import {
  getBookOutputSources,
  getKnowledgeCoverageMatrix,
} from "../db-knowledge";
import { staleBookChapterProcessingCutoff } from "../queue/claim";
import { publishMessage } from "../queue/client";
import { protectedProcedure, router } from "./trpc";

// ── 📤 Study Pack access (lib/book-access.ts) ───────────────────────────
// Reads: owner OR accepted share, then the existing owner-scoped reader
// runs with access.ownerId — the same single copy of every artifact.
// AI generation / reprocessing: owner only; a recipient gets a clear
// FORBIDDEN instead of a (cost-incurring) run on someone else's file.
const OWNER_ONLY_MESSAGE = "التوليد متاح لصاحب الملف فقط.";

async function requireBookAccess(userId: string, bookId: string) {
  const access = await getBookAccess(userId, bookId);
  if (!access) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
  }
  return access;
}

function accessInfo(access: BookAccess) {
  return {
    role: access.role,
    ownerName: access.ownerName,
    ownerUsername: access.ownerUsername,
  };
}

// Owner-only book actions: a recipient learns why it's refused, anyone
// else just gets "not found" (no existence leak).
async function throwOwnerOnlyOrNotFound(
  userId: string,
  lookup: { bookId: string } | { chapterId: string },
  notFoundMessage: string
): Promise<never> {
  const access =
    "bookId" in lookup
      ? await getBookAccess(userId, lookup.bookId)
      : await getChapterAccess(userId, lookup.chapterId);
  if (access?.role === "shared") {
    throw new TRPCError({ code: "FORBIDDEN", message: OWNER_ONLY_MESSAGE });
  }
  throw new TRPCError({ code: "NOT_FOUND", message: notFoundMessage });
}

async function requireOwnedChapter(userId: string, chapterId: string) {
  const chapter = await getChapterForUser(userId, chapterId);
  if (!chapter) {
    return throwOwnerOnlyOrNotFound(userId, { chapterId }, "Chapter not found");
  }
  return chapter;
}

// Generation needs an analysed chapter the caller owns.
async function requireCompleteOwnedChapter(userId: string, chapterId: string) {
  const chapter = await requireOwnedChapter(userId, chapterId);
  if (chapter.status !== "complete") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Chapter analysis must complete first",
    });
  }
  return chapter;
}

async function requireOwnedBook(userId: string, bookId: string) {
  const result = await getBookForUser(userId, bookId);
  if (!result) {
    return throwOwnerOnlyOrNotFound(userId, { bookId }, "Book not found");
  }
  return result;
}

export const booksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return listBooksForUser(ctx.user.id);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const access = await requireBookAccess(ctx.user.id, input.id);
      const result = await getBookForUser(access.ownerId, input.id);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
      }
      return {
        ...result,
        book: shareSafeBook(result.book, access),
        access: accessInfo(access),
      };
    }),

  // Student's explicit "ابدأ التوليد" choice from the study-tools dashboard
  // (app/books/[bookId]/page.tsx) — nothing analyzes a chapter until this is
  // called (see app/api/books/extract/route.ts, which used to auto-enqueue
  // this and no longer does). Idempotent: only chapters still "pending" get
  // (re-)published, so a second click (or two cards clicked back to back)
  // never double-queues an already-started/complete chapter.
  startChapterAnalysis: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await requireOwnedBook(ctx.user.id, input.bookId);
      const pending = result.chapters.filter(
        chapter => chapter.status === "pending"
      );
      if (!pending.length) {
        return { started: false } as const;
      }
      await Promise.all(
        pending.map(chapter =>
          publishMessage({
            type: "analyze_book_chapter",
            chapterId: chapter.id,
            bookId: input.bookId,
          })
        )
      );
      return { started: true } as const;
    }),

  // Self-healing for a started analysis whose chapters stopped moving (a
  // lost queue message, or a worker killed by a redeploy mid-run) — the
  // book page calls this periodically while chapters are unfinished.
  // Re-publishes only genuinely stalled chapters (see
  // listStalledBookChaptersForUser); a duplicate delivery is harmless since
  // claimBookChapter is atomic.
  resumeChapterAnalysis: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const stalled = await listStalledBookChaptersForUser(
        ctx.user.id,
        input.bookId,
        staleBookChapterProcessingCutoff()
      );
      await Promise.all(
        stalled.map(chapter =>
          publishMessage({
            type: "analyze_book_chapter",
            chapterId: chapter.id,
            bookId: input.bookId,
          })
        )
      );
      return { resumed: stalled.length };
    }),

  // The whole file's study content (every chapter's cards/MCQs/summaries)
  // plus the book-level processing manifest — backs /books/[id]/study, so
  // the book page's بطاقات/اختبار/ملخص open the ENTIRE document instead of
  // only its first chapter.
  getStudyContent: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .query(async ({ ctx, input }) => {
      const access = await requireBookAccess(ctx.user.id, input.bookId);
      const result = await getBookStudyContentForUser(
        access.ownerId,
        input.bookId
      );
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
      }
      return {
        ...result,
        cards: await personalizeCards(result.cards, access, ctx.user.id),
        access: accessInfo(access),
      };
    }),

  // 🧠 Coverage Matrix: every Knowledge Item (Exam Focus fact) → the
  // flashcards and questions derived from it → source pages, plus how many
  // V1 (page-text) cards/questions each chapter still has, so the study
  // page can offer to rebuild them from the knowledge base.
  getKnowledgeCoverage: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireBookAccess(ctx.user.id, input.bookId);
      const [matrix, chapters] = await Promise.all([
        getKnowledgeCoverageMatrix(input.bookId),
        getBookOutputSources(input.bookId),
      ]);
      return { ...matrix, chapters };
    }),

  getMindMap: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const access = await requireBookAccess(ctx.user.id, input.id);
      const result = await getBookMindMapForUser(access.ownerId, input.id);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
      }
      return { ...result, access: accessInfo(access) };
    }),

  getChapter: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const access = await getChapterAccess(ctx.user.id, input.id);
      const result = access
        ? await getChapterContentForUser(access.ownerId, input.id)
        : null;
      if (!access || !result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chapter not found",
        });
      }
      return {
        ...result,
        cards: await personalizeCards(result.cards, access, ctx.user.id),
        access: accessInfo(access),
      };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // A question file backing a published protected set holds its
      // students' questions — it's archived from /doctor, never deleted.
      if (await bookHasPublishedQuestionSet(input.id)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "هذا الملف مرتبط بمجموعة أسئلة منشورة لطلاب، ولا يمكن حذفه.",
        });
      }
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
      const access = await getBookCardAccess(ctx.user.id, input.cardId);
      if (!access) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
      }
      // A recipient's review goes to their own progress row — the owner's
      // schedule on the card itself is never touched.
      const result =
        access.role === "owner"
          ? await rateBookCard(ctx.user.id, input.cardId, input.rating)
          : await rateSharedBookCard(ctx.user.id, input.cardId, input.rating);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
      }
      return result;
    }),

  // "اشرحها ببساطة" (see lib/book-analysis.ts's buildExplainCardMessages
  // header comment) — deliberately un-cached/un-persisted: a student can ask
  // again for a different phrasing, and there's no automatic caller (unlike
  // generateMindMapSections/generateVisualInsights above) that would need an
  // idempotent, saved result.
  explainCard: protectedProcedure
    .input(z.object({ cardId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const access = await getBookCardAccess(ctx.user.id, input.cardId);
      const card = access
        ? await getBookCardForUser(access.ownerId, input.cardId)
        : null;
      if (!card) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
      }
      // Short and answered live, so it stays a direct call — behind the
      // same cross-replica load guard as the assistant
      // (lib/ai/interactive-limit.ts), taken before the quota.
      const slot = await acquireInteractiveSlot(ctx.user.id, "explain_card");
      if (!slot.ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: INTERACTIVE_LIMIT_MESSAGE_AR[slot.reason],
        });
      }
      let response;
      try {
        // 💳 An AI answer on demand, like the assistant — same quota
        // (lib/trpc/chatRouter.ts's ask), handed back if the call fails.
        let receipt;
        try {
          receipt = await consumeUsage(ctx.user.id, "ASSISTANT_MESSAGE");
        } catch (error) {
          toTrpcError(error);
        }
        try {
          response = await invokeLLM({
            max_tokens: 400,
            messages: buildExplainCardMessages(card.questionEn, card.answerEn),
            response_format: explainCardResponseSchema,
          });
        } catch (error) {
          await releaseUsage(receipt);
          throw error;
        }
      } finally {
        await slot.release();
      }
      const explanationAr = parseExplainCard(
        response.choices[0]?.message.content
      );
      return { explanationAr };
    }),

  listMcqs: protectedProcedure.query(async ({ ctx }) => {
    return listMcqsForUser(ctx.user.id);
  }),

  submitMcqAttempt: protectedProcedure
    .input(z.object({ mcqId: z.string(), selectedIndex: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      // Owner or accepted recipient; the attempt is always the caller's own.
      const access = await getMcqAccess(ctx.user.id, input.mcqId);
      const result = access
        ? await recordMcqAttempt(ctx.user.id, input.mcqId, input.selectedIndex)
        : null;
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
  // `tzOffsetMinutes` is optional: without it the days are UTC's, as before.
  upcomingForecast: protectedProcedure
    .input(
      z
        .object({ tzOffsetMinutes: z.number().int().min(-840).max(840) })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return getUpcomingReviewForecastForUser(
        ctx.user.id,
        7,
        input?.tzOffsetMinutes
      );
    }),

  // Student-initiated retry for a chapter that exhausted its automatic
  // QStash retry budget — resets it to "pending" with a fresh attempt count
  // and publishes a new message, same as the very first attempt.
  retryChapter: protectedProcedure
    .input(z.object({ chapterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const chapter = await requireOwnedChapter(ctx.user.id, input.chapterId);
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
      const result = await requireOwnedBook(ctx.user.id, input.bookId);
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
      const access = await requireBookAccess(ctx.user.id, input.bookId);
      return listBookPagesForUser(access.ownerId, input.bookId);
    }),

  getCoverageReport: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Access check first — getBookCoverageReport itself has no per-user
      // filter (it's a plain aggregate over one bookId), so the caller must
      // prove owner-or-accepted-share access before we run it.
      await requireBookAccess(ctx.user.id, input.bookId);
      return getBookCoverageReport(input.bookId);
    }),

  // Audit Phase 3 — the real page-numbered Document Coverage Engine, distinct
  // from getCoverageReport above (which only returns aggregate counts): this
  // names the exact missing/failed page numbers so a caller never has to
  // trust an aggregate count (or the LLM) as proof of completeness.
  getCoverageDetail: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireBookAccess(ctx.user.id, input.bookId);
      return getBookCoverageDetail(input.bookId);
    }),

  // Audit Phase 6 — this chapter's hierarchical mind map. Generated in the
  // background (lib/generation-jobs.ts): this procedure only checks
  // ownership/status and queues the job (or returns the one already
  // queued/running, or the automatic one analyze-chapter queued); the page
  // polls generationJobs and refetches the map when it completes.
  generateMindMapSections: protectedProcedure
    .input(z.object({ chapterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const chapter = await requireCompleteOwnedChapter(
        ctx.user.id,
        input.chapterId
      );
      return enqueueChapterGeneration({
        chapterId: chapter.id,
        bookId: chapter.bookId,
        userId: ctx.user.id,
        kind: "mindmap",
      });
    }),

  // Audit Phase 7 — connects this chapter's explanation to its real visual
  // assets (images/diagrams/tables). Only meaningful once BOTH chapter
  // analysis AND page-visual analysis have produced something, which
  // finish on independent schedules — so this stays a student-triggered
  // action. Runs as a background job like the rest.
  generateVisualInsights: protectedProcedure
    .input(z.object({ chapterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const chapter = await requireCompleteOwnedChapter(
        ctx.user.id,
        input.chapterId
      );
      return enqueueChapterGeneration({
        chapterId: chapter.id,
        bookId: chapter.bookId,
        userId: ctx.user.id,
        kind: "visual_insights",
      });
    }),

  // البطاقات والاختبار صاروا اختياريين — لا يتولّدون تلقائيًا مع تحليل
  // الفصل، بس عند طلب الطالب، كمهمة في الخلفية.
  // `rebuild`: replace this chapter's V1 (page-text) cards with cards
  // derived from the book's Knowledge Items — explicit student action only.
  generateChapterFlashcards: protectedProcedure
    .input(z.object({ chapterId: z.string(), rebuild: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const chapter = await requireCompleteOwnedChapter(
        ctx.user.id,
        input.chapterId
      );
      return enqueueChapterGeneration({
        chapterId: chapter.id,
        bookId: chapter.bookId,
        userId: ctx.user.id,
        kind: "flashcards",
        rebuild: input.rebuild,
      });
    }),

  generateChapterMcqs: protectedProcedure
    .input(z.object({ chapterId: z.string(), rebuild: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const chapter = await requireCompleteOwnedChapter(
        ctx.user.id,
        input.chapterId
      );
      return enqueueChapterGeneration({
        chapterId: chapter.id,
        bookId: chapter.bookId,
        userId: ctx.user.id,
        kind: "mcqs",
        rebuild: input.rebuild,
      });
    }),

  generateMedicalNotePages: protectedProcedure
    .input(z.object({ chapterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const chapter = await requireCompleteOwnedChapter(
        ctx.user.id,
        input.chapterId
      );
      return enqueueChapterGeneration({
        chapterId: chapter.id,
        bookId: chapter.bookId,
        userId: ctx.user.id,
        kind: "medical_notes",
      });
    }),

  // Audit Phase 5 — Question Validation Agent (lib/mcq-validation.ts), as a
  // background job: validates the chapter's still-pending MCQs and fills
  // coverage gaps from the chapter's own page text.
  validateChapterMcqs: protectedProcedure
    .input(z.object({ chapterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const chapter = await requireCompleteOwnedChapter(
        ctx.user.id,
        input.chapterId
      );
      return enqueueChapterGeneration({
        chapterId: chapter.id,
        bookId: chapter.bookId,
        userId: ctx.user.id,
        kind: "mcq_validation",
      });
    }),

  // What the study / mind-map pages poll while generation runs: every job
  // of this book (owner only — a shared recipient never generates).
  generationJobs: protectedProcedure
    .input(z.object({ bookId: z.string() }))
    .query(async ({ ctx, input }) => {
      return listGenerationJobsForBook(ctx.user.id, input.bookId);
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
