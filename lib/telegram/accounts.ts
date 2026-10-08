// ✈️ Telegram user ↔ NiroLearn account.
//
// A Telegram user never IS a NiroLearn user: telegram_accounts maps one to
// the other. First contact creates a GUEST account — an ordinary users row
// with no phone, email or password — so the file a guest sends is owned,
// metered and authorized exactly like any student's. Registering fills that
// same row in (lib/db-phone.ts's upgradeGuestWithVerifiedPhone), so nothing
// the guest uploaded ever has to move.
import { and, count, eq } from "drizzle-orm";
import {
  books,
  subjects,
  telegramAccounts,
  users,
  type TelegramAccount,
} from "../../drizzle/schema";
import { requireDb } from "../db";
import { isUniqueViolation } from "../db-errors";
import { createSubject } from "../db-subjects";
import { consumeLinkToken, revokeLinkTokens } from "./tokens";

export type TelegramIdentity = {
  telegramUserId: number;
  chatId: number;
  languageCode?: string | null;
};

export type TelegramUserState = {
  id: string;
  name: string | null;
  isGuest: boolean;
  suspended: boolean;
};

export type AccountContext = {
  account: TelegramAccount;
  user: TelegramUserState;
};

const GUEST_NAME = "ضيف Telegram";
const TELEGRAM_SUBJECT_NAME = "Telegram";

// A guest has no way to sign in on their own: no phone, no email (so no
// Google either), no password.
export function isGuestUser(user: {
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
}): boolean {
  return !user.email && !user.phone && !user.passwordHash;
}

const userStateColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  passwordHash: users.passwordHash,
  suspendedAt: users.suspendedAt,
};

function toUserState(row: {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
  suspendedAt: Date | null;
}): TelegramUserState {
  return {
    id: row.id,
    name: row.name,
    isGuest: isGuestUser(row),
    suspended: !!row.suspendedAt,
  };
}

export async function findTelegramAccount(
  telegramUserId: number
): Promise<AccountContext | null> {
  const [row] = await requireDb()
    .select({ account: telegramAccounts, user: userStateColumns })
    .from(telegramAccounts)
    .innerJoin(users, eq(users.id, telegramAccounts.userId))
    .where(eq(telegramAccounts.telegramUserId, telegramUserId))
    .limit(1);
  return row ? { account: row.account, user: toUserState(row.user) } : null;
}

export async function findTelegramAccountById(
  accountId: string
): Promise<AccountContext | null> {
  const [row] = await requireDb()
    .select({ account: telegramAccounts, user: userStateColumns })
    .from(telegramAccounts)
    .innerJoin(users, eq(users.id, telegramAccounts.userId))
    .where(eq(telegramAccounts.id, accountId))
    .limit(1);
  return row ? { account: row.account, user: toUserState(row.user) } : null;
}

// The account for this Telegram user, created as a guest on first contact.
// Only private chats reach here (the handler ignores groups), so chatId is
// the user's own chat. Nothing from the Telegram profile is stored beyond
// the numeric id and the interface language.
export async function ensureTelegramAccount(
  identity: TelegramIdentity
): Promise<AccountContext> {
  const db = requireDb();
  const existing = await findTelegramAccount(identity.telegramUserId);
  if (existing) {
    await db
      .update(telegramAccounts)
      .set({ chatId: identity.chatId, lastSeenAt: new Date(), blockedAt: null })
      .where(eq(telegramAccounts.id, existing.account.id));
    return existing;
  }

  try {
    await db.transaction(async tx => {
      const [user] = await tx
        .insert(users)
        .values({ name: GUEST_NAME })
        .returning({ id: users.id });
      await tx.insert(telegramAccounts).values({
        telegramUserId: identity.telegramUserId,
        chatId: identity.chatId,
        userId: user.id,
        languageCode: identity.languageCode?.slice(0, 12) ?? null,
      });
    });
  } catch (error) {
    // Two updates from the same new user at once: the other one won, and
    // this transaction (with its guest user) rolled back.
    if (!isUniqueViolation(error)) throw error;
  }
  const created = await findTelegramAccount(identity.telegramUserId);
  if (!created) throw new Error("Telegram account could not be created");
  return created;
}

export async function setPendingKind(
  accountId: string,
  kind: "question_file" | "book" | null
): Promise<void> {
  await requireDb()
    .update(telegramAccounts)
    .set({ pendingKind: kind })
    .where(eq(telegramAccounts.id, accountId));
}

export async function markAccountBlocked(accountId: string): Promise<void> {
  await requireDb()
    .update(telegramAccounts)
    .set({ blockedAt: new Date() })
    .where(eq(telegramAccounts.id, accountId));
}

// Every upload must sit in a folder the student owns (the web upload makes
// them pick one); files from the bot go into a "Telegram" folder, created
// on the first upload.
export async function ensureTelegramSubject(userId: string): Promise<string> {
  const [existing] = await requireDb()
    .select({ id: subjects.id })
    .from(subjects)
    .where(
      and(eq(subjects.userId, userId), eq(subjects.name, TELEGRAM_SUBJECT_NAME))
    )
    .limit(1);
  if (existing) return existing.id;
  return (await createSubject(userId, { name: TELEGRAM_SUBJECT_NAME })).id;
}

export type LinkOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalid_code"
        | "already_linked_elsewhere"
        | "account_has_other_telegram"
        | "guest_has_files";
    };

// Attaches this Telegram user to the registered account that created
// `token` (from /account). The code is one-time.
//
// A Telegram user who already has a guest account here is moved onto the
// registered account only while the guest owns no files; a guest WITH files
// keeps them by registering that guest account instead (no silent merge of
// two accounts' data).
export async function linkTelegramToAccount(
  token: string,
  identity: TelegramIdentity
): Promise<LinkOutcome> {
  const link = await consumeLinkToken(token, "telegram_link");
  if (!link) return { ok: false, reason: "invalid_code" };
  const db = requireDb();
  const current = await findTelegramAccount(identity.telegramUserId);

  if (current?.user.id === link.userId) return { ok: true };
  if (current && !current.user.isGuest) {
    return { ok: false, reason: "already_linked_elsewhere" };
  }

  try {
    if (!current) {
      await db.insert(telegramAccounts).values({
        telegramUserId: identity.telegramUserId,
        chatId: identity.chatId,
        userId: link.userId,
        languageCode: identity.languageCode?.slice(0, 12) ?? null,
      });
      return { ok: true };
    }

    const guestId = current.user.id;
    return await db.transaction(async tx => {
      const [owned] = await tx
        .select({ value: count() })
        .from(books)
        .where(eq(books.userId, guestId));
      if (Number(owned?.value ?? 0) > 0) {
        return { ok: false, reason: "guest_has_files" } as const;
      }
      await tx
        .update(telegramAccounts)
        .set({ userId: link.userId, chatId: identity.chatId })
        .where(eq(telegramAccounts.id, current.account.id));
      // The empty guest account has no further purpose.
      await tx.delete(users).where(eq(users.id, guestId));
      return { ok: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "account_has_other_telegram" };
    }
    throw error;
  }
}

// The signed-in user, when they are a Telegram guest who has not registered
// yet — the one case where "create account" must fill in the existing row
// instead of making a second account (app/api/register).
export async function isTelegramGuest(userId: string): Promise<boolean> {
  const [row] = await requireDb()
    .select({ user: userStateColumns })
    .from(telegramAccounts)
    .innerJoin(users, eq(users.id, telegramAccounts.userId))
    .where(eq(telegramAccounts.userId, userId))
    .limit(1);
  return !!row && isGuestUser(row.user);
}

// Whether (and as what) a signed-in student is connected — for /account.
export async function getTelegramLinkForUser(userId: string) {
  const [row] = await requireDb()
    .select({ id: telegramAccounts.id, createdAt: telegramAccounts.createdAt })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, userId))
    .limit(1);
  return row ?? null;
}

// Disconnects Telegram from a registered account. The files stay with the
// account; the bot simply no longer knows this Telegram user.
export async function unlinkTelegram(userId: string): Promise<boolean> {
  const removed = await requireDb()
    .delete(telegramAccounts)
    .where(eq(telegramAccounts.userId, userId))
    .returning({ id: telegramAccounts.id });
  await revokeLinkTokens(userId);
  return removed.length > 0;
}
