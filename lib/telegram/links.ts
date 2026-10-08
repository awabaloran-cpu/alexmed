// ✈️ What a bot button opens.
//
// Mini App (the default): the button is a Telegram "web app" button to
// /tg?to=<path>. NiroLearn opens INSIDE Telegram and signs the student in
// from Telegram's own signed data (lib/telegram/webapp.ts) — guest or
// registered alike, with no token in any link.
//
// Ordinary links (TELEGRAM_MINI_APP=false, and the fallback the Mini App
// itself uses where it cannot run, e.g. Telegram Web):
//   guest       → /t/<token>: signs the guest account in (the guest has no
//                 other way in) and lands on `path`.
//   registered  → /api/telegram/open?to=<path>: the page itself when they
//                 are already signed in on that browser, otherwise the
//                 normal login and then the page. A registered account is
//                 never signed in by a link — a forwarded message must not
//                 hand over an account that holds a student's whole library.
//
// connectLink: a guest's way to keep their files — /connect/<token>, where
// they sign in (or create an account) and the guest is merged into it.
import type { TelegramUserState } from "./accounts";
import type { InlineButton } from "./api";
import { miniAppEnabled, webLoginLinkTtlMinutes, webUrl } from "./config";
import { createLinkToken } from "./tokens";

type LinkUser = Pick<TelegramUserState, "id" | "isGuest">;

// The ordinary-browser destination, as a path on this site.
export async function externalOpenLink(
  user: LinkUser,
  path: string
): Promise<string> {
  if (!user.isGuest) {
    return `/api/telegram/open?to=${encodeURIComponent(path)}`;
  }
  const token = await createLinkToken({
    userId: user.id,
    purpose: "web_login",
    path,
    ttlMinutes: webLoginLinkTtlMinutes(),
  });
  return `/t/${token}`;
}

export async function openLink(user: LinkUser, path: string): Promise<string> {
  return webUrl(await externalOpenLink(user, path));
}

// The button itself. Web-app buttons only exist in private chats, which is
// the only place the bot talks.
export async function openButton(
  user: LinkUser,
  text: string,
  path: string
): Promise<InlineButton> {
  if (miniAppEnabled()) {
    return {
      text,
      web_app: { url: webUrl(`/tg?to=${encodeURIComponent(path)}`) },
    };
  }
  return { text, url: await openLink(user, path) };
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
