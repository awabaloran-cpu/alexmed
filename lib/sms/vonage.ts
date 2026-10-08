// 📱 Vonage Verify v2 — sends the sign-up SMS code and checks it. Vonage
// generates, delivers and checks the code itself (we never see or store
// it), and enforces its own limits (3 wrong codes per request, one active
// request per number). https://developer.vonage.com/en/api/verify.v2
//
// Env: VONAGE_API_KEY, VONAGE_API_SECRET (Basic auth), optional
// VONAGE_BRAND (the name shown in the SMS, default "NiroLearn"),
// VONAGE_LOCALE (message language, default "ar-xa") and VONAGE_API_BASE
// (tests / local QA only). Secrets stay server-side.

export type VonageFetch = typeof fetch;

export class SmsNotConfiguredError extends Error {
  constructor() {
    super(
      "SMS verification is not configured (VONAGE_API_KEY / VONAGE_API_SECRET)."
    );
    this.name = "SmsNotConfiguredError";
  }
}

export type StartResult =
  | {
      ok: true;
      requestId: string;
      // The channel the code goes to first, and how long it can be entered.
      channel: VerifyChannel;
      lifetimeSeconds: number;
    }
  | {
      ok: false;
      reason:
        | "invalid_number"
        | "concurrent"
        | "rate_limited"
        | "provider_error";
    };

export type CheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: "wrong_code" | "expired" | "rate_limited" | "provider_error";
    };

export const SMS_CODE_LENGTH = 6;
// How long the code in the SMS stays valid at Vonage.
export const SMS_CODE_TTL_SECONDS = 300;

// Where the code is sent, in order (VONAGE_VERIFY_CHANNELS, e.g.
// "whatsapp,sms"). Vonage tries the first channel and moves to the next one
// only if the code was not entered within channelTimeoutSeconds() — so with
// "whatsapp,sms" an SMS is paid for only when WhatsApp did not do the job.
// Unset = SMS only, exactly as before.
export type VerifyChannel = "whatsapp" | "sms";

export function verifyChannels(): VerifyChannel[] {
  const wanted = (process.env.VONAGE_VERIFY_CHANNELS ?? "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter((value): value is VerifyChannel =>
      value === "whatsapp" || value === "sms"
    );
  const unique = [...new Set(wanted)];
  return unique.length ? unique : ["sms"];
}

// How long Vonage waits on one channel before trying the next. With a
// single channel this is simply how long the code stays valid.
export function channelTimeoutSeconds(): number {
  if (verifyChannels().length === 1) return SMS_CODE_TTL_SECONDS;
  const wanted = Number(process.env.VONAGE_CHANNEL_TIMEOUT_SECONDS) || 90;
  return Math.min(900, Math.max(15, Math.round(wanted)));
}

// How long the code can still be entered: every channel gets its turn.
export function codeLifetimeSeconds(): number {
  return verifyChannels().length * channelTimeoutSeconds();
}

function workflowFor(channels: VerifyChannel[], to: string) {
  const whatsappFrom = process.env.VONAGE_WHATSAPP_FROM?.replace(/\D/g, "");
  return channels.map(channel =>
    channel === "whatsapp"
      ? // `from` is the account's own WhatsApp Business number, when it has
        // one; without it Vonage uses its shared sender.
        { channel, to, ...(whatsappFrom ? { from: whatsappFrom } : {}) }
      : { channel, to }
  );
}

function config() {
  const key = process.env.VONAGE_API_KEY;
  const secret = process.env.VONAGE_API_SECRET;
  if (!key || !secret) throw new SmsNotConfiguredError();
  return {
    base: (process.env.VONAGE_API_BASE || "https://api.nexmo.com").replace(
      /\/$/,
      ""
    ),
    auth: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
    brand: process.env.VONAGE_BRAND || "NiroLearn",
    locale: process.env.VONAGE_LOCALE || "ar-xa",
  };
}

export function isSmsConfigured(): boolean {
  return Boolean(process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET);
}

async function errorType(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    type?: string;
    title?: string;
  } | null;
  // Vonage errors are RFC 7807: `type` is a URL ending in the error name.
  return `${body?.type ?? ""} ${body?.title ?? ""}`.toLowerCase();
}

// `e164` is "+9627…"; Vonage wants the digits without "+".
export async function startVerification(
  e164: string,
  fetchImpl: VonageFetch = fetch
): Promise<StartResult> {
  const { base, auth, brand, locale } = config();
  const to = e164.replace(/^\+/, "");
  const channels = verifyChannels();
  const send = (use: VerifyChannel[], timeout: number) =>
    fetchImpl(`${base}/v2/verify`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        brand,
        locale,
        code_length: SMS_CODE_LENGTH,
        channel_timeout: timeout,
        workflow: workflowFor(use, to),
      }),
    });

  let used = channels;
  let lifetimeSeconds = codeLifetimeSeconds();
  let response = await send(channels, channelTimeoutSeconds());
  // WhatsApp refused outright (not enabled on the account, a sender that is
  // not set up): sign-up must not stop working because of it — send the
  // code by SMS alone, and say so in the logs.
  if (
    !response.ok &&
    channels.includes("whatsapp") &&
    channels.includes("sms") &&
    response.status !== 409 &&
    response.status !== 429 &&
    response.status !== 401 &&
    response.status !== 403
  ) {
    console.error(
      "[SMS] Vonage refused the WhatsApp workflow, falling back to SMS only",
      response.status,
      await errorType(response.clone())
    );
    used = ["sms"];
    lifetimeSeconds = SMS_CODE_TTL_SECONDS;
    response = await send(used, SMS_CODE_TTL_SECONDS);
  }
  if (response.ok) {
    const body = (await response.json()) as { request_id?: string };
    return body.request_id
      ? {
          ok: true,
          requestId: body.request_id,
          channel: used[0],
          lifetimeSeconds,
        }
      : { ok: false, reason: "provider_error" };
  }
  const type = await errorType(response);
  if (response.status === 409 || type.includes("concurrent")) {
    return { ok: false, reason: "concurrent" };
  }
  if (response.status === 429) return { ok: false, reason: "rate_limited" };
  if (response.status === 422 || response.status === 400) {
    return { ok: false, reason: "invalid_number" };
  }
  if (response.status === 401 || response.status === 403) {
    console.error("[SMS] Vonage rejected our credentials", response.status);
  } else {
    console.error("[SMS] Vonage start failed", response.status, type);
  }
  return { ok: false, reason: "provider_error" };
}

export async function checkCode(
  requestId: string,
  code: string,
  fetchImpl: VonageFetch = fetch
): Promise<CheckResult> {
  const { base, auth } = config();
  const response = await fetchImpl(
    `${base}/v2/verify/${encodeURIComponent(requestId)}`,
    {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }
  );
  if (response.ok) return { ok: true };
  const type = await errorType(response);
  if (response.status === 429) return { ok: false, reason: "rate_limited" };
  if (type.includes("invalid-code") || type.includes("invalid code")) {
    return { ok: false, reason: "wrong_code" };
  }
  // "expired" (too many wrong codes), request-not-found, 410 gone.
  if ([400, 404, 409, 410].includes(response.status)) {
    return { ok: false, reason: "expired" };
  }
  console.error("[SMS] Vonage check failed", response.status, type);
  return { ok: false, reason: "provider_error" };
}

// Best effort: frees the number for a new code right away (Vonage allows
// one active request per number). Failure is harmless — it expires anyway.
export async function cancelVerification(
  requestId: string,
  fetchImpl: VonageFetch = fetch
): Promise<void> {
  try {
    const { base, auth } = config();
    await fetchImpl(`${base}/v2/verify/${encodeURIComponent(requestId)}`, {
      method: "DELETE",
      headers: { Authorization: auth },
    });
  } catch {
    // ignore
  }
}
