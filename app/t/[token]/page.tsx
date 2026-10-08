import "@/app/globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CircleAlert, Sparkles } from "lucide-react";
import s from "@/app/status.module.css";
import { auth } from "@/lib/auth";
import { resolveWebLogin } from "@/lib/telegram/web-session";

// ✈️ Where a Telegram guest's button lands. Opening the link changes
// nothing — it only shows this page; the session starts when the student
// presses the button (a POST to /api/telegram/session). So a link preview,
// a prefetch or a forwarded link being glanced at signs nobody in.
export const metadata: Metadata = {
  title: "متابعة إلى NiroLearn",
  robots: { index: false, follow: false },
  // The address holds the link's token. The site-wide Referrer-Policy
  // (strict-origin-when-cross-origin, next.config.ts) already keeps the path
  // from other sites. "no-referrer" must NOT be set here: it makes browsers
  // send `Origin: null` with the form below, and the session route would
  // then refuse this page's own button.
  referrer: "strict-origin-when-cross-origin",
};

export const dynamic = "force-dynamic";

export default async function TelegramLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [target, session] = await Promise.all([
    resolveWebLogin(token),
    auth(),
  ]);

  if (!target) {
    return (
      <main className={s.screen} dir="rtl" lang="ar">
        <div className={s.panel}>
          <span className={s.icon}>
            <CircleAlert size={28} aria-hidden="true" />
          </span>
          <h1 className={s.title}>انتهت صلاحية هذا الرابط</h1>
          <p className={s.text}>
            اطلب رابطًا جديدًا من البوت في Telegram، أو سجّل الدخول إلى حسابك
            للوصول إلى ملفاتك.
          </p>
          <Link href="/login" className={s.action}>
            تسجيل الدخول
            <ArrowLeft size={16} aria-hidden="true" />
          </Link>
        </div>
      </main>
    );
  }

  // Already in as this same guest (the button was pressed before on this
  // browser): nothing to confirm.
  if (session?.user?.id === target.user.id) redirect(target.path);

  return (
    <main className={s.screen} dir="rtl" lang="ar">
      <div className={s.panel}>
        <span className={s.icon}>
          <Sparkles size={28} aria-hidden="true" />
        </span>
        <h1 className={s.title}>ملفك جاهز في NiroLearn</h1>
        <p className={s.text}>
          {session?.user
            ? "أنت مسجّل الآن بحساب آخر على هذا المتصفح. المتابعة ستفتح ملفك المرفوع من Telegram بحساب الضيف."
            : "اضغط للمتابعة وابدأ الدراسة مباشرة — بدون تسجيل."}
        </p>
        <form method="post" action="/api/telegram/session">
          <input type="hidden" name="token" value={token} />
          <button type="submit" className={s.action}>
            متابعة
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
        </form>
      </div>
    </main>
  );
}
