// ✈️ The URL a bot button opens.
//
//   guest       → /t/<token>: a link that signs the guest account in (the
//                 guest has no other way in) and lands on `path`.
//   registered  → /api/telegram/open?to=<path>: the page itself when they
//                 are already signed in on that browser, otherwise the
//                 normal login and then the page. A registered account is
//                 NEVER signed in by a link — a forwarded message must not
//                 hand over an account that holds a student's whole library.
//
// connectLink: a guest's way to keep their files — /connect/<token>, where
// they sign in (or create an account) and the guest is merged into it.
import type { TelegramUserState } from "./accounts";
import { webLoginLinkTtlMinutes, webUrl } from "./config";
import { createLinkToken } from "./tokens";

export async function openLink(
  user: Pick<TelegramUserState, "id" | "isGuest">,
  path: string
): Promise<string> {
  if (!user.isGuest) {
    return webUrl(`/api/telegram/open?to=${encodeURIComponent(path)}`);
  }
  const token = await createLinkToken({
    userId: user.id,
    purpose: "web_login",
    path,
    ttlMinutes: webLoginLinkTtlMinutes(),
  });
  return webUrl(`/t/${token}`);
}

export async function connectLink(
  user: Pick<TelegramUserState, "id">
): Promise<string> {
  const token = await createLinkToken({
    userId: user.id,
    purpose: "guest_claim",
    ttlMinutes: webLoginLinkTtlMinutes(),
  });
  return webUrl(`/connect/${token}`);
}
