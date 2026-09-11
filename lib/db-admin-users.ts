// Data-access layer for the admin dashboard's user management — separate
// from lib/db.ts/lib/db-books.ts (student-facing, always ownership-scoped)
// since every function here is deliberately NOT scoped to a userId: it's
// only ever called from adminProcedure-gated routes (see
// lib/trpc/adminUsersRouter.ts), which is itself gated by role==="admin"
// both server-side (app/admin/layout.tsx) and per-request (adminProcedure).
import { count, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import {
  bookCards,
  bookMcqAttempts,
  books,
  decks,
  subjects,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { deleteBook, listBooksForUser } from "./db-books";
import { deleteDeck, listDecksForUser } from "./db";

export type AdminUserPlan = "free" | "premium";

export async function listUsersForAdmin(params: {
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  if (!db) return { users: [], total: 0 };

  const limit = Math.min(params.limit ?? 25, 100);
  const offset = params.offset ?? 0;
  const search = params.search?.trim();

  const whereClause = search
    ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`))
    : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        plan: users.plan,
        planExpiresAt: users.planExpiresAt,
        suspendedAt: users.suspendedAt,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(users).where(whereClause),
  ]);

  return { users: rows, total: Number(total) };
}

export async function getUserDetailForAdmin(userId: string) {
  const db = getDb();
  if (!db) return null;

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      plan: users.plan,
      planExpiresAt: users.planExpiresAt,
      suspendedAt: users.suspendedAt,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  const [[bookStats], [deckStats], [subjectStats], [mcqStats]] =
    await Promise.all([
      db.select({ total: count() }).from(books).where(eq(books.userId, userId)),
      db.select({ total: count() }).from(decks).where(eq(decks.userId, userId)),
      db
        .select({ total: count() })
        .from(subjects)
        .where(eq(subjects.userId, userId)),
      db
        .select({
          total: count(),
          correct: count(
            sql`case when ${bookMcqAttempts.isCorrect} then 1 end`
          ),
        })
        .from(bookMcqAttempts)
        .where(eq(bookMcqAttempts.userId, userId)),
    ]);

  const [{ total: bookCardCount }] = await db
    .select({ total: count() })
    .from(bookCards)
    .where(eq(bookCards.userId, userId));

  return {
    user,
    stats: {
      bookCount: Number(bookStats.total),
      deckCount: Number(deckStats.total),
      subjectCount: Number(subjectStats.total),
      bookCardCount: Number(bookCardCount),
      mcqAttemptsTotal: Number(mcqStats.total),
      mcqAttemptsCorrect: Number(mcqStats.correct),
    },
  };
}

export async function setUserPlanForAdmin(
  userId: string,
  plan: AdminUserPlan,
  planExpiresAt: Date | null
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(users)
    .set({ plan, planExpiresAt, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function setUserSuspendedForAdmin(
  userId: string,
  suspended: boolean
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(users)
    .set({ suspendedAt: suspended ? new Date() : null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// Permanent, irreversible deletion. Books/decks are deleted individually via
// the same functions the student-facing "delete book/deck" flows use (so
// their S3 cleanup — see lib/db-books.ts's deleteBook — runs identically
// here, not a second, divergent implementation), THEN the user row itself
// cascades away everything else that references it (subjects,
// chat_sessions, annotations, review events, admin_material_reviews — every
// users.id foreign key in drizzle/schema.ts is onDelete: "cascade").
export async function deleteUserForAdmin(userId: string): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const [userBooks, userDecks] = await Promise.all([
    listBooksForUser(userId),
    listDecksForUser(userId),
  ]);

  for (const book of userBooks) {
    await deleteBook(userId, book.id);
  }
  for (const deck of userDecks) {
    await deleteDeck(userId, deck.id);
  }

  const deleted = await db
    .delete(users)
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return deleted.length > 0;
}

export async function getPlatformStatsForAdmin() {
  const db = getDb();
  if (!db) {
    return {
      totalUsers: 0,
      premiumUsers: 0,
      suspendedUsers: 0,
      totalBooks: 0,
      totalDecks: 0,
      signupsToday: 0,
      signupsThisWeek: 0,
      activeToday: 0,
    };
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  const [
    [userTotals],
    [{ total: totalBooks }],
    [{ total: totalDecks }],
    [{ total: signupsToday }],
    [{ total: signupsThisWeek }],
    [{ total: activeToday }],
  ] = await Promise.all([
    db
      .select({
        total: count(),
        premium: count(sql`case when ${users.plan} = 'premium' then 1 end`),
        suspended: count(
          sql`case when ${users.suspendedAt} is not null then 1 end`
        ),
      })
      .from(users),
    db.select({ total: count() }).from(books),
    db.select({ total: count() }).from(decks),
    db
      .select({ total: count() })
      .from(users)
      .where(gte(users.createdAt, startOfToday)),
    db
      .select({ total: count() })
      .from(users)
      .where(gte(users.createdAt, startOfWeek)),
    db
      .select({ total: count() })
      .from(users)
      .where(gte(users.lastSignedIn, startOfToday)),
  ]);

  return {
    totalUsers: Number(userTotals.total),
    premiumUsers: Number(userTotals.premium),
    suspendedUsers: Number(userTotals.suspended),
    totalBooks: Number(totalBooks),
    totalDecks: Number(totalDecks),
    signupsToday: Number(signupsToday),
    signupsThisWeek: Number(signupsThisWeek),
    activeToday: Number(activeToday),
  };
}
