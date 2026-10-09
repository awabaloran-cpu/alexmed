"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Loader2, Play } from "lucide-react";
import type { DeckBreak } from "@/components/questions/QuestionList";
import type { AdBreakPolicy } from "@/lib/ads/policy";
import { trpc } from "@/lib/trpc-client";
import { insideTelegram, loadAdsgram, watchRewardedAd } from "./adsgram";
import s from "./AdBreak.module.css";

type ActivePolicy = Extract<AdBreakPolicy, { enabled: true }>;

// 📣 The pause between groups of questions for students on a free plan
// (lib/ads/policy.ts decides whether there is one, and who fills it).
//
// Laid out so an ad is never tapped by accident: the student's own recap
// comes first, the ad sits in its own labelled box, and "متابعة" is a
// separate, full-width button well below it — nothing here looks like, or
// sits next to, an answer button. Nothing asks the student to tap the ad.
//
// Inside Telegram, with an AdsGram block configured, the pause is a rewarded
// ad instead: one button plays it, and the next questions open when it has
// been watched to the end (components/ads/adsgram.ts).
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

  // Decided once, when the pause appears (a pause is only ever drawn in
  // the browser, after the student moved on from a question).
  const [rewardedBlock] = useState(() =>
    policy.adsgram && insideTelegram() ? policy.adsgram.blockId : null
  );
  const provider = rewardedBlock ? "adsgram" : policy.provider;

  // One impression per pause shown.
  useEffect(() => {
    recordRef.current({ bookId, provider, event: "impression" });
  }, [bookId, provider, info.afterPosition]);

  // NiroLearn's own card: what fills the break when Google is not the
  // provider — or has nothing to show.
  const house = (
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
  );

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

      {rewardedBlock ? (
        <RewardedGate
          key={info.afterPosition}
          blockId={rewardedBlock}
          onContinue={info.onContinue}
          report={event =>
            record.mutate({ bookId, provider: "adsgram", event })
          }
        />
      ) : (
        <>
          <div className={s.adBox}>
            <span className={s.adLabel}>إعلان</span>
            {policy.provider === "adsense" && policy.adsense ? (
              <AdSenseUnit
                key={info.afterPosition}
                client={policy.adsense.client}
                slot={policy.adsense.slot}
                fallback={house}
              />
            ) : (
              house
            )}
          </div>

          <button
            type="button"
            className={s.continue}
            onClick={info.onContinue}
          >
            متابعة الأسئلة <ChevronLeft size={17} aria-hidden="true" />
          </button>
        </>
      )}
    </section>
  );
}

// The rewarded pause: the questions after it open when the ad has played to
// its end. Closing the ad early keeps the pause; an ad that cannot be shown
// at all (none available, blocked, an error) lets the student through —
// they are never held back by something they cannot do.
function RewardedGate({
  blockId,
  onContinue,
  report,
}: {
  blockId: string;
  onContinue: () => void;
  report: (event: "reward" | "skip" | "unavailable") => void;
}) {
  const [state, setState] = useState<"ready" | "loading" | "skipped">("ready");

  // Fetched while the student reads the pause, so the press plays at once.
  useEffect(() => {
    loadAdsgram().catch(() => {});
  }, []);

  const watch = async () => {
    if (state === "loading") return;
    setState("loading");
    const result = await watchRewardedAd(blockId);
    if (result === "skipped") {
      report("skip");
      setState("skipped");
      return;
    }
    report(result === "watched" ? "reward" : "unavailable");
    onContinue();
  };

  return (
    <>
      <div className={s.gate}>
        <span className={s.adLabel}>إعلان قصير</span>
        <p>
          شاهد إعلانًا قصيرًا لتفتح الأسئلة التالية. الإعلانات تُبقي NiroLearn
          مجانيًا لك ولزملائك.
        </p>
        {state === "skipped" && (
          <p className={s.gateNote} role="status">
            أُغلق الإعلان قبل نهايته. شاهده حتى النهاية لتتابع.
          </p>
        )}
      </div>

      <button
        type="button"
        className={s.continue}
        onClick={() => void watch()}
        disabled={state === "loading"}
      >
        {state === "loading" ? (
          <>
            <Loader2 size={17} className="spin" aria-hidden="true" />
            جاري تحميل الإعلان…
          </>
        ) : (
          <>
            <Play size={16} aria-hidden="true" />
            {state === "skipped"
              ? "شاهد الإعلان مرة أخرى"
              : "شاهد الإعلان وتابع الأسئلة"}
          </>
        )}
      </button>

      <Link href="/pricing" className={s.noAds}>
        ادرس بلا إعلانات مع NiroLearn Pro
      </Link>
    </>
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
//
// Google marks the unit data-ad-status="unfilled" when it has no ad for this
// view (a new site, a low-inventory country), and an ad blocker leaves it
// with no status at all. Either way an empty white box is the worst thing
// to show in the middle of a study session, so `fallback` takes its place —
// hiding an unfilled unit is the handling Google's own help documents.
const NO_ANSWER_AFTER_MS = 4000;

function AdSenseUnit({
  client,
  slot,
  fallback,
}: {
  client: string;
  slot: string;
  fallback: ReactNode;
}) {
  const unit = useRef<HTMLModElement>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const ins = unit.current;
    if (!ins) return;
    const read = () => {
      const status = ins.getAttribute("data-ad-status");
      if (status) setEmpty(status === "unfilled");
      return status;
    };
    const observer = new MutationObserver(read);
    observer.observe(ins, {
      attributes: true,
      attributeFilter: ["data-ad-status"],
    });
    const timer = window.setTimeout(() => {
      if (!read()) setEmpty(true);
    }, NO_ANSWER_AFTER_MS);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

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
    <>
      <ins
        ref={unit}
        className={`adsbygoogle ${s.unit} ${empty ? s.unitEmpty : ""}`}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
      {empty ? fallback : null}
    </>
  );
}
