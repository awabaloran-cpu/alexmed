// 📝 Who may ask for a summary, and the job row behind each one
// (file_summaries). Owner's rules (2026-10-09):
//   - a registered account only — a Telegram guest is asked to create one;
//   - the free plan: one summary a day, from a file of at most 40 pages;
//   - a paid plan: more a day, and longer files.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { books, fileSummaries } from "../../drizzle/schema";
import { getUserPlan } from "../billing/entitlement";
import { billingTimeZone, periodKeys } from "../billing/periods";
import { requireDb } from "../db";
import { isTelegramGuest } from "../telegram/accounts";
import { readPdfSource, readSummarySource } from "./source";
import type { SummarySection, SummaryStyle, SummaryTheme } from "./types";

function readInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type SummaryLimits = { daily: number; maxPages: number };

export function summaryLimits(planId: string): SummaryLimits {
  return planId === "free"
    ? {
        daily: readInt("SUMMARY_FREE_DAILY", 1),
        maxPages: readInt("SUMMARY_FREE_MAX_PAGES", 40),
      }
    : {
        daily: readInt("SUMMARY_PAID_DAILY", 10),
        maxPages: readInt("SUMMARY_PAID_MAX_PAGES", 150),
      };
}

export type SummaryRefusal =
  | { reason: "guest" }
  | { reason: "not_found" }
  | { reason: "not_ready" }
  | { reason: "empty" }
  | { reason: "in_progress" }
  | { reason: "too_long"; pages: number; limit: number; paid: boolean }
  | { reason: "daily_limit"; limit: number; paid: boolean };

// Pure: the decision, once the facts are known.
export function decideSummary(facts: {
  guest: boolean;
  planId: string;
  pages: number;
  madeToday: number;
  inProgress: boolean;
}): SummaryRefusal | null {
  if (facts.guest) return { reason: "guest" };
  if (facts.pages <= 0) return { reason: "empty" };
  if (facts.inProgress) return { reason: "in_progress" };
  const limits = summaryLimits(facts.planId);
  const paid = facts.planId !== "free";
  if (facts.pages > limits.maxPages) {
    return {
      reason: "too_long",
      pages: facts.pages,
      limit: limits.maxPages,
      paid,
    };
  }
  if (facts.madeToday >= limits.daily) {
    return { reason: "daily_limit", limit: limits.daily, paid };
  }
  return null;
}

export type SummaryRow = typeof fileSummaries.$inferSelect;

// Creates the job, or says why not. The source is one of the student's own
// finished files (bookId), or a PDF they sent only to be summarised (file —
// the caller has checked it is theirs). Two presses make one summary.
export async function requestSummary(input: {
  userId: string;
  bookId?: string;
  file?: { key: string; name: string };
  telegramAccountId: string | null;
  style: SummaryStyle;
  theme: SummaryTheme;
  now?: Date;
}): Promise<
  { ok: true; summary: SummaryRow } | ({ ok: false } & SummaryRefusal)
> {
  const db = requireDb();
  let pages;
  if (input.bookId) {
    const [book] = await db
      .select({
        id: books.id,
        status: books.status,
        sourceType: books.sourceType,
      })
      .from(books)
      .where(and(eq(books.id, input.bookId), eq(books.userId, input.userId)))
      .limit(1);
    if (!book) return { ok: false, reason: "not_found" };
    if (book.status === "extracting" || book.status === "failed") {
      return { ok: false, reason: "not_ready" };
    }
    pages = await readSummarySource(book);
  } else if (input.file) {
    pages = await readPdfSource(input.file.key);
  } else {
    return { ok: false, reason: "not_found" };
  }
  const day = periodKeys(input.now).day;
  const zone = billingTimeZone();
  const mine = await db
    .select({
      status: fileSummaries.status,
      bookId: fileSummaries.bookId,
      sourceKey: fileSummaries.sourceKey,
    })
    .from(fileSummaries)
    .where(
      and(
        eq(fileSummaries.userId, input.userId),
        ne(fileSummaries.status, "failed"),
        sql`to_char(${fileSummaries.createdAt} at time zone ${zone}, 'YYYY-MM-DD') = ${day}`
      )
    );
  const refusal = decideSummary({
    guest: await isTelegramGuest(input.userId),
    planId: (await getUserPlan(input.userId)).id,
    pages: pages.length,
    madeToday: mine.length,
    inProgress: mine.some(
      row =>
        (input.bookId
          ? row.bookId === input.bookId
          : row.sourceKey === input.file?.key) &&
        (row.status === "queued" || row.status === "processing")
    ),
  });
  if (refusal) return { ok: false, ...refusal };

  const [summary] = await db
    .insert(fileSummaries)
    .values({
      userId: input.userId,
      bookId: input.bookId ?? null,
      sourceKey: input.bookId ? null : (input.file?.key ?? null),
      sourceName: input.bookId ? null : (input.file?.name ?? null),
      telegramAccountId: input.telegramAccountId,
      style: input.style,
      theme: input.theme,
      sourcePages: pages.length,
    })
    .returning();
  return { ok: true, summary };
}

export async function getSummary(id: string): Promise<SummaryRow | null> {
  const [row] = await requireDb()
    .select()
    .from(fileSummaries)
    .where(eq(fileSummaries.id, id))
    .limit(1);
  return row ?? null;
}

// One worker run at a time takes the job (the queue also serialises them);
// a finished or failed job is never taken again.
export async function claimSummary(id: string): Promise<SummaryRow | null> {
  const [row] = await requireDb()
    .update(fileSummaries)
    .set({
      status: "processing",
      attemptCount: sql`${fileSummaries.attemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(fileSummaries.id, id),
        inArray(fileSummaries.status, ["queued", "processing"])
      )
    )
    .returning();
  return row ?? null;
}

// Progress made: the sections written so far and how far into the source.
// A run that got somewhere starts the attempt count again.
export async function saveSummaryProgress(
  id: string,
  parts: SummarySection[],
  donePages: number
): Promise<void> {
  await requireDb()
    .update(fileSummaries)
    .set({ parts, donePages, attemptCount: 0, updatedAt: new Date() })
    .where(eq(fileSummaries.id, id));
}

export async function setSummaryStatusMessage(
  id: string,
  messageId: number
): Promise<void> {
  await requireDb()
    .update(fileSummaries)
    .set({ statusMessageId: messageId })
    .where(eq(fileSummaries.id, id));
}

export async function completeSummary(
  id: string,
  result: { title: string; fileKey: string; parts: SummarySection[] }
): Promise<void> {
  await requireDb()
    .update(fileSummaries)
    .set({ ...result, status: "complete", error: null, updatedAt: new Date() })
    .where(eq(fileSummaries.id, id));
}

// A failed summary does not count against the day.
export async function failSummary(id: string, error: string): Promise<void> {
  await requireDb()
    .update(fileSummaries)
    .set({
      status: "failed",
      error: error.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(fileSummaries.id, id));
}
