// Vonage Verify v2 client — request shape, auth, and how every provider
// answer maps to our outcomes. A fake fetch stands in; nothing is sent.
import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelVerification,
  checkCode,
  isSmsConfigured,
  SmsNotConfiguredError,
  startVerification,
  verifyChannels,
  verifyDiagnostics,
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
    expect(result).toEqual({
      ok: true,
      requestId: "req-1",
      channel: "sms",
      lifetimeSeconds: 300,
    });
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

  describe("with WhatsApp first (VONAGE_VERIFY_CHANNELS=whatsapp,sms)", () => {
    const bodyOf = (call: unknown) =>
      JSON.parse(String((call as [string, RequestInit])[1].body));
    const restore = { ...process.env };
    beforeEach(() => {
      process.env.VONAGE_VERIFY_CHANNELS = "whatsapp, sms";
    });
    afterEach(() => {
      for (const key of [
        "VONAGE_VERIFY_CHANNELS",
        "VONAGE_WHATSAPP_FROM",
        "VONAGE_CHANNEL_TIMEOUT_SECONDS",
      ]) {
        if (restore[key] === undefined) delete process.env[key];
        else process.env[key] = restore[key];
      }
    });

    it("asks Vonage to try WhatsApp, then SMS after the channel timeout", async () => {
      const fetchImpl = vi.fn(async () => reply(202, { request_id: "req-2" }));
      const result = await startVerification("+962791234567", fetchImpl);
      expect(result).toEqual({
        ok: true,
        requestId: "req-2",
        channel: "whatsapp",
        // Two channels, 90 seconds each.
        lifetimeSeconds: 180,
      });
      expect(bodyOf(fetchImpl.mock.calls[0])).toMatchObject({
        channel_timeout: 90,
        workflow: [
          { channel: "whatsapp", to: "962791234567" },
          { channel: "sms", to: "962791234567" },
        ],
      });
      expect(bodyOf(fetchImpl.mock.calls[0]).workflow[0]).not.toHaveProperty("from");
    });

    it("sends from the account's own WhatsApp number when one is configured", async () => {
      process.env.VONAGE_WHATSAPP_FROM = "+962 7 9000 0000";
      const fetchImpl = vi.fn(async () => reply(202, { request_id: "req-3" }));
      await startVerification("+962791234567", fetchImpl);
      expect(bodyOf(fetchImpl.mock.calls[0]).workflow[0]).toEqual({
        channel: "whatsapp",
        to: "962791234567",
        from: "962790000000",
      });
    });

    it("if Vonage refuses the WhatsApp workflow, sign-up still works: SMS alone", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(reply(422, { title: "Invalid params" }))
        .mockResolvedValueOnce(reply(202, { request_id: "req-4" }));
      const result = await startVerification("+962791234567", fetchImpl);
      expect(result).toEqual({
        ok: true,
        requestId: "req-4",
        channel: "sms",
        lifetimeSeconds: 300,
      });
      expect(bodyOf(fetchImpl.mock.calls[1]).workflow).toEqual([
        { channel: "sms", to: "962791234567" },
      ]);
    });

    it("does not retry when the refusal is not about the channel", async () => {
      for (const status of [409, 429, 401]) {
        const fetchImpl = vi.fn(async () => reply(status, {}));
        await startVerification("+962791234567", fetchImpl);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      }
    });
  });

  it("signs requests with the application's key when one is configured, and reports why WhatsApp was refused", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const before = { ...process.env };
    process.env.VONAGE_APPLICATION_ID = "app-123";
    // As dashboards store it: one line, literal "\n".
    process.env.VONAGE_PRIVATE_KEY = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString()
      .replace(/\n/g, "\\n");
    process.env.VONAGE_VERIFY_CHANNELS = "whatsapp,sms";
    process.env.VONAGE_WHATSAPP_FROM = "962790000000";
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          reply(422, {
            title: "Invalid sender",
            detail: "The from number is not linked to this application",
            invalid_parameters: [{ name: "from", reason: "not a WhatsApp number" }],
          })
        )
        .mockResolvedValueOnce(reply(202, { request_id: "req-5" }));
      const result = await startVerification("+962791234567", fetchImpl);
      expect(result).toMatchObject({ ok: true, channel: "sms" });

      const header = (
        (fetchImpl.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>
      ).Authorization;
      expect(header).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      const [head, payload, signature] = header.slice(7).split(".");
      expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({
        application_id: "app-123",
      });
      expect(
        createVerify("RSA-SHA256")
          .update(`${head}.${payload}`)
          .verify(publicKey, Buffer.from(signature, "base64url"))
      ).toBe(true);

      const diagnostics = verifyDiagnostics();
      expect(diagnostics).toMatchObject({
        channels: ["whatsapp", "sms"],
        auth: "application_jwt",
        whatsappFromConfigured: true,
      });
      expect(diagnostics.lastChannelRefusal).toMatchObject({
        status: 422,
        detail:
          "Invalid sender — The from number is not linked to this application — from: not a WhatsApp number",
      });
      // Settings and Vonage's words only: no number, no key.
      expect(JSON.stringify(diagnostics)).not.toMatch(/9627|PRIVATE KEY/);
    } finally {
      for (const key of [
        "VONAGE_APPLICATION_ID",
        "VONAGE_PRIVATE_KEY",
        "VONAGE_VERIFY_CHANNELS",
        "VONAGE_WHATSAPP_FROM",
      ]) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
    }
  });

  it("ignores unknown channels and falls back to SMS only", () => {
    const before = process.env.VONAGE_VERIFY_CHANNELS;
    try {
      process.env.VONAGE_VERIFY_CHANNELS = "carrier-pigeon";
      expect(verifyChannels()).toEqual(["sms"]);
      process.env.VONAGE_VERIFY_CHANNELS = "WhatsApp";
      expect(verifyChannels()).toEqual(["whatsapp"]);
    } finally {
      if (before === undefined) delete process.env.VONAGE_VERIFY_CHANNELS;
      else process.env.VONAGE_VERIFY_CHANNELS = before;
    }
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
