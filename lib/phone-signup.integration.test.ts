// Real-Postgres test of phone sign-up (lib/db-phone.ts) end to end, with a
// fake Vonage (fetch) that accepts the code "246810". Proves: a number is
// only saved after its code was confirmed, one confirmed code creates one
// account, resend cooldown / wrong codes / reuse are refused, and an
// already-registered number can't start a new sign-up.
// Skipped unless LIVE_DB=1. Uses a random +96279… number per run and
// deletes everything it created at the end.
//
//   LIVE_DB=1 npx vitest run lib/phone-signup.integration.test.ts
import { config as loadEnv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const live = process.env.LIVE_DB === "1";
if (live) loadEnv();

const GOOD_CODE = "246810";
let started = 0;
const fakeVonage: typeof fetch = async (input, init) => {
  const url = String(input);
  if (init?.method === "DELETE") return new Response(null, { status: 204 });
  if (url.endsWith("/v2/verify")) {
    started += 1;
    return Response.json({ request_id: `req-${started}` }, { status: 202 });
  }
  const { code } = JSON.parse(String(init?.body ?? "{}")) as { code: string };
  return code === GOOD_CODE
    ? Response.json({ status: "completed" })
    : Response.json(
        { type: "https://developer.vonage.com/api-errors/verify#invalid-code" },
        { status: 400 }
      );
};

describe.skipIf(!live)(
  "phone sign-up — real database",
  { timeout: 60_000 },
  () => {
    const tail = String(Math.floor(1_000_000 + Math.random() * 8_999_999));
    const phone = `+96279${tail}`;
    let db: ReturnType<typeof import("./db").requireDb>;
    let schema: typeof import("../drizzle/schema");
    let orm: typeof import("drizzle-orm");
    let flow: typeof import("./db-phone");

    beforeAll(async () => {
      process.env.VONAGE_API_KEY = "test-key";
      process.env.VONAGE_API_SECRET = "test-secret";
      db = (await import("./db")).requireDb();
      schema = await import("../drizzle/schema");
      orm = await import("drizzle-orm");
      flow = await import("./db-phone");
    });

    afterAll(async () => {
      await db.delete(schema.users).where(orm.eq(schema.users.phone, phone));
      await db
        .delete(schema.phoneVerifications)
        .where(orm.eq(schema.phoneVerifications.phone, phone));
    });

    it("runs the whole flow and refuses every shortcut", async () => {
      const ip = `qa-${tail}`;
      const first = await flow.startPhoneVerification({
        phone,
        ip,
        fetchImpl: fakeVonage,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      // Resend too soon → cooldown, nothing sent.
      expect(
        await flow.startPhoneVerification({ phone, ip, fetchImpl: fakeVonage })
      ).toMatchObject({ ok: false, error: "cooldown" });
      expect(started).toBe(1);

      // Can't create an account before the code is confirmed.
      expect(
        await flow.createAccountWithVerifiedPhone({
          verificationId: first.verificationId,
          name: "QA",
          password: "password123",
        })
      ).toEqual({ ok: false, error: "not_verified" });

      // Wrong code, then the right one.
      expect(
        await flow.checkPhoneVerification({
          verificationId: first.verificationId,
          code: "111111",
          fetchImpl: fakeVonage,
        })
      ).toEqual({ ok: false, error: "wrong_code" });
      expect(
        await flow.checkPhoneVerification({
          verificationId: first.verificationId,
          code: GOOD_CODE,
          fetchImpl: fakeVonage,
        })
      ).toEqual({ ok: true });

      // One confirmed code → one account, even if submitted twice at once.
      const created = await Promise.all([
        flow.createAccountWithVerifiedPhone({
          verificationId: first.verificationId,
          name: "QA Student",
          password: "password123",
        }),
        flow.createAccountWithVerifiedPhone({
          verificationId: first.verificationId,
          name: "QA Student",
          password: "password123",
        }),
      ]);
      expect(created.filter(result => result.ok)).toHaveLength(1);
      const rows = await db
        .select({
          email: schema.users.email,
          phoneVerifiedAt: schema.users.phoneVerifiedAt,
          passwordHash: schema.users.passwordHash,
        })
        .from(schema.users)
        .where(orm.eq(schema.users.phone, phone));
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBeNull();
      expect(rows[0].phoneVerifiedAt).toBeInstanceOf(Date);
      expect(rows[0].passwordHash).not.toBe("password123");

      // Login lookup by number finds the account.
      const { getUserByPhone } = await import("./db");
      expect((await getUserByPhone(phone))?.phone).toBe(phone);

      // The number is now taken: no new sign-up, no SMS spent.
      const sentBefore = started;
      expect(
        await flow.startPhoneVerification({ phone, ip, fetchImpl: fakeVonage })
      ).toEqual({ ok: false, error: "phone_taken" });
      expect(started).toBe(sentBefore);
    });
  }
);
