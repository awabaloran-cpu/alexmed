import { NextResponse } from "next/server";
import {
  issueMobileSession,
  MOBILE_SESSION_MAX_AGE_SECONDS,
} from "@/lib/mobile-session";
import { SITE_URL } from "@/lib/site";
import { markLinkTokenUsed } from "@/lib/telegram/tokens";
import { isSameOriginPost, resolveWebLogin } from "@/lib/telegram/web-session";

// ✈️ The confirm button on /t/<token> posts here: the guest's link becomes
// an ordinary session cookie and the browser is sent on to the file.
//
// A POST from this site's own page only (never a GET, so a link preview or
// a prefetch can't sign anyone in, and never a form on another site).
const NO_STORE = { "Cache-Control": "private, no-store" };

function back(path: string) {
  // A relative Location keeps the browser on the host it is already on,
  // whatever host the proxy shows this server.
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
  if (typeof token !== "string") return back("/login");

  const target = await resolveWebLogin(token);
  // Unknown, expired, revoked, or no longer a guest: the page explains.
  if (!target) return back(`/t/${encodeURIComponent(token)}`);

  const session = await issueMobileSession(target.user, request.url);
  await markLinkTokenUsed(target.tokenId);

  const response = back(target.path);
  response.cookies.set(session.cookieName, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: session.cookieName.startsWith("__Secure-"),
    path: "/",
    maxAge: MOBILE_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
