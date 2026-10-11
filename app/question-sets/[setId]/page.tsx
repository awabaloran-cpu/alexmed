"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, CircleAlert, CircleHelp, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import QuestionList, {
  correctAnswerOf,
  type QuestionListItem,
} from "@/components/questions/QuestionList";
import s from "./study.module.css";

type Mode = "all" | "unanswered" | "wrong" | "saved" | "unsure";
type Flags = { saved: string[]; unsure: string[] };

const NO_FLAGS: Flags = { saved: [], unsure: [] };
// One object for "nothing saved", so it is the same on every render.
const NO_ANSWERS: Record<string, number> = {};

// "Saved for later" and "not sure" are the student's own marks, kept on
// this device (nothing new is stored on the server for them).
function useFlags(setId: string) {
  const key = `nl-set-flags-${setId}`;
  const [flags, setFlags] = useState<Flags>(NO_FLAGS);
  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem(key) ?? "null"
      ) as Partial<Flags> | null;
      setFlags({
        saved: Array.isArray(stored?.saved) ? stored.saved : [],
        unsure: Array.isArray(stored?.unsure) ? stored.unsure : [],
      });
    } catch {
      setFlags(NO_FLAGS);
    }
  }, [key]);
  const toggle = (kind: keyof Flags, questionId: string) =>
    setFlags(current => {
      const has = current[kind].includes(questionId);
      const next = {
        ...current,
        [kind]: has
          ? current[kind].filter(id => id !== questionId)
          : [...current[kind], questionId],
      };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private mode, or storage refused: the mark lasts for this visit.
      }
      return next;
    });
  return { flags, toggle };
}

// A protected set, opened: the SAME question cards as any question file
// (components/questions/QuestionList.tsx), over the same stored questions —
// no PDF, no second renderer. Access is re-checked on every load; images
// come from an access-checked, no-store route.
//
// The student's answers are kept on the server (lib/question-set-attempts.ts)
// so the set is a course of study, not a page that forgets: it opens where
// they stopped, on any device, says what is left, and lets them go through
// the wrong ones again.
export default function ProtectedQuestionSetPage() {
  const { setId } = useParams<{ setId: string }>();
  const query = trpc.questionSets.get.useQuery(
    { setId },
    { retry: false, refetchOnWindowFocus: true }
  );
  const attempts = trpc.questionSets.attempts.useQuery(
    { setId },
    { retry: false, refetchOnWindowFocus: false, staleTime: Infinity }
  );

  if (query.isLoading || (query.data && attempts.isLoading)) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
          <h3>جاري التحميل...</h3>
        </div>
      </section>
    );
  }

  if (!query.data) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>هذه المجموعة غير متاحة حاليًا</h3>
          <Link
            href="/question-sets"
            className="secondary-button"
            style={{ marginTop: 12 }}
          >
            مجموعات الدكاترة
          </Link>
        </div>
      </section>
    );
  }

  const { set, questions, watermark } = query.data;

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <Link
            href="/question-sets"
            className="eyebrow"
            style={{ marginBottom: 8 }}
          >
            <span className="eyebrow-dot" /> ‹ مجموعات الدكاترة
          </Link>
          <h1>{set?.title}</h1>
          <p>
            {[set?.doctorName, set?.subjectLabel, `${questions.length} سؤال`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      <SetStudy
        setId={setId}
        questions={questions}
        saved={attempts.data ?? NO_ANSWERS}
        watermark={watermark ?? undefined}
        onRestarted={() => attempts.refetch()}
      />
    </section>
  );
}

function SetStudy({
  setId,
  questions,
  saved,
  watermark,
  onRestarted,
}: {
  setId: string;
  questions: QuestionListItem[];
  saved: Record<string, number>;
  watermark?: string;
  onRestarted: () => Promise<unknown>;
}) {
  const save = trpc.questionSets.saveAttempt.useMutation();
  const clear = trpc.questionSets.clearAttempts.useMutation();
  const { flags, toggle } = useFlags(setId);
  const [mode, setMode] = useState<Mode>("all");
  // A new run of the cards (a filter chosen, or a fresh start).
  const [run, setRun] = useState(0);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [shownId, setShownId] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  // What the student has answered: what the server had, then every choice
  // made on this page.
  const [answers, setAnswers] = useState<Record<string, number>>(saved);
  useEffect(() => setAnswers(saved), [saved]);

  const tally = useMemo(() => {
    let answered = 0;
    let correct = 0;
    let wrong = 0;
    for (const question of questions) {
      const chosen = answers[question.id];
      if (chosen === undefined) continue;
      answered++;
      const right = correctAnswerOf(question).index;
      if (right === null) continue;
      if (chosen === right) correct++;
      else wrong++;
    }
    return { answered, correct, wrong, left: questions.length - answered };
  }, [questions, answers]);

  // The questions of a run are chosen when it starts, and stay: a wrong
  // one answered right is not pulled from under the student.
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const flagsRef = useRef(flags);
  flagsRef.current = flags;
  const shown = useMemo(() => {
    const now = answersRef.current;
    const marks = flagsRef.current;
    switch (mode) {
      case "unanswered":
        return questions.filter(question => now[question.id] === undefined);
      case "wrong":
        return questions.filter(question => {
          const right = correctAnswerOf(question).index;
          const chosen = now[question.id];
          return right !== null && chosen !== undefined && chosen !== right;
        });
      case "saved":
        return questions.filter(question => marks.saved.includes(question.id));
      case "unsure":
        return questions.filter(question => marks.unsure.includes(question.id));
      default:
        return questions;
    }
    // `run` starts a new run of the same filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, mode, run]);

  // Going through the wrong ones again: they are shown unanswered.
  const initialAnswers = useMemo(
    () => (mode === "wrong" ? {} : answersRef.current),
    // Fixed for the run, like the questions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, run]
  );

  const choose = (next: Mode) => {
    setMode(next);
    setRun(value => value + 1);
    setShownId(null);
  };
  const onShown = useCallback((questionId: string) => {
    setShownId(questionId);
  }, []);

  const percent = questions.length
    ? Math.round((tally.answered / questions.length) * 100)
    : 0;
  const filters: { id: Mode; label: string; count: number }[] = [
    { id: "all", label: "الكل", count: questions.length },
    { id: "unanswered", label: "لم أُجب عنها", count: tally.left },
    { id: "wrong", label: "الخاطئة", count: tally.wrong },
    { id: "saved", label: "المحفوظة", count: flags.saved.length },
    { id: "unsure", label: "غير متأكد", count: flags.unsure.length },
  ];

  return (
    <div className={s.study}>
      <div className={s.progress}>
        <div
          className={s.bar}
          role="progressbar"
          aria-label="تقدّمك في المجموعة"
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-valuenow={tally.answered}
        >
          <i style={{ width: `${percent}%` }} />
        </div>
        <p>
          أجبت عن <b>{tally.answered}</b> من {questions.length}
          {tally.answered ? (
            <>
              {" "}
              · <b>{tally.correct}</b> صحيحة
            </>
          ) : null}
          {tally.left ? ` · باقٍ ${tally.left}` : " · أكملت المجموعة"}
        </p>
      </div>

      <div className={s.filters} role="tablist" aria-label="أي الأسئلة تُعرض">
        {filters.map(filter => (
          <button
            key={filter.id}
            type="button"
            role="tab"
            aria-selected={mode === filter.id}
            className={`${s.filter} ${mode === filter.id ? s.filterOn : ""}`}
            disabled={filter.id !== "all" && filter.count === 0}
            onClick={() => choose(filter.id)}
          >
            {filter.label}
            <span>{filter.count}</span>
          </button>
        ))}
      </div>

      {saveFailed ? (
        <p className={s.warn} role="alert">
          تعذّر حفظ إجابتك الأخيرة. تحقق من اتصالك؛ الإجابات التالية تُحفظ عند
          عودته.
        </p>
      ) : null}

      {shown.length === 0 ? (
        <div className={s.empty}>
          <strong>لا أسئلة في هذا العرض.</strong>
          <button
            type="button"
            className="secondary-button"
            onClick={() => choose("all")}
          >
            اعرض كل الأسئلة
          </button>
        </div>
      ) : (
        <>
          {shownId ? (
            <div className={s.marks}>
              <button
                type="button"
                className={`${s.markBtn} ${
                  flags.saved.includes(shownId) ? s.markOn : ""
                }`}
                aria-pressed={flags.saved.includes(shownId)}
                onClick={() => toggle("saved", shownId)}
              >
                <Bookmark size={16} aria-hidden="true" />
                {flags.saved.includes(shownId)
                  ? "محفوظ للمراجعة"
                  : "احفظه للمراجعة"}
              </button>
              <button
                type="button"
                className={`${s.markBtn} ${
                  flags.unsure.includes(shownId) ? s.markOn : ""
                }`}
                aria-pressed={flags.unsure.includes(shownId)}
                onClick={() => toggle("unsure", shownId)}
              >
                <CircleHelp size={16} aria-hidden="true" />
                {flags.unsure.includes(shownId)
                  ? "معلَّم: غير متأكد"
                  : "غير متأكد"}
              </button>
              <small>تُحفظ العلامتان على هذا الجهاز.</small>
            </div>
          ) : null}

          <QuestionList
            key={`${mode}-${run}`}
            questions={shown}
            watermark={watermark}
            initialAnswers={initialAnswers}
            onShown={onShown}
            onAnswered={(questionId, selectedIndex) => {
              setAnswers(current => ({
                ...current,
                [questionId]: selectedIndex,
              }));
              save.mutate(
                { setId, questionId, selectedIndex },
                {
                  onSuccess: () => setSaveFailed(false),
                  onError: () => setSaveFailed(true),
                }
              );
            }}
            renderComplete={result => (
              <div className={s.result}>
                <strong>
                  {mode === "all" ? "أنهيت المجموعة" : "أنهيت هذه الأسئلة"}
                </strong>
                <p>
                  {result.correct} صحيحة من {result.answered}
                  {result.answered
                    ? ` (${Math.round((result.correct / result.answered) * 100)}%)`
                    : ""}
                </p>
                <div className={s.resultActions}>
                  {tally.wrong > 0 ? (
                    <button
                      type="button"
                      className="nl-marker-button"
                      onClick={() => choose("wrong")}
                    >
                      أعد الخاطئة فقط ({tally.wrong})
                    </button>
                  ) : null}
                  {mode !== "all" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => choose("all")}
                    >
                      كل الأسئلة
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          />
        </>
      )}

      {tally.answered > 0 ? (
        <div className={s.restart}>
          {confirmRestart ? (
            <>
              <span role="alert">
                تُمسح إجاباتك كلها في هذه المجموعة وتبدأ من السؤال الأول.
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={clear.isPending}
                onClick={() =>
                  clear.mutate(
                    { setId, onlyWrong: false },
                    {
                      onSuccess: async () => {
                        setConfirmRestart(false);
                        setAnswers({});
                        answersRef.current = {};
                        await onRestarted();
                        choose("all");
                      },
                    }
                  )
                }
              >
                {clear.isPending ? "جاري المسح..." : "نعم، ابدأ من جديد"}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={clear.isPending}
                onClick={() => setConfirmRestart(false)}
              >
                تراجع
              </button>
            </>
          ) : (
            <button
              type="button"
              className={s.link}
              onClick={() => setConfirmRestart(true)}
            >
              ابدأ المجموعة من جديد
            </button>
          )}
          {clear.error ? (
            <p className={s.warn} role="alert">
              {clear.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
