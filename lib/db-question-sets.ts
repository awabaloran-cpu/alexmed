// 🔒 Protected Doctor Question Sets — data layer.
//
// A set is metadata + an access policy over ONE existing question-file book
// (books.sourceType = question_file). The book goes through the unchanged
// question-file pipeline exactly once; students only ever read what it
// produced (lib/db-question-files.ts's readQuestionFileContent), so no read
// here calls AI or enqueues work.
//
// Every doctor mutation carries `ownerId = <caller>` inside its own UPDATE /
// SELECT, so another doctor's id simply matches nothing — ownership is never
// a separate check that could be skipped.
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  books,
  doctorProfiles,
  questionSetAccessCodes,
  questionSetAuditEvents,
  questionSetEntitlements,
  questionSetRedeemAttempts,
  questionSets,
  users,
} from "../drizzle/schema";
import { getDb, requireDb } from "./db";
import { isUniqueViolation } from "./db-errors";
import { recordQuestionSetEvent } from "./db-question-set-audit";
import {
  CLEARED_OCR_STAGING,
  createQuestionFileShell,
} from "./db-question-files";
import {
  accessCodeHint,
  assertAccessCodeKeyConfigured,
  formatAccessCode,
  generateAccessCode,
  hashAccessCode,
  normalizeAccessCode,
} from "./question-set-codes";
import {
  questionSetDoctorActive,
  questionSetWindowOpen,
} from "./question-set-access";

export type QuestionSetSettings = {
  title: string;
  description?: string | null;
  subjectLabel?: string | null;
  academicYear?: string | null;
  examType?: string | null;
  visibility: "listed" | "unlisted";
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export class QuestionSetWindowError extends Error {
  constructor() {
    super("وقت النهاية يجب أن يكون بعد وقت البداية.");
    this.name = "QuestionSetWindowError";
  }
}

function assertWindow(settings: {
  startsAt?: Date | null;
  endsAt?: Date | null;
}) {
  if (
    settings.startsAt &&
    settings.endsAt &&
    settings.endsAt.getTime() <= settings.startsAt.getTime()
  ) {
    throw new QuestionSetWindowError();
  }
}

function settingsValues(settings: QuestionSetSettings) {
  return {
    title: settings.title,
    description: settings.description || null,
    subjectLabel: settings.subjectLabel || null,
    academicYear: settings.academicYear || null,
    examType: settings.examType || null,
    visibility: settings.visibility,
    startsAt: settings.startsAt ?? null,
    endsAt: settings.endsAt ?? null,
  };
}

// ── Doctor: create / read ───────────────────────────────────────────────

// The book row and the set are created together; the caller then publishes
// the SAME extract_question_file_job the student upload route publishes.
export async function createQuestionSet(
  ownerId: string,
  settings: QuestionSetSettings,
  file: { fileName: string; fileKey: string }
) {
  assertWindow(settings);
  const db = requireDb();
  return db.transaction(async tx => {
    const book = await createQuestionFileShell(
      ownerId,
      { fileName: file.fileName, fileKey: file.fileKey, subjectId: null },
      tx
    );
    const [set] = await tx
      .insert(questionSets)
      .values({ ownerId, bookId: book.id, ...settingsValues(settings) })
      .returning({ id: questionSets.id, bookId: questionSets.bookId });
    await recordQuestionSetEvent(tx, {
      setId: set.id,
      actorId: ownerId,
      event: "created",
    });
    return set;
  });
}

const processingDone = sql<boolean>`(
  ${books.status} = 'complete'
  and exists (select 1 from extracted_questions q where q."bookId" = ${questionSets.bookId} and q."reviewStatus" is distinct from 'needs_review')
  and not exists (select 1 from extracted_questions q where q."bookId" = ${questionSets.bookId} and q."aiStatus" in ('pending', 'processing'))
  and exists (select 1 from question_file_pages p where p."bookId" = ${questionSets.bookId})
  and not exists (select 1 from question_file_pages p where p."bookId" = ${questionSets.bookId} and p.status in ('pending', 'processing'))
)`;

const setSummaryColumns = {
  id: questionSets.id,
  bookId: questionSets.bookId,
  title: questionSets.title,
  description: questionSets.description,
  subjectLabel: questionSets.subjectLabel,
  academicYear: questionSets.academicYear,
  examType: questionSets.examType,
  visibility: questionSets.visibility,
  status: questionSets.status,
  startsAt: questionSets.startsAt,
  endsAt: questionSets.endsAt,
  publishedAt: questionSets.publishedAt,
  disabledAt: questionSets.disabledAt,
  disabledByRole: questionSets.disabledByRole,
  archivedAt: questionSets.archivedAt,
  questionCount: questionSets.questionCount,
  createdAt: questionSets.createdAt,
  updatedAt: questionSets.updatedAt,
  fileName: books.fileName,
  bookStatus: books.status,
  extractionError: books.extractionError,
  processingDone,
  // Questions whose explanation could not be written after every attempt
  // (the doctor may send them round again — resumeDraftProcessing).
  aiFailedCount: sql<number>`(select count(*)::int from extracted_questions q where q."bookId" = ${questionSets.bookId} and q."aiStatus" = 'failed' and q."reviewStatus" is distinct from 'needs_review')`,
  windowOpen: questionSetWindowOpen,
  // Valid questions only; needs-review blocks are counted apart.
  extractedQuestions: sql<number>`(select count(*)::int from extracted_questions q where q."bookId" = ${questionSets.bookId} and q."reviewStatus" is distinct from 'needs_review')`,
  needsReviewCount: sql<number>`(select count(*)::int from extracted_questions q where q."bookId" = ${questionSets.bookId} and q."reviewStatus" is not null)`,
  codesTotal: sql<number>`(select count(*)::int from question_set_access_codes c where c."setId" = ${questionSets.id})`,
  codesClaimed: sql<number>`(select count(*)::int from question_set_access_codes c where c."setId" = ${questionSets.id} and c.status = 'claimed')`,
  activeStudents: sql<number>`(select count(*)::int from question_set_entitlements e where e."setId" = ${questionSets.id} and e.status = 'active')`,
};

export async function listQuestionSetsForOwner(ownerId: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select(setSummaryColumns)
    .from(questionSets)
    .innerJoin(books, eq(books.id, questionSets.bookId))
    .where(eq(questionSets.ownerId, ownerId))
    .orderBy(desc(questionSets.createdAt));
}

export async function getQuestionSetForOwner(ownerId: string, setId: string) {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select(setSummaryColumns)
    .from(questionSets)
    .innerJoin(books, eq(books.id, questionSets.bookId))
    .where(and(eq(questionSets.id, setId), eq(questionSets.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function getDoctorStats(ownerId: string) {
  const db = requireDb();
  const [row] = await db
    .select({
      totalSets: count(),
      published: sql<number>`count(*) filter (where ${questionSets.status} = 'published')::int`,
      disabled: sql<number>`count(*) filter (where ${questionSets.status} = 'disabled')::int`,
      drafts: sql<number>`count(*) filter (where ${questionSets.status} = 'draft')::int`,
      codesTotal: sql<number>`coalesce(sum((select count(*) from question_set_access_codes c where c."setId" = ${questionSets.id})), 0)::int`,
      codesClaimed: sql<number>`coalesce(sum((select count(*) from question_set_access_codes c where c."setId" = ${questionSets.id} and c.status = 'claimed')), 0)::int`,
      activeStudents: sql<number>`coalesce(sum((select count(*) from question_set_entitlements e where e."setId" = ${questionSets.id} and e.status = 'active')), 0)::int`,
    })
    .from(questionSets)
    .where(eq(questionSets.ownerId, ownerId));
  const recent = await db
    .select({
      id: questionSetAuditEvents.id,
      setId: questionSetAuditEvents.setId,
      event: questionSetAuditEvents.event,
      meta: questionSetAuditEvents.meta,
      createdAt: questionSetAuditEvents.createdAt,
      setTitle: questionSets.title,
    })
    .from(questionSetAuditEvents)
    .innerJoin(questionSets, eq(questionSets.id, questionSetAuditEvents.setId))
    .where(eq(questionSets.ownerId, ownerId))
    .orderBy(desc(questionSetAuditEvents.createdAt))
    .limit(15);
  return {
    totalSets: Number(row?.totalSets ?? 0),
    published: Number(row?.published ?? 0),
    disabled: Number(row?.disabled ?? 0),
    drafts: Number(row?.drafts ?? 0),
    codesTotal: Number(row?.codesTotal ?? 0),
    codesClaimed: Number(row?.codesClaimed ?? 0),
    activeStudents: Number(row?.activeStudents ?? 0),
    recent,
  };
}

// ── Doctor: lifecycle ───────────────────────────────────────────────────

// Metadata only — never the book underneath. Archived sets are final.
export async function updateQuestionSetSettings(
  ownerId: string,
  setId: string,
  settings: QuestionSetSettings
): Promise<boolean> {
  assertWindow(settings);
  const db = requireDb();
  const rows = await db
    .update(questionSets)
    .set({ ...settingsValues(settings), updatedAt: new Date() })
    .where(
      and(
        eq(questionSets.id, setId),
        eq(questionSets.ownerId, ownerId),
        inArray(questionSets.status, ["draft", "published", "disabled"])
      )
    )
    .returning({ id: questionSets.id });
  if (!rows.length) return false;
  await recordQuestionSetEvent(db, {
    setId,
    actorId: ownerId,
    event: "settings_updated",
  });
  return true;
}

export type PublishResult =
  | { ok: true; questionCount: number }
  | { ok: false; reason: "not_found" | "not_draft" | "not_ready" };

// One conditional UPDATE: owner, draft, and the question pipeline finished
// with at least one question. After this the book can't be reprocessed or
// deleted (see bookHasPublishedQuestionSet).
export async function publishQuestionSet(
  ownerId: string,
  setId: string
): Promise<PublishResult> {
  const db = requireDb();
  const rows = await db
    .update(questionSets)
    .set({
      status: "published",
      publishedAt: sql`now()`,
      updatedAt: sql`now()`,
      // What students will see: valid questions only.
      questionCount: sql`(select count(*)::int from extracted_questions q where q."bookId" = ${questionSets.bookId} and q."reviewStatus" is distinct from 'needs_review')`,
    })
    .where(
      and(
        eq(questionSets.id, setId),
        eq(questionSets.ownerId, ownerId),
        eq(questionSets.status, "draft"),
        sql`exists (select 1 from books where books.id = ${questionSets.bookId} and books.status = 'complete')`,
        sql`exists (select 1 from extracted_questions q where q."bookId" = ${questionSets.bookId} and q."reviewStatus" is distinct from 'needs_review')`,
        sql`not exists (select 1 from extracted_questions q where q."bookId" = ${questionSets.bookId} and q."aiStatus" in ('pending', 'processing'))`,
        sql`exists (select 1 from question_file_pages p where p."bookId" = ${questionSets.bookId})`,
        sql`not exists (select 1 from question_file_pages p where p."bookId" = ${questionSets.bookId} and p.status in ('pending', 'processing'))`
      )
    )
    .returning({ questionCount: questionSets.questionCount });
  if (rows.length) {
    await recordQuestionSetEvent(db, {
      setId,
      actorId: ownerId,
      event: "published",
      meta: { questions: rows[0].questionCount },
    });
    return { ok: true, questionCount: rows[0].questionCount };
  }
  const existing = await getQuestionSetForOwner(ownerId, setId);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status !== "draft") return { ok: false, reason: "not_draft" };
  return { ok: false, reason: "not_ready" };
}

export type SetActor = { id: string; role: "doctor" | "admin" };

// Kill switch. Entitlements are left untouched: access is decided per
// request from the set's status, so every student stops at once and comes
// back at once on enable. A doctor can't lift an admin's disable.
export async function disableQuestionSet(
  actor: SetActor,
  setId: string
): Promise<boolean> {
  const db = requireDb();
  const rows = await db
    .update(questionSets)
    .set({
      status: "disabled",
      disabledAt: sql`now()`,
      disabledByRole: actor.role,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(questionSets.id, setId),
        eq(questionSets.status, "published"),
        actor.role === "doctor" ? eq(questionSets.ownerId, actor.id) : undefined
      )
    )
    .returning({ id: questionSets.id });
  if (!rows.length) return false;
  await recordQuestionSetEvent(db, {
    setId,
    actorId: actor.id,
    event: actor.role === "admin" ? "admin_disabled" : "disabled",
  });
  return true;
}

export async function enableQuestionSet(
  actor: SetActor,
  setId: string
): Promise<boolean> {
  const db = requireDb();
  const rows = await db
    .update(questionSets)
    .set({
      status: "published",
      disabledAt: null,
      disabledByRole: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(questionSets.id, setId),
        eq(questionSets.status, "disabled"),
        actor.role === "doctor"
          ? and(
              eq(questionSets.ownerId, actor.id),
              eq(questionSets.disabledByRole, "doctor")
            )
          : undefined
      )
    )
    .returning({ id: questionSets.id });
  if (!rows.length) return false;
  await recordQuestionSetEvent(db, {
    setId,
    actorId: actor.id,
    event: actor.role === "admin" ? "admin_enabled" : "enabled",
  });
  return true;
}

// Final: an archived set is never readable by students again, and it (and
// its book) may then be deleted with the doctor's account.
export async function archiveQuestionSet(
  actor: SetActor,
  setId: string
): Promise<boolean> {
  const db = requireDb();
  const rows = await db
    .update(questionSets)
    .set({ status: "archived", archivedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(questionSets.id, setId),
        inArray(questionSets.status, ["draft", "published", "disabled"]),
        actor.role === "doctor" ? eq(questionSets.ownerId, actor.id) : undefined
      )
    )
    .returning({ id: questionSets.id });
  if (!rows.length) return false;
  await recordQuestionSetEvent(db, {
    setId,
    actorId: actor.id,
    event: actor.role === "admin" ? "admin_archived" : "archived",
  });
  return true;
}

// A draft whose extraction failed may be re-run through the same pipeline
// (never a published set — its questions are fixed).
export async function resetDraftProcessing(
  ownerId: string,
  setId: string
): Promise<string | null> {
  const db = requireDb();
  const rows = await db
    .update(books)
    .set({
      status: "extracting",
      extractionError: null,
      ...CLEARED_OCR_STAGING,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(books.status, "failed"),
        eq(books.userId, ownerId),
        sql`exists (select 1 from question_sets qs where qs."bookId" = ${books.id} and qs.id = ${setId} and qs."ownerId" = ${ownerId} and qs.status = 'draft')`
      )
    )
    .returning({ id: books.id });
  return rows[0]?.id ?? null;
}

// ▶️ A draft whose preparation has stopped short — the AI service was down
// for hours, a restart killed the run, or some questions used up their
// attempts — is sent round again. Only what is still owed: a page or a
// question that succeeded is never done twice. Returns what the caller
// must queue, or null when this is not the owner's draft with a read file.
export async function resumeDraftProcessing(
  ownerId: string,
  setId: string
): Promise<{ bookId: string; questions: number; pages: number } | null> {
  const db = requireDb();
  return db.transaction(async tx => {
    const [set] = await tx
      .select({ bookId: questionSets.bookId })
      .from(questionSets)
      .innerJoin(books, eq(books.id, questionSets.bookId))
      .where(
        and(
          eq(questionSets.id, setId),
          eq(questionSets.ownerId, ownerId),
          eq(questionSets.status, "draft"),
          eq(books.status, "complete")
        )
      )
      .limit(1);
    if (!set) return null;
    const questions = await tx.execute<{ id: string }>(sql`
      update "extracted_questions"
      set "aiStatus" = 'pending', "aiAttemptCount" = 0, "aiError" = null
      where "bookId" = ${set.bookId} and "aiStatus" = 'failed'
      returning "id"
    `);
    // A page left "processing" by a run that died counts as owed too.
    const pages = await tx.execute<{ id: string }>(sql`
      update "question_file_pages"
      set "status" = 'pending', "attemptCount" = 0, "errorMessage" = null,
        "updatedAt" = now()
      where "bookId" = ${set.bookId}
        and ("status" = 'failed'
          or ("status" = 'processing' and "updatedAt" < now() - interval '10 minutes'))
      returning "id"
    `);
    return {
      bookId: set.bookId,
      questions: questions.length,
      pages: pages.length,
    };
  });
}

// 🗑️ The doctor uploaded the wrong file: the draft and its file are removed
// whole, whatever state the preparation is in (lib/trpc/doctorRouter.ts
// deletes the file this names; the set goes with it). Every worker looks
// the file up first and stops when it is gone, so nothing more is spent on
// it. Null for a set that was published — students may hold its questions.
export async function draftQuestionSetBook(
  ownerId: string,
  setId: string
): Promise<string | null> {
  const db = requireDb();
  const [set] = await db
    .select({ bookId: questionSets.bookId })
    .from(questionSets)
    .where(
      and(
        eq(questionSets.id, setId),
        eq(questionSets.ownerId, ownerId),
        eq(questionSets.status, "draft")
      )
    )
    .limit(1);
  return set?.bookId ?? null;
}

// 🔔 The draft behind this file has just finished preparing: its doctor is
// told once, in the app's notifications, with the way straight to it.
// Called by the last stage when it finds nothing left to do; a file that is
// not a doctor's draft, or one already announced, is left alone.
export async function notifyDraftReady(bookId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const [set] = await db
      .select({
        id: questionSets.id,
        ownerId: questionSets.ownerId,
        title: questionSets.title,
        done: processingDone,
        needsReview: sql<number>`(select count(*)::int from extracted_questions q where q."bookId" = ${questionSets.bookId} and q."reviewStatus" = 'needs_review')`,
        failed: sql<number>`(select count(*)::int from extracted_questions q where q."bookId" = ${questionSets.bookId} and q."aiStatus" = 'failed' and q."reviewStatus" is distinct from 'needs_review')`,
      })
      .from(questionSets)
      .innerJoin(books, eq(books.id, questionSets.bookId))
      .where(
        and(eq(questionSets.bookId, bookId), eq(questionSets.status, "draft"))
      )
      .limit(1);
    if (!set || !set.done) return false;
    const told = await db.execute<{ id: string }>(sql`
      insert into "notifications" ("userId", "type", "data")
      select ${set.ownerId}, 'question_set_ready', ${JSON.stringify({
        setId: set.id,
        title: set.title,
        needsReview: Number(set.needsReview),
        failed: Number(set.failed),
      })}::jsonb
      where not exists (
        select 1 from "notifications" n
        where n."userId" = ${set.ownerId}
          and n."type" = 'question_set_ready'
          and n."data"->>'setId' = ${set.id}
      )
      returning "id"
    `);
    return told.length > 0;
  } catch (error) {
    if (!isMissingTable(error)) {
      console.error("[QuestionSets] Could not announce a ready draft", error);
    }
    return false;
  }
}

// ── Guards used by existing flows ────────────────────────────────────────

// Postgres "undefined_table": the feature's migration hasn't been applied
// yet, so no set can exist — the guard must not break the existing flow.
function isMissingTable(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if ((current as { code?: string }).code === "42P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

// True while a book backs a set that students have (or had) access to —
// deleting or re-extracting it would destroy their questions.
export async function bookHasPublishedQuestionSet(
  bookId: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const [row] = await db
      .select({ id: questionSets.id })
      .from(questionSets)
      .where(
        and(
          eq(questionSets.bookId, bookId),
          sql`${questionSets.publishedAt} is not null`,
          sql`${questionSets.status} <> 'archived'`
        )
      )
      .limit(1);
    return !!row;
  } catch (error) {
    if (isMissingTable(error)) return false;
    throw error;
  }
}

export async function hasLiveQuestionSets(userId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const [row] = await db
      .select({ id: questionSets.id })
      .from(questionSets)
      .where(
        and(
          eq(questionSets.ownerId, userId),
          sql`${questionSets.publishedAt} is not null`,
          sql`${questionSets.status} <> 'archived'`
        )
      )
      .limit(1);
    return !!row;
  } catch (error) {
    if (isMissingTable(error)) return false;
    throw error;
  }
}

// ── Access codes ─────────────────────────────────────────────────────────

export const MAX_CODES_PER_BATCH = 500;

// Plaintext codes exist only in this return value (shown / exported once by
// the doctor's browser). Stored: HMAC hash + last-4 hint.
export async function generateAccessCodes(
  ownerId: string,
  setId: string,
  howMany: number
): Promise<{ batchId: string; codes: string[] } | null> {
  assertAccessCodeKeyConfigured();
  const total = Math.max(1, Math.min(MAX_CODES_PER_BATCH, Math.floor(howMany)));
  const db = requireDb();
  return db.transaction(async tx => {
    const [set] = await tx
      .select({ id: questionSets.id })
      .from(questionSets)
      .where(
        and(
          eq(questionSets.id, setId),
          eq(questionSets.ownerId, ownerId),
          eq(questionSets.status, "published")
        )
      )
      .for("update")
      .limit(1);
    if (!set) return null;

    const batchId = randomUUID();
    const created: string[] = [];
    // A collision with an existing hash is astronomically unlikely at 60
    // bits, but ON CONFLICT DO NOTHING + topping up makes it harmless.
    for (let round = 0; round < 5 && created.length < total; round++) {
      const wanted = new Map<string, string>();
      while (wanted.size < total - created.length) {
        const code = generateAccessCode();
        wanted.set(hashAccessCode(code), code);
      }
      const inserted = await tx
        .insert(questionSetAccessCodes)
        .values(
          [...wanted].map(([codeHash, code]) => ({
            setId,
            batchId,
            codeHash,
            codeHint: accessCodeHint(code),
          }))
        )
        .onConflictDoNothing({ target: questionSetAccessCodes.codeHash })
        .returning({ codeHash: questionSetAccessCodes.codeHash });
      for (const row of inserted) created.push(wanted.get(row.codeHash)!);
    }
    if (created.length < total) throw new Error("Could not generate codes");

    await recordQuestionSetEvent(tx, {
      setId,
      actorId: ownerId,
      event: "codes_generated",
      targetId: batchId,
      meta: { count: created.length },
    });
    return { batchId, codes: created.map(formatAccessCode) };
  });
}

export async function listAccessCodes(
  ownerId: string,
  setId: string,
  filter: { status?: "unused" | "claimed" | "revoked"; search?: string } = {}
) {
  const db = getDb();
  if (!db) return [];
  const search = (filter.search ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return db
    .select({
      id: questionSetAccessCodes.id,
      batchId: questionSetAccessCodes.batchId,
      hint: questionSetAccessCodes.codeHint,
      status: questionSetAccessCodes.status,
      claimedAt: questionSetAccessCodes.claimedAt,
      revokedAt: questionSetAccessCodes.revokedAt,
      createdAt: questionSetAccessCodes.createdAt,
      studentName: users.name,
      studentUsername: users.username,
    })
    .from(questionSetAccessCodes)
    .innerJoin(questionSets, eq(questionSets.id, questionSetAccessCodes.setId))
    .leftJoin(users, eq(users.id, questionSetAccessCodes.claimedById))
    .where(
      and(
        eq(questionSetAccessCodes.setId, setId),
        eq(questionSets.ownerId, ownerId),
        filter.status
          ? eq(questionSetAccessCodes.status, filter.status)
          : undefined,
        search
          ? sql`(${questionSetAccessCodes.codeHint} ilike ${"%" + search.slice(-4) + "%"} or ${users.username} ilike ${"%" + search.toLowerCase() + "%"})`
          : undefined
      )
    )
    .orderBy(desc(questionSetAccessCodes.createdAt))
    .limit(1000);
}

// Unused codes only — a student's access is revoked through their
// entitlement (revokeStudentAccess), which keeps the history.
export async function revokeAccessCode(
  ownerId: string,
  codeId: string
): Promise<boolean> {
  const db = requireDb();
  const rows = await db
    .update(questionSetAccessCodes)
    .set({ status: "revoked", revokedAt: sql`now()` })
    .where(
      and(
        eq(questionSetAccessCodes.id, codeId),
        eq(questionSetAccessCodes.status, "unused"),
        sql`exists (select 1 from question_sets qs where qs.id = ${questionSetAccessCodes.setId} and qs."ownerId" = ${ownerId})`
      )
    )
    .returning({ setId: questionSetAccessCodes.setId });
  if (!rows.length) return false;
  await recordQuestionSetEvent(db, {
    setId: rows[0].setId,
    actorId: ownerId,
    event: "code_revoked",
    targetId: codeId,
  });
  return true;
}

// ── Redemption ───────────────────────────────────────────────────────────

export class RedeemError extends Error {
  constructor(public readonly kind: "invalid" | "rate_limited") {
    super(kind);
    this.name = "RedeemError";
  }
}

export type RedeemResult = { outcome: "added" | "already"; setId: string };

function readIntEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function redeemLimits() {
  return {
    perUserFailed15Min: readIntEnv(
      "QUESTION_SET_REDEEM_MAX_FAILED_PER_USER",
      5
    ),
    perIpFailedHour: readIntEnv("QUESTION_SET_REDEEM_MAX_FAILED_PER_IP", 20),
  };
}

async function isRedeemRateLimited(
  userId: string,
  ipHash: string | null
): Promise<boolean> {
  const db = requireDb();
  const limits = redeemLimits();
  const [byUser] = await db
    .select({ n: count() })
    .from(questionSetRedeemAttempts)
    .where(
      and(
        eq(questionSetRedeemAttempts.userId, userId),
        eq(questionSetRedeemAttempts.outcome, "invalid"),
        gte(
          questionSetRedeemAttempts.createdAt,
          sql`now() - interval '15 minutes'`
        )
      )
    );
  if (Number(byUser?.n ?? 0) >= limits.perUserFailed15Min) return true;
  if (!ipHash) return false;
  const [byIp] = await db
    .select({ n: count() })
    .from(questionSetRedeemAttempts)
    .where(
      and(
        eq(questionSetRedeemAttempts.ipHash, ipHash),
        eq(questionSetRedeemAttempts.outcome, "invalid"),
        gte(questionSetRedeemAttempts.createdAt, sql`now() - interval '1 hour'`)
      )
    );
  return Number(byIp?.n ?? 0) >= limits.perIpFailedHour;
}

async function recordAttempt(
  userId: string,
  ipHash: string | null,
  outcome: "added" | "already" | "invalid" | "rate_limited"
) {
  const db = requireDb();
  await db.insert(questionSetRedeemAttempts).values({
    userId,
    ipHash,
    outcome: outcome === "added" ? "success" : outcome,
  });
  // Old attempts only feed rate limits for an hour; keep ~30 days for
  // abuse review, pruned opportunistically (no cron needed).
  if (Math.random() < 0.02) {
    await db
      .execute(
        sql`DELETE FROM question_set_redeem_attempts WHERE id IN (
          SELECT id FROM question_set_redeem_attempts
          WHERE "createdAt" < now() - interval '30 days' LIMIT 1000)`
      )
      .catch(error => console.error("[QuestionSets] prune failed", error));
  }
}

// Normalize → HMAC → ONE conditional UPDATE claims the code (first request
// wins; a concurrent second one re-evaluates `status = 'unused'` after the
// row lock and matches nothing) → entitlement → audit, all in one
// transaction. Every failure a student could learn something from is the
// same generic "invalid".
export async function redeemAccessCode(
  userId: string,
  rawCode: string,
  ipHash: string | null
): Promise<RedeemResult> {
  assertAccessCodeKeyConfigured();
  if (await isRedeemRateLimited(userId, ipHash)) {
    await recordAttempt(userId, ipHash, "rate_limited");
    await recordQuestionSetEvent(requireDb(), {
      actorId: userId,
      event: "access_denied_rate_limit",
    });
    throw new RedeemError("rate_limited");
  }
  const normalized = normalizeAccessCode(rawCode);
  if (!normalized) {
    await recordAttempt(userId, ipHash, "invalid");
    throw new RedeemError("invalid");
  }
  const codeHash = hashAccessCode(normalized);
  const db = requireDb();

  let result: RedeemResult | null;
  try {
    result = await db.transaction(async tx => {
      const claimed = await tx
        .update(questionSetAccessCodes)
        .set({ status: "claimed", claimedById: userId, claimedAt: sql`now()` })
        .where(
          and(
            eq(questionSetAccessCodes.codeHash, codeHash),
            eq(questionSetAccessCodes.status, "unused"),
            sql`exists (
              select 1 from question_sets qs
              join users owner on owner.id = qs."ownerId"
              join doctor_profiles d on d."userId" = qs."ownerId"
              where qs.id = ${questionSetAccessCodes.setId}
                and qs.status = 'published'
                and (qs."startsAt" is null or qs."startsAt" <= now())
                and (qs."endsAt" is null or qs."endsAt" > now())
                and d.status = 'approved'
                and owner."suspendedAt" is null
            )`,
            // Already entitled through another code: don't burn this one.
            sql`not exists (
              select 1 from question_set_entitlements e
              where e."setId" = ${questionSetAccessCodes.setId}
                and e."userId" = ${userId}
                and e.status = 'active'
            )`
          )
        )
        .returning({
          id: questionSetAccessCodes.id,
          setId: questionSetAccessCodes.setId,
        });

      if (claimed.length) {
        const { id: codeId, setId } = claimed[0];
        await tx
          .insert(questionSetEntitlements)
          .values({ setId, userId, codeId, source: "code" });
        await recordQuestionSetEvent(tx, {
          setId,
          actorId: userId,
          event: "code_claimed",
          targetId: codeId,
        });
        return { outcome: "added" as const, setId };
      }
      return findExistingAccess(tx, userId, codeHash);
    });
  } catch (error) {
    // The same student redeeming two different codes of one set at the same
    // instant: the partial unique index lets one entitlement through, and
    // this transaction (and its code claim) rolls back.
    if (
      !isUniqueViolation(error, "question_set_entitlements_active_set_user_idx")
    )
      throw error;
    result = await findExistingAccess(db, userId, codeHash);
  }

  if (!result) {
    await recordAttempt(userId, ipHash, "invalid");
    throw new RedeemError("invalid");
  }
  await recordAttempt(userId, ipHash, result.outcome);
  return result;
}

// "This set is already in your account": the code is this student's own
// (claimed by them) or unused while they already hold an active
// entitlement to its set. Anything else is indistinguishable from invalid.
async function findExistingAccess(
  executor: Pick<ReturnType<typeof requireDb>, "select">,
  userId: string,
  codeHash: string
): Promise<RedeemResult | null> {
  const [row] = await executor
    .select({
      setId: questionSetAccessCodes.setId,
      status: questionSetAccessCodes.status,
      claimedById: questionSetAccessCodes.claimedById,
      entitlementId: questionSetEntitlements.id,
    })
    .from(questionSetAccessCodes)
    .leftJoin(
      questionSetEntitlements,
      and(
        eq(questionSetEntitlements.setId, questionSetAccessCodes.setId),
        eq(questionSetEntitlements.userId, userId),
        eq(questionSetEntitlements.status, "active")
      )
    )
    .where(eq(questionSetAccessCodes.codeHash, codeHash))
    .limit(1);
  if (!row || !row.entitlementId) return null;
  const mine =
    (row.status === "claimed" && row.claimedById === userId) ||
    row.status === "unused";
  return mine ? { outcome: "already", setId: row.setId } : null;
}

// ── Student reads ────────────────────────────────────────────────────────

const studentSetColumns = {
  id: questionSets.id,
  title: questionSets.title,
  description: questionSets.description,
  subjectLabel: questionSets.subjectLabel,
  academicYear: questionSets.academicYear,
  examType: questionSets.examType,
  questionCount: questionSets.questionCount,
  startsAt: questionSets.startsAt,
  endsAt: questionSets.endsAt,
  doctorName: doctorProfiles.fullName,
};

// The student's own sets (active entitlements), each with whether it can be
// opened right now. Unavailable sets say only "not started yet" (with its
// date, which the student was given anyway) or "unavailable".
export async function listMyQuestionSets(userId: string) {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({
      ...studentSetColumns,
      grantedAt: questionSetEntitlements.grantedAt,
      published: sql<boolean>`${questionSets.status} = 'published'`,
      windowOpen: questionSetWindowOpen,
      notStarted: sql<boolean>`coalesce(${questionSets.startsAt} > now(), false)`,
      doctorActive: sql<boolean>`coalesce(${questionSetDoctorActive}, false)`,
    })
    .from(questionSetEntitlements)
    .innerJoin(questionSets, eq(questionSets.id, questionSetEntitlements.setId))
    .innerJoin(users, eq(users.id, questionSets.ownerId))
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, questionSets.ownerId))
    .where(
      and(
        eq(questionSetEntitlements.userId, userId),
        eq(questionSetEntitlements.status, "active"),
        sql`${questionSets.status} <> 'archived'`
      )
    )
    .orderBy(desc(questionSetEntitlements.grantedAt));
  return rows.map(
    ({ published, windowOpen, notStarted, doctorActive, ...set }) => {
      const available = published && windowOpen && doctorActive;
      return {
        ...set,
        availability: available
          ? ("available" as const)
          : published && doctorActive && notStarted
            ? ("not_started" as const)
            : ("unavailable" as const),
        startsAt: published && doctorActive && notStarted ? set.startsAt : null,
      };
    }
  );
}

// Listed + published sets for discovery. Metadata only: listing never
// grants access, and no question content is ever part of this.
export async function listQuestionSetCatalog(userId: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      ...studentSetColumns,
      inMyAccount: sql<boolean>`exists (
        select 1 from question_set_entitlements e
        where e."setId" = ${questionSets.id} and e."userId" = ${userId} and e.status = 'active')`,
    })
    .from(questionSets)
    .innerJoin(users, eq(users.id, questionSets.ownerId))
    .innerJoin(doctorProfiles, eq(doctorProfiles.userId, questionSets.ownerId))
    .where(
      and(
        eq(questionSets.visibility, "listed"),
        eq(questionSets.status, "published"),
        sql`(${questionSets.endsAt} is null or ${questionSets.endsAt} > now())`,
        questionSetDoctorActive
      )
    )
    .orderBy(desc(questionSets.publishedAt))
    .limit(100);
}

// Title/description for a set the caller was ALREADY authorized for
// (lib/question-set-access.ts).
export async function getQuestionSetMeta(setId: string) {
  const db = requireDb();
  const [row] = await db
    .select(studentSetColumns)
    .from(questionSets)
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, questionSets.ownerId))
    .where(eq(questionSets.id, setId))
    .limit(1);
  return row ?? null;
}

// What the watermark names: the viewer's public handle (or name) and a
// short tag from their entitlement id, so a leaked screenshot can be traced
// to the account and the grant it came from.
export async function watermarkFor(userId: string, entitlementId: string) {
  const db = requireDb();
  const [row] = await db
    .select({ name: users.name, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const who = row?.username ? `@${row.username}` : row?.name || "NiroLearn";
  const tag = entitlementId.replace(/-/g, "").slice(-4).toUpperCase();
  return `NiroLearn · ${who} · ${tag}`;
}

// ── Doctor: students & audit ─────────────────────────────────────────────

export async function listSetStudents(ownerId: string, setId: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      entitlementId: questionSetEntitlements.id,
      status: questionSetEntitlements.status,
      grantedAt: questionSetEntitlements.grantedAt,
      revokedAt: questionSetEntitlements.revokedAt,
      name: users.name,
      username: users.username,
      codeHint: questionSetAccessCodes.codeHint,
    })
    .from(questionSetEntitlements)
    .innerJoin(questionSets, eq(questionSets.id, questionSetEntitlements.setId))
    .innerJoin(users, eq(users.id, questionSetEntitlements.userId))
    .leftJoin(
      questionSetAccessCodes,
      eq(questionSetAccessCodes.id, questionSetEntitlements.codeId)
    )
    .where(
      and(
        eq(questionSetEntitlements.setId, setId),
        eq(questionSets.ownerId, ownerId)
      )
    )
    .orderBy(desc(questionSetEntitlements.grantedAt))
    .limit(2000);
}

export async function revokeStudentAccess(
  actor: SetActor,
  entitlementId: string
): Promise<boolean> {
  const db = requireDb();
  const rows = await db
    .update(questionSetEntitlements)
    .set({ status: "revoked", revokedAt: sql`now()`, revokedById: actor.id })
    .where(
      and(
        eq(questionSetEntitlements.id, entitlementId),
        eq(questionSetEntitlements.status, "active"),
        actor.role === "doctor"
          ? sql`exists (select 1 from question_sets qs where qs.id = ${questionSetEntitlements.setId} and qs."ownerId" = ${actor.id})`
          : undefined
      )
    )
    .returning({ setId: questionSetEntitlements.setId });
  if (!rows.length) return false;
  await recordQuestionSetEvent(db, {
    setId: rows[0].setId,
    actorId: actor.id,
    event: "student_revoked",
    targetId: entitlementId,
  });
  return true;
}

export async function listSetAudit(ownerId: string | null, setId: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      id: questionSetAuditEvents.id,
      event: questionSetAuditEvents.event,
      meta: questionSetAuditEvents.meta,
      createdAt: questionSetAuditEvents.createdAt,
      actorName: users.name,
      actorUsername: users.username,
    })
    .from(questionSetAuditEvents)
    .innerJoin(questionSets, eq(questionSets.id, questionSetAuditEvents.setId))
    .leftJoin(users, eq(users.id, questionSetAuditEvents.actorId))
    .where(
      and(
        eq(questionSetAuditEvents.setId, setId),
        ownerId ? eq(questionSets.ownerId, ownerId) : undefined
      )
    )
    .orderBy(desc(questionSetAuditEvents.createdAt))
    .limit(200);
}

// ── Admin ────────────────────────────────────────────────────────────────

export async function listQuestionSetsForAdmin() {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      ...setSummaryColumns,
      doctorName: doctorProfiles.fullName,
      doctorStatus: doctorProfiles.status,
      ownerId: questionSets.ownerId,
    })
    .from(questionSets)
    .innerJoin(books, eq(books.id, questionSets.bookId))
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, questionSets.ownerId))
    .orderBy(desc(questionSets.createdAt))
    .limit(500);
}
