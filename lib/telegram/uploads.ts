// ✈️ telegram_uploads — one row per PDF sent to the bot: idempotency,
// limits, duplicate detection and the state the queue workers move through.
// Each transition is a single UPDATE with its precondition in the WHERE
// clause (the lib/queue/claim.ts pattern), so a webhook or queue message
// delivered twice can never run a step twice.
import { and, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import {
  books,
  telegramAccounts,
  telegramUploads,
  type TelegramUpload,
} from "../../drizzle/schema";
import { requireDb } from "../db";
import { TELEGRAM_BURST_WINDOW_MINUTES } from "./config";
import type { DocumentKind } from "./detect";

export type UploadStatus =
  | "received"
  | "downloading"
  | "awaiting_kind"
  | "processing"
  | "complete"
  | "failed"
  | "rejected";

// Returns null when this Telegram update was already recorded (a webhook
// retry): the caller must then do nothing at all.
export async function createUpload(input: {
  telegramAccountId: string;
  updateId: number;
  fileId: string;
  fileUniqueId: string;
  fileName: string;
  fileSize: number;
  requestedKind: DocumentKind | null;
}): Promise<TelegramUpload | null> {
  const [row] = await requireDb()
    .insert(telegramUploads)
    .values(input)
    .onConflictDoNothing({ target: telegramUploads.updateId })
    .returning();
  return row ?? null;
}

export async function getUpload(id: string): Promise<TelegramUpload | null> {
  const [row] = await requireDb()
    .select()
    .from(telegramUploads)
    .where(eq(telegramUploads.id, id))
    .limit(1);
  return row ?? null;
}

export async function getUploadForAccount(
  id: string,
  telegramAccountId: string
): Promise<TelegramUpload | null> {
  const [row] = await requireDb()
    .select()
    .from(telegramUploads)
    .where(
      and(
        eq(telegramUploads.id, id),
        eq(telegramUploads.telegramAccountId, telegramAccountId)
      )
    )
    .limit(1);
  return row ?? null;
}

// The upload plus where to reach its owner — what a queue worker needs.
export async function getUploadContext(id: string) {
  const [row] = await requireDb()
    .select({
      upload: telegramUploads,
      chatId: telegramAccounts.chatId,
      userId: telegramAccounts.userId,
      accountId: telegramAccounts.id,
    })
    .from(telegramUploads)
    .innerJoin(
      telegramAccounts,
      eq(telegramAccounts.id, telegramUploads.telegramAccountId)
    )
    .where(eq(telegramUploads.id, id))
    .limit(1);
  return row ?? null;
}

const COUNTED = ne(telegramUploads.status, "rejected");

// Uploads this account had accepted (anything not refused outright).
export async function countAcceptedUploads(
  telegramAccountId: string
): Promise<number> {
  const [row] = await requireDb()
    .select({ value: count() })
    .from(telegramUploads)
    .where(and(eq(telegramUploads.telegramAccountId, telegramAccountId), COUNTED));
  return Number(row?.value ?? 0);
}

export async function countRecentUploads(
  telegramAccountId: string
): Promise<number> {
  const since = new Date(Date.now() - TELEGRAM_BURST_WINDOW_MINUTES * 60_000);
  const [row] = await requireDb()
    .select({ value: count() })
    .from(telegramUploads)
    .where(
      and(
        eq(telegramUploads.telegramAccountId, telegramAccountId),
        gte(telegramUploads.createdAt, since)
      )
    );
  return Number(row?.value ?? 0);
}

// Accepted uploads from everyone in the last 24 hours (the channel's
// global ceiling).
export async function countUploadsLastDay(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [row] = await requireDb()
    .select({ value: count() })
    .from(telegramUploads)
    .where(and(gte(telegramUploads.createdAt, since), COUNTED));
  return Number(row?.value ?? 0);
}

// The same file sent again by the same account, while an earlier copy is
// still being processed or is ready (and its book still exists).
export async function findDuplicateUpload(
  telegramAccountId: string,
  fileUniqueId: string
): Promise<TelegramUpload | null> {
  const [row] = await requireDb()
    .select({ upload: telegramUploads })
    .from(telegramUploads)
    .leftJoin(books, eq(books.id, telegramUploads.bookId))
    .where(
      and(
        eq(telegramUploads.telegramAccountId, telegramAccountId),
        eq(telegramUploads.fileUniqueId, fileUniqueId),
        sql`(
          ${telegramUploads.status} in ('received','downloading','awaiting_kind')
          or (${telegramUploads.status} in ('processing','complete') and ${books.id} is not null)
        )`
      )
    )
    .orderBy(desc(telegramUploads.createdAt))
    .limit(1);
  return row?.upload ?? null;
}

async function transition(
  id: string,
  from: UploadStatus[],
  set: Partial<typeof telegramUploads.$inferInsert>
): Promise<TelegramUpload | null> {
  const [row] = await requireDb()
    .update(telegramUploads)
    .set({ ...set, updatedAt: new Date() })
    .where(
      and(eq(telegramUploads.id, id), inArray(telegramUploads.status, from))
    )
    .returning();
  return row ?? null;
}

// A download stuck this long was a worker that died mid-way; the queue's
// redelivery may take it over.
const STALE_DOWNLOAD_MS = 10 * 60_000;

// received → downloading, exclusively. Null = someone else has it (or it
// is past this step).
export async function claimUploadForIntake(
  id: string
): Promise<TelegramUpload | null> {
  const staleBefore = new Date(Date.now() - STALE_DOWNLOAD_MS);
  const [row] = await requireDb()
    .update(telegramUploads)
    .set({ status: "downloading", updatedAt: new Date() })
    .where(
      and(
        eq(telegramUploads.id, id),
        sql`(
          ${telegramUploads.status} = 'received'
          or (${telegramUploads.status} = 'downloading' and ${telegramUploads.updatedAt} < ${staleBefore})
        )`
      )
    )
    .returning();
  return row ?? null;
}

// downloading → received: the worker failed on something transient and the
// queue will deliver the message again.
export function releaseUploadClaim(id: string) {
  return transition(id, ["downloading"], { status: "received" });
}

export function markUploadAwaitingKind(id: string, fileKey: string) {
  return transition(id, ["downloading"], { status: "awaiting_kind", fileKey });
}

// The student answered "which kind?" — back to `received` with the kind
// fixed, for the intake worker to pick up again.
export function resolveUploadKind(id: string, kind: DocumentKind) {
  return transition(id, ["awaiting_kind"], {
    status: "received",
    kind,
    requestedKind: kind,
  });
}

export function markUploadProcessing(
  id: string,
  input: { bookId: string; kind: DocumentKind; fileKey: string }
) {
  return transition(id, ["downloading"], { status: "processing", ...input });
}

export function markUploadComplete(id: string) {
  return transition(id, ["processing"], { status: "complete", error: null });
}

export function markUploadFailed(id: string, error: string) {
  return transition(
    id,
    ["received", "downloading", "awaiting_kind", "processing"],
    { status: "failed", error: error.slice(0, 500) }
  );
}

export function markUploadRejected(id: string, error: string) {
  return transition(id, ["received", "downloading", "awaiting_kind"], {
    status: "rejected",
    error: error.slice(0, 500),
  });
}

// failed → processing again, after the student asked for a retry of the
// same book.
export function reopenUploadForRetry(id: string) {
  return transition(id, ["failed"], {
    status: "processing",
    error: null,
    watchCount: 0,
    lastStage: null,
  });
}

export async function setUploadStatusMessage(
  id: string,
  statusMessageId: number
): Promise<void> {
  await requireDb()
    .update(telegramUploads)
    .set({ statusMessageId })
    .where(eq(telegramUploads.id, id));
}

// Records the stage last written to the progress message. Returns false
// when it was already this stage (nothing to send).
export async function recordUploadStage(
  id: string,
  stage: string
): Promise<boolean> {
  const updated = await requireDb()
    .update(telegramUploads)
    .set({ lastStage: stage, updatedAt: new Date() })
    .where(
      and(
        eq(telegramUploads.id, id),
        sql`${telegramUploads.lastStage} is distinct from ${stage}`
      )
    )
    .returning({ id: telegramUploads.id });
  return updated.length > 0;
}

export async function bumpWatchCount(id: string): Promise<number> {
  const [row] = await requireDb()
    .update(telegramUploads)
    .set({ watchCount: sql`${telegramUploads.watchCount} + 1` })
    .where(eq(telegramUploads.id, id))
    .returning({ watchCount: telegramUploads.watchCount });
  return row?.watchCount ?? 0;
}

// "ملفاتي" — the account's latest files that still exist.
export async function listRecentFiles(telegramAccountId: string, limit = 8) {
  return requireDb()
    .select({
      uploadId: telegramUploads.id,
      bookId: books.id,
      fileName: books.fileName,
      sourceType: books.sourceType,
      bookStatus: books.status,
    })
    .from(telegramUploads)
    .innerJoin(books, eq(books.id, telegramUploads.bookId))
    .where(eq(telegramUploads.telegramAccountId, telegramAccountId))
    .orderBy(desc(telegramUploads.createdAt))
    .limit(limit);
}
