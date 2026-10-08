"use client";

import { useState } from "react";
import { Check, Copy, Link2, Send, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import s from "./ShareLinkPanel.module.css";

// 🔗 The owner's "share by link" for one file (lib/share-links.ts): make
// the link, copy it, send it through Telegram, see how many joined, and
// stop it. Stopping asks once more in place — no browser dialog — because
// it takes the file away from everyone who joined.
export default function ShareLinkPanel({ bookId }: { bookId: string }) {
  const utils = trpc.useUtils();
  const link = trpc.sharing.link.useQuery(
    { bookId },
    { retry: false, refetchOnWindowFocus: false }
  );
  const create = trpc.sharing.createLink.useMutation({
    onSuccess: data => utils.sharing.link.setData({ bookId }, data),
  });
  const revoke = trpc.sharing.revokeLink.useMutation({
    onSuccess: () => {
      utils.sharing.link.setData({ bookId }, null);
      setConfirming(false);
    },
  });
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const live = link.data ?? null;
  const error = create.error ?? revoke.error;

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access: the link is on screen to select.
    }
  }

  return (
    <section className={s.panel} aria-label="مشاركة الملف برابط">
      <div className={s.head}>
        <Link2 size={18} aria-hidden="true" />
        <div>
          <strong>شارك الملف مع زملائك</strong>
          <p>
            يفتحون الملف نفسه من Telegram ويدرسون منه. لكل واحد تقدّمه الخاص،
            ولا يستطيع أحد تعديل ملفك.
          </p>
        </div>
      </div>

      {live ? (
        <>
          <p className={s.url} dir="ltr">
            {live.url}
          </p>
          <div className={s.actions}>
            <a
              className={s.primary}
              href={live.shareUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Send size={16} aria-hidden="true" /> أرسله عبر Telegram
            </a>
            <button
              type="button"
              className={s.secondary}
              onClick={() => copy(live.url)}
            >
              {copied ? (
                <>
                  <Check size={16} aria-hidden="true" /> تم النسخ
                </>
              ) : (
                <>
                  <Copy size={16} aria-hidden="true" /> نسخ الرابط
                </>
              )}
            </button>
          </div>
          <div className={s.foot}>
            <span className={s.joined}>
              <Users size={14} aria-hidden="true" /> انضم {live.joinCount}
            </span>
            {confirming ? (
              <span className={s.confirm}>
                سيفقد كل من انضم الوصول للملف.
                <button
                  type="button"
                  className={s.danger}
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate({ bookId })}
                >
                  أوقف المشاركة
                </button>
                <button
                  type="button"
                  className={s.text}
                  onClick={() => setConfirming(false)}
                >
                  تراجع
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={s.text}
                onClick={() => setConfirming(true)}
              >
                إيقاف الرابط
              </button>
            )}
          </div>
        </>
      ) : (
        <button
          type="button"
          className={s.primary}
          disabled={create.isPending || link.isLoading}
          onClick={() => create.mutate({ bookId })}
        >
          <Link2 size={16} aria-hidden="true" />
          {create.isPending ? "جاري إنشاء الرابط…" : "أنشئ رابط المشاركة"}
        </button>
      )}

      {error ? (
        <p className={s.error} role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
