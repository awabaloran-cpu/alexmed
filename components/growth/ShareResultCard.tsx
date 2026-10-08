"use client";

import { useState } from "react";
import { Check, Copy, Gift, Send } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import s from "./ShareResultCard.module.css";

// 🎁 Shown when a student has answered every question of a file: their
// result, and one tap to send NiroLearn to classmates. With Telegram
// connected the link is the student's own invite (a classmate who uploads
// earns them an extra file — lib/telegram/growth.ts); otherwise it is a
// plain link to the bot. Renders nothing while the gateway is off.
export default function ShareResultCard({
  answered,
  correct,
}: {
  answered: number;
  correct: number;
}) {
  const invite = trpc.telegram.invite.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const [copied, setCopied] = useState(false);
  if (!invite.data?.available) return null;
  const { link, shareUrl, stats } = invite.data;
  const percent = answered ? Math.round((correct / answered) * 100) : 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access: the share button still works.
    }
  }

  return (
    <section className={s.card} aria-label="نتيجتك">
      <div className={s.score}>
        <strong dir="ltr">{percent}%</strong>
        <span>
          أنهيت {answered} سؤالًا · صحيح {correct}
        </span>
      </div>
      <p className={s.pitch}>
        <Gift size={16} aria-hidden="true" />
        {stats
          ? "شارك NiroLearn مع زملائك — كل زميل يرفع ملفه الأول يمنحك ملفًا إضافيًا."
          : "أعجبك؟ شارك NiroLearn مع زملائك."}
      </p>
      <div className={s.actions}>
        <a
          className={s.share}
          href={shareUrl}
          target="_blank"
          rel="noreferrer"
        >
          <Send size={16} aria-hidden="true" /> مشاركة عبر Telegram
        </a>
        <button type="button" className={s.copy} onClick={copy}>
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
      {stats && stats.joined > 0 ? (
        <p className={s.stats}>
          انضم عبر رابطك {stats.joined} · ملفات إضافية متاحة {stats.available}
        </p>
      ) : null}
    </section>
  );
}
