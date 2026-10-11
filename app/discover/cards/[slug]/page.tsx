"use client";

// Flashcards: a stack. A tap turns the top card over to its answer; a
// swipe to the right says "I know it", to the left "review later" — the
// two buttons under the stack do the same for anyone not swiping. The end
// is a summary, and the next round is only the cards left for later.
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, RotateCcw, Undo2, X } from "lucide-react";
import {
  allCards,
  newRound,
  repeatLater,
  roundDone,
  sortCard,
  swipeVerdict,
  type Round,
} from "@/lib/discover/study";
import { useDiscover } from "@/components/discover/DiscoverProvider";
import { buzz, play } from "@/components/discover/sound";
import {
  SoundControls,
  StudyScreen,
  type StudyQuiz,
} from "@/components/discover/Study";
import s from "@/components/discover/discover.module.css";

// How long a card takes to leave before the next one is on top.
const LEAVE_MS = 220;

function Cards({ quiz }: { quiz: StudyQuiz }) {
  const { t } = useDiscover();
  const total = quiz.questions.length;
  const [round, setRound] = useState<Round>(() => newRound(allCards(total)));
  const [size, setSize] = useState(total);
  const [flipped, setFlipped] = useState(false);
  const [drag, setDrag] = useState(0);
  const [leaving, setLeaving] = useState<"know" | "later" | null>(null);
  const start = useRef<{ x: number; id: number; moved: boolean } | null>(null);
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const begin = (next: Round) => {
    setRound(next);
    setSize(next.queue.length);
    setFlipped(false);
    setDrag(0);
    setLeaving(null);
  };

  const sort = (knew: boolean) => {
    if (leaving) return;
    setLeaving(knew ? "know" : "later");
    play("swipe");
    buzz();
    timer.current = window.setTimeout(() => {
      setRound(current => {
        const next = sortCard(current, knew);
        if (roundDone(next)) play("finish");
        return next;
      });
      setFlipped(false);
      setDrag(0);
      setLeaving(null);
    }, LEAVE_MS);
  };

  // Left and right arrows sort, space turns the card.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (roundDone(round)) return;
      if (event.key === "ArrowRight") sort(true);
      else if (event.key === "ArrowLeft") sort(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `sort` reads only state that changes with `round` and `leaving`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, leaving]);

  const bar = (
    <div className={s.studyBar}>
      <Link href="/discover" className={s.round} aria-label={t("learn.exit")}>
        <X size={20} aria-hidden="true" />
      </Link>
      <b className={s.studyCount} dir="ltr">
        {roundDone(round) ? "" : `${size - round.queue.length + 1} / ${size}`}
      </b>
      <span className={s.studyBarEnd}>
        <SoundControls />
      </span>
    </div>
  );

  if (roundDone(round)) {
    return (
      <>
        {bar}
        <div className={s.result}>
          <h1>{t("cards.doneTitle")}</h1>
          <p>
            {round.later.length
              ? t("cards.summary", {
                  known: round.known.length,
                  later: round.later.length,
                })
              : t("cards.allKnown")}
          </p>
          {round.later.length ? (
            <button
              type="button"
              className={s.primary}
              onClick={() => begin(repeatLater(round))}
            >
              <Undo2 size={18} aria-hidden="true" />
              {t("cards.repeat", { n: round.later.length })}
            </button>
          ) : null}
          <button
            type="button"
            className={round.later.length ? s.button : s.primary}
            onClick={() => begin(newRound(allCards(total)))}
          >
            <RotateCcw size={18} aria-hidden="true" /> {t("cards.restart")}
          </button>
          <Link href={`/discover/learn/${quiz.slug}`} className={s.button}>
            {t("cards.toLearn")}
          </Link>
          <Link href="/discover" className={s.linkButton}>
            {t("learn.toDiscover")}
          </Link>
        </div>
      </>
    );
  }

  const card = quiz.questions[round.queue[0]];
  const behind = round.queue.length - 1;
  const width = cardRef.current?.offsetWidth ?? 320;
  const leaning = leaving ?? swipeVerdict(drag, width);
  const shift = leaving ? (leaving === "know" ? 1 : -1) * width * 1.4 : drag;

  return (
    <>
      {bar}
      <div
        className={s.segments}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={size}
        aria-valuenow={size - round.queue.length}
        aria-label={t("cards.progress", {
          n: size - round.queue.length + 1,
          total: size,
        })}
      >
        {Array.from({ length: size }, (_, segment) => (
          <i
            key={segment}
            className={
              segment < size - round.queue.length
                ? s.segmentRight
                : segment === size - round.queue.length
                  ? s.segmentNow
                  : undefined
            }
          />
        ))}
      </div>

      <div className={s.stack}>
        {behind > 1 ? <span className={`${s.ghost} ${s.ghost2}`} /> : null}
        {behind > 0 ? <span className={s.ghost} /> : null}
        <button
          ref={cardRef}
          key={card.id}
          type="button"
          className={`${s.flash} ${flipped ? s.flashFlipped : ""} ${
            leaning === "know"
              ? s.flashKnow
              : leaning === "later"
                ? s.flashLater
                : ""
          }`}
          style={{
            transform: `translateX(${shift}px) rotate(${shift / 24}deg)`,
            transition: start.current && !leaving ? "none" : undefined,
            opacity: leaving ? 0 : 1,
          }}
          aria-label={flipped ? t("cards.answer") : t("cards.flipHint")}
          onPointerDown={event => {
            if (leaving) return;
            start.current = {
              x: event.clientX,
              id: event.pointerId,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const from = start.current;
            if (!from || from.id !== event.pointerId) return;
            const dx = event.clientX - from.x;
            if (Math.abs(dx) > 6) from.moved = true;
            if (from.moved) setDrag(dx);
          }}
          onPointerUp={event => {
            const from = start.current;
            start.current = null;
            if (!from) return;
            const verdict = from.moved
              ? swipeVerdict(event.clientX - from.x, width)
              : null;
            if (verdict) sort(verdict === "know");
            else {
              setDrag(0);
              // A tap, not a drag: the card turns over.
              if (!from.moved) {
                setFlipped(value => !value);
                play("flip");
              }
            }
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag(0);
          }}
          onClick={event => {
            // The keyboard's Enter or Space (a pointer's tap is handled
            // above, where a drag can be told from it).
            if (event.detail !== 0) return;
            setFlipped(value => !value);
            play("flip");
          }}
        >
          <span className={s.flashInner}>
            <span className={s.flashFace}>
              <span dir="auto">{card.text}</span>
              <small>{t("cards.flipHint")}</small>
            </span>
            <span className={`${s.flashFace} ${s.flashBack}`}>
              <small>{t("cards.answer")}</small>
              <span dir="auto">{card.options[card.correctIndex]}</span>
            </span>
          </span>
        </button>
      </div>

      <p className={s.hint}>{t("cards.swipeHint")}</p>
      {/* Left and right are the hand's, not the language's: "later" is
          always on the left, "I know it" on the right. */}
      <div className={s.sortButtons} dir="ltr">
        <button
          type="button"
          className={s.sortLater}
          disabled={!!leaving}
          onClick={() => sort(false)}
        >
          <Undo2 size={18} aria-hidden="true" /> {t("cards.later")}
        </button>
        <button
          type="button"
          className={s.sortKnow}
          disabled={!!leaving}
          onClick={() => sort(true)}
        >
          <Check size={18} aria-hidden="true" /> {t("cards.know")}
        </button>
      </div>
    </>
  );
}

export default function CardsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  return <StudyScreen slug={slug}>{quiz => <Cards quiz={quiz} />}</StudyScreen>;
}
