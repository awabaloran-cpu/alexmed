import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { telegramEnabled } from "@/lib/telegram/config";
import {
  handleTelegramUpdate,
  type TelegramUpdate,
} from "@/lib/telegram/handler";

// ✈️ Telegram calls this for every update. Nothing slow happens here: the
// handler writes a few rows, replies, and queues the real work.
//
// Authenticity: Telegram sends back the secret given to setWebhook in
// X-Telegram-Bot-Api-Secret-Token on every call; a request without it is
// refused before its body is read as an update.
function secretMatches(header: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!header || !expected) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  // Off (the default): as if the route did not exist.
  if (!telegramEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  if (!update || typeof update.update_id !== "number") {
    return NextResponse.json({ ok: true });
  }

  // Always 200 once authenticated: Telegram re-sends an update that got an
  // error for a long time, and a failure here is ours to log, not something
  // a re-delivery fixes (a recorded upload is retried by the queue instead).
  try {
    await handleTelegramUpdate(update);
  } catch (error) {
    console.error("[Telegram] Failed to handle update", {
      updateId: update.update_id,
      error,
    });
  }
  return NextResponse.json({ ok: true });
}
