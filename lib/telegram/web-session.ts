// ✈️ Turning a guest's /t/<token> link into a web session.
//
// The session is the ordinary Auth.js one (lib/mobile-session.ts issues the
// exact token the web's own sign-in puts in the cookie), so every page and
// procedure authorizes the guest through the unchanged `auth()` — including
// its per-request re-check that the account still exists and isn't
// suspended. There is no second kind of session.
//
// Only a GUEST account can be entered this way. Once the account is
// registered its links stop working (and are revoked): a registered account
// signs in with its own credentials, never by a link that may have been
// forwarded.
import { eq } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { requireDb } from "../db";
import { isGuestUser } from "./accounts";
import { findLinkToken, safeInternalPath } from "./tokens";

export type WebLoginTarget = {
  tokenId: string;
  path: string;
  user: { id: string; name: string | null; email: null; role: string };
};

export async function resolveWebLogin(
  token: string
): Promise<WebLoginTarget | null> {
  const link = await findLinkToken(token, "web_login");
  if (!link) return null;
  const [user] = await requireDb()
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      email: users.email,
      phone: users.phone,
      passwordHash: users.passwordHash,
      suspendedAt: users.suspendedAt,
    })
    .from(users)
    .where(eq(users.id, link.userId))
    .limit(1);
  if (!user || user.suspendedAt || !isGuestUser(user)) return null;
  return {
    tokenId: link.id,
    path: safeInternalPath(link.path),
    user: { id: user.id, name: user.name, email: null, role: user.role },
  };
}

// True when a POST really came from one of this site's own pages. The
// exchange sets a session cookie, so a form on another site must not be
// able to submit it (that would sign a visitor into an account the other
// site chose). Browsers send Origin on every cross-site POST; Sec-Fetch-Site
// covers the rest.
export function isSameOriginPost(request: Request, siteUrl: string): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (!origin) return fetchSite === "same-origin";

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(siteUrl).host);
  } catch {
    // An unparsable site URL just leaves the request's own host.
  }
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host");
  if (host) allowed.add(host);
  try {
    return allowed.has(new URL(origin).host);
  } catch {
    return false;
  }
}
