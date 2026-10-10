"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Trophy, X } from "lucide-react";
import { bookDisplayTitle } from "@/lib/book-title";
import { trpc } from "@/lib/trpc-client";
import { Sheet } from "./parts";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

const COUNTS = [5, 10, 15, 20];
const SECONDS = [20, 30, 45, 60];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// 🏁 The room answers a question file together, one question at a time.
//
// The server is the judge and the clock (lib/study-rooms/quiz.ts): this
// screen shows what it says, asks again when the room moves on, when the
// clock it was given runs out, and every couple of seconds in between. The
// right answer is not in what the server sends until the question is over.
export function useRoomQuiz(roomId: string, roomSeq: number) {
  const current = trpc.rooms.quizCurrent.useQuery(
    { roomId },
    { refetchInterval: query => (query.state.data ? 2000 : false) }
  );
  const refetch = current.refetch;
  useEffect(() => {
    void refetch();
  }, [roomSeq, refetch]);

  // The quiz that was last seen running: when it is no longer current, its
  // results are what to show.
  const [lastQuizId, setLastQuizId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const activeId = current.data?.quizId ?? null;
  useEffect(() => {
    if (activeId) setLastQuizId(activeId);
  }, [activeId]);
  const finishedId =
    !activeId && lastQuizId && dismissed !== lastQuizId ? lastQuizId : null;

  return {
    active: current.data ?? null,
    finishedId,
    dismiss: () => setDismissed(lastQuizId),
    refetch,
  };
}

// Counts down from what the server said was left when it last answered.
function useCountdown(remainingMs: number, stamp: number) {
  const [left, setLeft] = useState(remainingMs);
  useEffect(() => {
    setLeft(remainingMs);
    if (remainingMs <= 0) return;
    const until = Date.now() + remainingMs;
    const timer = window.setInterval(() => {
      setLeft(Math.max(0, until - Date.now()));
    }, 250);
    return () => window.clearInterval(timer);
  }, [remainingMs, stamp]);
  return left;
}

export function QuizStartSheet({
  roomId,
  onClose,
}: {
  roomId: string;
  onClose: () => void;
}) {
  const { t, tError } = useRooms();
  const utils = trpc.useUtils();
  const files = trpc.questionFiles.list.useQuery();
  const ready = (files.data ?? []).filter(
    file => file.status === "complete" && file.questionCount >= 3
  );
  const [bookId, setBookId] = useState<string | null>(null);
  const [count, setCount] = useState(10);
  const [seconds, setSeconds] = useState(30);
  const start = trpc.rooms.quizStart.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.rooms.state.invalidate({ roomId }),
        utils.rooms.quizCurrent.invalidate({ roomId }),
      ]);
      onClose();
    },
  });
  const chosen = ready.find(file => file.id === bookId);
  const max = chosen ? Math.min(30, chosen.questionCount) : 30;

  return (
    <Sheet title={t("quiz.startTitle")} onClose={onClose}>
      <p className={s.meta}>{t("quiz.startHint")}</p>
      {files.isLoading ? (
        <div className={s.skeleton} style={{ minHeight: 100 }} />
      ) : ready.length === 0 ? (
        <p className={s.sub}>{t("quiz.noFiles")}</p>
      ) : (
        <div className={s.fileList}>
          {ready.map(file => (
            <button
              key={file.id}
              type="button"
              className={`${s.item} ${file.id === bookId ? s.itemOn : ""}`}
              aria-pressed={file.id === bookId}
              onClick={() => setBookId(file.id)}
            >
              <span dir="auto">
                {bookDisplayTitle(file.fileName)}
                <small>
                  {t("quiz.questionCount", { n: file.questionCount })}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}

      <p className={s.sub}>{t("quiz.howMany")}</p>
      <div
        className={s.choices}
        role="radiogroup"
        aria-label={t("quiz.howMany")}
      >
        {COUNTS.filter(value => value <= max || value === COUNTS[0]).map(
          value => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={count === value}
              className={`${s.choice} ${count === value ? s.choiceOn : ""}`}
              onClick={() => setCount(value)}
            >
              {value}
            </button>
          )
        )}
      </div>

      <p className={s.sub}>{t("quiz.perQuestion")}</p>
      <div
        className={s.choices}
        role="radiogroup"
        aria-label={t("quiz.perQuestion")}
      >
        {SECONDS.map(value => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={seconds === value}
            className={`${s.choice} ${seconds === value ? s.choiceOn : ""}`}
            onClick={() => setSeconds(value)}
          >
            {t("quiz.secondsShort", { n: value })}
          </button>
        ))}
      </div>

      {start.error ? (
        <p className={s.errorNote} role="alert">
          {tError(start.error)}
        </p>
      ) : null}
      <button
        type="button"
        className={`${s.btn} ${s.primary} ${s.wide}`}
        disabled={!bookId || start.isPending}
        onClick={() =>
          bookId &&
          start.mutate({
            roomId,
            bookId,
            count: Math.max(3, Math.min(count, max)),
            seconds,
          })
        }
      >
        {t("quiz.start")}
      </button>
    </Sheet>
  );
}

type Active = NonNullable<ReturnType<typeof useRoomQuiz>["active"]>;

export function QuizPanel({
  roomId,
  quiz,
  memberCount,
  myUserId,
  canLead,
  onChanged,
}: {
  roomId: string;
  quiz: Active;
  memberCount: number;
  myUserId: string;
  canLead: boolean;
  onChanged: () => void;
}) {
  const { t, tError, language } = useRooms();
  const utils = trpc.useUtils();
  const changed = async () => {
    await Promise.all([
      utils.rooms.quizCurrent.invalidate({ roomId }),
      utils.rooms.state.invalidate({ roomId }),
    ]);
    onChanged();
  };
  const answer = trpc.rooms.quizAnswer.useMutation({ onSettled: changed });
  const advance = trpc.rooms.quizAdvance.useMutation({ onSettled: changed });
  const cancel = trpc.rooms.quizCancel.useMutation({ onSettled: changed });
  // What this member pressed, shown at once while the server answers.
  const [picked, setPicked] = useState<{ q: string; i: number } | null>(null);
  const [showArabic, setShowArabic] = useState(false);

  const left = useCountdown(quiz.remainingMs, quiz.index);
  // The clock ran out here: ask the server, which decides.
  const asked = useRef(-1);
  useEffect(() => {
    if (
      quiz.state === "question" &&
      left <= 0 &&
      asked.current !== quiz.index
    ) {
      asked.current = quiz.index;
      void utils.rooms.quizCurrent.invalidate({ roomId });
    }
  }, [left, quiz.state, quiz.index, roomId, utils]);

  const revealed = quiz.state === "reveal";
  const selected =
    quiz.mySelectedIndex ??
    (picked && picked.q === quiz.question.id ? picked.i : null);
  const arabic =
    !!quiz.question.textAr &&
    !!quiz.question.optionsAr &&
    quiz.question.optionsAr.length === quiz.question.options.length;
  const useArabic = arabic && showArabic;
  const text = useArabic ? quiz.question.textAr! : quiz.question.text;
  const options = useArabic ? quiz.question.optionsAr! : quiz.question.options;
  const secondsLeft = Math.ceil(left / 1000);
  const answeredCount = quiz.answeredUserIds.length;
  const board = quiz.leaderboard ?? [];
  const last = quiz.index >= quiz.total - 1;
  const explanation =
    (language === "ar" ? quiz.explanationAr : null) ??
    quiz.explanation ??
    quiz.explanationAr ??
    null;
  const error = answer.error ?? advance.error ?? cancel.error;

  return (
    <section className={s.quiz} aria-label={t("quiz.title")}>
      <div className={s.quizHead}>
        <span>
          {t("quiz.progress", { n: quiz.index + 1, total: quiz.total })}
        </span>
        {revealed ? (
          <span>{t("quiz.timeUp")}</span>
        ) : (
          <span
            className={`${s.clock} ${secondsLeft <= 5 ? s.clockLow : ""}`}
            role="timer"
            aria-label={t("quiz.secondsLeft", { n: secondsLeft })}
          >
            {secondsLeft}
          </span>
        )}
      </div>
      <div
        className={s.quizBar}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={quiz.total}
        aria-valuenow={quiz.index + (revealed ? 1 : 0)}
      >
        <i
          style={{
            width: `${((quiz.index + (revealed ? 1 : 0)) / quiz.total) * 100}%`,
          }}
        />
      </div>

      <h2 className={s.quizText} dir="auto">
        {text}
      </h2>
      {arabic ? (
        <button
          type="button"
          className={s.readerLink}
          onClick={() => setShowArabic(value => !value)}
        >
          {showArabic ? t("quiz.showOriginal") : t("quiz.showArabic")}
        </button>
      ) : null}

      <div className={s.options}>
        {options.map((option, index) => {
          const mine = selected === index;
          const right = revealed && quiz.correctIndex === index;
          const wrong = revealed && mine && !right;
          return (
            <button
              key={index}
              type="button"
              className={`${s.option} ${mine ? s.optionMine : ""} ${
                right ? s.optionRight : ""
              } ${wrong ? s.optionWrong : ""}`}
              disabled={revealed || selected !== null || answer.isPending}
              aria-pressed={mine}
              onClick={() => {
                setPicked({ q: quiz.question.id, i: index });
                answer.mutate({
                  quizId: quiz.quizId,
                  questionId: quiz.question.id,
                  selectedIndex: index,
                });
              }}
            >
              <b aria-hidden="true">{LETTERS[index] ?? index + 1}</b>
              <span dir="auto">{option}</span>
              {right ? (
                <Check size={18} aria-label={t("quiz.correct")} />
              ) : null}
              {wrong ? <X size={18} aria-label={t("quiz.wrong")} /> : null}
              {revealed && quiz.distribution ? (
                <small>{quiz.distribution[index] ?? 0}</small>
              ) : null}
            </button>
          );
        })}
      </div>

      {revealed ? (
        <>
          <p className={s.quizNote} role="status">
            {selected === null
              ? t("quiz.noAnswer")
              : selected === quiz.correctIndex
                ? t("quiz.youRight")
                : t("quiz.youWrong")}
          </p>
          {explanation ? (
            <p className={s.quizExplain} dir="auto">
              {explanation}
            </p>
          ) : null}
          {board.length ? (
            <ol className={s.board}>
              {board.slice(0, 5).map((row, position) => (
                <li
                  key={row.userId}
                  className={row.userId === myUserId ? s.boardMe : ""}
                >
                  <span>{position + 1}</span>
                  <b dir="auto">
                    {row.userId === myUserId ? t("live.you") : row.name}
                  </b>
                  <i>{t("quiz.points", { n: row.points })}</i>
                </li>
              ))}
            </ol>
          ) : null}
          {canLead || quiz.canAdvance ? (
            <button
              type="button"
              className={`${s.btn} ${s.primary} ${s.wide}`}
              disabled={advance.isPending}
              onClick={() => advance.mutate({ quizId: quiz.quizId })}
            >
              {last ? t("quiz.finish") : t("quiz.next")}
            </button>
          ) : (
            <p className={s.meta}>{t("quiz.waitHost")}</p>
          )}
        </>
      ) : (
        <>
          <p className={s.quizNote} role="status">
            {selected !== null
              ? t("quiz.answered", { n: answeredCount, total: memberCount })
              : t("quiz.answeredSoFar", {
                  n: answeredCount,
                  total: memberCount,
                })}
          </p>
          {canLead ? (
            <button
              type="button"
              className={`${s.btn} ${s.wide}`}
              disabled={advance.isPending}
              onClick={() => advance.mutate({ quizId: quiz.quizId })}
            >
              {t("quiz.reveal")}
            </button>
          ) : null}
        </>
      )}

      {error ? (
        <p className={s.errorNote} role="alert">
          {tError(error)}
        </p>
      ) : null}
      {canLead ? (
        <button
          type="button"
          className={`${s.readerLink} ${s.quizCancel}`}
          disabled={cancel.isPending}
          onClick={() => cancel.mutate({ quizId: quiz.quizId })}
        >
          {t("quiz.cancel")}
        </button>
      ) : null}
    </section>
  );
}

export function QuizResults({
  quizId,
  myUserId,
  onClose,
}: {
  quizId: string;
  myUserId: string;
  onClose: () => void;
}) {
  const { t } = useRooms();
  const results = trpc.rooms.quizResults.useQuery(
    { quizId },
    { retry: false, staleTime: Infinity }
  );
  // Cancelled, not finished: there is nothing to show.
  const failed = results.isError;
  useEffect(() => {
    if (failed) onClose();
  }, [failed, onClose]);
  if (!results.data) {
    return <div className={s.skeleton} style={{ minHeight: 220 }} />;
  }
  const { ranking, me, hardest, total } = results.data;
  return (
    <section className={s.quiz} aria-label={t("quiz.resultsTitle")}>
      <div className={s.quizDone}>
        <Trophy size={30} aria-hidden="true" />
        <h2>{t("quiz.resultsTitle")}</h2>
        {me ? (
          <p>
            {t("quiz.myResult", {
              rank: me.rank,
              correct: me.correct,
              total,
            })}
          </p>
        ) : (
          <p>{t("quiz.noResult")}</p>
        )}
      </div>
      <ol className={s.board}>
        {ranking.map((row, position) => (
          <li
            key={row.userId}
            className={row.userId === myUserId ? s.boardMe : ""}
          >
            <span>{position + 1}</span>
            <b dir="auto">
              {row.userId === myUserId ? t("live.you") : row.name}
            </b>
            <i>
              {t("quiz.correctOf", { n: row.correct, total })} ·{" "}
              {t("quiz.points", { n: row.points })}
            </i>
          </li>
        ))}
      </ol>
      {hardest ? (
        <div className={s.quizExplain}>
          <b>{t("quiz.hardest")}</b>
          <span dir="auto">{hardest.text}</span>
          <small>
            {t("quiz.hardestScore", {
              n: hardest.correct,
              total: hardest.answers,
            })}
          </small>
        </div>
      ) : null}
      <button
        type="button"
        className={`${s.btn} ${s.primary} ${s.wide}`}
        onClick={onClose}
      >
        {t("quiz.backToFile")}
      </button>
    </section>
  );
}
