// 📈 Growth: where students come from, and students inviting students.
//
//   t.me/<bot>?start=src_<label>   a campaign link — one per group / post,
//                                  so sign-ups can be counted per place
//   t.me/<bot>?start=ref_<code>    a student's own invite link
//
// Both only ever label an account at the moment it is FIRST created; an
// existing student tapping a link changes nothing (so nobody can re-label
// themselves, or become "invited" after the fact).
//
// The reward: when an invited student's first file actually reaches
// processing, the inviter earns ONE extra file — once per invited student,
// up to MAX_BONUS_UPLOADS in total. It costs processing quota, never money.
// Counting only real, processed files from brand-new Telegram accounts
// (each needs its own phone number) is what keeps it from being farmed.
import { randomInt } from "node:crypto";
import { and, count, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  telegramAccounts,
  telegramUploads,
  users,
} from "../../drizzle/schema";
import { requireDb } from "../db";
import { isUniqueViolation } from "../db-errors";
import { telegramBotUsername } from "./config";

export const MAX_BONUS_UPLOADS = 30;
export const INVITE_SOURCE = "invite";
// A new student who arrived by opening a file a classmate shared.
export const SHARE_SOURCE = "share";

const SOURCE_PREFIX = "src_";
const REFERRAL_PREFIX = "ref_";
// Unambiguous when read aloud or retyped: no 0/O, 1/I/L.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

export type StartOrigin = { source?: string; referralCode?: string };

// What a /start payload says about where the student came from. Anything
// that is not one of the two forms above is ignored.
export function parseStartOrigin(payload: string | undefined): StartOrigin {
  if (!payload) return {};
  if (payload.startsWith(REFERRAL_PREFIX)) {
    const code = payload.slice(REFERRAL_PREFIX.length).toUpperCase();
    return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code)
      ? { referralCode: code, source: INVITE_SOURCE }
      : {};
  }
  if (payload.startsWith(SOURCE_PREFIX)) {
    const label = payload.slice(SOURCE_PREFIX.length).toLowerCase();
    return /^[a-z0-9_-]{1,32}$/.test(label) ? { source: label } : {};
  }
  return {};
}

function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

// The account id an invite code belongs to (null for an unknown code).
export async function findInviterId(code: string): Promise<string | null> {
  const [row] = await requireDb()
    .select({ id: telegramAccounts.id })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.referralCode, code))
    .limit(1);
  return row?.id ?? null;
}

// This account's invite code, created the first time it is asked for.
export async function getOrCreateReferralCode(
  accountId: string
): Promise<string> {
  const db = requireDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const [existing] = await db
      .select({ code: telegramAccounts.referralCode })
      .from(telegramAccounts)
      .where(eq(telegramAccounts.id, accountId))
      .limit(1);
    if (existing?.code) return existing.code;
    try {
      const [set] = await db
        .update(telegramAccounts)
        .set({ referralCode: newCode() })
        .where(
          and(
            eq(telegramAccounts.id, accountId),
            isNull(telegramAccounts.referralCode)
          )
        )
        .returning({ code: telegramAccounts.referralCode });
      if (set?.code) return set.code;
    } catch (error) {
      // The (astronomically unlikely) same code as someone else: try again.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Could not create a referral code");
}

export async function inviteLink(accountId: string): Promise<string | null> {
  const bot = telegramBotUsername();
  if (!bot) return null;
  return `https://t.me/${bot}?start=${REFERRAL_PREFIX}${await getOrCreateReferralCode(accountId)}`;
}

// A link that carries a campaign label instead of a person's code.
export function sourceLink(label: string): string | null {
  const bot = telegramBotUsername();
  return bot ? `https://t.me/${bot}?start=${SOURCE_PREFIX}${label}` : null;
}

// Telegram's own share sheet: the student picks the chats to send it to.
export function shareUrl(link: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}

// Called when a file of `accountId` reaches processing. If that student was
// invited and this is the first time, the inviter earns one extra file.
// Returns the inviter's chat (to tell them) or null when nothing was earned.
// Both steps are single guarded UPDATEs: a retry can never reward twice.
export async function rewardInviterOf(
  accountId: string
): Promise<{ chatId: number; bonusLeft: number } | null> {
  const db = requireDb();
  const [invited] = await db
    .update(telegramAccounts)
    .set({ referralRewardedAt: new Date() })
    .where(
      and(
        eq(telegramAccounts.id, accountId),
        isNotNull(telegramAccounts.referredById),
        isNull(telegramAccounts.referralRewardedAt)
      )
    )
    .returning({ inviterId: telegramAccounts.referredById });
  if (!invited?.inviterId) return null;

  const [inviter] = await db
    .update(telegramAccounts)
    .set({ bonusUploads: sql`${telegramAccounts.bonusUploads} + 1` })
    .where(
      and(
        eq(telegramAccounts.id, invited.inviterId),
        lt(telegramAccounts.bonusUploads, MAX_BONUS_UPLOADS)
      )
    )
    .returning({
      chatId: telegramAccounts.chatId,
      bonusUploads: telegramAccounts.bonusUploads,
      bonusUsed: telegramAccounts.bonusUsed,
    });
  return inviter
    ? {
        chatId: inviter.chatId,
        bonusLeft: inviter.bonusUploads - inviter.bonusUsed,
      }
    : null;
}

// Spends one earned file, if there is one. Atomic: two files sent at once
// cannot both spend the last one.
export async function spendBonusUpload(accountId: string): Promise<boolean> {
  const spent = await requireDb()
    .update(telegramAccounts)
    .set({ bonusUsed: sql`${telegramAccounts.bonusUsed} + 1` })
    .where(
      and(
        eq(telegramAccounts.id, accountId),
        sql`${telegramAccounts.bonusUsed} < ${telegramAccounts.bonusUploads}`
      )
    )
    .returning({ id: telegramAccounts.id });
  return spent.length > 0;
}

// Gives a spent file back (the upload it was spent on never started).
export async function refundBonusUpload(accountId: string): Promise<void> {
  await requireDb()
    .update(telegramAccounts)
    .set({ bonusUsed: sql`${telegramAccounts.bonusUsed} - 1` })
    .where(
      and(
        eq(telegramAccounts.id, accountId),
        sql`${telegramAccounts.bonusUsed} > 0`
      )
    );
}

export async function inviteStats(accountId: string) {
  const db = requireDb();
  const [account] = await db
    .select({
      bonusUploads: telegramAccounts.bonusUploads,
      bonusUsed: telegramAccounts.bonusUsed,
    })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.id, accountId))
    .limit(1);
  const [joined] = await db
    .select({ value: count() })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.referredById, accountId));
  return {
    joined: Number(joined?.value ?? 0),
    earned: account?.bonusUploads ?? 0,
    available: Math.max(
      0,
      (account?.bonusUploads ?? 0) - (account?.bonusUsed ?? 0)
    ),
  };
}

// Admin: for each place students came from — how many arrived, how many
// sent a file that was processed, how many created a full account. Counts
// only; no student is identified.
export async function sourceReport() {
  const rows = await requireDb()
    .select({
      source: sql<string>`coalesce(${telegramAccounts.source}, 'direct')`,
      arrived: count(),
      uploaded: sql<number>`count(*) filter (where exists (
        select 1 from ${telegramUploads}
        where ${telegramUploads.telegramAccountId} = ${telegramAccounts.id}
          and ${telegramUploads.status} in ('processing', 'complete')
      ))`,
      registered: sql<number>`count(*) filter (where
        ${users.phone} is not null or ${users.email} is not null
        or ${users.passwordHash} is not null)`,
    })
    .from(telegramAccounts)
    .innerJoin(users, eq(users.id, telegramAccounts.userId))
    .groupBy(sql`coalesce(${telegramAccounts.source}, 'direct')`)
    .orderBy(sql`count(*) desc`);
  return rows.map(row => ({
    source: row.source,
    arrived: Number(row.arrived),
    uploaded: Number(row.uploaded),
    registered: Number(row.registered),
  }));
}
