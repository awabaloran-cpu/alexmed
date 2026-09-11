import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { GeneratedCard } from "../lib/pdf-cards";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

/**
 * Core user table. Shape is a superset of what @auth/drizzle-adapter expects
 * (id/name/email/emailVerified/image) plus our own fields (passwordHash,
 * role). passwordHash is nullable because a Google-only account never sets
 * one — Credentials sign-in must treat a null passwordHash as "no password
 * set" rather than comparing against it.
 */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: text("passwordHash"),
  name: text("name"),
  emailVerified: timestamp("emailVerified", { withTimezone: true }),
  image: text("image"),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// --- @auth/drizzle-adapter tables (Google OAuth account linking) ---
// Session strategy stays "jwt" (see lib/auth.ts) so `sessions` is never
// actually read/written by Auth.js today, but the adapter's TypeScript
// contract and its internal codepaths still reference it, so it must exist
// with this exact shape.

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  account => ({
    compositePk: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  vt => ({
    compositePk: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);

export const cardStatusEnum = pgEnum("card_status", [
  "complete",
  "needs_review",
]);
export const cardConfidenceEnum = pgEnum("card_confidence", [
  "high",
  "medium",
  "low",
]);

// Shared SRS rating domain — used by both مِرآة's `cards` (below) and كتبي's
// `bookCards` (see the كتبي section further down). Declared up here (rather
// than only where `bookCards` is defined) since `cards` now needs it too and
// a pgEnum() const must be initialized before any pgTable() that references
// it.
export const bookCardRatingEnum = pgEnum("book_card_rating", [
  "hard",
  "good",
  "easy",
]);

// A saved study session: one uploaded PDF's generated cards, so a user can
// come back to them later without re-uploading the file.
export const decks = pgTable(
  "decks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: text("fileName").notNull(),
    // Storage key (see lib/storage.ts) — nullable since the underlying object
    // may expire/be removed independently of the deck's saved cards.
    fileKey: text("fileKey"),
    pageCount: integer("pageCount").default(0).notNull(),
    depth: text("depth").default("balanced").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userCreatedIdx: index("decks_user_id_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deckId: uuid("deckId")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    questionArabic: text("questionArabic").notNull(),
    answer: text("answer").notNull(),
    answerArabic: text("answerArabic").notNull(),
    explanation: text("explanation").notNull(),
    explanationArabic: text("explanationArabic").notNull(),
    keyIdea: text("keyIdea").notNull(),
    keyIdeaArabic: text("keyIdeaArabic").notNull(),
    keyword: text("keyword").notNull(),
    keywordArabic: text("keywordArabic").notNull(),
    sourcePage: integer("sourcePage").notNull(),
    status: cardStatusEnum("status").notNull(),
    confidence: cardConfidenceEnum("confidence").notNull(),
    // SRS (SM-2-style) scheduling fields — same shape/defaults as كتبي's
    // bookCards below, so lib/srs.ts's applySrsRating() works unmodified for
    // either table. dueAt defaults to now() so a freshly generated card is
    // immediately due, matching bookCards' behavior for a freshly-analyzed
    // chapter's cards.
    easeFactor: real("easeFactor").default(2.5).notNull(),
    intervalDays: integer("intervalDays").default(0).notNull(),
    dueAt: timestamp("dueAt", { withTimezone: true }).defaultNow().notNull(),
    reviewCount: integer("reviewCount").default(0).notNull(),
    lastRating: bookCardRatingEnum("lastRating"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    deckSourcePageIdx: index("cards_deck_id_source_page_idx").on(
      table.deckId,
      table.sourcePage
    ),
    dueAtIdx: index("cards_due_at_idx").on(table.dueAt),
  })
);

// Append-only SRS rating log for مِرآة cards — mirrors bookReviewEvents
// further down for the same reason documented there (stats/streak queries
// need per-review history, which a mutable current-state column can't give).
export const cardReviewEvents = pgTable(
  "card_review_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardId: uuid("cardId")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: bookCardRatingEnum("rating").notNull(),
    reviewedAt: timestamp("reviewedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userReviewedIdx: index("card_review_events_user_id_reviewed_at_idx").on(
      table.userId,
      table.reviewedAt
    ),
  })
);

export type Deck = typeof decks.$inferSelect;
export type InsertDeck = typeof decks.$inferInsert;
export type CardRow = typeof cards.$inferSelect;
export type InsertCardRow = typeof cards.$inferInsert;
export type CardReviewEvent = typeof cardReviewEvents.$inferSelect;

// ── مِرآة generation jobs — a server-side, resumable staging area for the
// upload→extract→OCR→generate pipeline, replacing browser localStorage as
// the source of truth (Item D of the reliability plan). Mirrors كتبي's
// books/bookChapters pattern directly below: a job is planned once (all
// batches "pending"), each batch is driven through its own bounded AI call
// by /api/mirror/generate-batch, and once every batch reaches "complete" the
// job "graduates" — its cards are copied into a real decks/cards row via the
// existing createDeckWithCards() (lib/db.ts), so the established
// library/browse/SRS-review UI needs no changes. mirror_jobs/mirror_batches
// are transient (read once during generation, then not read again after
// graduation) — unlike decks/cards, which stay the durable, permanently
// queried library.

// "partial_failed"/"processing"/"retrying" added for the QStash queue
// migration — enum values are additive-only (Postgres can't cheaply drop or
// rename a value already in use), so "generating"/"analyzing" (see
// bookChapterStatusEnum below) stay as legacy values a row can technically
// still hold, we just stop ever assigning them going forward.
// "extracting"/"failed" added when PDF text-extraction + OCR itself moved to
// a background QStash worker (was previously run synchronously inside
// upload-and-plan, which could exceed Vercel's 60s function limit on
// multi-page scanned files). "extracting" = OCR/extraction in progress;
// "failed" = extraction failed permanently (bad file), distinct from
// "partial_failed" which means generation finished with some batches failed.
export const mirrorJobStatusEnum = pgEnum("mirror_job_status", [
  "pending",
  "complete",
  "partial_failed",
  "extracting",
  "failed",
]);
export const mirrorBatchStatusEnum = pgEnum("mirror_batch_status", [
  "pending",
  "generating",
  "complete",
  "failed",
  "processing",
  "retrying",
]);

export const mirrorJobs = pgTable(
  "mirror_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: text("fileName").notNull(),
    fileKey: text("fileKey").notNull(),
    pageCount: integer("pageCount").default(0).notNull(),
    depth: text("depth").default("balanced").notNull(),
    status: mirrorJobStatusEnum("status").default("pending").notNull(),
    // Set once graduateMirrorJob() creates the real deck — null while the job
    // is still generating.
    deckId: uuid("deckId").references(() => decks.id),
    // Extraction/OCR staging (background worker, app/api/mirror/extract) —
    // accumulated page text + which pages still need OCR. Cleared once
    // finalizeMirrorJobExtraction() creates the real mirrorBatches rows,
    // since each batch then owns its own pageTexts slice.
    pageTexts:
      jsonb("pageTexts").$type<
        { page: number; text: string; hasText: boolean }[]
      >(),
    pagesNeedingOcr: jsonb("pagesNeedingOcr").$type<number[]>(),
    ocrFailedPages: jsonb("ocrFailedPages").$type<number[]>(),
    extractionError: text("extractionError"),
    extractionAttemptCount: integer("extractionAttemptCount")
      .default(0)
      .notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userCreatedIdx: index("mirror_jobs_user_id_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

export const mirrorBatches = pgTable(
  "mirror_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("jobId")
      .notNull()
      .references(() => mirrorJobs.id, { onDelete: "cascade" }),
    orderIndex: integer("orderIndex").notNull(),
    startPage: integer("startPage").notNull(),
    endPage: integer("endPage").notNull(),
    status: mirrorBatchStatusEnum("status").default("pending").notNull(),
    // This batch's own slice of extracted (+ OCR'd) page text, stored at
    // plan time — same rationale as bookChapters.pageTexts below: the
    // generate-batch route never has to re-fetch/re-parse the whole PDF.
    pageTexts:
      jsonb("pageTexts").$type<
        { page: number; text: string; hasText: boolean }[]
      >(),
    // Generated cards, stored as a transient blob (not a normalized child
    // table): this data is written once and read at most twice — once for
    // progress display, once to graduate into real `cards` rows — never
    // queried/joined afterward, same one-shot-content pattern as
    // bookChapters.explanationAr/keyPoints below.
    cards: jsonb("cards").$type<GeneratedCard[]>(),
    errorMessage: text("errorMessage"),
    // Queue-worker bookkeeping (QStash migration): attemptCount backs the
    // retry-vs-terminal-failure decision (compared against
    // QUEUE_MAX_ATTEMPTS), the three timestamps are observability-only.
    attemptCount: integer("attemptCount").default(0).notNull(),
    lastStartedAt: timestamp("lastStartedAt", { withTimezone: true }),
    lastCompletedAt: timestamp("lastCompletedAt", { withTimezone: true }),
    lastErrorAt: timestamp("lastErrorAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    jobOrderIdx: index("mirror_batches_job_id_order_index_idx").on(
      table.jobId,
      table.orderIndex
    ),
    statusIdx: index("mirror_batches_status_idx").on(table.status),
  })
);

export type MirrorJob = typeof mirrorJobs.$inferSelect;
export type MirrorBatch = typeof mirrorBatches.$inferSelect;

// ── كتبي (Book Study) — separate feature/data layer from decks/cards above.
// A book is uploaded once, split into chapters (heading-detected or fixed
// page windows — see lib/book-chapters.ts), and each chapter is analyzed by
// its own bounded AI call (never the whole book at once) whose result is
// persisted the instant that one chapter's request completes — this is what
// makes the whole pipeline resumable without any job queue: "pending" chapter
// rows are themselves the resume marker (see lib/book-analysis.ts).

// Book-level status (QStash queue migration) — books had no status column
// at all before this; mirrors mirrorJobs.status's role.
// "extracting"/"failed" mirror mirrorJobStatusEnum's additions above — same
// reasoning, for كتبي's own extraction/OCR background worker.
export const bookStatusEnum = pgEnum("book_status", [
  "pending",
  "processing",
  "complete",
  "partial_failed",
  "extracting",
  "failed",
]);

// Surfaced to the student when chapter detection fell back to guesswork —
// see lib/book-chapters.ts's classifyDetectionConfidence(). Null for books
// extracted before this column existed (legacy rows never get backfilled;
// the UI simply shows no confidence banner for them, same as it would for
// a book that's still mid-extraction).
export const bookChapterDetectionConfidenceEnum = pgEnum(
  "book_chapter_detection_confidence",
  ["high", "medium", "low"]
);

// ── StudyOS subjects (PR2: profile + multiple subjects) — one enum shared
// between a subject's own "type" and a book's "profile": both answer the
// same question ("what kind of material is this"), just at two different
// granularities (a subject groups many books; a book can also carry its
// own profile independent of — or before it even has — a subject, since
// profile drives AI prompt/schema selection per book while subjects are a
// student-organizational grouping layer added on top).
export const bookProfileEnum = pgEnum("book_profile", [
  "general",
  "medical",
  "english",
  "mathematics",
  "aptitude",
  "programming",
  "custom",
]);

export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: bookProfileEnum("type").default("general").notNull(),
    description: text("description"),
    color: text("color"),
    icon: text("icon"),
    examDate: timestamp("examDate", { withTimezone: true }),
    targetDate: timestamp("targetDate", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userCreatedIdx: index("subjects_user_id_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

export type Subject = typeof subjects.$inferSelect;
export type InsertSubject = typeof subjects.$inferInsert;

export const books = pgTable(
  "books",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Nullable — a book can exist unassigned (student hasn't organized it
    // into a subject yet); onDelete "set null" so deleting a subject only
    // unassigns its books rather than deleting them (books are the
    // student's actual content, subjects are just an organizational label).
    subjectId: uuid("subjectId").references(() => subjects.id, {
      onDelete: "set null",
    }),
    fileName: text("fileName").notNull(),
    fileKey: text("fileKey"),
    pageCount: integer("pageCount").default(0).notNull(),
    // Drives AI prompt/schema selection in lib/book-analysis.ts (see that
    // file). Every pre-existing book (before this column existed) is
    // backfilled to "medical" by this migration — this app's entire history
    // before StudyOS was medical-exam-focused, so that's the accurate
    // profile for old data, NOT a placeholder. "general" is only the
    // default for genuinely NEW books going forward.
    profile: bookProfileEnum("profile").default("general").notNull(),
    // How chapters were determined — "headings" (regex-detected) or
    // "fixed_windows" (fallback fixed-size page chunks) — see detectChapters().
    // Null while status is "extracting": unknown until finalizeBookExtraction()
    // runs detectChapters() against the fully-extracted text.
    chapterDetectionMethod: text("chapterDetectionMethod"),
    // Set alongside chapterDetectionMethod above — lets the UI show "we
    // guessed at the chapter split" only when it's actually true, instead of
    // inferring it (fragilely) from chapterDetectionMethod === "fixed_windows".
    chapterDetectionConfidence: bookChapterDetectionConfidenceEnum(
      "chapterDetectionConfidence"
    ),
    status: bookStatusEnum("status").default("pending").notNull(),
    // Extraction/OCR staging (background worker, app/api/books/extract) —
    // same role as mirrorJobs' equivalent columns above. Cleared once
    // finalizeBookExtraction() creates the real bookChapters rows.
    pageTexts:
      jsonb("pageTexts").$type<
        { page: number; text: string; hasText: boolean }[]
      >(),
    pagesNeedingOcr: jsonb("pagesNeedingOcr").$type<number[]>(),
    // Pages that have permanently exhausted their OCR retry budget (see
    // ocrAttemptCounts) — distinct from pagesNeedingOcr, which still holds
    // pages waiting for another attempt. A page never appears in both.
    ocrFailedPages: jsonb("ocrFailedPages").$type<number[]>(),
    // Per-page OCR attempt counter, keyed by page number as a string —
    // deliberately separate from extractionAttemptCount below, which counts
    // worker *invocations* (scales with book size, not failures) and would
    // wrongly trip a page-retry-budget check on a large-but-healthy book.
    // Cleared (along with the other staging columns) once
    // finalizeBookExtraction() runs.
    ocrAttemptCounts: jsonb("ocrAttemptCounts").$type<Record<string, number>>(),
    extractionError: text("extractionError"),
    extractionAttemptCount: integer("extractionAttemptCount")
      .default(0)
      .notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userCreatedIdx: index("books_user_id_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

// "processing"/"retrying" added for the QStash queue migration — additive
// only, "analyzing" stays a legacy value (see mirrorBatchStatusEnum above
// for the same reasoning).
export const bookChapterStatusEnum = pgEnum("book_chapter_status", [
  "pending",
  "analyzing",
  "complete",
  "failed",
  "processing",
  "retrying",
]);

export const bookChapters = pgTable(
  "book_chapters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookId: uuid("bookId")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    orderIndex: integer("orderIndex").notNull(),
    title: text("title").notNull(),
    startPage: integer("startPage").notNull(),
    endPage: integer("endPage").notNull(),
    status: bookChapterStatusEnum("status").default("pending").notNull(),
    // This chapter's own slice of extracted page text, stored at plan time so
    // the analyze route never has to re-fetch/re-parse the whole book PDF.
    pageTexts: jsonb("pageTexts").$type<{ page: number; text: string }[]>(),
    explanationAr: text("explanationAr"),
    explanationEn: text("explanationEn"),
    keyPoints: jsonb("keyPoints").$type<string[]>(),
    chapterSummary: text("chapterSummary"),
    // Last failure reason, when status is "failed" — surfaced with a retry
    // button rather than leaving the chapter stuck silently.
    errorMessage: text("errorMessage"),
    // Queue-worker bookkeeping (QStash migration) — same role as
    // mirrorBatches' equivalent columns above.
    attemptCount: integer("attemptCount").default(0).notNull(),
    lastStartedAt: timestamp("lastStartedAt", { withTimezone: true }),
    lastCompletedAt: timestamp("lastCompletedAt", { withTimezone: true }),
    lastErrorAt: timestamp("lastErrorAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    bookOrderIdx: index("book_chapters_book_id_order_index_idx").on(
      table.bookId,
      table.orderIndex
    ),
    statusIdx: index("book_chapters_status_idx").on(table.status),
  })
);

// ── كتبي visual content (images/diagrams/tables/screenshots) ─────────────
// Additive to كتبي only — a page's full-resolution screenshot is captured
// independently of whether its text was extractable (see
// app/api/books/analyze-page-visuals/route.ts), so a fully-scanned or
// all-image page still gets a real book_pages row instead of being treated
// as empty. bookCards/bookMcqs are NOT modified — their sourcePage→visual
// linkage is computed at read time (join through here) rather than stored,
// since visual analysis finishes independently of (and later than) chapter
// analysis; see getChapterContentForUser in lib/db-books.ts.
export const bookPageTextStatusEnum = pgEnum("book_page_text_status", [
  "pending",
  "complete",
  "failed",
]);
export const bookPageVisualStatusEnum = pgEnum("book_page_visual_status", [
  "pending",
  "processing",
  "complete",
  "needs_review",
  "failed",
]);
export const bookVisualAssetTypeEnum = pgEnum("book_visual_asset_type", [
  "image",
  "diagram",
  "table",
  "screenshot",
  "chart",
]);
export const bookVisualConfidenceEnum = pgEnum("book_visual_confidence", [
  "high",
  "medium",
  "low",
]);
export const bookVisualReviewStatusEnum = pgEnum("book_visual_review_status", [
  "complete",
  "needs_review",
]);

export const bookPages = pgTable(
  "book_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookId: uuid("bookId")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    // Known once detectChapters() runs (same finalizeBookExtraction call
    // that creates these rows) — null only briefly if a chapter is later
    // deleted independently.
    chapterId: uuid("chapterId").references(() => bookChapters.id, {
      onDelete: "set null",
    }),
    pageNumber: integer("pageNumber").notNull(),
    // Full-page screenshot (see lib/pdf-ocr.ts's getScreenshot usage) —
    // never a cropped sub-image; book_visual_assets below reuse this same
    // key rather than a truly cropped one (no image-segmentation capability
    // exists in this pipeline yet).
    storageKey: text("storageKey"),
    previewKey: text("previewKey"),
    extractedText: text("extractedText"),
    textStatus: bookPageTextStatusEnum("textStatus")
      .default("pending")
      .notNull(),
    // Separate from errorMessage below (which is owned by the visual
    // pipeline, see updateBookPageVisualResult) — a page can fail text
    // extraction and later succeed visual analysis (or vice versa)
    // independently, and each pipeline clearing its own error on success
    // must never wipe out the other's.
    textErrorMessage: text("textErrorMessage"),
    visualStatus: bookPageVisualStatusEnum("visualStatus")
      .default("pending")
      .notNull(),
    width: integer("width"),
    height: integer("height"),
    hasImages: boolean("hasImages").default(false).notNull(),
    hasTables: boolean("hasTables").default(false).notNull(),
    hasDiagrams: boolean("hasDiagrams").default(false).notNull(),
    errorMessage: text("errorMessage"),
    attemptCount: integer("attemptCount").default(0).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    // Prevents a duplicate page row / duplicate preview generation for the
    // same (book, pageNumber) — the finalize step that creates these rows
    // only ever runs once per book, and this is the hard DB-level backstop.
    bookPageUnique: uniqueIndex("book_pages_book_id_page_number_idx").on(
      table.bookId,
      table.pageNumber
    ),
    chapterIdx: index("book_pages_chapter_id_idx").on(table.chapterId),
    visualStatusIdx: index("book_pages_visual_status_idx").on(
      table.visualStatus
    ),
  })
);

export const bookVisualAssets = pgTable(
  "book_visual_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookId: uuid("bookId")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: uuid("chapterId").references(() => bookChapters.id, {
      onDelete: "set null",
    }),
    pageId: uuid("pageId")
      .notNull()
      .references(() => bookPages.id, { onDelete: "cascade" }),
    assetType: bookVisualAssetTypeEnum("assetType").notNull(),
    storageKey: text("storageKey").notNull(),
    previewKey: text("previewKey"),
    altText: text("altText"),
    descriptionAr: text("descriptionAr"),
    descriptionEn: text("descriptionEn"),
    // Reserved for a future real object-detection pass — never populated by
    // the current page-level vision analysis (see plan's explicit note).
    boundingBox: jsonb("boundingBox").$type<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>(),
    sortOrder: integer("sortOrder").default(0).notNull(),
    confidence: bookVisualConfidenceEnum("confidence"),
    reviewStatus: bookVisualReviewStatusEnum("reviewStatus")
      .default("complete")
      .notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    pageIdx: index("book_visual_assets_page_id_idx").on(table.pageId),
    bookIdx: index("book_visual_assets_book_id_idx").on(table.bookId),
  })
);

export type BookPage = typeof bookPages.$inferSelect;
export type BookVisualAsset = typeof bookVisualAssets.$inferSelect;

export const bookTerms = pgTable("book_terms", {
  id: uuid("id").defaultRandom().primaryKey(),
  chapterId: uuid("chapterId")
    .notNull()
    .references(() => bookChapters.id, { onDelete: "cascade" }),
  ar: text("ar").notNull(),
  en: text("en").notNull(),
  pronunciation: text("pronunciation").notNull(),
});

export const bookCards = pgTable(
  "book_cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chapterId: uuid("chapterId")
      .notNull()
      .references(() => bookChapters.id, { onDelete: "cascade" }),
    // Denormalized from chapter->book->userId so "cards due across the whole
    // library" can query this table directly without joining through books.
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionAr: text("questionAr").notNull(),
    questionEn: text("questionEn").notNull(),
    answerAr: text("answerAr").notNull(),
    answerEn: text("answerEn").notNull(),
    relatedTermEn: text("relatedTermEn"),
    sourcePage: integer("sourcePage").notNull(),
    // SRS (SM-2-style) scheduling fields — see lib/srs.ts's applySrsRating().
    easeFactor: real("easeFactor").default(2.5).notNull(),
    intervalDays: integer("intervalDays").default(0).notNull(),
    dueAt: timestamp("dueAt", { withTimezone: true }).defaultNow().notNull(),
    reviewCount: integer("reviewCount").default(0).notNull(),
    lastRating: bookCardRatingEnum("lastRating"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userDueIdx: index("book_cards_user_id_due_at_idx").on(
      table.userId,
      table.dueAt
    ),
    chapterIdx: index("book_cards_chapter_id_idx").on(table.chapterId),
  })
);

export const bookMcqs = pgTable("book_mcqs", {
  id: uuid("id").defaultRandom().primaryKey(),
  chapterId: uuid("chapterId")
    .notNull()
    .references(() => bookChapters.id, { onDelete: "cascade" }),
  questionEn: text("questionEn").notNull(),
  choices: jsonb("choices").$type<string[]>().notNull(),
  correctIndex: integer("correctIndex").notNull(),
  explanationEn: text("explanationEn").notNull(),
  sourcePage: integer("sourcePage").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const bookMcqAttempts = pgTable("book_mcq_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  mcqId: uuid("mcqId")
    .notNull()
    .references(() => bookMcqs.id, { onDelete: "cascade" }),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  selectedIndex: integer("selectedIndex").notNull(),
  isCorrect: boolean("isCorrect").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Append-only SRS rating log — separate from book_cards' own (mutable,
// current-state) SRS fields, because stats (accuracy history, streaks) need
// to query "how many reviews happened on day X", which a field that gets
// overwritten on every rating can never answer.
export const bookReviewEvents = pgTable(
  "book_review_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardId: uuid("cardId")
      .notNull()
      .references(() => bookCards.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: bookCardRatingEnum("rating").notNull(),
    reviewedAt: timestamp("reviewedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userReviewedIdx: index("book_review_events_user_id_reviewed_at_idx").on(
      table.userId,
      table.reviewedAt
    ),
  })
);

export type Book = typeof books.$inferSelect;
export type InsertBook = typeof books.$inferInsert;
export type BookChapter = typeof bookChapters.$inferSelect;
export type InsertBookChapter = typeof bookChapters.$inferInsert;
export type BookTerm = typeof bookTerms.$inferSelect;
export type BookCard = typeof bookCards.$inferSelect;
export type InsertBookCard = typeof bookCards.$inferInsert;
export type BookMcq = typeof bookMcqs.$inferSelect;
export type BookMcqAttempt = typeof bookMcqAttempts.$inferSelect;
export type BookReviewEvent = typeof bookReviewEvents.$inferSelect;

// ── الملاحظات والتظليل (PR4) — كتبي only for now (مِرآة untouched, per the
// standing rule). Starting with "highlight" and "note" only — pen drawing
// is explicitly a later addition per the plan ("ابدأ بالملاحظات النصية
// والتظليل، ثم أضف الرسم بالقلم لاحقاً"). No subjectId column here
// deliberately: it's always derivable via bookId -> books.subjectId, and
// storing it separately would go stale the moment a book moves to another
// subject (see lib/db-subjects.ts's assignBookToSubject) — subject-scoped
// search (lib/db-annotations.ts) joins through books instead.
export const annotationTypeEnum = pgEnum("annotation_type", [
  "highlight",
  "note",
]);

export const annotations = pgTable(
  "annotations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bookId: uuid("bookId")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    pageId: uuid("pageId")
      .notNull()
      .references(() => bookPages.id, { onDelete: "cascade" }),
    type: annotationTypeEnum("type").notNull(),
    // The highlighted text itself, when this annotation came from a
    // selection — null for a plain note typed without selecting anything.
    selectedText: text("selectedText"),
    // Character offsets {start, end} into that page's own extractedText —
    // deliberately NOT pixel/CSS coordinates, so a highlight's position
    // stays valid regardless of screen size, zoom, or font — see the plan's
    // explicit "مستقلة عن حجم الشاشة" requirement. Null for a plain note.
    positionJson: jsonb("positionJson").$type<{
      start: number;
      end: number;
    }>(),
    // The note's own written text. For a highlight-only annotation (no
    // note attached) this can be empty — the highlight's meaning is the
    // selectedText itself.
    content: text("content").notNull().default(""),
    color: text("color"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    pageIdx: index("annotations_page_id_idx").on(table.pageId),
    userBookIdx: index("annotations_user_id_book_id_idx").on(
      table.userId,
      table.bookId
    ),
  })
);

export type Annotation = typeof annotations.$inferSelect;
export type InsertAnnotation = typeof annotations.$inferInsert;

// ── مكتبة الأدمن (Admin Library) — a third, fully independent
// feature/data layer, deliberately not sharing any table with مِرآة
// (decks/cards/mirrorJobs/mirrorBatches) or كتبي (books/bookChapters/
// bookCards). An admin uploads a PDF, it goes through the exact same
// extraction+OCR+generation pipeline مِرآة uses (see lib/db-admin-materials.ts
// and app/api/admin/materials/*), but nothing is ever visible to students
// until the admin explicitly reviews and publishes it — so unlike
// mirrorJobs/books, a material's row is durable and permanently queried
// (there's no "graduation" into a second table): admin_material_cards IS
// the durable content, gated purely by admin_materials.status.
export const adminMaterialStatusEnum = pgEnum("admin_material_status", [
  "draft",
  "processing",
  "ready_for_review",
  "published",
  "archived",
  "failed",
]);
export const adminMaterialBatchStatusEnum = pgEnum(
  "admin_material_batch_status",
  ["pending", "processing", "complete", "failed", "retrying"]
);
// Deliberately a separate enum type from cardConfidenceEnum above (same
// values) — this feature stays isolated even where the domain happens to
// coincide, per the isolation requirement.
export const adminMaterialConfidenceEnum = pgEnum("admin_material_confidence", [
  "high",
  "medium",
  "low",
]);
export const adminMaterialReviewStatusEnum = pgEnum(
  "admin_material_review_status",
  ["pending", "approved", "needs_review"]
);
export const adminMaterialDifficultyEnum = pgEnum("admin_material_difficulty", [
  "easy",
  "medium",
  "hard",
]);

export const adminMaterials = pgTable(
  "admin_materials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerAdminId: uuid("ownerAdminId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: text("fileName").notNull(),
    fileKey: text("fileKey").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    difficulty: adminMaterialDifficultyEnum("difficulty")
      .default("medium")
      .notNull(),
    language: text("language").default("both").notNull(),
    pageCount: integer("pageCount").default(0).notNull(),
    // Snapshot taken once, when the material reaches "ready_for_review" —
    // not kept live during generation (no student is watching it stream in
    // the way مِرآة's review session does; the admin's own progress screen
    // reads live batch/card counts directly instead).
    cardCount: integer("cardCount").default(0).notNull(),
    status: adminMaterialStatusEnum("status").default("draft").notNull(),
    // Extraction/OCR staging — identical role to mirrorJobs' equivalent
    // columns (see that table's comment above).
    pageTexts:
      jsonb("pageTexts").$type<
        { page: number; text: string; hasText: boolean }[]
      >(),
    pagesNeedingOcr: jsonb("pagesNeedingOcr").$type<number[]>(),
    ocrFailedPages: jsonb("ocrFailedPages").$type<number[]>(),
    extractionError: text("extractionError"),
    extractionAttemptCount: integer("extractionAttemptCount")
      .default(0)
      .notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp("publishedAt", { withTimezone: true }),
    archivedAt: timestamp("archivedAt", { withTimezone: true }),
  },
  table => ({
    statusIdx: index("admin_materials_status_idx").on(table.status),
    ownerCreatedIdx: index("admin_materials_owner_admin_id_created_at_idx").on(
      table.ownerAdminId,
      table.createdAt
    ),
    categoryIdx: index("admin_materials_category_idx").on(table.category),
  })
);

export const adminMaterialBatches = pgTable(
  "admin_material_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    materialId: uuid("materialId")
      .notNull()
      .references(() => adminMaterials.id, { onDelete: "cascade" }),
    batchIndex: integer("batchIndex").notNull(),
    startPage: integer("startPage").notNull(),
    endPage: integer("endPage").notNull(),
    pageTexts:
      jsonb("pageTexts").$type<
        { page: number; text: string; hasText: boolean }[]
      >(),
    status: adminMaterialBatchStatusEnum("status").default("pending").notNull(),
    errorMessage: text("errorMessage"),
    attemptCount: integer("attemptCount").default(0).notNull(),
    lastStartedAt: timestamp("lastStartedAt", { withTimezone: true }),
    lastCompletedAt: timestamp("lastCompletedAt", { withTimezone: true }),
    lastErrorAt: timestamp("lastErrorAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    materialOrderIdx: index(
      "admin_material_batches_material_id_batch_index_idx"
    ).on(table.materialId, table.batchIndex),
    statusIdx: index("admin_material_batches_status_idx").on(table.status),
  })
);

export const adminMaterialCards = pgTable(
  "admin_material_cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    materialId: uuid("materialId")
      .notNull()
      .references(() => adminMaterials.id, { onDelete: "cascade" }),
    batchId: uuid("batchId")
      .notNull()
      .references(() => adminMaterialBatches.id, { onDelete: "cascade" }),
    questionEn: text("questionEn").notNull(),
    questionAr: text("questionAr").notNull(),
    answerEn: text("answerEn").notNull(),
    answerAr: text("answerAr").notNull(),
    explanationEn: text("explanationEn").notNull(),
    explanationAr: text("explanationAr").notNull(),
    keyIdeaEn: text("keyIdeaEn").notNull(),
    keyIdeaAr: text("keyIdeaAr").notNull(),
    keywordEn: text("keywordEn").notNull(),
    keywordAr: text("keywordAr").notNull(),
    sourcePage: integer("sourcePage").notNull(),
    confidence: adminMaterialConfidenceEnum("confidence").notNull(),
    reviewStatus: adminMaterialReviewStatusEnum("reviewStatus")
      .default("pending")
      .notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    materialSourcePageIdx: index(
      "admin_material_cards_material_id_source_page_idx"
    ).on(table.materialId, table.sourcePage),
    reviewStatusIdx: index("admin_material_cards_review_status_idx").on(
      table.reviewStatus
    ),
  })
);

// Per-(student, card) SRS state — unlike مِرآة's `cards`/كتبي's `bookCards`
// (each row already owned by exactly one user), admin_material_cards are
// shared read-only content across every student, so the spaced-repetition
// schedule can't live on the card itself and instead lives in this junction
// table, one row per student per card they've reviewed at least once.
export const adminMaterialReviews = pgTable(
  "admin_material_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    materialCardId: uuid("materialCardId")
      .notNull()
      .references(() => adminMaterialCards.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    easeFactor: real("easeFactor").default(2.5).notNull(),
    intervalDays: integer("intervalDays").default(0).notNull(),
    dueAt: timestamp("dueAt", { withTimezone: true }).defaultNow().notNull(),
    reviewCount: integer("reviewCount").default(0).notNull(),
    lastRating: bookCardRatingEnum("lastRating"),
    lastReviewedAt: timestamp("lastReviewedAt", { withTimezone: true }),
  },
  table => ({
    // Upserted on every rating — a student can only ever have one SRS state
    // row per card.
    userCardUnique: uniqueIndex(
      "admin_material_reviews_user_id_card_id_idx"
    ).on(table.userId, table.materialCardId),
    userDueIdx: index("admin_material_reviews_user_id_due_at_idx").on(
      table.userId,
      table.dueAt
    ),
  })
);

// Audit trail for admin actions — deliberately NOT foreign-keyed to
// adminMaterials/users (see column comments): an audit log's job is to
// outlive the rows it describes, not enforce referential integrity against
// them. Also doubles as the source for "material opened"/"students who
// used this material" stats via action="view_material" rows, rather than
// adding a separate views table.
export const adminMaterialAuditLogs = pgTable(
  "admin_material_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Plain uuid columns, no .references() — see table comment above.
    materialId: uuid("materialId"),
    actorUserId: uuid("actorUserId"),
    action: text("action").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: text("ipAddress"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    materialIdx: index("admin_material_audit_logs_material_id_idx").on(
      table.materialId
    ),
    actorIdx: index("admin_material_audit_logs_actor_user_id_idx").on(
      table.actorUserId
    ),
    createdAtIdx: index("admin_material_audit_logs_created_at_idx").on(
      table.createdAt
    ),
  })
);

export type AdminMaterial = typeof adminMaterials.$inferSelect;
export type AdminMaterialBatch = typeof adminMaterialBatches.$inferSelect;
export type AdminMaterialCard = typeof adminMaterialCards.$inferSelect;
export type AdminMaterialReview = typeof adminMaterialReviews.$inferSelect;
export type AdminMaterialAuditLog = typeof adminMaterialAuditLogs.$inferSelect;

// ── المحادثة مع المصادر (PR5) — retrieval is keyword/full-text search
// (Postgres to_tsvector/plainto_tsquery over book_pages.extractedText,
// see lib/rag.ts) scoped by whichever of subjectId/bookId/chapterId/pageId
// is set, NOT embedding-based semantic search. Deliberately so: this repo
// has no pgvector extension and no confirmed-available embedding model in
// production, and standing up that infra (extension, a vector column, a
// backfill-embedding job) is a bigger, riskier addition than one PR
// warrants. lib/ai/types.ts's AiProvider.embed() already exists for a
// later upgrade once pgvector availability on the production DB is
// confirmed — this table's shape doesn't need to change for that (only
// lib/rag.ts's retrieval query would).
// No separate "chunks" table: book_pages already carries bookId/chapterId/
// pageNumber on every row, which is exactly the metadata a chunk would
// need — indexing at page granularity reuses it directly.
export const chatScopeEnum = pgEnum("chat_scope", [
  "page",
  "chapter",
  "book",
  "subject",
]);

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: chatScopeEnum("scope").notNull(),
    // Exactly one of these is authoritative per `scope` (see comment
    // above) — the others are left null. All nullable + onDelete cascade
    // since a session is worthless once its one real target is gone.
    subjectId: uuid("subjectId").references(() => subjects.id, {
      onDelete: "cascade",
    }),
    bookId: uuid("bookId").references(() => books.id, { onDelete: "cascade" }),
    chapterId: uuid("chapterId").references(() => bookChapters.id, {
      onDelete: "cascade",
    }),
    pageId: uuid("pageId").references(() => bookPages.id, {
      onDelete: "cascade",
    }),
    // First user message, truncated — a human-readable label when a
    // student has more than one session in the same scope over time.
    title: text("title"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userCreatedIdx: index("chat_sessions_user_id_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

export const chatMessageRoleEnum = pgEnum("chat_message_role", [
  "user",
  "assistant",
]);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("sessionId")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: chatMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    // Which (bookId, pageNumber) excerpts were actually fed to the model
    // for this assistant reply — "إظهار المصدر ورقم الصفحة مع الإجابة".
    // Null for a user message, and null/empty for an assistant reply that
    // found no evidence (see lib/rag.ts) — never populated with a guess.
    citedPages:
      jsonb("citedPages").$type<{ bookId: string; pageNumber: number }[]>(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    sessionCreatedIdx: index("chat_messages_session_id_created_at_idx").on(
      table.sessionId,
      table.createdAt
    ),
  })
);

export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
