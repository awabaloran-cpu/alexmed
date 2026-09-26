// Vonage Verify v2 client — request shape, auth, and how every provider
// answer maps to our outcomes. A fake fetch stands in; nothing is sent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelVerification,
  checkCode,
  isSmsConfigured,
  SmsNotConfiguredError,
  startVerification,
} from "./vonage";

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const problem = (name: string) => ({
  type: `https://developer.vonage.com/api-errors/verify#${name}`,
  title: name,
});

beforeEach(() => {
  process.env.VONAGE_API_KEY = "key123";
  process.env.VONAGE_API_SECRET = "secret456";
  delete process.env.VONAGE_API_BASE;
});
afterEach(() => {
  delete process.env.VONAGE_API_KEY;
  delete process.env.VONAGE_API_SECRET;
});

describe("startVerification", () => {
  it("sends an SMS workflow with basic auth, brand and a 6-digit code", async () => {
    const fetchImpl = vi.fn(async () => reply(202, { request_id: "req-1" }));
    const result = await startVerification("+962791234567", fetchImpl);
    expect(result).toEqual({ ok: true, requestId: "req-1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.nexmo.com/v2/verify");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("key123:secret456").toString("base64")}`
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      brand: "NiroLearn",
      code_length: 6,
      workflow: [{ channel: "sms", to: "962791234567" }],
    });
  });

  it("maps provider errors", async () => {
    const run = (status: number, body: unknown) =>
      startVerification("+962791234567", async () => reply(status, body));
    expect(await run(409, problem("concurrent"))).toEqual({
      ok: false,
      reason: "concurrent",
    });
    expect(await run(429, {})).toEqual({ ok: false, reason: "rate_limited" });
    expect(await run(422, problem("invalid-params"))).toEqual({
      ok: false,
      reason: "invalid_number",
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run(401, {})).toEqual({
      ok: false,
      reason: "provider_error",
    });
    error.mockRestore();
  });

  it("refuses to run without credentials", async () => {
    delete process.env.VONAGE_API_KEY;
    expect(isSmsConfigured()).toBe(false);
    await expect(
      startVerification("+962791234567", vi.fn())
    ).rejects.toBeInstanceOf(SmsNotConfiguredError);
  });
});

describe("checkCode", () => {
  it("accepts the right code", async () => {
    const fetchImpl = vi.fn(async () =>
      reply(200, { request_id: "req-1", status: "completed" })
    );
    expect(await checkCode("req-1", "123456", fetchImpl)).toEqual({
      ok: true,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.nexmo.com/v2/verify/req-1");
    expect(JSON.parse(String(init.body))).toEqual({ code: "123456" });
  });

  it("tells a wrong code from an expired request", async () => {
    expect(
      await checkCode("r", "000000", async () =>
        reply(400, problem("invalid-code"))
      )
    ).toEqual({ ok: false, reason: "wrong_code" });
    expect(
      await checkCode("r", "000000", async () => reply(400, problem("expired")))
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      await checkCode("r", "000000", async () =>
        reply(404, problem("request-not-found"))
      )
    ).toEqual({ ok: false, reason: "expired" });
  });
});

it("cancel never throws", async () => {
  await expect(
    cancelVerification("r", async () => {
      throw new Error("network");
    })
  ).resolves.toBeUndefined();
});
