import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { SITE_URL } from "@/lib/site";
import {
  connectGuestToAccount,
  findGuestForClaim,
  isTelegramGuest,
} from "@/lib/telegram/accounts";
import { sendMessage } from "@/lib/telegram/api";
import { mainKeyboard, TEXT } from "@/lib/telegram/messages";
import { isSameOriginPost } from "@/lib/telegram/web-session";

// ✈️ The buttons of /connect/<token> post here.
//
//   register | login  → on to the sign-up / sign-in page, to come back to
//                       /connect/<token> afterwards. A guest session on this
//                       browser is ended first, so the student signs in or
//                       registers as a real account, never "on top of" the
//                       guest.
//   link              → the signed-in, registered student confirmed: the
//                       guest (and its files) is merged into their account
//                       and the bot says so in the chat.
//
// Same-site POST only, like every route that changes who is signed in.
const NO_STORE = { "Cache-Control": "private, no-store" };
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function go(path: string) {
  return new NextResponse(null, {
    status: 303,
    headers: { ...NO_STORE, Location: path },
  });
}

export async function POST(request: Request) {
  if (!isSameOriginPost(request, SITE_URL)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: NO_STORE }
    );
  }
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  const action = form?.get("action");
  if (typeof token !== "string" || !TOKEN.test(token)) return go("/login");
  const page = `/connect/${token}`;

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const signedInAsGuest = userId ? await isTelegramGuest(userId) : false;

  if (action === "register" || action === "login") {
    // An expired link has nothing to come back to.
    if (!(await findGuestForClaim(token))) return go(page);
    const response = go(`/${action}?callbackUrl=${encodeURIComponent(page)}`);
    if (signedInAsGuest) {
      for (const name of SESSION_COOKIES) {
        response.cookies.set(name, "", {
          path: "/",
          maxAge: 0,
          httpOnly: true,
          sameSite: "lax",
          secure: name.startsWith("__Secure-"),
        });
      }
    }
    return response;
  }

  if (action === "link") {
    if (!userId || signedInAsGuest) return go(page);
    const outcome = await connectGuestToAccount(token, userId);
    if (!outcome.ok) return go(`${page}?error=${outcome.reason}`);
    if (outcome.chatId) {
      // The link is done either way; a failed message must not undo it.
      await sendMessage(outcome.chatId, TEXT.linked, mainKeyboard()).catch(
        error => console.error("[Telegram] Could not announce the link", error)
      );
    }
    return go(page);
  }

  return go(page);
}
