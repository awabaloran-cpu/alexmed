// Data-access layer for كتبي (Book Study) — deliberately separate from
// lib/db.ts (which stays مِرآة/auth-only), mirroring that file's established
// pattern: getDb() singleton, ownership-scoped queries via and(eq(id,...),
// eq(userId,...)), read functions return safe empty defaults, write
// functions throw when the DB isn't configured.
import { and, asc, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { deleteObjects } from "./storage";
import {
  bookCards,
  bookChapters,
  bookMcqAttempts,
  bookMcqs,
  books,
  bookPages,
  bookReviewEvents,
  bookTerms,
  bookVisualAssets,
  type Book,
  type BookChapter,
  type BookPage,
  type BookVisualAsset,
} from "../drizzle/schema";
import { getDb } from "./db";
import { detectChapters } from "./book-chapters";
import type {
  BookChapterAnalysis,
  ChapterMindMapSection,
} from "./book-analysis";
import {
  FSRS_DEFAULT_WEIGHTS,
  scheduleFsrsReview,
  type FsrsGrade,
} from "./fsrs";

export type PageText = { page: number; text: string };
export type BookPageText = { page: number; text: string; hasText: boolean };

// Step 1 of the كتبي pipeline: a bare book row, status "extracting", with no
// chapters yet — mirrors createMirrorJobShell in lib/db-mirror.ts exactly,
// for the exact same reason (extract-and-plan must return {bookId}
// immediately regardless of file size; see app/api/books/extract/route.ts).
export async function createBookShell(
  userId: string,
  input: {
    fileName: string;
    fileKey: string;
    // Both optional — profile defaults to "general" (the schema column's
    // own default, for genuinely new books) and subjectId to unassigned.
    profile?: Book["profile"];
    subjectId?: string | null;
  }
): Promise<Book> {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const [book] = await db
    .insert(books)
    .values({
      userId,
      fileName: input.fileName,
      fileKey: input.fileKey,
      status: "extracting",
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
    })
    .returning();
  return book;
}

// No-ownership-filter lookup for the extraction queue worker — same
// trust-boundary reasoning as getChapterById below.
export async function getBookById(bookId: string): Promise<Book | null> {
  const db = getDb();
  if (!db) return null;

  const [book] = await db
    .select()
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  return book ?? null;
}

// Persists one extraction worker invocation's progress — mirrors
// updateMirrorJobExtractionProgress exactly. extractionAttemptCount counts
// worker *invocations* (diagnostic/telemetry — naturally scales with book
// size) and is unconditionally bumped every call; it is NOT the per-page
// retry budget (see ocrAttemptCounts, tracked separately by the caller and
// passed through here) — conflating the two would make a large-but-healthy
// book falsely look like it exhausted its OCR retry budget just from having
// many batches.
export async function updateBookExtractionProgress(
  bookId: string,
  update: {
    pageCount?: number;
    pageTexts: BookPageText[];
    pagesNeedingOcr: number[];
    ocrFailedPages: number[];
    ocrAttemptCounts?: Record<string, number>;
  }
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(books)
    .set({
      ...(update.pageCount !== undefined
        ? { pageCount: update.pageCount }
        : {}),
      pageTexts: update.pageTexts,
      pagesNeedingOcr: update.pagesNeedingOcr,
      ocrFailedPages: update.ocrFailedPages,
      ...(update.ocrAttemptCounts !== undefined
        ? { ocrAttemptCounts: update.ocrAttemptCounts }
        : {}),
      extractionAttemptCount: sql`${books.extractionAttemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId));
}

// Student-initiated retry for a book whose extraction hit a fatal error
// before any page could be salvaged (see markBookExtractionFailed) — resets
// it back to "extracting" with a clean attempt budget so the extract worker
// starts over, without the student re-uploading the file (same fileKey).
export async function resetBookExtractionForRetry(bookId: string) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(books)
    .set({
      status: "extracting",
      extractionError: null,
      extractionAttemptCount: 0,
      pageTexts: null,
      pagesNeedingOcr: null,
      ocrFailedPages: null,
      ocrAttemptCounts: null,
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId));
}

// Upserts one page's TEXT-extraction result — safe to call repeatedly for
// the same (bookId, pageNumber) as extraction/retries progress across
// worker invocations, relying on book_pages' existing unique index on
// (bookId, pageNumber) (see schema) rather than a new one. Only ever touches
// text-related columns: visualStatus/attemptCount/errorMessage (owned by the
// separate visual-analysis pipeline) are left untouched on conflict, and
// only defaulted on the very first insert for this page.
export async function upsertBookPageText(
  bookId: string,
  update: {
    page: number;
    text: string;
    textStatus: "complete" | "failed";
    errorMessage?: string | null;
    // Left undefined while extraction is still in progress (chapter isn't
    // known yet); passed explicitly once finalizeBookExtraction has run
    // detectChapters(). Omitting the key on conflict (rather than writing
    // null) means an earlier chapter assignment is never clobbered by a
    // later call that doesn't know it.
    chapterId?: string | null;
  }
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(bookPages)
    .values({
      bookId,
      pageNumber: update.page,
      chapterId: update.chapterId ?? null,
      extractedText: update.text,
      textStatus: update.textStatus,
      textErrorMessage: update.errorMessage ?? null,
      visualStatus: "pending",
    })
    .onConflictDoUpdate({
      target: [bookPages.bookId, bookPages.pageNumber],
      set: {
        extractedText: update.text,
        textStatus: update.textStatus,
        textErrorMessage: update.errorMessage ?? null,
        ...(update.chapterId !== undefined
          ? { chapterId: update.chapterId }
          : {}),
        updatedAt: new Date(),
      },
    });
}

export async function upsertBookPagesText(
  bookId: string,
  updates: {
    page: number;
    text: string;
    textStatus: "complete" | "failed";
    errorMessage?: string | null;
    chapterId?: string | null;
  }[]
) {
  for (const update of updates) {
    await upsertBookPageText(bookId, update);
  }
}

// Student-initiated retry for a single page whose text extraction
// permanently failed (retry budget exhausted during extraction) — resets it
// to "pending" so the dedicated retry worker
// (app/api/books/retry-page-text/route.ts) picks it up. Does not touch
// visualStatus or the book's own status; finalizeBookIfDone re-derives the
// book's status once the retry resolves.
export async function resetBookPageTextForRetry(pageId: string) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookPages)
    .set({
      textStatus: "pending",
      textErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(bookPages.id, pageId));
}

// Terminal extraction failure — mirrors markMirrorJobExtractionFailed.
export async function markBookExtractionFailed(
  bookId: string,
  errorMessage: string
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(books)
    .set({
      status: "failed",
      extractionError: errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId));
}

export type FinalizedPageText = {
  page: number;
  text: string;
  // Whether this page's text is trustworthy content vs. a permanent OCR
  // failure the extract worker gave up on (see app/api/books/extract). A
  // "failed" page still gets a real book_pages row (readable, just empty)
  // and is individually retryable afterward — it never blocks the rest of
  // the book from finalizing.
  textStatus: "complete" | "failed";
  errorMessage?: string | null;
};

// Step 2: runs detectChapters() against the now-fully-extracted (or
// partially-extracted — see textStatus above) text and creates the chapter
// rows against the EXISTING book row from createBookShell — mirrors
// finalizeMirrorJobExtraction. Leaves the book in "pending", which
// finalizeBookIfDone already understands.
export async function finalizeBookExtraction(
  bookId: string,
  pages: FinalizedPageText[]
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const pageTexts: PageText[] = pages.map(({ page, text }) => ({
    page,
    text,
  }));
  const {
    chapters: boundaries,
    method,
    confidence,
  } = detectChapters(pageTexts);
  const pagesByChapter = boundaries.map(chapter =>
    pages.filter(
      page => page.page >= chapter.startPage && page.page <= chapter.endPage
    )
  );

  let chapters: {
    id: string;
    orderIndex: number;
    title: string;
    startPage: number;
    endPage: number;
  }[] = [];
  if (boundaries.length) {
    const inserted = await db
      .insert(bookChapters)
      .values(
        boundaries.map((chapter, index) => ({
          bookId,
          orderIndex: index,
          title: chapter.title,
          startPage: chapter.startPage,
          endPage: chapter.endPage,
          pageTexts: (pagesByChapter[index] ?? []).map(page => ({
            page: page.page,
            text: page.text,
          })),
        }))
      )
      .returning({
        id: bookChapters.id,
        orderIndex: bookChapters.orderIndex,
        title: bookChapters.title,
        startPage: bookChapters.startPage,
        endPage: bookChapters.endPage,
      });
    // A multi-row INSERT...RETURNING isn't guaranteed to preserve input
    // order, so sort explicitly by the stored orderIndex rather than relying
    // on it — the client drives its analyze-loop by this order.
    chapters = inserted.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  // Backfill (or, for a book whose extract worker never got a chance to
  // upsert incrementally — e.g. a legacy/edge path — create outright) each
  // page's book_pages row now that its chapterId is known. Upsert-based
  // (see upsertBookPageText) rather than a bulk INSERT, since pages with
  // real text/embedded content were typically already written incrementally
  // during extraction (see app/api/books/extract/route.ts) — this call is
  // what attaches the now-known chapterId and the FINAL textStatus
  // (including any page that permanently failed OCR) without duplicating
  // rows, relying on book_pages' existing (bookId, pageNumber) unique index.
  if (pages.length) {
    const chapterIdByPage = new Map<number, string>();
    boundaries.forEach((chapter, index) => {
      const chapterId = chapters[index]?.id;
      if (!chapterId) return;
      for (let p = chapter.startPage; p <= chapter.endPage; p++) {
        chapterIdByPage.set(p, chapterId);
      }
    });

    await upsertBookPagesText(
      bookId,
      pages.map(page => ({
        page: page.page,
        text: page.text,
        textStatus: page.textStatus,
        errorMessage: page.errorMessage,
        chapterId: chapterIdByPage.get(page.page) ?? null,
      }))
    );
  }

  const failedPages = pages.filter(page => page.textStatus === "failed");
  const [book] = await db
    .update(books)
    .set({
      status: "pending",
      chapterDetectionMethod: method,
      chapterDetectionConfidence: confidence,
      pageTexts: null,
      pagesNeedingOcr: null,
      ocrFailedPages: null,
      ocrAttemptCounts: null,
      extractionError: failedPages.length
        ? `تعذّرت قراءة ${failedPages.length} صفحة ضوئيًا: ${failedPages.map(page => page.page).join(", ")}. يمكنك إعادة محاولتها من صفحة الكتاب.`
        : null,
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId))
    .returning();

  return { book, chapters };
}

export async function listBooksForUser(userId: string) {
  const db = getDb();
  if (!db) return [];

  return db
    .select({
      id: books.id,
      fileName: books.fileName,
      pageCount: books.pageCount,
      createdAt: books.createdAt,
      updatedAt: books.updatedAt,
      subjectId: books.subjectId,
      profile: books.profile,
      chapterCount: count(bookChapters.id),
      completeChapterCount: count(
        sql`case when ${bookChapters.status} = 'complete' then 1 end`
      ),
    })
    .from(books)
    .leftJoin(bookChapters, eq(bookChapters.bookId, books.id))
    .where(and(eq(books.userId, userId), eq(books.sourceType, "study_book")))
    .groupBy(books.id)
    .orderBy(desc(books.createdAt));
}

export async function getBookForUser(userId: string, bookId: string) {
  const db = getDb();
  if (!db) return null;

  const [book] = await db
    .select()
    .from(books)
    .where(
      and(
        eq(books.id, bookId),
        eq(books.userId, userId),
        eq(books.sourceType, "study_book")
      )
    )
    .limit(1);
  if (!book) return null;

  const chapters = await db
    .select({
      id: bookChapters.id,
      orderIndex: bookChapters.orderIndex,
      title: bookChapters.title,
      startPage: bookChapters.startPage,
      endPage: bookChapters.endPage,
      status: bookChapters.status,
      errorMessage: bookChapters.errorMessage,
    })
    .from(bookChapters)
    .where(eq(bookChapters.bookId, bookId))
    .orderBy(asc(bookChapters.orderIndex));

  return { book, chapters };
}

// PR18 — real, minimal data for the book's mind map: just titles/keyPoints/
// terms, not the full getChapter payload (cards/mcqs/pages), since the map
// needs every chapter at once rather than one at a time.
export async function getBookMindMapForUser(userId: string, bookId: string) {
  const db = getDb();
  if (!db) return null;

  const [book] = await db
    .select({ id: books.id, fileName: books.fileName })
    .from(books)
    .where(
      and(
        eq(books.id, bookId),
        eq(books.userId, userId),
        eq(books.sourceType, "study_book")
      )
    )
    .limit(1);
  if (!book) return null;

  const chapters = await db
    .select({
      id: bookChapters.id,
      orderIndex: bookChapters.orderIndex,
      title: bookChapters.title,
      keyPoints: bookChapters.keyPoints,
      mindMapSections: bookChapters.mindMapSections,
    })
    .from(bookChapters)
    .where(
      and(eq(bookChapters.bookId, bookId), eq(bookChapters.status, "complete"))
    )
    .orderBy(asc(bookChapters.orderIndex));

  const terms = chapters.length
    ? await db
        .select({
          chapterId: bookTerms.chapterId,
          ar: bookTerms.ar,
          en: bookTerms.en,
        })
        .from(bookTerms)
        .where(
          inArray(
            bookTerms.chapterId,
            chapters.map(c => c.id)
          )
        )
    : [];
  const termsByChapter = new Map<string, { ar: string; en: string }[]>();
  for (const term of terms) {
    const list = termsByChapter.get(term.chapterId) ?? [];
    list.push({ ar: term.ar, en: term.en });
    termsByChapter.set(term.chapterId, list);
  }

  // Audit Phase 6/7 — the mind map must reflect real image/diagram/table
  // content too, not just text-derived keyPoints/terms, so each chapter node
  // gets its own visual assets (with the page they came from) alongside its
  // keyPoints/terms. Joined through bookPages since bookVisualAssets has no
  // chapterId of its own on older rows in some edge cases — pageId always
  // resolves it reliably.
  const visuals = chapters.length
    ? await db
        .select({
          chapterId: bookPages.chapterId,
          pageNumber: bookPages.pageNumber,
          assetType: bookVisualAssets.assetType,
          descriptionAr: bookVisualAssets.descriptionAr,
          descriptionEn: bookVisualAssets.descriptionEn,
        })
        .from(bookVisualAssets)
        .innerJoin(bookPages, eq(bookPages.id, bookVisualAssets.pageId))
        .where(
          inArray(
            bookPages.chapterId,
            chapters.map(c => c.id)
          )
        )
        .orderBy(asc(bookPages.pageNumber))
    : [];
  const visualsByChapter = new Map<
    string,
    {
      pageNumber: number;
      assetType: string;
      descriptionAr: string | null;
      descriptionEn: string | null;
    }[]
  >();
  for (const visual of visuals) {
    if (!visual.chapterId) continue;
    const list = visualsByChapter.get(visual.chapterId) ?? [];
    list.push({
      pageNumber: visual.pageNumber,
      assetType: visual.assetType,
      descriptionAr: visual.descriptionAr,
      descriptionEn: visual.descriptionEn,
    });
    visualsByChapter.set(visual.chapterId, list);
  }

  return {
    book,
    chapters: chapters.map(chapter => ({
      ...chapter,
      terms: termsByChapter.get(chapter.id) ?? [],
      visuals: visualsByChapter.get(chapter.id) ?? [],
    })),
  };
}

// Ordered, safe deletion (see lib/storage.ts's deleteObject/deleteObjects):
// 1) verify ownership, 2) collect every storage key this book owns (its
// original PDF + every page screenshot/preview + every visual asset image)
// WHILE the rows still exist, 3) delete the DB rows (a single DELETE is
// already atomic; children cascade via each table's onDelete: "cascade"),
// 4) only once that's committed, best-effort delete the collected S3
// objects. A student-visible "book deleted" means step 3 succeeded — S3
// cleanup failing afterward is logged (an orphan for a future cleanup pass)
// and never reported back as this call failing, since the DB record (what
// the rest of the app and the student actually see) is already gone.
export async function deleteBook(userId: string, bookId: string) {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const [book] = await db
    .select({ id: books.id, fileKey: books.fileKey })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);
  if (!book) return false;

  const pages = await db
    .select({
      storageKey: bookPages.storageKey,
      previewKey: bookPages.previewKey,
    })
    .from(bookPages)
    .where(eq(bookPages.bookId, bookId));
  const visuals = await db
    .select({
      storageKey: bookVisualAssets.storageKey,
      previewKey: bookVisualAssets.previewKey,
    })
    .from(bookVisualAssets)
    .where(eq(bookVisualAssets.bookId, bookId));

  const storageKeys = [
    book.fileKey,
    ...pages.flatMap(page => [page.storageKey, page.previewKey]),
    ...visuals.flatMap(visual => [visual.storageKey, visual.previewKey]),
  ].filter((key): key is string => Boolean(key));

  const deleted = await db
    .delete(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .returning({ id: books.id });
  if (!deleted.length) return false;

  if (storageKeys.length) {
    try {
      await deleteObjects(storageKeys);
    } catch (error) {
      console.error("[Books] Failed to delete storage objects for book", {
        bookId,
        error,
      });
    }
  }

  return true;
}

// Ownership check for a chapter-scoped action (the analyze route) — joins
// through to the owning book's userId rather than trusting chapterId alone.
export async function getChapterForUser(
  userId: string,
  chapterId: string
): Promise<BookChapter | null> {
  const db = getDb();
  if (!db) return null;

  const [row] = await db
    .select({ chapter: bookChapters })
    .from(bookChapters)
    .innerJoin(books, eq(books.id, bookChapters.bookId))
    .where(and(eq(bookChapters.id, chapterId), eq(books.userId, userId)))
    .limit(1);

  return row?.chapter ?? null;
}

// No-ownership-filter lookup for a queue worker (no session — the worker
// verifies the QStash signature instead, see lib/queue/verify.ts), same
// trust-boundary reasoning as db-mirror.ts's getMirrorBatchById.
export async function getChapterById(
  chapterId: string
): Promise<
  (BookChapter & { userId: string; bookProfile: Book["profile"] }) | null
> {
  const db = getDb();
  if (!db) return null;

  const [row] = await db
    .select({
      chapter: bookChapters,
      userId: books.userId,
      bookProfile: books.profile,
    })
    .from(bookChapters)
    .innerJoin(books, eq(books.id, bookChapters.bookId))
    .where(eq(bookChapters.id, chapterId))
    .limit(1);

  return row
    ? { ...row.chapter, userId: row.userId, bookProfile: row.bookProfile }
    : null;
}

// Resets a failed chapter back to "pending" for a fresh retry budget — used
// by the retryChapter tRPC mutation.
export async function resetBookChapterForRetry(chapterId: string) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookChapters)
    .set({
      status: "pending",
      attemptCount: 0,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(bookChapters.id, chapterId));
}

// Audit fix (P0) — persists one more completed sub-chunk's result onto the
// chapter row immediately after that sub-chunk's own LLM call succeeds, so a
// timeout/retry on a LATER sub-chunk never has to redo (or re-pay for) this
// one. Small array (a chapter split into double digits of sub-chunks would
// already be an extreme outlier), so read-modify-write is fine — no need
// for a real append-only jsonb operator here.
export async function saveChapterSubChunkProgress(
  chapterId: string,
  results: BookChapterAnalysis[]
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookChapters)
    .set({ subChunkResults: results, updatedAt: new Date() })
    .where(eq(bookChapters.id, chapterId));
}

export async function markBookChapterRetrying(
  chapterId: string,
  errorMessage: string
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookChapters)
    .set({
      status: "retrying",
      errorMessage,
      lastErrorAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(bookChapters.id, chapterId));
}

export async function markBookChapterFailedTerminal(
  chapterId: string,
  errorMessage: string
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookChapters)
    .set({
      status: "failed",
      errorMessage,
      lastErrorAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(bookChapters.id, chapterId));
}

// ── كتبي page visual analysis (images/diagrams/tables) ──────────────────
// No-ownership-filter lookup for the queue worker — same trust-boundary
// reasoning as getChapterById above.
export async function getBookPageById(
  pageId: string
): Promise<BookPage | null> {
  const db = getDb();
  if (!db) return null;
  const [page] = await db
    .select()
    .from(bookPages)
    .where(eq(bookPages.id, pageId))
    .limit(1);
  return page ?? null;
}

// Next page still needing visual analysis for a given book — the worker
// drives itself off this rather than a batch id, since pages were all
// created up front by finalizeBookExtraction (unlike مِرآة/مكتبة الأدمن's
// batches, there's no separate "claim by id" queued unit here per se; the
// caller looks this up, then claims that specific page).
export async function getNextPendingBookPage(
  bookId: string
): Promise<BookPage | null> {
  const db = getDb();
  if (!db) return null;
  const [page] = await db
    .select()
    .from(bookPages)
    .where(
      and(
        eq(bookPages.bookId, bookId),
        inArray(bookPages.visualStatus, ["pending", "failed"])
      )
    )
    .orderBy(asc(bookPages.pageNumber))
    .limit(1);
  return page ?? null;
}

export async function updateBookPageVisualResult(
  pageId: string,
  update: {
    storageKey: string;
    width?: number;
    height?: number;
    extractedText?: string;
    hasImages: boolean;
    hasTables: boolean;
    hasDiagrams: boolean;
    visualStatus: "complete" | "needs_review";
  }
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookPages)
    .set({
      storageKey: update.storageKey,
      width: update.width,
      height: update.height,
      ...(update.extractedText ? { extractedText: update.extractedText } : {}),
      hasImages: update.hasImages,
      hasTables: update.hasTables,
      hasDiagrams: update.hasDiagrams,
      visualStatus: update.visualStatus,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(bookPages.id, pageId));
}

export async function markBookPageVisualFailed(
  pageId: string,
  errorMessage: string
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookPages)
    .set({
      visualStatus: "failed",
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(bookPages.id, pageId));
}

// Student/admin-triggered retry of one failed page — resets it back to
// "pending" so getNextPendingBookPage picks it up again; the caller
// republishes an analyze_book_page_visuals message for the book.
export async function resetBookPageVisualForRetry(pageId: string) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookPages)
    .set({
      visualStatus: "pending",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(bookPages.id, pageId));
}

export async function insertBookVisualAssets(
  pageId: string,
  bookId: string,
  chapterId: string | null,
  assets: {
    assetType: "image" | "diagram" | "table" | "screenshot" | "chart";
    storageKey: string;
    descriptionAr: string;
    descriptionEn: string;
    confidence: "high" | "medium" | "low";
    reviewStatus: "complete" | "needs_review";
  }[]
) {
  if (!assets.length) return;
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(bookVisualAssets).values(
    assets.map((asset, index) => ({
      bookId,
      chapterId,
      pageId,
      assetType: asset.assetType,
      storageKey: asset.storageKey,
      descriptionAr: asset.descriptionAr,
      descriptionEn: asset.descriptionEn,
      confidence: asset.confidence,
      reviewStatus: asset.reviewStatus,
      sortOrder: index,
    }))
  );
}

// Ownership check for a page-scoped action (the retryPageVisual mutation) —
// same join-through-books pattern as getChapterForUser.
export async function getBookPageOwnedByUser(
  userId: string,
  pageId: string
): Promise<BookPage | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ page: bookPages })
    .from(bookPages)
    .innerJoin(books, eq(books.id, bookPages.bookId))
    .where(and(eq(bookPages.id, pageId), eq(books.userId, userId)))
    .limit(1);
  return row?.page ?? null;
}

export async function listBookPagesForUser(userId: string, bookId: string) {
  const db = getDb();
  if (!db) return [];
  const [book] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);
  if (!book) return [];

  return db
    .select()
    .from(bookPages)
    .where(eq(bookPages.bookId, bookId))
    .orderBy(asc(bookPages.pageNumber));
}

export async function getBookPageForUser(
  userId: string,
  bookId: string,
  pageNumber: number
) {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ page: bookPages, ownerId: books.userId })
    .from(bookPages)
    .innerJoin(books, eq(books.id, bookPages.bookId))
    .where(
      and(
        eq(bookPages.bookId, bookId),
        eq(bookPages.pageNumber, pageNumber),
        eq(books.userId, userId)
      )
    )
    .limit(1);
  if (!row) return null;

  const visuals = await db
    .select()
    .from(bookVisualAssets)
    .where(eq(bookVisualAssets.pageId, row.page.id))
    .orderBy(asc(bookVisualAssets.sortOrder));

  return { page: row.page, visuals };
}

// Coverage report — never claim "اكتمل" without showing what's still
// pending/failed (see plan's explicit requirement). All counts are simple,
// cheap COUNT()s scoped to one book.
export async function getBookCoverageReport(bookId: string) {
  const db = getDb();
  if (!db) return null;

  const [pageStats] = await db
    .select({
      total: count(),
      textComplete: count(
        sql`case when ${bookPages.textStatus} = 'complete' then 1 end`
      ),
      previewsReady: count(
        sql`case when ${bookPages.storageKey} is not null then 1 end`
      ),
      withVisuals: count(
        sql`case when ${bookPages.hasImages} or ${bookPages.hasTables} or ${bookPages.hasDiagrams} then 1 end`
      ),
      needsReview: count(
        sql`case when ${bookPages.visualStatus} = 'needs_review' then 1 end`
      ),
      failed: count(
        sql`case when ${bookPages.visualStatus} = 'failed' then 1 end`
      ),
      visualPending: count(
        sql`case when ${bookPages.visualStatus} in ('pending','processing') then 1 end`
      ),
    })
    .from(bookPages)
    .where(eq(bookPages.bookId, bookId));

  const [cardStats] = await db
    .select({ c: count() })
    .from(bookCards)
    .innerJoin(bookChapters, eq(bookChapters.id, bookCards.chapterId))
    .where(eq(bookChapters.bookId, bookId));

  const [mcqStats] = await db
    .select({ c: count() })
    .from(bookMcqs)
    .innerJoin(bookChapters, eq(bookChapters.id, bookMcqs.chapterId))
    .where(eq(bookChapters.bookId, bookId));

  return {
    totalPages: Number(pageStats?.total ?? 0),
    textComplete: Number(pageStats?.textComplete ?? 0),
    previewsReady: Number(pageStats?.previewsReady ?? 0),
    pagesWithVisuals: Number(pageStats?.withVisuals ?? 0),
    needsReview: Number(pageStats?.needsReview ?? 0),
    failed: Number(pageStats?.failed ?? 0),
    visualPending: Number(pageStats?.visualPending ?? 0),
    linkedCardCount: Number(cardStats?.c ?? 0),
    linkedMcqCount: Number(mcqStats?.c ?? 0),
  };
}

export type BookCoverageDetail = {
  totalPages: number;
  processedPages: number;
  failedPages: number[];
  missingPages: number[];
  coverage: number;
  status: "COMPLETE" | "PARTIAL" | "PROCESSING";
};

// Audit Phase 3 — the "real Document Coverage Engine" requirement: the
// system itself (never the LLM's own claim) must be able to say, in exact
// page numbers, which pages are missing/failed, and never report COMPLETE
// while any page is missing or has failed. Pure and DB-free (same rationale
// as computeBookRollupStatus below) so it's directly unit-testable against
// real page-status combinations rather than mocked DB calls.
//
// "Processed" = a page's own two independent per-page pipelines (text
// extraction, visual analysis) both reached a genuine terminal outcome:
// textStatus 'complete' AND visualStatus 'complete' or 'needs_review'
// (needs_review still means the page was actually looked at, just flagged
// for human review — not silently skipped, so it counts as processed here).
export function computeCoverageDetail(
  totalPages: number,
  pages: { pageNumber: number; textStatus: string; visualStatus: string }[]
): BookCoverageDetail {
  const seenPageNumbers = new Set(pages.map(page => page.pageNumber));
  const missingPages: number[] = [];
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    if (!seenPageNumbers.has(pageNumber)) missingPages.push(pageNumber);
  }

  const failedPages = pages
    .filter(
      page => page.textStatus === "failed" || page.visualStatus === "failed"
    )
    .map(page => page.pageNumber)
    .sort((a, b) => a - b);

  const processedPages = pages.filter(
    page =>
      page.textStatus === "complete" &&
      (page.visualStatus === "complete" || page.visualStatus === "needs_review")
  ).length;

  const coverage =
    totalPages > 0 ? Math.round((processedPages / totalPages) * 100) : 0;

  const status: BookCoverageDetail["status"] =
    totalPages > 0 && processedPages === totalPages && missingPages.length === 0
      ? "COMPLETE"
      : failedPages.length > 0 || missingPages.length > 0
        ? "PARTIAL"
        : "PROCESSING";

  return {
    totalPages,
    processedPages,
    failedPages,
    missingPages,
    coverage,
    status,
  };
}

// Thin DB wrapper around computeCoverageDetail above — books.pageCount is
// the ground truth for "how many pages this book actually has" (set once
// from the PDF parser's own page count in app/api/books/extract/route.ts,
// never derived from how many pages happened to process successfully), so
// it — not a COUNT() over book_pages — is what missingPages is measured
// against.
export async function getBookCoverageDetail(
  bookId: string
): Promise<BookCoverageDetail | null> {
  const db = getDb();
  if (!db) return null;

  const [book] = await db
    .select({ pageCount: books.pageCount })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  if (!book) return null;

  const pages = await db
    .select({
      pageNumber: bookPages.pageNumber,
      textStatus: bookPages.textStatus,
      visualStatus: bookPages.visualStatus,
    })
    .from(bookPages)
    .where(eq(bookPages.bookId, bookId));

  return computeCoverageDetail(book.pageCount, pages);
}

// Small helper for generateMindMapSections below — the caller has already
// proven ownership of the chapter via getChapterForUser, so this needs no
// ownership filter of its own (same trust-boundary reasoning as the other
// no-filter internal helpers in this file).
export async function getChapterTerms(chapterId: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({ ar: bookTerms.ar, en: bookTerms.en })
    .from(bookTerms)
    .where(eq(bookTerms.chapterId, chapterId));
}

// Audit Phase 5 — Question Validation Agent. The caller (validateChapterMcqs
// tRPC mutation) has already proven chapter ownership via getChapterForUser,
// so these need no ownership filter of their own.
export async function getChapterMcqsForValidation(chapterId: string) {
  const db = getDb();
  if (!db) return [];
  return (
    db
      .select({
        id: bookMcqs.id,
        questionEn: bookMcqs.questionEn,
        choices: bookMcqs.choices,
        correctIndex: bookMcqs.correctIndex,
        explanationEn: bookMcqs.explanationEn,
        sourcePage: bookMcqs.sourcePage,
        validationStatus: bookMcqs.validationStatus,
      })
      .from(bookMcqs)
      .where(eq(bookMcqs.chapterId, chapterId))
      // Deterministic order (oldest first) so duplicate detection always keeps
      // the earliest-created copy of a repeated question and flags only the
      // later one(s) — otherwise which copy gets flagged could flip between
      // calls, including flipping an already-"valid" MCQ to "flagged" for no
      // real reason.
      .orderBy(asc(bookMcqs.createdAt))
  );
}

// Audit Phase 5, part 3 — inserts the coverage-gap-filling MCQs generated by
// validateChapterMcqs (see lib/book-analysis.ts's buildGapQuestionsMessages/
// parseGapQuestions). Left at the schema-default "pending" validationStatus
// — a freshly-generated question hasn't been through the validation pass
// yet, so it isn't presumed correct just because it filled a gap.
export async function insertBookMcqs(
  chapterId: string,
  mcqs: {
    questionEn: string;
    choices: string[];
    correctIndex: number;
    explanationEn: string;
    sourcePage: number;
  }[]
) {
  if (!mcqs.length) return;
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(bookMcqs).values(
    mcqs.map(mcq => ({
      chapterId,
      questionEn: mcq.questionEn,
      choices: mcq.choices,
      correctIndex: mcq.correctIndex,
      explanationEn: mcq.explanationEn,
      sourcePage: mcq.sourcePage,
    }))
  );
}

export async function saveMcqValidationResults(
  results: { id: string; status: "valid" | "flagged"; note: string | null }[]
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  for (const result of results) {
    await db
      .update(bookMcqs)
      .set({ validationStatus: result.status, validationNote: result.note })
      .where(eq(bookMcqs.id, result.id));
  }
}

// Audit Phase 6 — persists the lazily-generated hierarchical mind map
// sections for one chapter (see lib/trpc/booksRouter.ts's
// generateMindMapSections and lib/book-analysis.ts's parseMindMapSections).
export async function saveChapterMindMapSections(
  chapterId: string,
  sections: ChapterMindMapSection[]
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookChapters)
    .set({ mindMapSections: sections, updatedAt: new Date() })
    .where(eq(bookChapters.id, chapterId));
}

// Audit Phase 7 — the caller (generateVisualInsights tRPC mutation) has
// already proven chapter ownership via getChapterForUser, so this needs no
// ownership filter of its own. Joined through bookPages (not
// bookVisualAssets.chapterId directly) — same reliability reasoning as
// getBookMindMapForUser's visuals join above.
export async function getChapterVisualAssets(chapterId: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      pageNumber: bookPages.pageNumber,
      assetType: bookVisualAssets.assetType,
      descriptionAr: bookVisualAssets.descriptionAr,
    })
    .from(bookVisualAssets)
    .innerJoin(bookPages, eq(bookPages.id, bookVisualAssets.pageId))
    .where(eq(bookPages.chapterId, chapterId))
    .orderBy(asc(bookPages.pageNumber));
}

export async function saveChapterVisualInsights(
  chapterId: string,
  visualInsightsAr: string
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookChapters)
    .set({ visualInsightsAr, updatedAt: new Date() })
    .where(eq(bookChapters.id, chapterId));
}

export type BookRollupDecision = "skip" | "complete" | "partial_failed";

// Pure decision logic for finalizeBookIfDone, extracted so it's directly
// unit-testable without mocking the DB (same rationale as
// linkSourcePagesToVisualAssets above). Found via a real-Postgres
// integration run: "partial_failed" was originally treated the same as
// "complete" (a terminal state finalizeBookIfDone refused to re-touch),
// which meant a student successfully retrying their last failed
// chapter/page could NEVER see the book flip back to "complete" — the
// status was permanently stuck. "complete" alone is truly terminal (no
// failure exists left to ever re-surface); "partial_failed" must keep being
// re-evaluated on every call.
export function computeBookRollupStatus(
  currentStatus: string,
  chapterStatuses: string[],
  pageStatuses: { visualStatus: string; textStatus: string }[]
): BookRollupDecision {
  if (currentStatus === "complete") return "skip";
  if (!chapterStatuses.length) return "skip";

  const chaptersStillWorking = chapterStatuses.some(
    status =>
      status === "pending" ||
      status === "processing" ||
      status === "analyzing" ||
      status === "retrying"
  );
  if (chaptersStillWorking) return "skip";

  // Also gates on every page's visualStatus reaching a terminal state
  // (complete/needs_review/failed) — a student can already read
  // chapters/cards while visual analysis runs in the background (this never
  // blocks that), but the book isn't reported "complete" until visual
  // coverage is honestly settled too. "needs_review" alone (no true
  // failures) does not force "partial_failed".
  const pagesStillWorking = pageStatuses.some(
    page =>
      page.visualStatus === "pending" || page.visualStatus === "processing"
  );
  if (pagesStillWorking) return "skip";

  const anyChapterFailed = chapterStatuses.some(status => status === "failed");
  // textStatus === "failed" means this page permanently exhausted its OCR
  // retry budget during extraction (see finalizeBookExtraction) — a real
  // failure the student can retry individually, same as a failed chapter or
  // a failed page visual, so it must count toward "partial_failed" too.
  const anyPageFailed = pageStatuses.some(
    page => page.visualStatus === "failed" || page.textStatus === "failed"
  );

  return anyChapterFailed || anyPageFailed ? "partial_failed" : "complete";
}

// Idempotent finalize: safe to call repeatedly — SELECT ... FOR UPDATE on
// the book row serializes concurrent finalize attempts for the same book, so
// two chapters (or page retries) finishing at nearly the same moment can't
// race each other. Unlike مِرآة, there's no "graduation" step here —
// chapters' content (bookTerms/bookCards/bookMcqs) is already the durable
// content, this just rolls the book's own status up from its chapters'/
// pages' statuses (see computeBookRollupStatus above for the actual rule).
export async function finalizeBookIfDone(bookId: string) {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async tx => {
    const [book] = await tx
      .select()
      .from(books)
      .where(eq(books.id, bookId))
      .for("update");
    if (!book) return;

    const chapters = await tx
      .select({ status: bookChapters.status })
      .from(bookChapters)
      .where(eq(bookChapters.bookId, bookId));
    const pages = await tx
      .select({
        visualStatus: bookPages.visualStatus,
        textStatus: bookPages.textStatus,
      })
      .from(bookPages)
      .where(eq(bookPages.bookId, bookId));

    const decision = computeBookRollupStatus(
      book.status,
      chapters.map(chapter => chapter.status),
      pages
    );
    if (decision === "skip") return;

    await tx
      .update(books)
      .set({ status: decision, updatedAt: new Date() })
      .where(eq(books.id, bookId));
  });
}

export async function setChapterAnalyzing(chapterId: string) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookChapters)
    .set({ status: "analyzing", errorMessage: null, updatedAt: new Date() })
    .where(eq(bookChapters.id, chapterId));
}

export async function setChapterFailed(
  chapterId: string,
  errorMessage: string
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bookChapters)
    .set({ status: "failed", errorMessage, updatedAt: new Date() })
    .where(eq(bookChapters.id, chapterId));
}

export async function completeChapterAnalysis(
  chapterId: string,
  userId: string,
  result: {
    explanationAr: string;
    explanationEn: string;
    keyPoints: string[];
    chapterSummary: string;
    terms: { ar: string; en: string; pronunciation: string }[];
    cards: {
      questionAr: string;
      questionEn: string;
      answerAr: string;
      answerEn: string;
      relatedTermEn: string;
      sourcePage: number;
    }[];
    mcqs: {
      questionEn: string;
      choices: string[];
      correctIndex: number;
      explanationEn: string;
      sourcePage: number;
    }[];
  }
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  // Wrapped in one transaction, with an unconditional delete-before-insert
  // for this chapter's children: this makes the whole function
  // idempotent-by-replacement, so a retry (whether it's this transaction
  // rolling back mid-way, or a chapter left with orphaned rows from before
  // this fix existed) can never leave duplicate terms/cards/mcqs behind.
  // Safe to wipe existing bookCards here because a chapter is only ever
  // re-analyzed from "pending"/"failed" (see app/books/[bookId]/page.tsx's
  // resume filter) — a "complete" chapter, whose cards a user could already
  // be reviewing via SRS, is never re-run through this function.
  await db.transaction(async tx => {
    await tx
      .update(bookChapters)
      .set({
        status: "complete",
        explanationAr: result.explanationAr,
        explanationEn: result.explanationEn,
        keyPoints: result.keyPoints,
        chapterSummary: result.chapterSummary,
        errorMessage: null,
        // Sub-chunk resume scaffolding (P0 audit fix) is only useful while
        // analysis is in progress — clear it once the chapter is durably
        // complete so it never masks a genuinely fresh re-analysis later.
        subChunkResults: null,
        updatedAt: new Date(),
      })
      .where(eq(bookChapters.id, chapterId));

    await tx.delete(bookTerms).where(eq(bookTerms.chapterId, chapterId));
    await tx.delete(bookCards).where(eq(bookCards.chapterId, chapterId));
    await tx.delete(bookMcqs).where(eq(bookMcqs.chapterId, chapterId));

    if (result.terms.length) {
      await tx.insert(bookTerms).values(
        result.terms.map(term => ({
          chapterId,
          ar: term.ar,
          en: term.en,
          pronunciation: term.pronunciation,
        }))
      );
    }

    if (result.cards.length) {
      await tx.insert(bookCards).values(
        result.cards.map(card => ({
          chapterId,
          userId,
          questionAr: card.questionAr,
          questionEn: card.questionEn,
          answerAr: card.answerAr,
          answerEn: card.answerEn,
          relatedTermEn: card.relatedTermEn,
          sourcePage: card.sourcePage,
        }))
      );
    }

    if (result.mcqs.length) {
      await tx.insert(bookMcqs).values(
        result.mcqs.map(mcq => ({
          chapterId,
          questionEn: mcq.questionEn,
          choices: mcq.choices,
          correctIndex: mcq.correctIndex,
          explanationEn: mcq.explanationEn,
          sourcePage: mcq.sourcePage,
        }))
      );
    }
  });
}

// Computes sourcePage -> visual-asset linkage at READ time (not stored on
// bookCards/bookMcqs) — visual analysis finishes independently of, and
// often later than, chapter analysis, so a stored/write-time column would
// need to coordinate two out-of-order background pipelines. Joining by
// (chapterId, pageNumber=sourcePage) here works regardless of which
// pipeline finished first or whether visual analysis has even started yet.
// Pure (no DB access) — kept separate from getChapterContentForUser
// specifically so it's directly unit-testable without mocking getDb().
// Given the pages a chapter has and the visual assets those pages own,
// returns a lookup from a card/MCQ's sourcePage to {pageId, relatedAssetIds}.
// A sourcePage with no matching page (shouldn't happen given the
// sourcePage-range filter in analyze-chapter/route.ts, but defensive
// regardless) or a page with no visuals yet (visual analysis hasn't reached
// it) both resolve to an empty relatedAssetIds — never throws.
export function linkSourcePagesToVisualAssets(
  pages: Pick<BookPage, "id" | "pageNumber">[],
  visuals: Pick<BookVisualAsset, "id" | "pageId">[]
): (sourcePage: number) => {
  pageId: string | null;
  relatedAssetIds: string[];
} {
  const pageIdByNumber = new Map(pages.map(page => [page.pageNumber, page.id]));
  const assetIdsByPageId = new Map<string, string[]>();
  for (const asset of visuals) {
    const list = assetIdsByPageId.get(asset.pageId) ?? [];
    list.push(asset.id);
    assetIdsByPageId.set(asset.pageId, list);
  }
  return (sourcePage: number) => {
    const pageId = pageIdByNumber.get(sourcePage) ?? null;
    const relatedAssetIds = pageId ? (assetIdsByPageId.get(pageId) ?? []) : [];
    return { pageId, relatedAssetIds };
  };
}

export async function getChapterContentForUser(
  userId: string,
  chapterId: string
) {
  const db = getDb();
  if (!db) return null;

  const chapter = await getChapterForUser(userId, chapterId);
  if (!chapter) return null;

  const [terms, cards, mcqs, pages] = await Promise.all([
    db.select().from(bookTerms).where(eq(bookTerms.chapterId, chapterId)),
    db.select().from(bookCards).where(eq(bookCards.chapterId, chapterId)),
    db.select().from(bookMcqs).where(eq(bookMcqs.chapterId, chapterId)),
    db
      .select()
      .from(bookPages)
      .where(eq(bookPages.chapterId, chapterId))
      .orderBy(asc(bookPages.pageNumber)),
  ]);

  const pageIds = pages.map(page => page.id);
  const visuals = pageIds.length
    ? await db
        .select()
        .from(bookVisualAssets)
        .where(inArray(bookVisualAssets.pageId, pageIds))
        .orderBy(asc(bookVisualAssets.sortOrder))
    : [];

  const linkFor = linkSourcePagesToVisualAssets(pages, visuals);

  const pagesWithVisuals = pages.map(page => ({
    ...page,
    visuals: visuals.filter(asset => asset.pageId === page.id),
  }));

  return {
    chapter,
    terms,
    cards: cards.map(card => ({ ...card, ...linkFor(card.sourcePage) })),
    mcqs: mcqs.map(mcq => ({ ...mcq, ...linkFor(mcq.sourcePage) })),
    pages: pagesWithVisuals,
  };
}

// ── SRS review (see lib/srs.ts's applySrsRating for the scheduling formula) ──

export async function getDueCardsForUser(userId: string) {
  const db = getDb();
  if (!db) return [];

  return db
    .select({
      id: bookCards.id,
      questionAr: bookCards.questionAr,
      questionEn: bookCards.questionEn,
      answerAr: bookCards.answerAr,
      answerEn: bookCards.answerEn,
      relatedTermEn: bookCards.relatedTermEn,
      sourcePage: bookCards.sourcePage,
      dueAt: bookCards.dueAt,
      chapterTitle: bookChapters.title,
      bookFileName: books.fileName,
    })
    .from(bookCards)
    .innerJoin(bookChapters, eq(bookChapters.id, bookCards.chapterId))
    .innerJoin(books, eq(books.id, bookChapters.bookId))
    .where(and(eq(bookCards.userId, userId), lte(bookCards.dueAt, new Date())))
    .orderBy(asc(bookCards.dueAt));
}

export async function rateBookCard(
  userId: string,
  cardId: string,
  rating: FsrsGrade
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const [card] = await db
    .select({
      fsrsStability: bookCards.fsrsStability,
      fsrsDifficulty: bookCards.fsrsDifficulty,
      lastReviewedAt: bookCards.lastReviewedAt,
    })
    .from(bookCards)
    .where(and(eq(bookCards.id, cardId), eq(bookCards.userId, userId)))
    .limit(1);
  if (!card) return null;

  const now = new Date();
  const update = scheduleFsrsReview(
    FSRS_DEFAULT_WEIGHTS,
    {
      stability: card.fsrsStability,
      difficulty: card.fsrsDifficulty,
      lastReviewedAt: card.lastReviewedAt,
    },
    rating,
    now
  );

  await db
    .update(bookCards)
    .set({
      fsrsStability: update.stability,
      fsrsDifficulty: update.difficulty,
      intervalDays: update.intervalDays,
      dueAt: update.dueAt,
      lastReviewedAt: now,
      reviewCount: sql`${bookCards.reviewCount} + 1`,
      lastRating: rating,
    })
    .where(eq(bookCards.id, cardId));

  await db.insert(bookReviewEvents).values({ cardId, userId, rating });

  return update;
}

// ── خطة الدراسة (PR7) — a simple, honest forecast: how many bookCards are
// already scheduled to come due on each of the next 7 days, from real
// dueAt values FSRS just computed. Deliberately كتبي-only (not a combined
// مِرآة+كتبي forecast): مِرآة's SM-2 cards have no stability model to make a
// multi-day projection meaningful beyond their own single next dueAt, so
// mixing them in here would either drop them silently or fabricate a
// forecast for an algorithm that doesn't support one.
export async function getUpcomingReviewForecastForUser(
  userId: string,
  days = 7
) {
  const db = getDb();
  if (!db) return [];

  const rows = await db.execute<{ day: string; count: number }>(sql`
    select date(bc."dueAt") as day, count(*)::int as count
    from book_cards bc
    where bc."userId" = ${userId}
      and bc."dueAt" >= now()
      and bc."dueAt" < now() + ${days} * interval '1 day'
    group by date(bc."dueAt")
    order by day asc
  `);

  return rows.map(row => ({ day: row.day, count: Number(row.count) }));
}

// ── MCQ practice + stats ─────────────────────────────────────────────────

export async function listMcqsForUser(userId: string) {
  const db = getDb();
  if (!db) return [];

  return db
    .select({
      id: bookMcqs.id,
      questionEn: bookMcqs.questionEn,
      choices: bookMcqs.choices,
      correctIndex: bookMcqs.correctIndex,
      explanationEn: bookMcqs.explanationEn,
      sourcePage: bookMcqs.sourcePage,
      validationStatus: bookMcqs.validationStatus,
      validationNote: bookMcqs.validationNote,
      chapterTitle: bookChapters.title,
      bookFileName: books.fileName,
    })
    .from(bookMcqs)
    .innerJoin(bookChapters, eq(bookChapters.id, bookMcqs.chapterId))
    .innerJoin(books, eq(books.id, bookChapters.bookId))
    .where(eq(books.userId, userId))
    .orderBy(desc(bookMcqs.createdAt));
}

export async function submitMcqAttemptForUser(
  userId: string,
  mcqId: string,
  selectedIndex: number
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const [mcq] = await db
    .select({
      correctIndex: bookMcqs.correctIndex,
      explanationEn: bookMcqs.explanationEn,
    })
    .from(bookMcqs)
    .innerJoin(bookChapters, eq(bookChapters.id, bookMcqs.chapterId))
    .innerJoin(books, eq(books.id, bookChapters.bookId))
    .where(and(eq(bookMcqs.id, mcqId), eq(books.userId, userId)))
    .limit(1);
  if (!mcq) return null;

  const isCorrect = selectedIndex === mcq.correctIndex;
  await db.insert(bookMcqAttempts).values({
    mcqId,
    userId,
    selectedIndex,
    isCorrect,
  });

  return {
    isCorrect,
    correctIndex: mcq.correctIndex,
    explanationEn: mcq.explanationEn,
  };
}

export async function getBookStatsForUser(userId: string) {
  const db = getDb();
  if (!db) {
    return {
      cardsReviewed: 0,
      accuracyPercent: 0,
      streakDays: 0,
      hoursStudied: 0,
      fileCount: 0,
      cardCount: 0,
      quizQuestionsAnsweredCount: 0,
    };
  }

  const [reviewStats] = await db
    .select({ total: count() })
    .from(bookReviewEvents)
    .where(eq(bookReviewEvents.userId, userId));

  const [mcqStats] = await db
    .select({
      total: count(),
      correct: count(sql`case when ${bookMcqAttempts.isCorrect} then 1 end`),
    })
    .from(bookMcqAttempts)
    .where(eq(bookMcqAttempts.userId, userId));

  // PR18 — real counts for /account's study statistics section.
  const [fileStats] = await db
    .select({ total: count() })
    .from(books)
    .where(eq(books.userId, userId));
  const [cardStats] = await db
    .select({ total: count() })
    .from(bookCards)
    .where(eq(bookCards.userId, userId));

  const totalAnswered = Number(mcqStats?.total ?? 0);
  const totalCorrect = Number(mcqStats?.correct ?? 0);
  const accuracyPercent = totalAnswered
    ? Math.round((totalCorrect / totalAnswered) * 100)
    : 0;

  const activeDayRows = await db
    .select({ day: sql<string>`date(${bookReviewEvents.reviewedAt})` })
    .from(bookReviewEvents)
    .where(eq(bookReviewEvents.userId, userId))
    .groupBy(sql`date(${bookReviewEvents.reviewedAt})`)
    .orderBy(desc(sql`date(${bookReviewEvents.reviewedAt})`));

  const activeDays = new Set(activeDayRows.map(row => row.day));
  let streakDays = 0;
  const cursor = new Date();
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!activeDays.has(key)) break;
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    cardsReviewed: Number(reviewStats?.total ?? 0),
    accuracyPercent,
    streakDays,
    // No dedicated study-session tracking in Phase 1 — approximated as a
    // fixed per-review-event cost rather than adding a new session table.
    hoursStudied:
      Math.round(((Number(reviewStats?.total ?? 0) * 1.5) / 60) * 10) / 10,
    fileCount: Number(fileStats?.total ?? 0),
    cardCount: Number(cardStats?.total ?? 0),
    quizQuestionsAnsweredCount: totalAnswered,
  };
}

// ── نقاط الضعف (PR6) ─────────────────────────────────────────────────────
// "Weak" is defined structurally, not by a prompt or a heuristic score: an
// MCQ is a current weak point iff the user's MOST RECENT attempt at it was
// wrong — so getting it right on a later retry removes it, and a question
// never attempted is never "weak" (that's just unstudied, a different
// thing). No new table: book_mcq_attempts already logs every attempt.
export type WeakPointAttemptRow = {
  mcqId: string;
  questionEn: string;
  choices: string[];
  correctIndex: number;
  explanationEn: string;
  sourcePage: number;
  chapterId: string;
  chapterTitle: string;
  bookId: string;
  bookFileName: string;
  lastSelectedIndex: number;
  lastAttemptedAt: Date;
};

export type WeakChapterSummary = {
  chapterId: string;
  chapterTitle: string;
  bookId: string;
  bookFileName: string;
  wrongCount: number;
};

export function computeWeakPoints(rows: WeakPointAttemptRow[]): {
  chapters: WeakChapterSummary[];
  questions: WeakPointAttemptRow[];
} {
  const stillWrong = rows.filter(
    row => row.lastSelectedIndex !== row.correctIndex
  );

  const chapterMap = new Map<string, WeakChapterSummary>();
  for (const row of stillWrong) {
    const existing = chapterMap.get(row.chapterId);
    if (existing) {
      existing.wrongCount += 1;
    } else {
      chapterMap.set(row.chapterId, {
        chapterId: row.chapterId,
        chapterTitle: row.chapterTitle,
        bookId: row.bookId,
        bookFileName: row.bookFileName,
        wrongCount: 1,
      });
    }
  }

  return {
    chapters: Array.from(chapterMap.values()).sort(
      (a, b) => b.wrongCount - a.wrongCount
    ),
    questions: stillWrong.sort(
      (a, b) => b.lastAttemptedAt.getTime() - a.lastAttemptedAt.getTime()
    ),
  };
}

export async function getWeakPointsForUser(userId: string) {
  const db = getDb();
  if (!db) return { chapters: [], questions: [] };

  // DISTINCT ON (Postgres) picks exactly one row per mcq — the most recent
  // attempt — in a single query, rather than fetching every attempt ever
  // made and reducing in JS.
  const rows = await db.execute<
    Omit<WeakPointAttemptRow, "lastAttemptedAt"> & {
      lastAttemptedAt: string | Date;
    }
  >(sql`
    select distinct on (bm.id)
      bm.id as "mcqId",
      bm."questionEn" as "questionEn",
      bm.choices as "choices",
      bm."correctIndex" as "correctIndex",
      bm."explanationEn" as "explanationEn",
      bm."sourcePage" as "sourcePage",
      bc.id as "chapterId",
      bc.title as "chapterTitle",
      b.id as "bookId",
      b."fileName" as "bookFileName",
      bma."selectedIndex" as "lastSelectedIndex",
      bma."createdAt" as "lastAttemptedAt"
    from book_mcq_attempts bma
    inner join book_mcqs bm on bm.id = bma."mcqId"
    inner join book_chapters bc on bc.id = bm."chapterId"
    inner join books b on b.id = bc."bookId"
    where bma."userId" = ${userId}
    order by bm.id, bma."createdAt" desc
  `);

  // db.execute() bypasses Drizzle's own column-type mapping, so a raw
  // timestamp column can come back as a string rather than a Date — coerce
  // here, at the query boundary, so computeWeakPoints (and its unit tests)
  // can rely on a real Date.
  return computeWeakPoints(
    rows.map(row => ({
      ...row,
      lastAttemptedAt: new Date(row.lastAttemptedAt),
    }))
  );
}
