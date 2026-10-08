// 📱 Phone sign-up flow (the server side of RegisterForm's 3 steps):
//   1. startPhoneVerification — limits, then Vonage sends a 6-digit SMS code
//   2. checkPhoneVerification — Vonage checks the code → row "verified"
//   3. createAccountWithVerifiedPhone — in ONE transaction: the verified row
//      is consumed (so one code = one account) and the user is created with
//      phone + phoneVerifiedAt. An unverified number can never be saved.
// Limits (all DB-backed, same approach as lib/auth-rate-limit.ts):
//   - 60 s between codes to the same number (resend cooldown)
//   - 5 codes per number per hour, 15 per device (hashed IP) per hour
//   - 5 code checks per sent code (Vonage itself allows 3 wrong codes)
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { and, count, desc, eq, gt, gte, isNull, ne, sql } from "drizzle-orm";
import { phoneVerifications, users } from "../drizzle/schema";
import { requireDb } from "./db";
import { isUniqueViolation } from "./db-errors";
import {
  cancelVerification,
  checkCode,
  SMS_CODE_TTL_SECONDS,
  startVerification,
  type VonageFetch,
} from "./sms/vonage";

export const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_PHONE_PER_HOUR = 5;
const MAX_SENDS_PER_IP_PER_HOUR = 15;
// Status of a row that only records an attempt on an already-registered
// number (no SMS sent) — see startPhoneVerification.
const TAKEN_STATUS = "taken";
// Every SMS is paid, and per-number / per-IP limits can be dodged by a
// requester with many numbers and addresses — so there is also a ceiling on
// all sends together, a backstop against SMS pumping.
function maxSendsPerHourTotal() {
  return Math.max(1, Number(process.env.SMS_MAX_SENDS_PER_HOUR) || 200);
}
const MAX_CHECKS_PER_CODE = 5;
// After the code is confirmed, the student has this long to finish the
// name + password step.
const VERIFIED_WINDOW_MINUTES = 30;

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256")
    .update(`${process.env.AUTH_SECRET ?? ""}:${ip}`)
    .digest("hex");
}

export type StartOutcome =
  | { ok: true; verificationId: string; resendAfterSeconds: number }
  | {
      ok: false;
      error:
        | "phone_taken"
        | "cooldown"
        | "too_many"
        | "invalid_number"
        | "sms_failed"
        | "busy";
      retryAfterSeconds?: number;
    };

export async function startPhoneVerification(input: {
  phone: string; // E.164
  ip: string | null;
  fetchImpl?: VonageFetch;
}): Promise<StartOutcome> {
  const db = requireDb();
  const hourAgo = new Date(Date.now() - 60 * 60_000);
  // No address (no proxy header) still gets a bucket — a shared one —
  // rather than skipping the per-IP limit.
  const ipHash = hashIp(input.ip || "unknown") ?? "";

  // Per device first, and it counts every attempt — including ones that hit
  // an already-registered number — so the "phone_taken" answer can't be
  // used to test numbers at will.
  const [perIp] = await db
    .select({ c: count() })
    .from(phoneVerifications)
    .where(
      and(
        eq(phoneVerifications.ipHash, ipHash),
        gte(phoneVerifications.createdAt, hourAgo)
      )
    );
  if (Number(perIp?.c ?? 0) >= MAX_SENDS_PER_IP_PER_HOUR) {
    return { ok: false, error: "too_many" };
  }

  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, input.phone))
    .limit(1);
  if (taken) {
    // Recorded only so it counts toward the device limit above; excluded
    // from every per-number / global SMS count below (no SMS was sent).
    await db.insert(phoneVerifications).values({
      phone: input.phone,
      status: TAKEN_STATUS,
      ipHash,
      expiresAt: new Date(),
    });
    return { ok: false, error: "phone_taken" };
  }

  const sent = ne(phoneVerifications.status, TAKEN_STATUS);
  const [last] = await db
    .select({
      id: phoneVerifications.id,
      createdAt: phoneVerifications.createdAt,
      status: phoneVerifications.status,
      providerRequestId: phoneVerifications.providerRequestId,
    })
    .from(phoneVerifications)
    .where(and(eq(phoneVerifications.phone, input.phone), sent))
    .orderBy(desc(phoneVerifications.createdAt))
    .limit(1);
  if (last) {
    const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      return {
        ok: false,
        error: "cooldown",
        retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed),
      };
    }
  }
  const [perPhone] = await db
    .select({ c: count() })
    .from(phoneVerifications)
    .where(
      and(
        eq(phoneVerifications.phone, input.phone),
        gte(phoneVerifications.createdAt, hourAgo),
        sent
      )
    );
  if (Number(perPhone?.c ?? 0) >= MAX_SENDS_PER_PHONE_PER_HOUR) {
    return { ok: false, error: "too_many" };
  }
  const [total] = await db
    .select({ c: count() })
    .from(phoneVerifications)
    .where(and(gte(phoneVerifications.createdAt, hourAgo), sent));
  if (Number(total?.c ?? 0) >= maxSendsPerHourTotal()) {
    console.error("[Phone] Hourly SMS ceiling reached — refusing new sends");
    return { ok: false, error: "busy" };
  }

  // A resend: free the number at Vonage (one active request per number).
  if (last?.status === "pending" && last.providerRequestId) {
    await cancelVerification(last.providerRequestId, input.fetchImpl);
    await db
      .update(phoneVerifications)
      .set({ status: "failed" })
      .where(eq(phoneVerifications.id, last.id));
  }

  const started = await startVerification(input.phone, input.fetchImpl);
  if (!started.ok) {
    const error =
      started.reason === "invalid_number"
        ? "invalid_number"
        : started.reason === "provider_error"
          ? "sms_failed"
          : "too_many"; // rate_limited / concurrent
    return { ok: false, error };
  }

  const [row] = await db
    .insert(phoneVerifications)
    .values({
      phone: input.phone,
      providerRequestId: started.requestId,
      ipHash,
      expiresAt: new Date(Date.now() + SMS_CODE_TTL_SECONDS * 1000),
    })
    .returning({ id: phoneVerifications.id });
  return {
    ok: true,
    verificationId: row.id,
    resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
  };
}

export type CheckOutcome =
  | { ok: true }
  | { ok: false; error: "wrong_code" | "expired" | "too_many" | "sms_failed" };

export async function checkPhoneVerification(input: {
  verificationId: string;
  code: string;
  fetchImpl?: VonageFetch;
}): Promise<CheckOutcome> {
  const db = requireDb();
  // Count the attempt first (atomically), and only for a live pending row.
  const [row] = await db
    .update(phoneVerifications)
    .set({ attempts: sql`${phoneVerifications.attempts} + 1` })
    .where(
      and(
        eq(phoneVerifications.id, input.verificationId),
        eq(phoneVerifications.status, "pending"),
        gt(phoneVerifications.expiresAt, new Date())
      )
    )
    .returning({
      attempts: phoneVerifications.attempts,
      providerRequestId: phoneVerifications.providerRequestId,
    });
  if (!row?.providerRequestId) return { ok: false, error: "expired" };
  if (row.attempts > MAX_CHECKS_PER_CODE) {
    await db
      .update(phoneVerifications)
      .set({ status: "failed" })
      .where(eq(phoneVerifications.id, input.verificationId));
    return { ok: false, error: "too_many" };
  }

  const result = await checkCode(
    row.providerRequestId,
    input.code,
    input.fetchImpl
  );
  if (result.ok) {
    await db
      .update(phoneVerifications)
      .set({ status: "verified", verifiedAt: new Date() })
      .where(eq(phoneVerifications.id, input.verificationId));
    return { ok: true };
  }
  if (result.reason === "expired") {
    await db
      .update(phoneVerifications)
      .set({ status: "failed" })
      .where(eq(phoneVerifications.id, input.verificationId));
  }
  const error =
    result.reason === "wrong_code" || result.reason === "expired"
      ? result.reason
      : result.reason === "rate_limited"
        ? "too_many"
        : "sms_failed";
  return { ok: false, error };
}

export type CreateOutcome =
  | { ok: true; userId: string; phone: string }
  | { ok: false; error: "not_verified" | "phone_taken" };

class PhoneTakenError extends Error {}
class NotGuestError extends Error {}

// Consumes the verified row and creates the account together — a verified
// code can create exactly one account, and only for the number it proved.
export async function createAccountWithVerifiedPhone(input: {
  verificationId: string;
  name: string;
  password: string;
}): Promise<CreateOutcome> {
  const db = requireDb();
  const passwordHash = await bcrypt.hash(input.password, 10);
  const verifiedSince = new Date(Date.now() - VERIFIED_WINDOW_MINUTES * 60_000);
  try {
    return await db.transaction(async tx => {
      const [verification] = await tx
        .update(phoneVerifications)
        .set({ status: "consumed", consumedAt: new Date() })
        .where(
          and(
            eq(phoneVerifications.id, input.verificationId),
            eq(phoneVerifications.status, "verified"),
            gt(phoneVerifications.verifiedAt, verifiedSince)
          )
        )
        .returning({ phone: phoneVerifications.phone });
      if (!verification) return { ok: false, error: "not_verified" } as const;

      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phone, verification.phone))
        .limit(1);
      // Throwing rolls the consume back too.
      if (taken) throw new PhoneTakenError();
      const [user] = await tx
        .insert(users)
        .values({
          phone: verification.phone,
          phoneVerifiedAt: new Date(),
          passwordHash,
          name: input.name,
        })
        .returning({ id: users.id });
      return { ok: true, userId: user.id, phone: verification.phone } as const;
    });
  } catch (error) {
    // The number was registered meanwhile, or a simultaneous sign-up with
    // the same number hit the unique index first.
    if (
      error instanceof PhoneTakenError ||
      isUniqueViolation(error, "users_phone_unique")
    ) {
      return { ok: false, error: "phone_taken" };
    }
    throw error;
  }
}

// ✈️ A Telegram guest (lib/telegram/accounts.ts) registering: the SAME users
// row gets the verified number, the password and the name, so the files the
// guest already uploaded stay where they are — nothing is copied or moved.
// Same guarantees as createAccountWithVerifiedPhone above: the verified code
// is consumed in the same transaction and a taken number rolls it back. The
// WHERE clause is what makes it "guests only": a row that already has a
// phone, an email or a password is never touched.
export async function upgradeGuestWithVerifiedPhone(input: {
  userId: string;
  verificationId: string;
  name: string;
  password: string;
}): Promise<CreateOutcome | { ok: false; error: "not_guest" }> {
  const db = requireDb();
  const passwordHash = await bcrypt.hash(input.password, 10);
  const verifiedSince = new Date(Date.now() - VERIFIED_WINDOW_MINUTES * 60_000);
  try {
    return await db.transaction(async tx => {
      const [verification] = await tx
        .update(phoneVerifications)
        .set({ status: "consumed", consumedAt: new Date() })
        .where(
          and(
            eq(phoneVerifications.id, input.verificationId),
            eq(phoneVerifications.status, "verified"),
            gt(phoneVerifications.verifiedAt, verifiedSince)
          )
        )
        .returning({ phone: phoneVerifications.phone });
      if (!verification) return { ok: false, error: "not_verified" } as const;

      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phone, verification.phone))
        .limit(1);
      // Throwing rolls the consume back too.
      if (taken) throw new PhoneTakenError();
      const [user] = await tx
        .update(users)
        .set({
          phone: verification.phone,
          phoneVerifiedAt: new Date(),
          passwordHash,
          name: input.name,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.id, input.userId),
            isNull(users.phone),
            isNull(users.email),
            isNull(users.passwordHash)
          )
        )
        .returning({ id: users.id });
      if (!user) throw new NotGuestError();
      return { ok: true, userId: user.id, phone: verification.phone } as const;
    });
  } catch (error) {
    if (error instanceof NotGuestError) return { ok: false, error: "not_guest" };
    if (
      error instanceof PhoneTakenError ||
      isUniqueViolation(error, "users_phone_unique")
    ) {
      return { ok: false, error: "phone_taken" };
    }
    throw error;
  }
}
