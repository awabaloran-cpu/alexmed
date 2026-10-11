"use client";

// Learn mode: one question at a time — a segmented bar across the top,
// the cover, the question, four coloured answers two by two. An answer is
// judged on the spot, the right one is shown, and the end is a score with
// stars.
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  Droplet,
  Hexagon,
  Leaf,
  MoreVertical,
  RotateCcw,
  Share2,
  Star,
  Users,
  X,
} from "lucide-react";
import { starsFor } from "@/lib/discover/study";
import { Cover } from "@/components/discover/Cover";
import { useDiscover } from "@/components/discover/DiscoverProvider";
import { usePlayInRoom } from "@/components/discover/QuizSheet";
import { buzz, play } from "@/components/discover/sound";
import {
  SoundControls,
  StudyScreen,
  type StudyQuiz,
} from "@/components/discover/Study";
import s from "@/components/discover/discover.module.css";

// Our own four: a colour and a mark each, so an answer is told apart by
// more than its colour.
const MARKS = [Star, Hexagon, Droplet, Leaf];
// How long the right answer stays up before the next question.
const REVEAL_MS = 1500;

function Result({
  quiz,
  correct,
  onAgain,
}: {
  quiz: StudyQuiz;
  correct: number;
  onAgain: () => void;
}) {
  const { t } = useDiscover();
  const total = quiz.questions.length;
  const stars = starsFor(correct, total);
  const room = usePlayInRoom(quiz.slug, quiz.title);
  useEffect(() => {
    play("finish");
  }, []);
  return (
    <div className={s.result}>
      <h1>{t("learn.resultTitle")}</h1>
      <p className={s.percent} dir="ltr">
        {Math.round((correct / total) * 100)}%
      </p>
      <p
        className={s.stars}
        role="img"
        aria-label={t("learn.stars", { n: stars })}
      >
        {[1, 2, 3].map(n => (
          <Star
            key={n}
            size={38}
            className={n <= stars ? s.starOn : s.starOff}
            aria-hidden="true"
          />
        ))}
      </p>
      <p>{t("learn.score", { correct, total })}</p>
      <p className={s.praise}>
        {t(
          stars === 3
            ? "learn.praise3"
            : stars === 2
              ? "learn.praise2"
              : stars === 1
                ? "learn.praise1"
                : "learn.praise0"
        )}
      </p>
      <button type="button" className={s.primary} onClick={onAgain}>
        <RotateCcw size={18} aria-hidden="true" /> {t("learn.again")}
      </button>
      {room.available ? (
        <button
          type="button"
          className={s.button}
          disabled={room.busy}
          onClick={room.play}
        >
          <Users size={18} aria-hidden="true" />
          {room.busy ? t("sheet.opening") : t("learn.playRoom")}
        </button>
      ) : null}
      {room.error ? (
        <p className={s.error} role="alert">
          {room.error.text}{" "}
          {room.error.setup ? (
            <Link href="/rooms" className={s.linkButton}>
              {t("sheet.roomSetup")}
            </Link>
          ) : null}
        </p>
      ) : null}
      <Link href={`/discover/cards/${quiz.slug}`} className={s.button}>
        {t("sheet.cards")}
      </Link>
      <Link href="/discover" className={s.linkButton}>
        {t("learn.toDiscover")}
      </Link>
    </div>
  );
}

function Learn({ quiz }: { quiz: StudyQuiz }) {
  const { t } = useDiscover();
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const total = quiz.questions.length;
  const restart = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setIndex(0);
    setPicked(null);
    setAnswers([]);
    setMenu(false);
  };

  if (index >= total) {
    return (
      <Result
        quiz={quiz}
        correct={answers.filter(Boolean).length}
        onAgain={restart}
      />
    );
  }

  const question = quiz.questions[index];
  const next = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setPicked(null);
    setIndex(value => value + 1);
  };
  const answer = (option: number) => {
    if (picked !== null) return;
    const right = option === question.correctIndex;
    setPicked(option);
    setAnswers(list => [...list, right]);
    play(right ? "correct" : "wrong");
    buzz(right ? 12 : [20, 40, 20]);
    timer.current = window.setTimeout(next, REVEAL_MS + (right ? 0 : 900));
  };

  async function share() {
    setMenu(false);
    const url = `${window.location.origin}/discover?quiz=${quiz.slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: quiz.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Dismissed, or no clipboard here.
    }
  }

  return (
    <>
      <div className={s.studyBar}>
        <Link href="/discover" className={s.round} aria-label={t("learn.exit")}>
          <X size={20} aria-hidden="true" />
        </Link>
        <span className={s.studyBarEnd}>
          <button
            type="button"
            className={s.round}
            aria-label={t("sheet.share")}
            onClick={share}
          >
            <Share2 size={20} aria-hidden="true" />
          </button>
          <SoundControls />
          <button
            type="button"
            className={s.round}
            aria-label={t("sheet.options")}
            aria-expanded={menu}
            onClick={() => setMenu(value => !value)}
          >
            <MoreVertical size={20} aria-hidden="true" />
          </button>
          {menu ? (
            <div className={s.menu} role="menu">
              <button type="button" role="menuitem" onClick={restart}>
                <RotateCcw size={16} aria-hidden="true" /> {t("learn.restart")}
              </button>
              <Link href={`/discover/cards/${quiz.slug}`} role="menuitem">
                {t("sheet.cards")}
              </Link>
            </div>
          ) : null}
        </span>
      </div>
      {copied ? (
        <p className={s.toast} role="status">
          {t("sheet.copied")}
        </p>
      ) : null}

      <div
        className={s.segments}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={index}
        aria-label={t("learn.question", { n: index + 1, total })}
      >
        {quiz.questions.map((item, segment) => (
          <i
            key={item.id}
            className={
              segment < index
                ? answers[segment]
                  ? s.segmentRight
                  : s.segmentWrong
                : segment === index
                  ? s.segmentNow
                  : undefined
            }
          />
        ))}
      </div>

      <Cover
        art={quiz.art}
        color={quiz.color}
        image={question.image ?? quiz.coverImage}
        className={s.questionArt}
      />

      <div className={s.questionBox} key={question.id}>
        <small>{t("learn.question", { n: index + 1, total })}</small>
        <h1 dir="auto">{question.text}</h1>
      </div>

      <div className={s.answers}>
        {question.options.map((option, optionIndex) => {
          const Mark = MARKS[optionIndex % MARKS.length];
          const isRight = optionIndex === question.correctIndex;
          const state =
            picked === null
              ? ""
              : isRight
                ? s.answerRight
                : optionIndex === picked
                  ? s.answerWrong
                  : s.answerDim;
          return (
            <button
              key={option}
              type="button"
              className={`${s.answer} ${s[`answer${optionIndex % 4}`]} ${state}`}
              disabled={picked !== null}
              onClick={() => answer(optionIndex)}
            >
              <span className={s.answerMark}>
                {picked !== null && isRight ? (
                  <Check size={20} aria-hidden="true" />
                ) : picked === optionIndex ? (
                  <X size={20} aria-hidden="true" />
                ) : (
                  <Mark size={20} aria-hidden="true" />
                )}
              </span>
              <span dir="auto">{option}</span>
            </button>
          );
        })}
      </div>

      <div className={s.verdict} aria-live="polite">
        {picked === null ? null : (
          <>
            <b
              className={
                picked === question.correctIndex
                  ? s.verdictRight
                  : s.verdictWrong
              }
            >
              {picked === question.correctIndex
                ? t("learn.correct")
                : t("learn.wrong")}
            </b>
            {picked === question.correctIndex ? null : (
              <span dir="auto">
                {t("learn.rightAnswer", {
                  answer: question.options[question.correctIndex],
                })}
              </span>
            )}
            <button type="button" className={s.button} onClick={next}>
              {index + 1 >= total ? t("learn.finish") : t("learn.next")}
            </button>
          </>
        )}
      </div>
    </>
  );
}

export default function LearnPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  return <StudyScreen slug={slug}>{quiz => <Learn quiz={quiz} />}</StudyScreen>;
}
