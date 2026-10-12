"use client";

// A quiz on its public page: every question is on the page as text (a
// reader, or a search engine, sees all of it without pressing anything),
// and a visitor can also play it — pick an answer, see at once whether it
// was right, and watch the score at the foot of the page.
import { useState } from "react";
import {
  Check,
  Droplet,
  Hexagon,
  Leaf,
  RotateCcw,
  Star,
  X,
} from "lucide-react";
import type { DiscoverLanguage } from "@/lib/discover/data";
import { translate, type DiscoverKey } from "@/lib/discover/i18n";
import type { PublicQuiz as Quiz } from "@/lib/discover/public";
import { starsFor } from "@/lib/discover/study";
import s from "./public.module.css";

// The same four marks as the app's learn mode: an answer is told apart by
// more than its colour.
const MARKS = [Star, Hexagon, Droplet, Leaf];

export function PublicQuiz({
  quiz,
  language,
}: {
  quiz: Quiz;
  language: DiscoverLanguage;
}) {
  const t = (key: DiscoverKey, params?: Record<string, string | number>) =>
    translate(language, key, params);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const total = quiz.questions.length;
  const answered = Object.keys(picked).length;
  const correct = quiz.questions.filter(
    (question, index) => picked[index] === question.correctIndex
  ).length;
  const done = answered === total;

  return (
    <>
      <ol className={s.questions}>
        {quiz.questions.map((question, index) => {
          const choice = picked[index];
          const answeredThis = choice !== undefined;
          return (
            <li key={question.text} className={s.question}>
              <h3>
                <span className={s.number} aria-hidden="true">
                  {index + 1}
                </span>
                <span dir="auto">{question.text}</span>
              </h3>
              <div className={s.options}>
                {question.options.map((option, optionIndex) => {
                  const Mark = MARKS[optionIndex % MARKS.length];
                  const right = optionIndex === question.correctIndex;
                  return (
                    <button
                      key={option}
                      type="button"
                      className={`${s.option} ${s[`option${optionIndex % 4}`]} ${
                        !answeredThis
                          ? ""
                          : right
                            ? s.optionRight
                            : optionIndex === choice
                              ? s.optionWrong
                              : s.optionDim
                      }`}
                      disabled={answeredThis}
                      onClick={() =>
                        setPicked(all => ({ ...all, [index]: optionIndex }))
                      }
                    >
                      <span className={s.mark}>
                        {answeredThis && right ? (
                          <Check size={16} aria-hidden="true" />
                        ) : answeredThis && optionIndex === choice ? (
                          <X size={16} aria-hidden="true" />
                        ) : (
                          <Mark size={16} aria-hidden="true" />
                        )}
                      </span>
                      <span dir="auto">{option}</span>
                    </button>
                  );
                })}
              </div>
              {/* In the page whether or not it is opened. */}
              <details className={s.reveal} open={answeredThis || undefined}>
                <summary>{t("public.reveal")}</summary>
                <p dir="auto">
                  {t("learn.rightAnswer", {
                    answer: question.options[question.correctIndex],
                  })}
                </p>
              </details>
            </li>
          );
        })}
      </ol>

      <div className={s.score} role="status" aria-live="polite">
        <div className={s.scoreBar} aria-hidden="true">
          <i style={{ inlineSize: `${(answered / total) * 100}%` }} />
        </div>
        <span>
          {done
            ? t("learn.score", { correct, total })
            : t("public.progress", { n: answered, total })}
        </span>
        {done ? (
          <span
            className={s.stars}
            role="img"
            aria-label={t("learn.stars", { n: starsFor(correct, total) })}
          >
            {[1, 2, 3].map(n => (
              <Star
                key={n}
                size={18}
                className={n <= starsFor(correct, total) ? s.starOn : s.starOff}
                aria-hidden="true"
              />
            ))}
          </span>
        ) : null}
        {answered > 0 ? (
          <button
            type="button"
            className={s.again}
            onClick={() => setPicked({})}
          >
            <RotateCcw size={15} aria-hidden="true" /> {t("learn.restart")}
          </button>
        ) : null}
      </div>
    </>
  );
}
