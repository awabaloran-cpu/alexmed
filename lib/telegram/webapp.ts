// ✈️ Telegram Mini App sign-in.
//
// When a bot button opens NiroLearn INSIDE Telegram (a "web app" button),
// Telegram hands the page `initData`: who the user is, when it was issued,
// and a hash only Telegram and the bot can produce. Checking that hash on
// the server proves the Telegram user's identity — no link token, nothing
// that can be forwarded to someone else.
//
// The check is Telegram's documented one
// (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
//   secret = HMAC_SHA256(key: "WebAppData", message: <bot token>)
//   hash   = hex(HMAC_SHA256(key: secret, message: <data-check-string>))
// where the data-check-string is every field except `hash`, as "key=value",
// sorted by key and joined with newlines.
import { createHmac, timingSafeEqual } from "node:crypto";

export type MiniAppUser = {
  telegramUserId: number;
  languageCode: string | null;
};

// initData older than this is refused: it is minted when the Mini App is
// opened, so a real launch is always seconds old. Bounds how long a copied
// initData string could be replayed.
export const INIT_DATA_MAX_AGE_SECONDS = 60 * 60;

export function validateInitData(
  initData: string,
  botToken: string,
  now: Date = new Date(),
  maxAgeSeconds: number = INIT_DATA_MAX_AGE_SECONDS
): MiniAppUser | null {
  if (!initData || initData.length > 8192 || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret)
    .update(dataCheckString)
    .digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  const authDate = Number(params.get("auth_date"));
  const ageSeconds = now.getTime() / 1000 - authDate;
  if (!Number.isFinite(authDate) || ageSeconds > maxAgeSeconds) return null;
  // A date well in the future is not a clock skew, it is a forgery attempt
  // that the hash should already have stopped.
  if (ageSeconds < -300) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "null") as {
      id?: unknown;
      is_bot?: unknown;
      language_code?: unknown;
    } | null;
    if (!user || user.is_bot === true) return null;
    if (typeof user.id !== "number" || !Number.isSafeInteger(user.id)) {
      return null;
    }
    return {
      telegramUserId: user.id,
      languageCode:
        typeof user.language_code === "string" ? user.language_code : null,
    };
  } catch {
    return null;
  }
}
