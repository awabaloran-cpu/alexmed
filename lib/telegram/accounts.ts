// ✈️ Telegram user ↔ NiroLearn account.
//
// A Telegram user never IS a NiroLearn user: telegram_accounts maps one to
// the other. First contact creates a GUEST account — an ordinary users row
// with no phone, email or password — so the file a guest sends is owned,
// metered and authorized exactly like any student's. Registering fills that
// same row in (lib/db-phone.ts's upgradeGuestWithVerifiedPhone), so nothing
// the guest uploaded ever has to move.
import { and, eq, inArray, sql } from "drizzle-orm";
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
import { consumeLinkToken, findLinkToken, revokeLinkTokens } from "./tokens";

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
//
// `origin` (a campaign label and/or an inviter, from the /start link —
// lib/telegram/growth.ts) is recorded only when the account is created
// here, never on an existing one.
export async function ensureTelegramAccount(
  identity: TelegramIdentity,
  origin: { source?: string; referredById?: string | null } = {}
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
        source: origin.source?.slice(0, 40) ?? null,
        referredById: origin.referredById ?? null,
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
  kind: "question_file" | "book" | "summary" | null
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
        | "account_has_other_telegram";
    };

type Db = ReturnType<typeof requireDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Every column in the database that points at users.id — read from the
// catalog rather than listed here, so a table added later is covered
// without anyone remembering this function.
async function userReferenceColumns(tx: Tx) {
  const rows = (await tx.execute(sql`
    select cl.relname as "table", a.attname as "column"
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.users'::regclass
      and array_length(c.conkey, 1) = 1
      and n.nspname = 'public'
    order by cl.relname, a.attname
  `)) as unknown as { table: string; column: string }[];
  return rows;
}

// Tables whose rows are about the guest IDENTITY, not the guest's study
// material: they are not carried over.
const NOT_MERGED = new Set(["telegram_accounts", "access_link_tokens"]);

// Folds a guest account into a registered one, inside the caller's
// transaction: everything the guest owns (files, folders, answers, review
// history, chats …) becomes the registered account's, and the guest row is
// removed. Files are not copied or re-processed — only their owner changes;
// access to a stored file is decided by the owning row, never by the
// storage key's path.
//
// Each table is moved in its own savepoint. Where the registered account
// already has the row a unique rule allows only one of (today's usage
// counter, a game's progress, a mark on the same card), the account's own
// row wins and the guest's is dropped.
async function mergeGuestInto(tx: Tx, guestId: string, targetId: string) {
  // One "Telegram" folder, not two with the same name.
  const folders = await tx
    .select({ id: subjects.id, userId: subjects.userId })
    .from(subjects)
    .where(
      and(
        inArray(subjects.userId, [guestId, targetId]),
        eq(subjects.name, TELEGRAM_SUBJECT_NAME)
      )
    );
  const guestFolder = folders.find(folder => folder.userId === guestId);
  const targetFolder = folders.find(folder => folder.userId === targetId);
  if (guestFolder && targetFolder) {
    await tx
      .update(books)
      .set({ subjectId: targetFolder.id })
      .where(eq(books.subjectId, guestFolder.id));
    await tx.delete(subjects).where(eq(subjects.id, guestFolder.id));
  }

  for (const { table, column } of await userReferenceColumns(tx)) {
    if (NOT_MERGED.has(table)) continue;
    const target = sql`${sql.identifier(table)}`;
    const owner = sql`${sql.identifier(column)}`;
    try {
      await tx.transaction(savepoint =>
        savepoint.execute(
          sql`update ${target} set ${owner} = ${targetId} where ${owner} = ${guestId}`
        )
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await tx.execute(sql`delete from ${target} where ${owner} = ${guestId}`);
    }
  }
  // Whatever is left (the guest's links) goes with the row.
  await tx.delete(users).where(eq(users.id, guestId));
}

// Points this Telegram user at `targetUserId`, a registered account.
//   no account yet          → a new mapping
//   an existing guest       → the guest is merged into the account
//   another registered user → refused (unlink there first)
async function attachTelegramToAccount(
  identity: TelegramIdentity,
  current: AccountContext | null,
  targetUserId: string
): Promise<LinkOutcome> {
  if (current?.user.id === targetUserId) return { ok: true };
  if (current && !current.user.isGuest) {
    return { ok: false, reason: "already_linked_elsewhere" };
  }
  const db = requireDb();
  // One Telegram per account: checked before anything is moved.
  const [taken] = await db
    .select({ id: telegramAccounts.id })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, targetUserId))
    .limit(1);
  if (taken) return { ok: false, reason: "account_has_other_telegram" };

  try {
    if (!current) {
      await db.insert(telegramAccounts).values({
        telegramUserId: identity.telegramUserId,
        chatId: identity.chatId,
        userId: targetUserId,
        languageCode: identity.languageCode?.slice(0, 12) ?? null,
      });
      return { ok: true };
    }
    await db.transaction(async tx => {
      await tx
        .update(telegramAccounts)
        .set({ userId: targetUserId, chatId: identity.chatId })
        .where(eq(telegramAccounts.id, current.account.id));
      await mergeGuestInto(tx, current.user.id, targetUserId);
    });
    return { ok: true };
  } catch (error) {
    // Two links racing for the same account.
    if (isUniqueViolation(error, "telegram_accounts_user_idx")) {
      return { ok: false, reason: "account_has_other_telegram" };
    }
    throw error;
  }
}

// From the bot: `/start link_<code>`, the one-time code a signed-in student
// got on /account. Attaches this Telegram user to that account; a guest's
// files come along.
export async function linkTelegramToAccount(
  token: string,
  identity: TelegramIdentity
): Promise<LinkOutcome> {
  const link = await consumeLinkToken(token, "telegram_link");
  if (!link) return { ok: false, reason: "invalid_code" };
  return attachTelegramToAccount(
    identity,
    await findTelegramAccount(identity.telegramUserId),
    link.userId
  );
}

// From the web: the guest's own "connect" link (/connect/<token>), opened
// by someone signed in to a registered account who confirmed. The guest the
// token belongs to is merged into that account. Returns the chat to tell.
export async function connectGuestToAccount(
  token: string,
  targetUserId: string
): Promise<LinkOutcome & { chatId?: number }> {
  const claim = await findLinkToken(token, "guest_claim");
  if (!claim) return { ok: false, reason: "invalid_code" };
  const guest = await findTelegramAccountByUserId(claim.userId);
  if (!guest || !guest.user.isGuest) return { ok: false, reason: "invalid_code" };
  const outcome = await attachTelegramToAccount(
    {
      telegramUserId: guest.account.telegramUserId,
      chatId: guest.account.chatId,
      languageCode: guest.account.languageCode,
    },
    guest,
    targetUserId
  );
  return outcome.ok ? { ok: true, chatId: guest.account.chatId } : outcome;
}

// The guest a connect link belongs to, while it can still be used.
export async function findGuestForClaim(
  token: string
): Promise<AccountContext | null> {
  const claim = await findLinkToken(token, "guest_claim");
  if (!claim) return null;
  const guest = await findTelegramAccountByUserId(claim.userId);
  return guest?.user.isGuest && !guest.user.suspended ? guest : null;
}

export async function findTelegramAccountByUserId(
  userId: string
): Promise<AccountContext | null> {
  const [row] = await requireDb()
    .select({ account: telegramAccounts, user: userStateColumns })
    .from(telegramAccounts)
    .innerJoin(users, eq(users.id, telegramAccounts.userId))
    .where(eq(telegramAccounts.userId, userId))
    .limit(1);
  return row ? { account: row.account, user: toUserState(row.user) } : null;
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
