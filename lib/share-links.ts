// 🔗 Sharing a file by link.
//
// A student shares one of their files — a question file or a study book —
// as a link to the bot (t.me/<bot>?start=sh_<code>). Whoever opens it gets
// an ACCEPTED book_shares row: the same access a share by username gives
// (lib/book-access.ts for books, lib/question-file-access.ts for question
// files), over the SAME single copy. Nothing is copied or re-processed for
// a classmate, so a share costs no AI work; each classmate's answers and
// progress are their own.
//
// What a link can and cannot do:
//   - only the owner can make one, and only for a file that is ready and
//     is not a doctor's protected set;
//   - the code is random; knowing a file's id is not enough;
//   - the owner can stop it: new joins end AND everyone who joined through
//     it loses access at once. A new link can be made afterwards, unless an
//     admin stopped it;
//   - a classmate the owner removed or blocked cannot come back through it;
//   - a classmate can only study: every write that changes the file itself
//     stays owner-only in the routers, exactly as for shares by username.
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  bookShareEvents,
  bookShares,
  books,
  fileShareLinks,
  questionSets,
  userBlocks,
  users,
} from "../drizzle/schema";
import { requireDb } from "./db";
import { isUniqueViolation } from "./db-errors";
import { telegramBotUsername } from "./telegram/config";

export const SHARE_PREFIX = "sh_";
// 16 characters of a 31-letter alphabet: ~79 bits. Unambiguous when retyped.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 16;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export type SharedKind = "question_file" | "book";

function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

// The share code inside a /start payload, or null.
export function parseShareCode(payload: string | undefined): string | null {
  if (!payload?.startsWith(SHARE_PREFIX)) return null;
  const code = payload.slice(SHARE_PREFIX.length).toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function shareLinkUrl(code: string): string | null {
  const bot = telegramBotUsername();
  return bot ? `https://t.me/${bot}?start=${SHARE_PREFIX}${code}` : null;
}

const kindOf = (sourceType: string): SharedKind =>
  sourceType === "question_file" ? "question_file" : "book";

export type ShareLinkOutcome =
  | { ok: true; code: string; joinCount: number }
  | {
      ok: false;
      reason: "not_found" | "not_ready" | "protected" | "stopped_by_admin";
    };

// The owner's file, when it can be shared at all.
async function shareableFile(ownerId: string, bookId: string) {
  const [book] = await requireDb()
    .select({
      id: books.id,
      status: books.status,
      sourceType: books.sourceType,
      // Written with explicit table names: a select from ONE table renders
      // columns unqualified, and a bare "id" inside the subquery would mean
      // question_sets.id — the check would then never be true.
      protectedSet: sql<boolean>`exists (
        select 1 from "question_sets" qs where qs."bookId" = "books"."id"
      )`,
    })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, ownerId)))
    .limit(1);
  return book ?? null;
}

// The file's live link, made on first use. Idempotent: asking again returns
// the same code, so a link already sent to classmates keeps working.
export async function getOrCreateShareLink(
  ownerId: string,
  bookId: string
): Promise<ShareLinkOutcome> {
  const db = requireDb();
  const book = await shareableFile(ownerId, bookId);
  if (!book) return { ok: false, reason: "not_found" };
  if (book.protectedSet) return { ok: false, reason: "protected" };
  // Nothing to study yet (still being read), or nothing at all (failed).
  if (book.status === "extracting" || book.status === "failed") {
    return { ok: false, reason: "not_ready" };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const [live] = await db
      .select({
        code: fileShareLinks.code,
        joinCount: fileShareLinks.joinCount,
      })
      .from(fileShareLinks)
      .where(
        and(eq(fileShareLinks.bookId, bookId), isNull(fileShareLinks.revokedAt))
      )
      .limit(1);
    if (live) return { ok: true, ...live };

    const [stopped] = await db
      .select({ id: fileShareLinks.id })
      .from(fileShareLinks)
      .where(
        and(
          eq(fileShareLinks.bookId, bookId),
          eq(fileShareLinks.revokedBy, "admin")
        )
      )
      .limit(1);
    if (stopped) return { ok: false, reason: "stopped_by_admin" };

    try {
      const [created] = await db
        .insert(fileShareLinks)
        .values({ bookId, ownerId, code: newCode() })
        .returning({ code: fileShareLinks.code });
      return { ok: true, code: created.code, joinCount: 0 };
    } catch (error) {
      // Two requests at once (the live-link index), or a code collision:
      // read again.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Could not create a share link");
}

// Stops a link and withdraws everyone who joined through it. `by` "admin"
// also prevents a new link for that file.
async function stopLink(linkId: string, by: "owner" | "admin", actorId: string) {
  const db = requireDb();
  await db.transaction(async tx => {
    await tx
      .update(fileShareLinks)
      .set({ revokedAt: new Date(), revokedBy: by })
      .where(eq(fileShareLinks.id, linkId));
    const withdrawn = await tx
      .update(bookShares)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(
        and(eq(bookShares.linkId, linkId), eq(bookShares.status, "accepted"))
      )
      .returning({ id: bookShares.id });
    if (withdrawn.length) {
      await tx.insert(bookShareEvents).values(
        withdrawn.map(share => ({
          shareId: share.id,
          actorId,
          event: by === "admin" ? "link_stopped_by_admin" : "link_revoked",
        }))
      );
    }
  });
}

// The owner stops sharing a file. False when there was no live link.
export async function revokeShareLink(
  ownerId: string,
  bookId: string
): Promise<boolean> {
  const [link] = await requireDb()
    .select({ id: fileShareLinks.id })
    .from(fileShareLinks)
    .where(
      and(
        eq(fileShareLinks.bookId, bookId),
        eq(fileShareLinks.ownerId, ownerId),
        isNull(fileShareLinks.revokedAt)
      )
    )
    .limit(1);
  if (!link) return false;
  await stopLink(link.id, "owner", ownerId);
  return true;
}

export async function adminStopShareLink(
  adminId: string,
  linkId: string
): Promise<boolean> {
  const [link] = await requireDb()
    .select({ id: fileShareLinks.id })
    .from(fileShareLinks)
    .where(eq(fileShareLinks.id, linkId))
    .limit(1);
  if (!link) return false;
  await stopLink(link.id, "admin", adminId);
  return true;
}

export type JoinOutcome =
  | {
      ok: true;
      bookId: string;
      kind: SharedKind;
      title: string;
      ownerId: string;
      ownerName: string | null;
      // "own": the person opening the link owns the file.
      role: "own" | "joined" | "already";
      // How many classmates have joined, this one included — only on
      // "joined", for telling the owner.
      joinCount?: number;
    }
  | { ok: false; reason: "invalid" | "refused" };

// Someone opened a share link. Gives them access (once) and says what the
// file is. "refused" = the owner removed or blocked this student before;
// they are told the same thing as for a dead link.
export async function joinByShareLink(
  code: string,
  userId: string
): Promise<JoinOutcome> {
  if (!CODE_PATTERN.test(code)) return { ok: false, reason: "invalid" };
  const db = requireDb();
  const [link] = await db
    .select({
      id: fileShareLinks.id,
      bookId: books.id,
      title: books.fileName,
      status: books.status,
      sourceType: books.sourceType,
      ownerId: books.userId,
      ownerName: users.name,
      ownerSuspended: users.suspendedAt,
      protectedSet: sql<boolean>`exists (
        select 1 from ${questionSets} where ${questionSets.bookId} = ${books.id}
      )`,
    })
    .from(fileShareLinks)
    .innerJoin(books, eq(books.id, fileShareLinks.bookId))
    .innerJoin(users, eq(users.id, books.userId))
    .where(and(eq(fileShareLinks.code, code), isNull(fileShareLinks.revokedAt)))
    .limit(1);
  if (
    !link ||
    link.ownerSuspended ||
    link.protectedSet ||
    link.status === "failed"
  ) {
    return { ok: false, reason: "invalid" };
  }
  const file = {
    bookId: link.bookId,
    kind: kindOf(link.sourceType),
    title: link.title,
    ownerId: link.ownerId,
    ownerName: link.ownerName,
  };
  if (link.ownerId === userId) return { ok: true, ...file, role: "own" };

  const [blocked] = await db
    .select({ blockerId: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      and(
        eq(userBlocks.blockerId, link.ownerId),
        eq(userBlocks.blockedId, userId)
      )
    )
    .limit(1);
  if (blocked) return { ok: false, reason: "refused" };

  const [previous] = await db
    .select({ id: bookShares.id, status: bookShares.status })
    .from(bookShares)
    .where(
      and(eq(bookShares.bookId, link.bookId), eq(bookShares.recipientId, userId))
    )
    .orderBy(desc(bookShares.createdAt))
    .limit(1);
  if (previous?.status === "accepted") {
    return { ok: true, ...file, role: "already" };
  }
  // The owner took this student's access away themselves (by username):
  // the link does not hand it back. A share ended by stopping a link is
  // different — that student may join the file's next link.
  if (previous?.status === "revoked") {
    const [personal] = await db
      .select({ id: bookShareEvents.id })
      .from(bookShareEvents)
      .where(
        and(
          eq(bookShareEvents.shareId, previous.id),
          eq(bookShareEvents.event, "access_revoked")
        )
      )
      .limit(1);
    if (personal) return { ok: false, reason: "refused" };
  }

  let joinCount = 0;
  try {
    await db.transaction(async tx => {
      const now = new Date();
      // A request by username still waiting for an answer: the link is the
      // answer.
      const upgraded =
        previous?.status === "pending"
          ? await tx
              .update(bookShares)
              .set({
                status: "accepted",
                linkId: link.id,
                respondedAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  eq(bookShares.id, previous.id),
                  eq(bookShares.status, "pending")
                )
              )
              .returning({ id: bookShares.id })
          : [];
      const [share] = upgraded.length
        ? upgraded
        : await tx
            .insert(bookShares)
            .values({
              bookId: link.bookId,
              ownerId: link.ownerId,
              recipientId: userId,
              linkId: link.id,
              status: "accepted",
              respondedAt: now,
            })
            .returning({ id: bookShares.id });
      await tx.insert(bookShareEvents).values({
        shareId: share.id,
        actorId: userId,
        event: "joined_by_link",
      });
      const [counted] = await tx
        .update(fileShareLinks)
        .set({ joinCount: sql`${fileShareLinks.joinCount} + 1` })
        .where(eq(fileShareLinks.id, link.id))
        .returning({ joinCount: fileShareLinks.joinCount });
      joinCount = counted?.joinCount ?? 0;
    });
  } catch (error) {
    // The same student tapping the link twice at once: the other request
    // created the share.
    if (!isUniqueViolation(error)) throw error;
    return { ok: true, ...file, role: "already" };
  }
  return { ok: true, ...file, role: "joined", joinCount };
}

// A classmate reports a file shared with them. Once per student per file;
// the count is what an admin sees. False when they hold no share of it.
export async function reportSharedFile(
  userId: string,
  bookId: string
): Promise<boolean> {
  const db = requireDb();
  const [share] = await db
    .select({ id: bookShares.id, linkId: bookShares.linkId })
    .from(bookShares)
    .where(
      and(
        eq(bookShares.bookId, bookId),
        eq(bookShares.recipientId, userId),
        eq(bookShares.status, "accepted")
      )
    )
    .limit(1);
  if (!share) return false;
  const [already] = await db
    .select({ id: bookShareEvents.id })
    .from(bookShareEvents)
    .where(
      and(
        eq(bookShareEvents.shareId, share.id),
        eq(bookShareEvents.event, "reported")
      )
    )
    .limit(1);
  if (already) return true;
  await db.transaction(async tx => {
    await tx
      .insert(bookShareEvents)
      .values({ shareId: share.id, actorId: userId, event: "reported" });
    if (share.linkId) {
      await tx
        .update(fileShareLinks)
        .set({
          reportCount: sql`${fileShareLinks.reportCount} + 1`,
          lastReportedAt: new Date(),
        })
        .where(eq(fileShareLinks.id, share.linkId));
    }
  });
  return true;
}

// Admin: links that students reported, most reported first. The file's
// name and the owner's display name — what an admin needs to judge it.
export async function listReportedShareLinks() {
  return requireDb()
    .select({
      linkId: fileShareLinks.id,
      bookId: fileShareLinks.bookId,
      title: books.fileName,
      sourceType: books.sourceType,
      ownerName: users.name,
      joinCount: fileShareLinks.joinCount,
      reportCount: fileShareLinks.reportCount,
      lastReportedAt: fileShareLinks.lastReportedAt,
      revokedAt: fileShareLinks.revokedAt,
      revokedBy: fileShareLinks.revokedBy,
    })
    .from(fileShareLinks)
    .innerJoin(books, eq(books.id, fileShareLinks.bookId))
    .innerJoin(users, eq(users.id, fileShareLinks.ownerId))
    .where(gt(fileShareLinks.reportCount, 0))
    .orderBy(desc(fileShareLinks.reportCount))
    .limit(100);
}

// The owner's view of one file's sharing: is there a live link, and how
// many joined through it.
export async function shareLinkStatus(ownerId: string, bookId: string) {
  const [link] = await requireDb()
    .select({
      code: fileShareLinks.code,
      joinCount: fileShareLinks.joinCount,
    })
    .from(fileShareLinks)
    .where(
      and(
        eq(fileShareLinks.bookId, bookId),
        eq(fileShareLinks.ownerId, ownerId),
        isNull(fileShareLinks.revokedAt)
      )
    )
    .limit(1);
  return link ?? null;
}

// Who owns the file behind a live link (null for a dead one) — read before
// the join so a brand-new student can be credited to that classmate.
export async function shareLinkOwnerId(code: string): Promise<string | null> {
  if (!CODE_PATTERN.test(code)) return null;
  const [link] = await requireDb()
    .select({ ownerId: fileShareLinks.ownerId })
    .from(fileShareLinks)
    .where(and(eq(fileShareLinks.code, code), isNull(fileShareLinks.revokedAt)))
    .limit(1);
  return link?.ownerId ?? null;
}

// Files shared with this student that they can open now, newest first —
// for the bot's "ملفاتي".
export async function listSharedFilesForUser(userId: string, limit = 6) {
  return requireDb()
    .select({
      bookId: books.id,
      fileName: books.fileName,
      sourceType: books.sourceType,
    })
    .from(bookShares)
    .innerJoin(books, eq(books.id, bookShares.bookId))
    .where(
      and(
        eq(bookShares.recipientId, userId),
        eq(bookShares.status, "accepted"),
        sql`not exists (
          select 1 from ${questionSets} where ${questionSets.bookId} = ${books.id}
        )`
      )
    )
    .orderBy(desc(bookShares.respondedAt))
    .limit(limit);
}

// The owner hears about classmates joining at these counts only — the
// first one, then widening steps — never a message per classmate.
const JOIN_MILESTONES = [1, 3, 5, 10, 25, 50, 100, 250, 500, 1000];
export const isJoinMilestone = (joinCount: number) =>
  JOIN_MILESTONES.includes(joinCount);
