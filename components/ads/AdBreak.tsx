"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ChevronLeft } from "lucide-react";
import type { DeckBreak } from "@/components/questions/QuestionList";
import type { AdBreakPolicy } from "@/lib/ads/policy";
import { trpc } from "@/lib/trpc-client";
import s from "./AdBreak.module.css";

type ActivePolicy = Extract<AdBreakPolicy, { enabled: true }>;

// 📣 The pause between groups of questions for students on a free plan
// (lib/ads/policy.ts decides whether there is one, and who fills it).
//
// Laid out so an ad is never tapped by accident: the student's own recap
// comes first, the ad sits in its own labelled box, and "متابعة" is a
// separate, full-width button well below it — nothing here looks like, or
// sits next to, an answer button. Nothing asks the student to tap the ad.
export default function AdBreak({
  policy,
  bookId,
  info,
}: {
  policy: ActivePolicy;
  bookId: string;
  info: DeckBreak;
}) {
  const record = trpc.ads.record.useMutation();
  const recordRef = useRef(record.mutate);
  recordRef.current = record.mutate;

  // One impression per pause shown.
  useEffect(() => {
    recordRef.current({
      bookId,
      provider: policy.provider,
      event: "impression",
    });
  }, [bookId, policy.provider, info.afterPosition]);

  return (
    <section className={s.break} aria-label="استراحة قصيرة">
      <div className={s.recap}>
        <h2>أحسنت — أنهيت {info.afterPosition} من {info.total}</h2>
        {info.answered > 0 && (
          <p>
            في آخر مجموعة: أجبت {info.answered} · صحيح {info.correct}
          </p>
        )}
      </div>

      <div className={s.adBox}>
        <span className={s.adLabel}>إعلان</span>
        {policy.provider === "adsense" && policy.adsense ? (
          <AdSenseUnit
            key={info.afterPosition}
            client={policy.adsense.client}
            slot={policy.adsense.slot}
          />
        ) : (
          <Link
            href="/pricing"
            className={s.house}
            onClick={() =>
              record.mutate({ bookId, provider: "house", event: "click" })
            }
          >
            <strong>NiroLearn Pro</strong>
            <span>دراسة بلا إعلانات، وحدود أعلى لملفاتك وأسئلتك.</span>
          </Link>
        )}
      </div>

      <button type="button" className={s.continue} onClick={info.onContinue}>
        متابعة الأسئلة <ChevronLeft size={17} aria-hidden="true" />
      </button>
    </section>
  );
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const ADSENSE_SCRIPT = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

// A standard responsive AdSense display unit — Google's own tag, unmodified.
// The loader script is added once per page, only when a unit is first shown,
// so students who never see an ad never load it.
function AdSenseUnit({ client, slot }: { client: string; slot: string }) {
  useEffect(() => {
    if (!document.querySelector("script[data-nl-adsense]")) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `${ADSENSE_SCRIPT}?client=${encodeURIComponent(client)}`;
      script.crossOrigin = "anonymous";
      script.dataset.nlAdsense = "1";
      document.head.appendChild(script);
    }
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // A blocked or failed ad must never break the question flow.
    }
  }, [client]);

  return (
    <ins
      className={`adsbygoogle ${s.unit}`}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
