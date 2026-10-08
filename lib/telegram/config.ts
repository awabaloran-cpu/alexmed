// ✈️ Telegram gateway — the one place that reads its env vars.
//
// The gateway is OFF unless TELEGRAM_ENABLED=true and both the bot token and
// the webhook secret are set: with it off, the webhook answers 404 and no
// other part of the app behaves differently.
import { SITE_URL } from "../site";

const MB = 1024 * 1024;

function readInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function telegramEnabled(): boolean {
  return (
    process.env.TELEGRAM_ENABLED === "true" &&
    !!process.env.TELEGRAM_BOT_TOKEN &&
    !!process.env.TELEGRAM_WEBHOOK_SECRET
  );
}

export function telegramBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

export function telegramBotUsername(): string | null {
  return process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || null;
}

// Telegram's own servers, unless a self-hosted Bot API server is configured
// (github.com/tdlib/telegram-bot-api).
const CLOUD_API_BASE = "https://api.telegram.org";

export function telegramApiBase(): string {
  return (process.env.TELEGRAM_API_BASE || CLOUD_API_BASE).replace(/\/$/, "");
}

export function usesLocalBotApi(): boolean {
  return telegramApiBase() !== CLOUD_API_BASE;
}

// Telegram's cloud Bot API refuses to hand a bot any file above 20 MB
// (core.telegram.org/bots/api#getfile); only a self-hosted Bot API server
// lifts that. So the wanted limit (TELEGRAM_MAX_FILE_MB, default 70) is
// only reachable with TELEGRAM_API_BASE set — otherwise 20 MB is the
// ceiling, and larger files are sent to the web upload page.
export const CLOUD_BOT_API_MAX_FILE_MB = 20;

export function telegramMaxFileBytes(): number {
  const wanted = readInt("TELEGRAM_MAX_FILE_MB", 70);
  const reachable = usesLocalBotApi()
    ? wanted
    : Math.min(wanted, CLOUD_BOT_API_MAX_FILE_MB);
  return reachable * MB;
}

// The longest PDF the bot takes, in pages. A long file costs one AI call a
// page and more: a 5,057-page bank sent on 2026-10-08 had to be stopped by
// hand.
export function telegramMaxPages(): number {
  return readInt("TELEGRAM_MAX_PAGES", 100);
}

// How many files a guest (no registered account yet) may send before the
// bot asks them to create their account.
export function guestFreeUploads(): number {
  return readInt("TELEGRAM_GUEST_FREE_UPLOADS", 1);
}

// Every Telegram upload across all users, per rolling 24 hours — the
// ceiling on what the channel can cost in a day, whatever else fails.
export function telegramDailyUploadCap(): number {
  return readInt("TELEGRAM_DAILY_UPLOAD_CAP", 300);
}

// Files one Telegram account may send per 10 minutes (before plan quotas
// and the job-creation limit are even consulted).
export function telegramAccountBurstLimit(): number {
  return readInt("TELEGRAM_ACCOUNT_BURST_LIMIT", 5);
}
export const TELEGRAM_BURST_WINDOW_MINUTES = 10;

// A guest's "open NiroLearn" link stays valid this long.
export function webLoginLinkTtlMinutes(): number {
  return readInt("TELEGRAM_LINK_TTL_MINUTES", 24 * 60);
}

// Bot buttons open NiroLearn inside Telegram (a Mini App) unless this is
// switched off — then they are ordinary links to the browser.
export function miniAppEnabled(): boolean {
  return process.env.TELEGRAM_MINI_APP !== "false";
}

export function webUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
