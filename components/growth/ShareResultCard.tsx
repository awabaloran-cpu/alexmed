"use client";

import { useState } from "react";
import { Check, Copy, Gift, Send, Upload, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import s from "./ShareResultCard.module.css";

// 🎁 Shown when a student has answered every question of a file: their
// result, and the one next step that brings classmates in.
//
// - The file's owner sends THIS file to their batch (lib/share-links.ts):
//   classmates open the same questions, which is what a group wants.
// - A classmate who got the file by a link is asked to bring a file of
//   their own to the bot.
// - Anything else (no link possible, e.g. a protected set) falls back to
//   the student's invite to NiroLearn (lib/telegram/growth.ts).
//
// Renders nothing while the gateway is off.
export default function ShareResultCard({
  answered,
  correct,
  bookId,
  shared = false,
}: {
  answered: number;
  correct: number;
  bookId: string;
  // The file belongs to a classmate.
  shared?: boolean;
}) {
  const invite = trpc.telegram.invite.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const utils = trpc.useUtils();
  const fileLink = trpc.sharing.link.useQuery(
    { bookId },
    { enabled: !shared, retry: false, refetchOnWindowFocus: false }
  );
  const createLink = trpc.sharing.createLink.useMutation({
    onSuccess: data => utils.sharing.link.setData({ bookId }, data),
  });
  const [copied, setCopied] = useState(false);
  if (!invite.data?.available) return null;
  const { stats, uploadLink } = invite.data;
  const percent = answered ? Math.round((correct / answered) * 100) : 0;

  // What this card sends: the file itself for its owner, else the invite.
  const file = shared ? null : (fileLink.data ?? null);
  const canMakeFileLink =
    !shared && !file && !fileLink.isLoading && !createLink.isError;
  const sendingFile = Boolean(file) || canMakeFileLink;
  const link = file?.url ?? invite.data.link;
  const shareUrl = file?.shareUrl ?? invite.data.shareUrl;

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

      {shared && uploadLink ? (
        <>
          <p className={s.pitch}>
            <Upload size={16} aria-hidden="true" />
            عندك ملف أسئلة أو ملخص لمادة أخرى؟ أرسله للبوت ويتحوّل إلى اختبار
            مثل هذا.
          </p>
          <div className={s.actions}>
            <a
              className={s.share}
              href={uploadLink}
              target="_blank"
              rel="noreferrer"
            >
              <Upload size={16} aria-hidden="true" /> حوّل ملفك أنت
            </a>
          </div>
        </>
      ) : null}

      <p className={shared && uploadLink ? s.note : s.pitch}>
        {sendingFile ? (
          <Users size={16} aria-hidden="true" />
        ) : (
          <Gift size={16} aria-hidden="true" />
        )}
        {sendingFile
          ? "أرسل هذا الملف لمجموعة الدفعة: يفتحه زملاؤك ويحلّون الأسئلة نفسها، ولكلٍّ تقدّمه الخاص."
          : stats
            ? "شارك NiroLearn مع زملائك — كل زميل يرفع ملفه الأول يمنحك ملفًا إضافيًا."
            : "أعجبك؟ شارك NiroLearn مع زملائك."}
      </p>
      <div className={s.actions}>
        {canMakeFileLink ? (
          <button
            type="button"
            className={s.share}
            disabled={createLink.isPending}
            onClick={() => createLink.mutate({ bookId })}
          >
            <Users size={16} aria-hidden="true" />
            {createLink.isPending ? "جاري إنشاء الرابط…" : "أرسل الملف لدفعتك"}
          </button>
        ) : (
          <>
            <a
              className={shared && uploadLink ? s.copy : s.share}
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Send size={16} aria-hidden="true" />{" "}
              {file ? "أرسله عبر Telegram" : "مشاركة عبر Telegram"}
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
          </>
        )}
      </div>
      {file && file.joinCount > 0 ? (
        <p className={s.stats}>انضم عبر رابط هذا الملف {file.joinCount}</p>
      ) : !file && stats && stats.joined > 0 ? (
        <p className={s.stats}>
          انضم عبر رابطك {stats.joined} · ملفات إضافية متاحة {stats.available}
        </p>
      ) : null}
    </section>
  );
}
