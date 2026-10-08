import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { users } from "@/drizzle/schema";
import { requireDb } from "@/lib/db";
import {
  issueMobileSession,
  MOBILE_SESSION_MAX_AGE_SECONDS,
} from "@/lib/mobile-session";
import { safeCallbackUrl } from "@/lib/safe-redirect";
import { SITE_URL } from "@/lib/site";
import { ensureTelegramAccount } from "@/lib/telegram/accounts";
import {
  telegramBotToken,
  telegramEnabled,
  webUrl,
} from "@/lib/telegram/config";
import { externalOpenLink } from "@/lib/telegram/links";
import { validateInitData } from "@/lib/telegram/webapp";
import { isSameOriginPost } from "@/lib/telegram/web-session";

// ✈️ The Mini App page (/tg) posts Telegram's signed initData here. A valid
// one proves which Telegram user opened the app, so the account that user
// is connected to is signed in — the ordinary session cookie, exactly as
// /api/telegram/session issues for a guest link.
//
// `external` is the same destination as a link for an ordinary browser:
// Telegram Web shows Mini Apps in a frame, where this cookie would be a
// third-party cookie, so there the page opens that link in a new tab
// instead.
const NO_STORE = { "Cache-Control": "private, no-store" };

function refuse(status: number, code: string) {
  return NextResponse.json({ error: code }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!telegramEnabled()) return refuse(404, "not_found");
  if (!isSameOriginPost(request, SITE_URL)) return refuse(403, "forbidden");

  const body = (await request.json().catch(() => null)) as {
    initData?: unknown;
    to?: unknown;
  } | null;
  const initData = typeof body?.initData === "string" ? body.initData : "";
  const to = safeCallbackUrl(typeof body?.to === "string" ? body.to : null);

  const identity = validateInitData(initData, telegramBotToken());
  if (!identity) return refuse(401, "invalid_init_data");

  // A private chat's id is the user's own id.
  const context = await ensureTelegramAccount({
    telegramUserId: identity.telegramUserId,
    chatId: identity.telegramUserId,
    languageCode: identity.languageCode,
  });
  if (context.user.suspended) return refuse(403, "account_suspended");

  const [user] = await requireDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, context.user.id))
    .limit(1);
  if (!user) return refuse(401, "invalid_init_data");

  const session = await issueMobileSession(user, request.url);
  const response = NextResponse.json(
    {
      to,
      external: webUrl(await externalOpenLink(context.user, to)),
    },
    { headers: NO_STORE }
  );
  response.cookies.set(session.cookieName, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: session.cookieName.startsWith("__Secure-"),
    path: "/",
    maxAge: MOBILE_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
