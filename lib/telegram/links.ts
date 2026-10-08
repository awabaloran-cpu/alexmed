// ✈️ The URL a bot button opens.
//
//   guest       → /t/<token>: a link that signs the guest account in (the
//                 guest has no other way in) and lands on `path`.
//   registered  → the page itself. A registered account is NEVER signed in
//                 by a link — a forwarded message must not hand over an
//                 account that holds a student's whole library — so they go
//                 through the normal login.
import type { TelegramUserState } from "./accounts";
import { webLoginLinkTtlMinutes, webUrl } from "./config";
import { createLinkToken } from "./tokens";

export async function openLink(
  user: Pick<TelegramUserState, "id" | "isGuest">,
  path: string
): Promise<string> {
  if (!user.isGuest) return webUrl(path);
  const token = await createLinkToken({
    userId: user.id,
    purpose: "web_login",
    path,
    ttlMinutes: webLoginLinkTtlMinutes(),
  });
  return webUrl(`/t/${token}`);
}
