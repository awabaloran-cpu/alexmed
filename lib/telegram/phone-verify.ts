// ✈️ Verifying a phone number through the Telegram bot — no code, no SMS,
// no cost.
//
// Telegram lets a bot ask a user to share THEIR OWN contact; the phone
// number that arrives is the one the Telegram account is registered with
// (Telegram itself verified it), and the message says whose contact it is.
// So sign-up can prove a number like this:
//
//   1. the student types their number on /register and picks "Telegram"
//      → a pending phone_verifications row + a one-time link to the bot
//   2. the bot (opened by that link) asks them to share their contact
//   3. if the shared number is their own AND equals the typed one, the row
//      becomes "verified" — the same state an SMS / WhatsApp code leads to
//   4. /register (polling the row) moves on; creating the account consumes
//      the row exactly as for a code (lib/db-phone.ts), unchanged.
//
// The row's providerRequestId holds "tg:<sha256 of the link token>" and,
// once a Telegram user opened the link, ":<their Telegram id>" — so only
// that user's contact can complete it, and the raw token is never stored.
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, gte, like } from "drizzle-orm";
import { phoneVerifications, users } from "../../drizzle/schema";
import { requireDb } from "../db";
import { hashIp, TELEGRAM_VERIFICATION_PREFIX } from "../db-phone";
import { telegramBotUsername, telegramEnabled } from "./config";
import { hashToken } from "./tokens";

// Long enough to switch apps, share the contact and come back.
const TELEGRAM_VERIFY_TTL_MINUTES = 10;
// Same per-device ceiling as code sends (lib/db-phone.ts): the answer
// "this number is already registered" must not become a way to test numbers.
const MAX_STARTS_PER_IP_PER_HOUR = 15;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function telegramPhoneVerifyAvailable(): boolean {
  return telegramEnabled() && !!telegramBotUsername();
}

const requestIdFor = (tokenHash: string, telegramUserId?: number) =>
  `${TELEGRAM_VERIFICATION_PREFIX}${tokenHash}` +
  (telegramUserId === undefined ? "" : `:${telegramUserId}`);

export type TelegramStartOutcome =
  | { ok: true; verificationId: string; url: string }
  | { ok: false; error: "phone_taken" | "too_many" | "sms_not_configured" };

export async function startTelegramPhoneVerification(input: {
  phone: string; // E.164
  ip: string | null;
}): Promise<TelegramStartOutcome> {
  const bot = telegramBotUsername();
  if (!telegramEnabled() || !bot) {
    return { ok: false, error: "sms_not_configured" };
  }
  const db = requireDb();
  const hourAgo = new Date(Date.now() - 60 * 60_000);
  const ipHash = hashIp(input.ip || "unknown") ?? "";

  const [perIp] = await db
    .select({ c: count() })
    .from(phoneVerifications)
    .where(
      and(
        eq(phoneVerifications.ipHash, ipHash),
        gte(phoneVerifications.createdAt, hourAgo)
      )
    );
  if (Number(perIp?.c ?? 0) >= MAX_STARTS_PER_IP_PER_HOUR) {
    return { ok: false, error: "too_many" };
  }

  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, input.phone))
    .limit(1);
  if (taken) {
    // Recorded so it counts toward the device limit, like a code attempt.
    await db.insert(phoneVerifications).values({
      phone: input.phone,
      status: "taken",
      ipHash,
      expiresAt: new Date(),
    });
    return { ok: false, error: "phone_taken" };
  }

  const token = randomBytes(32).toString("base64url");
  const [row] = await db
    .insert(phoneVerifications)
    .values({
      phone: input.phone,
      providerRequestId: requestIdFor(hashToken(token)),
      ipHash,
      expiresAt: new Date(Date.now() + TELEGRAM_VERIFY_TTL_MINUTES * 60_000),
    })
    .returning({ id: phoneVerifications.id });
  return {
    ok: true,
    verificationId: row.id,
    // Telegram's start parameter allows 64 of [A-Za-z0-9_-]: 7 + 43.
    url: `https://t.me/${bot}?start=verify_${token}`,
  };
}

// The bot was opened with the link: bind the request to this Telegram user.
// False when the link is unknown, expired, finished, or was opened by
// another Telegram user first.
export async function claimTelegramPhoneVerification(
  token: string,
  telegramUserId: number
): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  const tokenHash = hashToken(token);
  const mine = requestIdFor(tokenHash, telegramUserId);
  const db = requireDb();
  const live = and(
    eq(phoneVerifications.status, "pending"),
    gt(phoneVerifications.expiresAt, new Date())
  );
  const claimed = await db
    .update(phoneVerifications)
    .set({ providerRequestId: mine })
    .where(
      and(eq(phoneVerifications.providerRequestId, requestIdFor(tokenHash)), live)
    )
    .returning({ id: phoneVerifications.id });
  if (claimed.length) return true;
  // The same user tapping the link again.
  const [again] = await db
    .select({ id: phoneVerifications.id })
    .from(phoneVerifications)
    .where(and(eq(phoneVerifications.providerRequestId, mine), live))
    .limit(1);
  return !!again;
}

export type ContactOutcome = "verified" | "mismatch" | "no_request";

// The user shared their own contact: complete the request they opened, if
// the number is the one typed on the sign-up page.
export async function completeTelegramPhoneVerification(
  telegramUserId: number,
  phone: string // E.164
): Promise<ContactOutcome> {
  const db = requireDb();
  const [request] = await db
    .select({ id: phoneVerifications.id, phone: phoneVerifications.phone })
    .from(phoneVerifications)
    .where(
      and(
        like(
          phoneVerifications.providerRequestId,
          `${TELEGRAM_VERIFICATION_PREFIX}%:${telegramUserId}`
        ),
        eq(phoneVerifications.status, "pending"),
        gt(phoneVerifications.expiresAt, new Date())
      )
    )
    .orderBy(desc(phoneVerifications.createdAt))
    .limit(1);
  if (!request) return "no_request";
  if (request.phone !== phone) return "mismatch";
  const verified = await db
    .update(phoneVerifications)
    .set({ status: "verified", verifiedAt: new Date() })
    .where(
      and(
        eq(phoneVerifications.id, request.id),
        eq(phoneVerifications.status, "pending")
      )
    )
    .returning({ id: phoneVerifications.id });
  return verified.length ? "verified" : "no_request";
}

// What the sign-up page polls while the student is in Telegram.
export async function getPhoneVerificationStatus(
  verificationId: string
): Promise<"pending" | "verified" | "expired"> {
  const [row] = await requireDb()
    .select({
      status: phoneVerifications.status,
      expiresAt: phoneVerifications.expiresAt,
    })
    .from(phoneVerifications)
    .where(eq(phoneVerifications.id, verificationId))
    .limit(1);
  if (!row) return "expired";
  if (row.status === "verified") return "verified";
  if (row.status === "pending" && row.expiresAt > new Date()) return "pending";
  return "expired";
}
