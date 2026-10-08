import "@/app/globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Link2, Send } from "lucide-react";
import s from "@/app/status.module.css";
import { auth } from "@/lib/auth";
import {
  findGuestForClaim,
  getTelegramLinkForUser,
  isTelegramGuest,
} from "@/lib/telegram/accounts";
import { telegramBotUsername } from "@/lib/telegram/config";
import c from "./connect.module.css";

// ✈️ "Keep my files": where a Telegram guest connects the chat to a real
// NiroLearn account. One page, three moments:
//
//   not signed in        → create an account, or sign in to an existing one;
//                          either way they come back here afterwards
//   signed in (a real    → confirm: the guest's files move into this
//   account)               account and the bot is told
//   done                 → back to Telegram
//
// Opening the page changes nothing; every step is a button (a same-site
// POST to /api/telegram/connect).
export const metadata: Metadata = {
  title: "ربط Telegram بحسابك | NiroLearn",
  robots: { index: false, follow: false },
  referrer: "strict-origin-when-cross-origin",
};

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  account_has_other_telegram:
    "حسابك هذا مربوط بحساب Telegram آخر. افصله من صفحة «حسابي» ثم حاول مرة ثانية.",
  already_linked_elsewhere: "حساب Telegram هذا مربوط بحساب NiroLearn آخر.",
  invalid_code: "انتهت صلاحية هذا الرابط. اطلب رابطًا جديدًا من البوت.",
};

function Action({
  token,
  action,
  children,
  secondary = false,
}: {
  token: string;
  action: "register" | "login" | "link";
  children: React.ReactNode;
  secondary?: boolean;
}) {
  return (
    <form method="post" action="/api/telegram/connect">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="action" value={action} />
      <button
        type="submit"
        className={secondary ? c.secondary : `${s.action} ${c.primary}`}
      >
        {children}
      </button>
    </form>
  );
}

export default async function TelegramConnectPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ token }, { error }] = await Promise.all([params, searchParams]);
  const [guest, session] = await Promise.all([
    findGuestForClaim(token),
    auth(),
  ]);
  const userId = session?.user?.id ?? null;
  const registered = userId ? !(await isTelegramGuest(userId)) : false;
  const errorText = error ? ERRORS[error] : null;
  const bot = telegramBotUsername();

  // The link was used (or expired). A registered student whose account is
  // now connected has just finished.
  if (!guest) {
    const connected =
      registered && userId ? !!(await getTelegramLinkForUser(userId)) : false;
    return (
      <main className={s.screen} dir="rtl" lang="ar">
        <div className={s.panel}>
          <span className={s.icon}>
            {connected ? (
              <CheckCircle2 size={28} aria-hidden="true" />
            ) : (
              <CircleAlert size={28} aria-hidden="true" />
            )}
          </span>
          <h1 className={s.title}>
            {connected ? "تم ربط Telegram بحسابك" : "انتهت صلاحية هذا الرابط"}
          </h1>
          <p className={s.text}>
            {connected
              ? "ملفاتك المرفوعة من Telegram صارت في حسابك. ارجع إلى المحادثة وأرسل ملفك التالي."
              : "اطلب رابطًا جديدًا من البوت في Telegram، أو اربط حسابك من صفحة «حسابي»."}
          </p>
          <div className={c.actions}>
            {connected && bot ? (
              <a href={`https://t.me/${bot}`} className={`${s.action} ${c.primary}`}>
                <Send size={16} aria-hidden="true" />
                العودة إلى Telegram
              </a>
            ) : null}
            <Link href={connected ? "/subjects" : "/account"} className={c.secondary}>
              {connected ? "فتح ملفاتي في NiroLearn" : "صفحة حسابي"}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={s.screen} dir="rtl" lang="ar">
      <div className={s.panel}>
        <span className={s.icon}>
          <Link2 size={28} aria-hidden="true" />
        </span>
        {registered ? (
          <>
            <h1 className={s.title}>ربط Telegram بحسابك</h1>
            <p className={s.text}>
              ستنتقل ملفاتك المرفوعة من Telegram وتقدّمك فيها إلى حسابك
              {session?.user?.name ? (
                <>
                  {" "}
                  <bdi>{session.user.name}</bdi>
                </>
              ) : null}
              ، وكل ملف ترسله للبوت بعدها يُضاف إليه.
            </p>
            {errorText ? (
              <p className={c.error} role="alert">
                {errorText}
              </p>
            ) : null}
            <div className={c.actions}>
              <Action token={token} action="link">
                تأكيد الربط
              </Action>
              <Action token={token} action="login" secondary>
                ليس حسابك؟ سجّل الدخول بحساب آخر
              </Action>
            </div>
          </>
        ) : (
          <>
            <h1 className={s.title}>احفظ ملفاتك في حسابك</h1>
            <p className={s.text}>
              سجّل الدخول أو أنشئ حسابًا مجانيًا، وملفك المرفوع من Telegram
              وتقدّمك ينتقلان إليه كما هما.
            </p>
            <div className={c.actions}>
              <Action token={token} action="login">
                لديّ حساب — تسجيل الدخول
              </Action>
              <Action token={token} action="register" secondary>
                إنشاء حساب جديد
              </Action>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
