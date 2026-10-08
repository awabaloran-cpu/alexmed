// 📤 Study Pack sharing — usernames & search, share requests, access
// management, notifications and the audit trail. Authorization for READING
// shared content lives in lib/book-access.ts; this file owns the share
// lifecycle: pending → accepted | declined, accepted → revoked | removed.
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  bookCards,
  bookChapters,
  bookMcqs,
  bookShareEvents,
  bookShares,
  books,
  examFocusDecks,
  notifications,
  userBlocks,
  users,
} from "../drizzle/schema";
import { getDb, requireDb } from "./db";

export type SharingErrorCode =
  | "NOT_FOUND"
  | "SELF_SHARE"
  | "ALREADY_PENDING"
  | "ALREADY_SHARED"
  | "RECENTLY_DECLINED"
  | "BLOCKED"
  | "NOT_READY"
  | "USERNAME_TAKEN"
  | "INVALID_USERNAME"
  | "RATE_LIMITED";

export class SharingError extends Error {
  constructor(
    public code: SharingErrorCode,
    message: string
  ) {
    super(message);
  }
}

// ── Usernames ────────────────────────────────────────────────────────────
// 3–24 chars, lowercase a–z / 0–9 / "." / "_", starting with a letter or
// digit. Stored normalised so search and uniqueness are case-insensitive.
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{2,23}$/;

export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

export function validateUsername(input: string): string | null {
  const value = normalizeUsername(input);
  if (!USERNAME_PATTERN.test(value)) return null;
  if (/[._]{2}/.test(value)) return null;
  return value;
}

export async function setUsername(userId: string, input: string) {
  const username = validateUsername(input);
  if (!username) {
    throw new SharingError(
      "INVALID_USERNAME",
      "اسم المستخدم من 3 إلى 24 حرفًا: أحرف إنجليزية صغيرة وأرقام و . و _"
    );
  }
  const db = requireDb();
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), ne(users.id, userId)))
    .limit(1);
  if (taken) {
    throw new SharingError("USERNAME_TAKEN", "اسم المستخدم محجوز، جرّب غيره.");
  }
  try {
    await db
      .update(users)
      .set({ username, updatedAt: new Date() })
      .where(eq(users.id, userId));
  } catch {
    // Unique index race with another student picking it at the same time.
    throw new SharingError("USERNAME_TAKEN", "اسم المستخدم محجوز، جرّب غيره.");
  }
  return username;
}

export async function getSharingProfile(userId: string) {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ username: users.username, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

// ── Search ───────────────────────────────────────────────────────────────
export const SEARCH_PAGE_SIZE = 10;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

// Only discoverable students (who chose a username), never the searcher,
// never suspended accounts, never anyone in a block with the searcher.
// Matches username prefix or display-name substring, case-insensitive.
// Returns public profile fields only — never email or anything else.
export async function searchStudents(
  viewerId: string,
  rawQuery: string,
  offset = 0,
  limit = SEARCH_PAGE_SIZE
) {
  const q = normalizeUsername(rawQuery);
  if (q.length < 2) return { items: [], nextOffset: null as number | null };
  const db = getDb();
  if (!db) return { items: [], nextOffset: null as number | null };
  const like = escapeLike(q);
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      image: users.image,
    })
    .from(users)
    .where(
      and(
        isNotNull(users.username),
        ne(users.id, viewerId),
        isNull(users.suspendedAt),
        or(
          sql`${users.username} like ${`${like}%`}`,
          sql`lower(coalesce(${users.name}, '')) like ${`%${like}%`}`
        ),
        sql`not exists (
          select 1 from ${userBlocks}
          where (${userBlocks.blockerId} = ${viewerId} and ${userBlocks.blockedId} = ${users.id})
             or (${userBlocks.blockerId} = ${users.id} and ${userBlocks.blockedId} = ${viewerId})
        )`
      )
    )
    // Exact username first, then username prefix, then name matches.
    .orderBy(
      sql`case when ${users.username} = ${q} then 0 when ${users.username} like ${`${like}%`} then 1 else 2 end`,
      asc(users.username)
    )
    .offset(offset)
    .limit(limit + 1);
  const items = rows.slice(0, limit).map(row => ({
    id: row.id,
    username: row.username as string,
    name: row.name,
    image: row.image,
  }));
  return {
    items,
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}

// ── Contents of a Study Pack (what's already generated) ──────────────────
export type PackContents = {
  chapters: number;
  flashcards: number;
  questions: number;
  examFocus: number | null;
};

export async function getPackContents(
  bookIds: string[]
): Promise<Map<string, PackContents>> {
  const result = new Map<string, PackContents>();
  const db = getDb();
  if (!db || !bookIds.length) return result;
  const [chapters, cards, mcqs, decks] = await Promise.all([
    db
      .select({ bookId: bookChapters.bookId, n: count() })
      .from(bookChapters)
      .where(
        and(
          inArray(bookChapters.bookId, bookIds),
          eq(bookChapters.status, "complete")
        )
      )
      .groupBy(bookChapters.bookId),
    db
      .select({ bookId: bookChapters.bookId, n: count() })
      .from(bookCards)
      .innerJoin(bookChapters, eq(bookChapters.id, bookCards.chapterId))
      .where(inArray(bookChapters.bookId, bookIds))
      .groupBy(bookChapters.bookId),
    db
      .select({ bookId: bookChapters.bookId, n: count() })
      .from(bookMcqs)
      .innerJoin(bookChapters, eq(bookChapters.id, bookMcqs.chapterId))
      .where(inArray(bookChapters.bookId, bookIds))
      .groupBy(bookChapters.bookId),
    db
      .select({
        bookId: examFocusDecks.bookId,
        totalCards: examFocusDecks.totalCards,
        status: examFocusDecks.status,
      })
      .from(examFocusDecks)
      .where(inArray(examFocusDecks.bookId, bookIds)),
  ]);
  const num = (rows: { bookId: string; n: number }[], id: string) =>
    Number(rows.find(row => row.bookId === id)?.n ?? 0);
  for (const id of bookIds) {
    const deck = decks.find(d => d.bookId === id);
    result.set(id, {
      chapters: num(chapters, id),
      flashcards: num(cards, id),
      questions: num(mcqs, id),
      examFocus:
        deck && (deck.status === "complete" || deck.status === "partial_failed")
          ? deck.totalCards
          : null,
    });
  }
  return result;
}

// ── Notifications & audit ────────────────────────────────────────────────
type Tx = Parameters<
  Parameters<ReturnType<typeof requireDb>["transaction"]>[0]
>[0];

async function notify(
  tx: Tx,
  userId: string,
  type: string,
  actorId: string,
  data: Record<string, unknown>
) {
  await tx.insert(notifications).values({ userId, type, actorId, data });
}

async function audit(tx: Tx, shareId: string, actorId: string, event: string) {
  await tx.insert(bookShareEvents).values({ shareId, actorId, event });
}

export async function listNotifications(userId: string, limit = 30) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      data: notifications.data,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorName: users.name,
      actorUsername: users.username,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnreadNotifications(userId: string) {
  const db = getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}

export async function markNotificationsRead(userId: string) {
  const db = requireDb();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

// ── Share request rules (pure, unit-tested) ──────────────────────────────
// After a decline, the same owner can ask the same student again only
// after this long — enough to stop repeat nagging, short enough for "oops,
// I tapped decline".
export const RESEND_AFTER_DECLINE_MS = 24 * 60 * 60 * 1000;
// Anti-spam: at most this many share requests per sender per hour.
export const MAX_REQUESTS_PER_HOUR = 30;

export type ShareRequestState = {
  ownerId: string;
  recipientId: string;
  blocked: boolean;
  liveStatus: "pending" | "accepted" | null;
  lastDeclinedAt: Date | null;
  now: Date;
};

// The first rule a request breaks, or null when it may be created.
export function checkShareRequest(
  state: ShareRequestState
): SharingErrorCode | null {
  if (state.ownerId === state.recipientId) return "SELF_SHARE";
  if (state.blocked) return "BLOCKED";
  if (state.liveStatus === "pending") return "ALREADY_PENDING";
  if (state.liveStatus === "accepted") return "ALREADY_SHARED";
  if (
    state.lastDeclinedAt &&
    state.now.getTime() - state.lastDeclinedAt.getTime() <
      RESEND_AFTER_DECLINE_MS
  ) {
    return "RECENTLY_DECLINED";
  }
  return null;
}

export function shareRequestMessage(
  code: SharingErrorCode,
  recipientLabel: string
): string {
  switch (code) {
    case "SELF_SHARE":
      return "لا يمكنك مشاركة الملف مع نفسك.";
    case "BLOCKED":
      return "لا يمكن المشاركة مع هذا الطالب.";
    case "ALREADY_PENDING":
      return "الطلب مُرسل بالفعل وبانتظار الرد.";
    case "ALREADY_SHARED":
      return `${recipientLabel} لديه وصول لهذا الملف بالفعل.`;
    case "RECENTLY_DECLINED":
      return "رفض الطالب هذا الطلب مؤخرًا، يمكنك إعادة الإرسال بعد 24 ساعة.";
    case "NOT_READY":
      return "انتظر اكتمال قراءة الملف قبل مشاركته.";
    case "RATE_LIMITED":
      return "أرسلت طلبات كثيرة خلال وقت قصير، حاول بعد قليل.";
    default:
      return "تعذّر إرسال الطلب.";
  }
}

// ── Share requests ───────────────────────────────────────────────────────
export async function createShareRequest(
  ownerId: string,
  bookId: string,
  recipientId: string
) {
  if (ownerId === recipientId) {
    throw new SharingError("SELF_SHARE", shareRequestMessage("SELF_SHARE", ""));
  }
  const db = requireDb();
  return db.transaction(async tx => {
    const [book] = await tx
      .select({ id: books.id, fileName: books.fileName, status: books.status })
      .from(books)
      .where(
        and(
          eq(books.id, bookId),
          eq(books.userId, ownerId),
          eq(books.sourceType, "study_book")
        )
      )
      .limit(1);
    if (!book) throw new SharingError("NOT_FOUND", "الملف غير موجود.");
    if (
      book.status === "extracting" ||
      book.status === "pending" ||
      book.status === "failed"
    ) {
      throw new SharingError("NOT_READY", shareRequestMessage("NOT_READY", ""));
    }
    const [recipient] = await tx
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(eq(users.id, recipientId))
      .limit(1);
    if (!recipient || !recipient.username || recipient.suspendedAt) {
      throw new SharingError("NOT_FOUND", "الطالب غير موجود.");
    }
    const [block] = await tx
      .select({ blockerId: userBlocks.blockerId })
      .from(userBlocks)
      .where(
        or(
          and(
            eq(userBlocks.blockerId, ownerId),
            eq(userBlocks.blockedId, recipientId)
          ),
          and(
            eq(userBlocks.blockerId, recipientId),
            eq(userBlocks.blockedId, ownerId)
          )
        )
      )
      .limit(1);
    const [live] = await tx
      .select({ status: bookShares.status })
      .from(bookShares)
      .where(
        and(
          eq(bookShares.bookId, bookId),
          eq(bookShares.recipientId, recipientId),
          inArray(bookShares.status, ["pending", "accepted"])
        )
      )
      .limit(1);
    const [lastDecline] = await tx
      .select({ respondedAt: bookShares.respondedAt })
      .from(bookShares)
      .where(
        and(
          eq(bookShares.bookId, bookId),
          eq(bookShares.recipientId, recipientId),
          eq(bookShares.status, "declined")
        )
      )
      .orderBy(desc(bookShares.respondedAt))
      .limit(1);
    const [recentRequests] = await tx
      .select({ n: count() })
      .from(bookShares)
      .where(
        and(
          eq(bookShares.ownerId, ownerId),
          gt(bookShares.createdAt, new Date(Date.now() - 60 * 60 * 1000))
        )
      );
    if (Number(recentRequests?.n ?? 0) >= MAX_REQUESTS_PER_HOUR) {
      throw new SharingError(
        "RATE_LIMITED",
        shareRequestMessage("RATE_LIMITED", "")
      );
    }
    const label = recipient.name || `@${recipient.username}`;
    const broken = checkShareRequest({
      ownerId,
      recipientId,
      blocked: Boolean(block),
      liveStatus: (live?.status as "pending" | "accepted" | undefined) ?? null,
      lastDeclinedAt: lastDecline?.respondedAt ?? null,
      now: new Date(),
    });
    if (broken) {
      throw new SharingError(broken, shareRequestMessage(broken, label));
    }
    // The partial unique index is the final race guard: two concurrent
    // requests can't both create a live share.
    const [share] = await tx
      .insert(bookShares)
      .values({ bookId, ownerId, recipientId, status: "pending" })
      .onConflictDoNothing()
      .returning({ id: bookShares.id });
    if (!share) {
      throw new SharingError(
        "ALREADY_PENDING",
        shareRequestMessage("ALREADY_PENDING", label)
      );
    }
    await audit(tx, share.id, ownerId, "request_created");
    await notify(tx, recipientId, "share_request", ownerId, {
      shareId: share.id,
      bookId,
      bookTitle: book.fileName,
    });
    return {
      shareId: share.id,
      recipient: {
        id: recipient.id,
        username: recipient.username,
        name: recipient.name,
      },
    };
  });
}

async function lockShare(tx: Tx, shareId: string) {
  const [share] = await tx
    .select()
    .from(bookShares)
    .where(eq(bookShares.id, shareId))
    .for("update");
  return share ?? null;
}

// Recipient accepts or declines a PENDING request (optionally blocking the
// sender). Accepting only flips a status — no content is copied and no AI
// runs; the recipient reads the owner's existing artifacts.
export async function respondToShare(
  recipientId: string,
  shareId: string,
  decision: "accept" | "decline",
  block = false
) {
  const db = requireDb();
  return db.transaction(async tx => {
    const share = await lockShare(tx, shareId);
    if (!share || share.recipientId !== recipientId) {
      throw new SharingError("NOT_FOUND", "الطلب غير موجود.");
    }
    if (share.status !== "pending") {
      throw new SharingError("NOT_FOUND", "هذا الطلب لم يعد متاحًا.");
    }
    const [book] = await tx
      .select({ fileName: books.fileName })
      .from(books)
      .where(eq(books.id, share.bookId))
      .limit(1);
    const now = new Date();
    const status = decision === "accept" ? "accepted" : "declined";
    await tx
      .update(bookShares)
      .set({ status, respondedAt: now, updatedAt: now })
      .where(eq(bookShares.id, shareId));
    await audit(
      tx,
      shareId,
      recipientId,
      decision === "accept" ? "request_accepted" : "request_declined"
    );
    await notify(
      tx,
      share.ownerId,
      decision === "accept" ? "share_accepted" : "share_declined",
      recipientId,
      { shareId, bookId: share.bookId, bookTitle: book?.fileName ?? "" }
    );
    if (decision === "decline" && block) {
      await tx
        .insert(userBlocks)
        .values({ blockerId: recipientId, blockedId: share.ownerId })
        .onConflictDoNothing();
      await audit(tx, shareId, recipientId, "sender_blocked");
    }
    // The request notification has been answered — mark it read.
    await tx
      .update(notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(notifications.userId, recipientId),
          eq(notifications.type, "share_request"),
          isNull(notifications.readAt),
          sql`${notifications.data}->>'shareId' = ${shareId}`
        )
      );
    return { status, bookId: share.bookId };
  });
}

// Owner withdraws a pending request or revokes an accepted share. Only
// this share row changes — the book, other recipients and the recipient's
// own personal data are untouched.
export async function revokeShare(ownerId: string, shareId: string) {
  const db = requireDb();
  return db.transaction(async tx => {
    const share = await lockShare(tx, shareId);
    if (!share || share.ownerId !== ownerId) {
      throw new SharingError("NOT_FOUND", "المشاركة غير موجودة.");
    }
    if (share.status !== "pending" && share.status !== "accepted") {
      return { status: share.status };
    }
    await tx
      .update(bookShares)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(eq(bookShares.id, shareId));
    await audit(tx, shareId, ownerId, "access_revoked");
    return { status: "revoked" as const };
  });
}

// Recipient removes a shared pack from their own library — only their own
// access ends; the original stays with its owner.
export async function removeSharedFromLibrary(
  recipientId: string,
  bookId: string
) {
  const db = requireDb();
  return db.transaction(async tx => {
    const [share] = await tx
      .select()
      .from(bookShares)
      .where(
        and(
          eq(bookShares.bookId, bookId),
          eq(bookShares.recipientId, recipientId),
          eq(bookShares.status, "accepted")
        )
      )
      .for("update");
    if (!share) throw new SharingError("NOT_FOUND", "المشاركة غير موجودة.");
    await tx
      .update(bookShares)
      .set({ status: "removed", updatedAt: new Date() })
      .where(eq(bookShares.id, share.id));
    await audit(tx, share.id, recipientId, "recipient_removed");
    return { status: "removed" as const };
  });
}

export async function unblockUser(blockerId: string, blockedId: string) {
  const db = requireDb();
  await db
    .delete(userBlocks)
    .where(
      and(
        eq(userBlocks.blockerId, blockerId),
        eq(userBlocks.blockedId, blockedId)
      )
    );
}

export async function listBlockedUsers(blockerId: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({ id: users.id, name: users.name, username: users.username })
    .from(userBlocks)
    .innerJoin(users, eq(users.id, userBlocks.blockedId))
    .where(eq(userBlocks.blockerId, blockerId))
    .orderBy(desc(userBlocks.createdAt));
}

// ── Lists ────────────────────────────────────────────────────────────────
export async function listIncomingRequests(recipientId: string) {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({
      shareId: bookShares.id,
      bookId: bookShares.bookId,
      createdAt: bookShares.createdAt,
      bookTitle: books.fileName,
      pageCount: books.pageCount,
      ownerName: users.name,
      ownerUsername: users.username,
    })
    .from(bookShares)
    .innerJoin(books, eq(books.id, bookShares.bookId))
    .innerJoin(users, eq(users.id, bookShares.ownerId))
    .where(
      and(
        eq(bookShares.recipientId, recipientId),
        eq(bookShares.status, "pending")
      )
    )
    .orderBy(desc(bookShares.createdAt));
  const contents = await getPackContents(rows.map(row => row.bookId));
  return rows.map(row => ({ ...row, contents: contents.get(row.bookId)! }));
}

export async function listSharedWithMe(recipientId: string) {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({
      shareId: bookShares.id,
      bookId: bookShares.bookId,
      sharedAt: bookShares.respondedAt,
      bookTitle: books.fileName,
      pageCount: books.pageCount,
      bookStatus: books.status,
      ownerName: users.name,
      ownerUsername: users.username,
    })
    .from(bookShares)
    .innerJoin(books, eq(books.id, bookShares.bookId))
    .innerJoin(users, eq(users.id, bookShares.ownerId))
    .where(
      and(
        eq(bookShares.recipientId, recipientId),
        eq(bookShares.status, "accepted"),
        // Study books only: a shared QUESTION FILE (lib/share-links.ts) has
        // its own list and its own viewer (questionFiles.sharedWithMe), and
        // every client of this list opens what it returns as a book.
        eq(books.sourceType, "study_book")
      )
    )
    .orderBy(desc(bookShares.respondedAt));
  const contents = await getPackContents(rows.map(row => row.bookId));
  return rows.map(row => ({ ...row, contents: contents.get(row.bookId)! }));
}

// Owner's "👥 Shared With" list for one of their books (live requests and
// shares plus declines, newest first). Null when the caller isn't owner.
export async function listSharesForBook(ownerId: string, bookId: string) {
  const db = getDb();
  if (!db) return null;
  const [book] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, ownerId)))
    .limit(1);
  if (!book) return null;
  return db
    .select({
      shareId: bookShares.id,
      status: bookShares.status,
      createdAt: bookShares.createdAt,
      respondedAt: bookShares.respondedAt,
      recipientName: users.name,
      recipientUsername: users.username,
    })
    .from(bookShares)
    .innerJoin(users, eq(users.id, bookShares.recipientId))
    .where(
      and(
        eq(bookShares.bookId, bookId),
        inArray(bookShares.status, ["pending", "accepted", "declined"])
      )
    )
    .orderBy(desc(bookShares.createdAt));
}

export async function getSharingHomeSummary(userId: string) {
  const db = getDb();
  if (!db) return { pending: 0, unread: 0, recent: [] };
  const [[pendingRow], recent, unread] = await Promise.all([
    db
      .select({ n: count() })
      .from(bookShares)
      .where(
        and(
          eq(bookShares.recipientId, userId),
          eq(bookShares.status, "pending")
        )
      ),
    db
      .select({
        bookId: bookShares.bookId,
        bookTitle: books.fileName,
        ownerName: users.name,
        ownerUsername: users.username,
        sharedAt: bookShares.respondedAt,
      })
      .from(bookShares)
      .innerJoin(books, eq(books.id, bookShares.bookId))
      .innerJoin(users, eq(users.id, bookShares.ownerId))
      .where(
        and(
          eq(bookShares.recipientId, userId),
          eq(bookShares.status, "accepted"),
          eq(books.sourceType, "study_book"),
          gt(
            bookShares.respondedAt,
            new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
          )
        )
      )
      .orderBy(desc(bookShares.respondedAt))
      .limit(3),
    countUnreadNotifications(userId),
  ]);
  return { pending: Number(pendingRow?.n ?? 0), unread, recent };
}
