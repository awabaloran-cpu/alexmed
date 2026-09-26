import { sql } from "drizzle-orm";
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
import type {
  ChapterCoverageManifest,
  PageType,
} from "../lib/document-coverage";
import type { ExamFocusCoverage, ExamFocusFact } from "../lib/exam-focus";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

// Manual plan tracking only — there is no real payment provider wired up
// yet (no Stripe/webhooks). An admin sets this by hand from the admin
// dashboard; it does not gate any feature on its own today, it is just the
// record of what a student is on. planExpiresAt is null for "free" and for
// a premium grant with no set end date.
export const userPlanEnum = pgEnum("user_plan", ["free", "premium"]);

/**
 * Core user table. Shape is a superset of what @auth/drizzle-adapter expects
 * (id/name/email/emailVerified/image) plus our own fields (passwordHash,
 * role). passwordHash is nullable because a Google-only account never sets
 * one — Credentials sign-in must treat a null passwordHash as "no password
 * set" rather than comparing against it.
 */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Nullable since phone sign-up: a phone account has no email. Existing
  // email / Google accounts keep theirs (unique still holds for non-null).
  email: varchar("email", { length: 320 }).unique(),
  // Verified mobile number in E.164 (+9627…) — set only after an SMS code
  // was confirmed (lib/db-phone.ts). Login by phone matches this column.
  phone: varchar("phone", { length: 20 }).unique(),
  phoneVerifiedAt: timestamp("phoneVerifiedAt", { withTimezone: true }),
  passwordHash: text("passwordHash"),
  name: text("name"),
  emailVerified: timestamp("emailVerified", { withTimezone: true }),
  image: text("image"),
  role: userRoleEnum("role").default("user").notNull(),
  plan: userPlanEnum("plan").default("free").notNull(),
  planExpiresAt: timestamp("planExpiresAt", { withTimezone: true }),
  // PR18 — real student profile fields shown/editable on /account. Free-text
  // rather than an enum: "السنة الدراسية"/"التخصص" vary too much across
  // students' actual programs to enumerate meaningfully.
  academicYear: text("academicYear"),
  specialty: text("specialty"),
  // Study Pack sharing — the public handle other students find you by
  // (lib/db-sharing.ts). Stored normalised (lowercase [a-z0-9._]); null =
  // not discoverable. Search never matches or returns email.
  username: varchar("username", { length: 32 }).unique(),
  // Null = active. Set by an admin from the dashboard; checked at sign-in
  // (both Credentials and Google) in lib/auth.ts so a suspended account
  // genuinely cannot use the app, not just cosmetically hidden.
  suspendedAt: timestamp("suspendedAt", { withTimezone: true }),
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

// One row per failed Credentials sign-in attempt — see
// lib/auth-rate-limit.ts, checked before bcrypt.compare in lib/auth.ts's
// authorize(). Nothing else reads these rows; a window naturally "clears"
// once old rows age out of the rate-limit query's time range, so there is
// deliberately no cleanup job. Keyed by the submitted email alone (not a
// real FK to users — an attempt against an email with no account must still
// count, or the limit would leak which emails exist).
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    emailCreatedIdx: index("login_attempts_email_created_at_idx").on(
      table.email,
      table.createdAt
    ),
  })
);

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
// "again" added for FSRS (PR7) — كتبي's bookCards only (see the FSRS columns
// on bookCards below). Purely additive: مِرآة's cards and
// adminMaterialReviews never emit it, so this changes nothing for either.
export const bookCardRatingEnum = pgEnum("book_card_rating", [
  "hard",
  "good",
  "easy",
  "again",
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
    // Nullable, same rationale as books.subjectId above: a ملف أسئلة can
    // exist unassigned, and deleting a subject only unassigns its decks
    // rather than deleting them.
    subjectId: uuid("subjectId").references(() => subjects.id, {
      onDelete: "set null",
    }),
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
    // Which مِرآة job (one upload or one pasted-text submission) produced this
    // card, so a deck can hold several separate additions and the UI can show
    // and filter them apart. Null for cards created before this column existed
    // (treated as the deck's original job) and for decks made by
    // createDeckWithCards; set null if the job row is later deleted.
    jobId: uuid("jobId").references(() => mirrorJobs.id, {
      onDelete: "set null",
    }),
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
    jobIdx: index("cards_job_id_idx").on(table.jobId),
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

// A student's own تضليل/قلم markings on one مِرآة card — one row per
// (user, card) holding the whole set, since the client edits and saves it as
// a unit (see lib/card-marks.ts for the shapes and why positions are
// character offsets / card-width-normalised points rather than pixels).
// Deleting the card or the user cascades the marks away; a row with no
// highlights and no strokes is deleted rather than kept empty.
export const cardMarks = pgTable(
  "card_marks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardId: uuid("cardId")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    highlights: jsonb("highlights")
      .$type<
        {
          id: string;
          field: string;
          start: number;
          end: number;
          color: string;
        }[]
      >()
      .default([])
      .notNull(),
    strokes: jsonb("strokes")
      .$type<
        {
          id: string;
          color: string;
          width: number;
          points: [number, number][];
        }[]
      >()
      .default([])
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userCardUnique: uniqueIndex("card_marks_user_id_card_id_idx").on(
      table.userId,
      table.cardId
    ),
  })
);

export type Deck = typeof decks.$inferSelect;
export type InsertDeck = typeof decks.$inferInsert;
export type CardRow = typeof cards.$inferSelect;
export type InsertCardRow = typeof cards.$inferInsert;
export type CardReviewEvent = typeof cardReviewEvents.$inferSelect;
export type CardMarksRow = typeof cardMarks.$inferSelect;

// كتبي's counterpart to cardMarks above — same تضليل/قلم feature, applied to
// a book's own PDF pages (see lib/pdf-marks.ts) instead of a مِرآة flashcard.
// A highlight here is a set of rects (from the browser's own selection
// getClientRects()) rather than a character range, since PDF text lives in
// pdf.js's own positioned text-layer spans, not one known string per field —
// storing rects is also just how PDF highlight annotations normally work.
export const bookPageMarks = pgTable(
  "book_page_marks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookId: uuid("bookId")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pageNumber: integer("pageNumber").notNull(),
    highlights: jsonb("highlights")
      .$type<
        {
          id: string;
          color: string;
          rects: { x: number; y: number; width: number; height: number }[];
        }[]
      >()
      .default([])
      .notNull(),
    strokes: jsonb("strokes")
      .$type<
        {
          id: string;
          color: string;
          width: number;
          points: [number, number][];
        }[]
      >()
      .default([])
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userBookPageUnique: uniqueIndex(
      "book_page_marks_user_id_book_id_page_number_idx"
    ).on(table.userId, table.bookId, table.pageNumber),
  })
);

export type BookPageMarksRow = typeof bookPageMarks.$inferSelect;

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
    // For a pasted-text job this is the section's display name (the new
    // file's title, or the label of an addition to an existing file).
    fileName: text("fileName").notNull(),
    // Empty string for a pasted-text job — there is no stored file.
    fileKey: text("fileKey").notNull(),
    // Mandatory-folder-on-upload (see components/SubjectPicker.tsx): chosen
    // at upload time, before extraction even starts, then copied onto the
    // real `decks` row once finalizeMirrorJobExtraction() creates it — a PDF
    // job's deck isn't created until extraction finishes, so the choice has
    // to be staged here in the meantime. Nullable only for pre-existing jobs
    // from before this column existed; every new job is required to set it
    // server-side (see app/api/mirror/upload-and-plan).
    subjectId: uuid("subjectId").references(() => subjects.id, {
      onDelete: "set null",
    }),
    // "file" = an uploaded PDF (extract → OCR → generate); "text" = pasted
    // question text, which skips extraction and images entirely and starts
    // straight at generation (see lib/db-mirror.ts's createMirrorTextJob).
    sourceType: text("sourceType").default("file").notNull(),
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

// Multimodal مِرآة — per-page image capture, mirroring كتبي question-files'
// own extractedQuestionImages/questionFilePages pair exactly (see that
// schema's comments for the full rationale). Deliberately NOT a persisted
// card<->image join table: unlike question-files (where every question
// exists up front before association runs), مِرآة's cards are created
// progressively across many separately-timed batches, so persisting the
// association would mean re-running it every time either side changes —
// getDeckWithCards (lib/db.ts) instead computes each card's owning image
// live at read time from this table + the card's own sourcePage, using the
// same page-range rule (image at page P owns cards in [P, nextImagePage)).
export const mirrorImagePageStatusEnum = pgEnum("mirror_image_page_status", [
  "pending",
  "processing",
  "complete",
  "failed",
]);

export const mirrorImagePages = pgTable(
  "mirror_image_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("jobId")
      .notNull()
      .references(() => mirrorJobs.id, { onDelete: "cascade" }),
    pageNumber: integer("pageNumber").notNull(),
    status: mirrorImagePageStatusEnum("status").default("pending").notNull(),
    attemptCount: integer("attemptCount").default(0).notNull(),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    jobPageUnique: uniqueIndex("mirror_image_pages_job_id_page_number_idx").on(
      table.jobId,
      table.pageNumber
    ),
    statusIdx: index("mirror_image_pages_status_idx").on(table.status),
  })
);

export type MirrorImagePage = typeof mirrorImagePages.$inferSelect;

// One row per page confirmed (by vision classification) to contain a real
// figure — not one row per page unconditionally. v1 stores a full-page
// screenshot (no per-figure cropping yet), same architecture note as
// extractedQuestionImages.
export const mirrorPageImages = pgTable(
  "mirror_page_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("jobId")
      .notNull()
      .references(() => mirrorJobs.id, { onDelete: "cascade" }),
    pageNumber: integer("pageNumber").notNull(),
    storageKey: text("storageKey").notNull(),
    // Live-reproduced (2026-09-19): many scanned exam PDFs place a figure at
    // the very bottom of a page, with the question(s) that actually
    // reference it starting on the NEXT page (a mid-explanation page break).
    // The plain "owns every question from its own page onward" rule then
    // attaches the image to the wrong (same-page, unrelated) question and
    // leaves the real one pointing at the wrong figure. True when the page
    // classification call found no question/answer text below the image on
    // its own page — see lib/db.ts's getDeckWithCards owner-selection loop
    // for how this shifts the image's effective ownership to start at
    // pageNumber + 1 instead of pageNumber.
    isAtPageEnd: boolean("isAtPageEnd").default(false).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    jobPageIdx: index("mirror_page_images_job_id_page_number_idx").on(
      table.jobId,
      table.pageNumber
    ),
  })
);

export type MirrorPageImage = typeof mirrorPageImages.$inferSelect;

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

// PR16: distinguishes an uploaded PDF that's a study textbook (the existing
// chapter-detection + AI analysis pipeline, unchanged) from one that's a
// bank of pre-existing questions (a separate, non-AI extraction pipeline —
// see extractedQuestions below). Every pre-existing book backfills to
// "study_book", which is accurate for all of them (question-file upload
// didn't exist before this).
export const bookSourceTypeEnum = pgEnum("book_source_type", [
  "study_book",
  "question_file",
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
    // PR16 — see bookSourceTypeEnum above. "question_file" books skip the
    // whole chapter/AI pipeline below entirely (chapterDetectionMethod,
    // chapterDetectionConfidence, etc. stay null for them).
    sourceType: bookSourceTypeEnum("sourceType")
      .default("study_book")
      .notNull(),
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
    // Audit fix (P0): a long chapter is split into several sub-chunks, each
    // its own sequential AI call within one worker invocation (Vercel's 60s
    // ceiling can't fit more than a couple) — this holds every sub-chunk's
    // completed analysis as it finishes, so a timeout/retry resumes from the
    // next un-processed sub-chunk instead of redoing (and re-paying for) the
    // whole chapter. Cleared back to null once the chapter reaches "complete"
    // — purely transient scaffolding, never read once analysis is done.
    subChunkResults: jsonb("subChunkResults").$type<
      {
        explanationAr: string;
        explanationEn: string;
        keyPoints: string[];
        medicalTerms: { ar: string; en: string; pronunciation: string }[];
        flashcards: {
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
        chapterSummary: string;
      }[]
    >(),
    explanationAr: text("explanationAr"),
    explanationEn: text("explanationEn"),
    keyPoints: jsonb("keyPoints").$type<string[]>(),
    chapterSummary: text("chapterSummary"),
    // Full-document coverage manifest (lib/document-coverage.ts's
    // ChapterCoverageManifest): pages extracted/failed, page types, the
    // chunks every page was placed into, and — per generated output
    // (summary/flashcards/mcqs/mindmap/notes) — which chunks actually
    // produced it plus the COMPLETE/PARTIAL/FAILED Quality Gate verdict.
    // Nullable/additive: chapters analyzed before this existed simply have
    // no manifest until their next generation step writes one.
    coverageManifest:
      jsonb("coverageManifest").$type<ChapterCoverageManifest>(),
    // AI Medical Note Composer output: source-grounded, page-ready medical
    // notes (definition, features, diagnosis, management, red flags, etc.).
    // Kept additive to the existing chapter analysis so cards/MCQs remain
    // untouched and older chapters continue to render normally.
    medicalNotePages: jsonb("medicalNotePages").$type<
      {
        title: string;
        subtitle: string;
        layout: "overview" | "sections" | "comparison" | "algorithm" | "exam";
        sourcePages: number[];
        blocks: {
          kind:
            | "definition"
            | "bullet_group"
            | "alert"
            | "comparison"
            | "algorithm"
            | "image";
          heading: string;
          bodyEn: string;
          bodyAr: string;
          items: string[];
          tone: "default" | "high_yield" | "warning" | "clinical";
          sourcePages: number[];
        }[];
      }[]
    >(),
    // Audit Phase 6 — real hierarchical mind map data: Chapter -> Sections ->
    // Key concepts, each section carrying the real page numbers it came
    // from. Generated lazily (on first mind-map view, one bounded LLM call
    // per chapter — see lib/trpc/booksRouter.ts's generateMindMapSections)
    // from this chapter's OWN already-generated explanationAr/keyPoints —
    // purely reorganizing already-grounded content, never re-reading raw PDF
    // text, so it can never introduce a new fact this chapter didn't already
    // contain. Null until generated; never blocks chapter completion.
    mindMapSections: jsonb("mindMapSections").$type<
      {
        title: string;
        summaryEn: string;
        explanationAr: string;
        sourcePages: number[];
        concepts: {
          termAr: string;
          termEn: string;
          explanationEn: string;
          explanationAr: string;
        }[];
        examPoints: string[];
        cardPrompts: string[];
      }[]
    >(),
    // Audit Phase 7 — connects this chapter's already-written explanation to
    // its real images/diagrams/tables (book_visual_assets), generated
    // lazily AFTER both chapter analysis and page-visual analysis are done
    // (see lib/trpc/booksRouter.ts's generateVisualInsights). Never blocks
    // or reorders the original chapter-analysis pipeline — visual analysis
    // finishes independently of and typically after chapter analysis, so
    // this is a separate, later, additive enrichment rather than a change
    // to explanationAr/explanationEn themselves. Grounded ONLY in this
    // chapter's own already-extracted visual descriptions — never invents
    // what a diagram shows beyond what analyze-page-visuals already wrote.
    // Null until generated (or until there's nothing to generate from).
    visualInsightsAr: text("visualInsightsAr"),
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
    // metadata | educational_content | mixed | unknown — classification
    // ONLY (lib/document-coverage.ts's classifyPageType), never used to drop
    // a page from processing. Null for pages extracted before it existed.
    pageType: text("pageType").$type<PageType>(),
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
    // Legacy SM-2-style fields — see lib/srs.ts's applySrsRating(). No longer
    // written to as of PR7 (rateBookCard now schedules via FSRS below); left
    // in place, unread by any UI (verified before this change), rather than
    // dropped, since dropping a column is harder to undo than leaving one
    // unused.
    easeFactor: real("easeFactor").default(2.5).notNull(),
    intervalDays: integer("intervalDays").default(0).notNull(),
    dueAt: timestamp("dueAt", { withTimezone: true }).defaultNow().notNull(),
    reviewCount: integer("reviewCount").default(0).notNull(),
    lastRating: bookCardRatingEnum("lastRating"),
    // FSRS (PR7) memory-state fields — see lib/fsrs.ts. Both null until the
    // card's first FSRS-scheduled review (distinct from "0", which the
    // reference algorithm uses as its own internal not-yet-reviewed
    // sentinel — a DB column can just say so directly). lastReviewedAt is
    // required to compute elapsed days since the last review, which the
    // retrievability/forgetting-curve formula needs and which the old SM-2
    // fields never had to track explicitly (interval already encoded it).
    fsrsStability: real("fsrsStability"),
    fsrsDifficulty: real("fsrsDifficulty"),
    lastReviewedAt: timestamp("lastReviewedAt", { withTimezone: true }),
    // 🧠 Knowledge-based generation (lib/knowledge-study.ts): the Exam Focus
    // fact (Knowledge Item) this card was derived from, every page that fact
    // cites, and what kind of recall it tests. All null for V1 cards
    // generated straight from page text. SET NULL: regenerating the Exam
    // Focus deck never deletes a student's cards or their review history.
    knowledgeItemId: uuid("knowledgeItemId").references(
      () => examFocusCards.id,
      { onDelete: "set null" }
    ),
    sourcePages: jsonb("sourcePages").$type<number[]>(),
    cardType: text("cardType"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    knowledgeItemIdx: index("book_cards_knowledge_item_id_idx").on(
      table.knowledgeItemId
    ),
    userDueIdx: index("book_cards_user_id_due_at_idx").on(
      table.userId,
      table.dueAt
    ),
    chapterIdx: index("book_cards_chapter_id_idx").on(table.chapterId),
  })
);

// Audit Phase 5 — Question Validation Agent's verdict per MCQ. "pending"
// (default) means no validation pass has run yet — never treated as "known
// good", just "not yet checked". Additive only: existing quiz-taking code
// (submitMcqAttemptForUser, listMcqsForUser) is completely unaffected by an
// MCQ's validation status — see lib/db-books.ts's validateChapterMcqs for
// the only writer of this column.
export const bookMcqValidationStatusEnum = pgEnum(
  "book_mcq_validation_status",
  ["pending", "valid", "flagged"]
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
  validationStatus: bookMcqValidationStatusEnum("validationStatus")
    .default("pending")
    .notNull(),
  // Why it was flagged (wrong correctIndex, ungrounded/hallucinated, exact
  // duplicate of another MCQ in the same chapter, etc.) — null while
  // pending/valid.
  validationNote: text("validationNote"),
  // 🧠 Knowledge-based generation (see bookCards above): the primary Exam
  // Focus fact this question tests, any second fact it contrasts it with
  // (differentiation questions), the pages behind them, and the question
  // type (recall / clinical_vignette / next_best_step / …). Null for V1.
  knowledgeItemId: uuid("knowledgeItemId").references(() => examFocusCards.id, {
    onDelete: "set null",
  }),
  relatedKnowledgeItemIds: jsonb("relatedKnowledgeItemIds").$type<string[]>(),
  sourcePages: jsonb("sourcePages").$type<number[]>(),
  questionType: text("questionType"),
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

// PR16 — questions parsed directly out of an uploaded "question_file" book's
// real text (lib/question-extraction.ts), NEVER generated by an LLM. Kept
// entirely separate from bookMcqs (which IS AI-generated, from study
// chapters) so the two are never conflated in the UI or in a query.
//
// extractedAnswer{Index,Text} reflect ONLY what the source PDF itself states
// (null when the file doesn't give an answer — never guessed). aiInferred
// AnswerIndex is a deliberately distinct column reserved for a possible
// future AI-assisted-guess feature; it must never be read as if it were
// extractedAnswerIndex, and nothing in this PR ever writes to it.
//
// keywords/aiExplanationAr/ai{Status,Error,AttemptCount} below are that
// "future AI-assisted-guess feature" (see lib/question-file-analysis.ts):
// every extracted question — image-bearing or not — is run through
// vision-aware AI once to produce these, same claim/retry-budget pattern as
// bookPages' visualStatus/attemptCount. aiInferredAnswerIndex is only ever
// written when extractedAnswerIndex IS NULL — it must never override a real,
// source-stated answer.
export const extractedQuestionAiStatusEnum = pgEnum(
  "extracted_question_ai_status",
  ["pending", "processing", "complete", "failed"]
);

export const extractedQuestions = pgTable(
  "extracted_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookId: uuid("bookId")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    orderIndex: integer("orderIndex").notNull(),
    questionText: text("questionText").notNull(),
    options: jsonb("options").$type<string[]>(),
    extractedAnswerIndex: integer("extractedAnswerIndex"),
    extractedAnswerText: text("extractedAnswerText"),
    aiInferredAnswerIndex: integer("aiInferredAnswerIndex"),
    explanationText: text("explanationText"),
    sourcePage: integer("sourcePage").notNull(),
    keywords: jsonb("keywords").$type<string[]>(),
    aiExplanationAr: text("aiExplanationAr"),
    aiStatus: extractedQuestionAiStatusEnum("aiStatus")
      .default("pending")
      .notNull(),
    aiError: text("aiError"),
    aiAttemptCount: integer("aiAttemptCount").default(0).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    bookOrderIdx: index("extracted_questions_book_id_order_index_idx").on(
      table.bookId,
      table.orderIndex
    ),
    aiStatusIdx: index("extracted_questions_ai_status_idx").on(table.aiStatus),
  })
);

export type ExtractedQuestion = typeof extractedQuestions.$inferSelect;

// Per-page tracker for question-file image capture/classification (mirrors
// bookPages' visualStatus/attemptCount claim pattern in lib/queue/claim.ts) —
// this is what proves every page of the PDF was actually looked at (never
// silently stops early on a long file), independent of extractedQuestions'
// own per-question aiStatus above.
export const questionFilePageStatusEnum = pgEnum("question_file_page_status", [
  "pending",
  "processing",
  "complete",
  "failed",
]);

export const questionFilePages = pgTable(
  "question_file_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookId: uuid("bookId")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    pageNumber: integer("pageNumber").notNull(),
    status: questionFilePageStatusEnum("status").default("pending").notNull(),
    attemptCount: integer("attemptCount").default(0).notNull(),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    bookPageUnique: uniqueIndex(
      "question_file_pages_book_id_page_number_idx"
    ).on(table.bookId, table.pageNumber),
    statusIdx: index("question_file_pages_status_idx").on(table.status),
  })
);

export type QuestionFilePage = typeof questionFilePages.$inferSelect;

// One row per PDF page confirmed (by vision classification in stage 2 — see
// lib/question-file-analysis.ts) to contain a real figure — NOT one row per
// page unconditionally, unlike bookPages. v1 stores a full-page screenshot
// (no real per-figure cropping yet, per the approved plan's explicit
// architecture note); storageKey is the only field a future cropping pass
// would ever need to change, and one page could then split into multiple
// rows here — no schema redesign required for that later.
export const extractedQuestionImages = pgTable(
  "extracted_question_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookId: uuid("bookId")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    pageNumber: integer("pageNumber").notNull(),
    storageKey: text("storageKey").notNull(),
    // See mirrorPageImages.isAtPageEnd's comment above — same fix, same
    // reason, applied to كتبي's parallel question-files image pipeline.
    isAtPageEnd: boolean("isAtPageEnd").default(false).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    bookPageIdx: index("extracted_question_images_book_id_page_number_idx").on(
      table.bookId,
      table.pageNumber
    ),
  })
);

export type ExtractedQuestionImage =
  typeof extractedQuestionImages.$inferSelect;

// The many-to-many join the user explicitly asked for: "ImageAsset ->
// Questions, not Question -> permanently embedded image". v1's deterministic,
// page-range association pass (lib/question-file-analysis.ts's
// associateImagesWithQuestions) only ever inserts one row per question, but
// nothing here stops a future real-cropping pass from linking one question
// to more than one image.
export const extractedQuestionImageRelations = pgTable(
  "extracted_question_image_relations",
  {
    questionId: uuid("questionId")
      .notNull()
      .references(() => extractedQuestions.id, { onDelete: "cascade" }),
    imageId: uuid("imageId")
      .notNull()
      .references(() => extractedQuestionImages.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.questionId, table.imageId] }),
    imageIdx: index("extracted_question_image_relations_image_id_idx").on(
      table.imageId
    ),
  })
);

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

// ── 🔥 Exam Focus — swipeable high-yield cards built from the WHOLE file
// (lib/exam-focus.ts, app/api/books/exam-focus/*). One deck per book; the
// book is split into units (every page in exactly one unit), each unit is
// its own retryable queue job, and the finalize job turns all units' facts
// into the deduplicated, ordered cards below.
export const examFocusDeckStatusEnum = pgEnum("exam_focus_deck_status", [
  "processing",
  "finalizing",
  "complete",
  "partial_failed",
  "failed",
]);

export const examFocusUnitStatusEnum = pgEnum("exam_focus_unit_status", [
  "pending",
  "processing",
  "retrying",
  "complete",
  "failed",
]);

export const examFocusDecks = pgTable(
  "exam_focus_decks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookId: uuid("bookId")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: examFocusDeckStatusEnum("status").default("processing").notNull(),
    totalPages: integer("totalPages").default(0).notNull(),
    totalUnits: integer("totalUnits").default(0).notNull(),
    totalCards: integer("totalCards").default(0).notNull(),
    // Finalize's verdict (validateExamFocusCoverage) — pages/units covered,
    // failed ranges, duplicates removed. Null until finalized.
    coverage: jsonb("coverage").$type<ExamFocusCoverage>(),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completedAt", { withTimezone: true }),
  },
  table => ({
    // One deck per book: a second "start" (double tap, two tabs) can never
    // create a duplicate generation.
    bookUnique: uniqueIndex("exam_focus_decks_book_id_idx").on(table.bookId),
  })
);

export const examFocusUnits = pgTable(
  "exam_focus_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deckId: uuid("deckId")
      .notNull()
      .references(() => examFocusDecks.id, { onDelete: "cascade" }),
    unitIndex: integer("unitIndex").notNull(),
    pageStart: integer("pageStart").notNull(),
    pageEnd: integer("pageEnd").notNull(),
    // The unit's own slice of page text (+ figure descriptions), fixed at
    // plan time — every retry re-runs exactly the same input.
    pageTexts: jsonb("pageTexts")
      .$type<{ page: number; text: string }[]>()
      .notNull(),
    status: examFocusUnitStatusEnum("status").default("pending").notNull(),
    attemptCount: integer("attemptCount").default(0).notNull(),
    lastStartedAt: timestamp("lastStartedAt", { withTimezone: true }),
    facts: jsonb("facts").$type<ExamFocusFact[]>(),
    declaredEmptyPages: jsonb("declaredEmptyPages").$type<number[]>(),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    deckUnitUnique: uniqueIndex("exam_focus_units_deck_id_unit_index_idx").on(
      table.deckId,
      table.unitIndex
    ),
  })
);

export const examFocusCards = pgTable(
  "exam_focus_cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deckId: uuid("deckId")
      .notNull()
      .references(() => examFocusDecks.id, { onDelete: "cascade" }),
    orderIndex: integer("orderIndex").notNull(),
    category: text("category").notNull(),
    topic: text("topic").default("").notNull(),
    title: text("title").notNull(),
    points: jsonb("points").$type<string[]>().notNull(),
    highlightLabel: text("highlightLabel").default("").notNull(),
    highlightText: text("highlightText").default("").notNull(),
    // Source ambiguity/contradiction the model flagged instead of guessing.
    flag: text("flag").default("").notNull(),
    sourcePages: jsonb("sourcePages").$type<number[]>().notNull(),
    unitIndex: integer("unitIndex").notNull(),
    // Lower-cased title/topic/points/highlight — what deck search matches.
    searchText: text("searchText").notNull(),
    bookmarked: boolean("bookmarked").default(false).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    deckOrderIdx: index("exam_focus_cards_deck_id_order_idx").on(
      table.deckId,
      table.orderIndex
    ),
  })
);

// ── 🧠 Brain Games (lib/brain-games/*, lib/trpc/brainGamesRouter.ts).
// Games themselves are a code registry (their stages are generated), so
// only per-user state lives here: one progress row per (user, game), and
// one session per stage attempt holding the server's copy of the stage
// (questions + answers / puzzle + solution) — the score is always
// recomputed from it, never taken from the client.
export const brainGameSessionStatusEnum = pgEnum("brain_game_session_status", [
  "active",
  "submitted",
  "abandoned",
]);

export type BrainGameStageBest = {
  score: number;
  accuracy: number;
  timeMs: number | null;
};

export const brainGameProgress = pgTable(
  "brain_game_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: text("gameId").notNull(),
    // The stage "Continue" opens: the last one started, or the next one
    // after a pass.
    currentStage: integer("currentStage").default(1).notNull(),
    highestUnlockedStage: integer("highestUnlockedStage").default(1).notNull(),
    completedStages: jsonb("completedStages")
      .$type<number[]>()
      .default([])
      .notNull(),
    bestScore: integer("bestScore").default(0).notNull(),
    totalScore: integer("totalScore").default(0).notNull(),
    totalCorrect: integer("totalCorrect").default(0).notNull(),
    totalWrong: integer("totalWrong").default(0).notNull(),
    totalAttempts: integer("totalAttempts").default(0).notNull(),
    // Quiz games: fastest correct answer · Sudoku: fastest solve.
    bestTimeMs: integer("bestTimeMs"),
    // Consecutive stages passed / best run of correct answers in a stage.
    currentStreak: integer("currentStreak").default(0).notNull(),
    bestStreak: integer("bestStreak").default(0).notNull(),
    stageBests: jsonb("stageBests")
      .$type<Record<string, BrainGameStageBest>>()
      .default({})
      .notNull(),
    // Game-specific stats (e.g. recently seen question ids, hints used).
    stats: jsonb("stats")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    lastPlayedAt: timestamp("lastPlayedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userGameUnique: uniqueIndex("brain_game_progress_user_game_idx").on(
      table.userId,
      table.gameId
    ),
  })
);

export const brainGameSessions = pgTable(
  "brain_game_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: text("gameId").notNull(),
    stage: integer("stage").notNull(),
    status: brainGameSessionStatusEnum("status").default("active").notNull(),
    seed: integer("seed").notNull(),
    // Server-only copy of the stage (includes the answers / solution).
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    // Resume state saved while playing (Sudoku board + notes).
    clientState: jsonb("clientState").$type<Record<string, unknown>>(),
    hintsUsed: integer("hintsUsed").default(0).notNull(),
    startedAt: timestamp("startedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submittedAt", { withTimezone: true }),
    // Stored verdict — a repeated submit returns this instead of scoring
    // twice.
    result: jsonb("result").$type<Record<string, unknown>>(),
    score: integer("score"),
    passed: boolean("passed"),
  },
  table => ({
    userGameStatusIdx: index("brain_game_sessions_user_game_status_idx").on(
      table.userId,
      table.gameId,
      table.status
    ),
  })
);

export type BrainGameProgress = typeof brainGameProgress.$inferSelect;
export type BrainGameSession = typeof brainGameSessions.$inferSelect;

export type ExamFocusDeck = typeof examFocusDecks.$inferSelect;
export type ExamFocusUnit = typeof examFocusUnits.$inferSelect;
export type ExamFocusCard = typeof examFocusCards.$inferSelect;

// ── 📤 Study Pack sharing (lib/book-access.ts, lib/db-sharing.ts). A
// "Study Pack" is an existing كتبي book (books.sourceType = study_book)
// with everything generated from it. Sharing never copies content: a share
// row grants read access to the owner's own rows; every generated artifact
// stays single-copy. Personal state lives in per-user tables below.
export const bookShareStatusEnum = pgEnum("book_share_status", [
  "pending",
  "accepted",
  "declined",
  "revoked",
  "removed",
]);

export const bookShares = pgTable(
  "book_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookId: uuid("bookId")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    ownerId: uuid("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipientId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: bookShareStatusEnum("status").default("pending").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    respondedAt: timestamp("respondedAt", { withTimezone: true }),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    // At most one live (pending or accepted) share per book + recipient —
    // the DB-level guard against duplicate requests / duplicate access.
    liveUnique: uniqueIndex("book_shares_live_book_recipient_idx")
      .on(table.bookId, table.recipientId)
      .where(sql`${table.status} in ('pending', 'accepted')`),
    recipientIdx: index("book_shares_recipient_status_idx").on(
      table.recipientId,
      table.status
    ),
    bookIdx: index("book_shares_book_status_idx").on(
      table.bookId,
      table.status
    ),
  })
);

// Who did what to a share, for debugging/security — ids and the event
// name only, nothing else.
export const bookShareEvents = pgTable(
  "book_share_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shareId: uuid("shareId")
      .notNull()
      .references(() => bookShares.id, { onDelete: "cascade" }),
    actorId: uuid("actorId").references(() => users.id, {
      onDelete: "set null",
    }),
    event: text("event").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    shareIdx: index("book_share_events_share_idx").on(table.shareId),
  })
);

// Generic in-app notifications (type + small JSON payload), so later
// features can add types without new tables.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: uuid("actorId").references(() => users.id, {
      onDelete: "set null",
    }),
    data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
    readAt: timestamp("readAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userCreatedIdx: index("notifications_user_created_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

// A blocked user can't send the blocker share requests (either direction
// is checked). Reporting can hang off the same pair later.
export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerId: uuid("blockerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blockedId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.blockerId, table.blockedId] }),
  })
);

// A recipient's own flashcard review state for a shared book's cards. The
// owner keeps using book_cards' own FSRS columns; a recipient's reviews go
// here, so neither ever changes the other's progress.
export const bookCardProgress = pgTable(
  "book_card_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("cardId")
      .notNull()
      .references(() => bookCards.id, { onDelete: "cascade" }),
    intervalDays: integer("intervalDays").default(0).notNull(),
    dueAt: timestamp("dueAt", { withTimezone: true }).defaultNow().notNull(),
    reviewCount: integer("reviewCount").default(0).notNull(),
    lastRating: bookCardRatingEnum("lastRating"),
    fsrsStability: real("fsrsStability"),
    fsrsDifficulty: real("fsrsDifficulty"),
    lastReviewedAt: timestamp("lastReviewedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userCardUnique: uniqueIndex("book_card_progress_user_card_idx").on(
      table.userId,
      table.cardId
    ),
  })
);

// Exam Focus "راجعها لاحقًا" bookmarks, per user (replaces the single
// exam_focus_cards.bookmarked flag, which a shared deck can't use).
export const examFocusBookmarks = pgTable(
  "exam_focus_bookmarks",
  {
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("cardId")
      .notNull()
      .references(() => examFocusCards.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.userId, table.cardId] }),
  })
);

export type BookShare = typeof bookShares.$inferSelect;
export type Notification = typeof notifications.$inferSelect;

// 📱 One row per SMS verification code sent (Vonage Verify, lib/sms/vonage.ts).
// Drives the send limits (per number and per device), links a confirmed
// number to exactly one account creation (status → consumed), and expires.
// ipHash is a salted SHA-256 of the requester's IP — enough for rate
// limiting, never the raw address.
export const phoneVerifications = pgTable(
  "phone_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phone: varchar("phone", { length: 20 }).notNull(),
    purpose: text("purpose").default("signup").notNull(),
    providerRequestId: text("providerRequestId"),
    // pending → verified → consumed; failed when the code can't be checked
    // any more (too many wrong codes / expired at the provider).
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    ipHash: varchar("ipHash", { length: 64 }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verifiedAt", { withTimezone: true }),
    consumedAt: timestamp("consumedAt", { withTimezone: true }),
  },
  table => ({
    phoneCreatedIdx: index("phone_verifications_phone_created_at_idx").on(
      table.phone,
      table.createdAt
    ),
    ipCreatedIdx: index("phone_verifications_ip_created_at_idx").on(
      table.ipHash,
      table.createdAt
    ),
  })
);
