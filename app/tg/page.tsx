"use client";

import "@/app/globals.css";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import s from "@/app/status.module.css";

// ✈️ The Mini App's front door: where a bot button lands when NiroLearn is
// opened INSIDE Telegram. It hands Telegram's signed launch data to the
// server (/api/telegram/webapp-session), which signs the student in, and
// then goes straight to the page the button was for (?to=…). The student
// sees a spinner for a moment, never a login form.
//
// Opened anywhere else (a normal browser, an old Telegram), there is no
// launch data: the page says so and offers the ordinary sign-in.
type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  openLink: (url: string) => void;
  close: () => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const SDK = "https://telegram.org/js/telegram-web-app.js";

export default function TelegramMiniAppPage() {
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  const start = useCallback(async () => {
    if (started.current) return;
    const app = window.Telegram?.WebApp;
    if (!app?.initData) return;
    started.current = true;
    app.ready();
    app.expand();
    const to = new URLSearchParams(window.location.search).get("to");
    try {
      const response = await fetch("/api/telegram/webapp-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData: app.initData, to }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const result = (await response.json()) as { to: string; external: string };
      // Telegram Web shows Mini Apps in a frame, where the session cookie
      // is a third-party cookie the browser will not keep: open the page in
      // a real tab there instead.
      if (window.self !== window.top) {
        app.openLink(result.external);
        app.close();
        return;
      }
      window.location.replace(result.to);
    } catch {
      setFailed(true);
    }
  }, []);

  // The SDK may already be there (a client-side return to this page), or
  // arrive through the <Script> below. Give it a few seconds, then stop
  // waiting: this is not Telegram.
  useEffect(() => {
    void start();
    const timer = window.setTimeout(() => {
      if (!started.current) setFailed(true);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [start]);

  return (
    <main className={s.screen} dir="rtl" lang="ar">
      <Script src={SDK} strategy="afterInteractive" onLoad={() => void start()} />
      <div className={s.panel}>
        {failed ? (
          <>
            <span className={s.icon}>
              <CircleAlert size={28} aria-hidden="true" />
            </span>
            <h1 className={s.title}>تعذّر الفتح من Telegram</h1>
            <p className={s.text}>
              افتح هذه الصفحة من زر البوت داخل Telegram، أو سجّل الدخول إلى
              حسابك مباشرة.
            </p>
            <a href="/login" className={s.action}>
              تسجيل الدخول
            </a>
          </>
        ) : (
          <>
            <span className={s.icon}>
              <Loader2 size={28} className="spin" aria-hidden="true" />
            </span>
            <h1 className={s.title}>جاري فتح NiroLearn…</h1>
            <p className={s.text}>لحظة واحدة.</p>
          </>
        )}
      </div>
    </main>
  );
}
