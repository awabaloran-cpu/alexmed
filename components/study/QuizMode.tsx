"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronsRight,
  CircleAlert,
  Lightbulb,
  Loader2,
  RotateCcw,
  SkipForward,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import StudyShell from "./StudyShell";
import { NIRO_NAME } from "@/lib/niro";
import StudyAiSheet, { type AiRequest, type AiTarget } from "./StudyAiSheet";
import type { McqSubmitResult } from "@/components/McqCard";

export type QuizMcq = {
  id: string;
  questionEn: string;
  choices: string[];
  correctIndex: number;
  explanationEn: string;
  validationStatus?: string;
  validationNote?: string | null;
  // Real PDF page the question was generated from — shown so every
  // question is traceable to its source (full-document coverage).
  sourcePage?: number;
  // 🧠 Knowledge-based questions: the kind of thinking it tests, already
  // as an Arabic label (حالة سريرية / الخطوة التالية / …); "" for V1.
  questionType?: string;
};

type Answer = { selected: number } & McqSubmitResult;

const LETTERS = ["A", "B", "C", "D", "E", "F"];

// Full-screen one-question-at-a-time quiz over a chapter's MCQs: numbered
// progress dots (✓/✗ once answered), running score, lettered choices, and a
// bottom bar with السابق / تلميح / AI help / تخطي. Attempts are recorded
// through the same submitMcqAttempt mutation McqCard uses (onSubmit), so
// weak-points/stats keep working exactly as before.
export default function QuizMode({
  title,
  subtitle,
  aiTarget,
  notice,
  mcqs,
  onBack,
  onSubmit,
  onGenerate,
  generating,
}: {
  title: string;
  subtitle?: string;
  aiTarget: AiTarget;
  notice?: ReactNode;
  mcqs: QuizMcq[];
  onBack: () => void;
  onSubmit: (mcqId: string, selectedIndex: number) => Promise<McqSubmitResult>;
  // Absent for a shared (read-only) Study Pack — generation is owner-only.
  onGenerate?: () => void;
  generating: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  // "تلميح" = remove one wrong choice (up to all-but-two). The MCQs have no
  // stored hint text, and this never gives the answer away.
  const [eliminated, setEliminated] = useState<Record<string, number[]>>({});
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiRequest, setAiRequest] = useState<AiRequest | null>(null);
  const dotsRef = useRef<HTMLDivElement>(null);

  const finished = mcqs.length > 0 && index >= mcqs.length;
  const mcq = finished ? null : mcqs[index];
  const answer = mcq ? answers[mcq.id] : undefined;
  const score = Object.values(answers).filter(a => a.isCorrect).length;

  useEffect(() => {
    dotsRef.current
      ?.querySelector<HTMLElement>(".quiz-dot.is-current")
      ?.scrollIntoView({
        inline: "center",
        block: "nearest",
        behavior: "smooth",
      });
  }, [index]);

  async function choose(choiceIndex: number) {
    if (!mcq || answer || pendingIndex !== null) return;
    setError("");
    setPendingIndex(choiceIndex);
    try {
      const result = await onSubmit(mcq.id, choiceIndex);
      setAnswers(current => ({
        ...current,
        [mcq.id]: { selected: choiceIndex, ...result },
      }));
    } catch {
      setError("تعذر حفظ إجابتك. اختر الإجابة مرة أخرى.");
    } finally {
      setPendingIndex(null);
    }
  }

  function hint() {
    if (!mcq || answer) return;
    const removed = eliminated[mcq.id] ?? [];
    if (mcq.choices.length - removed.length <= 2) return;
    const candidates = mcq.choices
      .map((_, i) => i)
      .filter(i => i !== mcq.correctIndex && !removed.includes(i));
    if (!candidates.length) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    setEliminated(current => ({ ...current, [mcq.id]: [...removed, pick] }));
  }

  function askAi(extra?: string) {
    const text = (extra ?? aiInput).trim();
    const question = mcq
      ? `${text || "ساعدني أفهم هذا السؤال بدون ما تعطيني الجواب مباشرة."}\n\nالسؤال: ${mcq.questionEn}\nالخيارات: ${mcq.choices
          .map((c, i) => `${LETTERS[i]}) ${c}`)
          .join(" | ")}`
      : text;
    if (!question) return;
    setAiRequest({ question, id: Date.now() });
    setAiInput("");
    setAiOpen(true);
  }

  function restart(onlyWrong: boolean) {
    if (onlyWrong) {
      const firstWrong = mcqs.findIndex(
        q => answers[q.id] && !answers[q.id].isCorrect
      );
      setAnswers(current =>
        Object.fromEntries(
          Object.entries(current).filter(([, a]) => a.isCorrect)
        )
      );
      setIndex(firstWrong === -1 ? 0 : firstWrong);
    } else {
      setAnswers({});
      setIndex(0);
    }
    setEliminated({});
  }

  if (!mcqs.length) {
    return (
      <StudyShell
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        notice={notice}
      >
        <div className="study-empty">
          <Sparkles size={28} />
          <h3>لا يوجد اختبار لهذا الجزء بعد</h3>
          {onGenerate ? (
            <button
              type="button"
              className="primary-button"
              disabled={generating}
              onClick={onGenerate}
            >
              {generating ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Sparkles size={16} />
              )}
              توليد اختبار لهذا الجزء
            </button>
          ) : (
            <p>لم يولّد صاحب الملف أسئلة لهذا الجزء بعد.</p>
          )}
        </div>
      </StudyShell>
    );
  }

  const answeredCount = Object.keys(answers).length;
  const removed = mcq ? (eliminated[mcq.id] ?? []) : [];

  return (
    <StudyShell
      title={title}
      subtitle={subtitle}
      onBack={onBack}
      notice={notice}
      footer={
        !finished && (
          <>
            <div className="quiz-pills">
              <button
                type="button"
                className="quiz-pill"
                disabled={index === 0}
                onClick={() => setIndex(i => Math.max(0, i - 1))}
              >
                <ChevronsRight size={15} /> السابق
              </button>
              <button
                type="button"
                className="quiz-pill"
                disabled={
                  !!answer || !mcq || mcq.choices.length - removed.length <= 2
                }
                onClick={hint}
              >
                <Lightbulb size={15} /> تلميح
              </button>
              <button
                type="button"
                className="quiz-pill"
                onClick={() => askAi("اشرح لي هذا السؤال وفكرته.")}
              >
                <Sparkles size={15} /> اشرح
              </button>
            </div>
            <div className="quiz-bottom-row">
              <form
                className="quiz-ai-input"
                onSubmit={event => {
                  event.preventDefault();
                  if (aiInput.trim()) askAi();
                }}
              >
                <input
                  value={aiInput}
                  onChange={event => setAiInput(event.target.value)}
                  placeholder={`اسأل ${NIRO_NAME} ليش هذا الجواب صح…`}
                />
              </form>
              <button
                type="button"
                className="quiz-next-button"
                onClick={() => setIndex(i => i + 1)}
              >
                {answer ? (
                  <>التالي</>
                ) : (
                  <>
                    <SkipForward size={16} /> تخطي
                  </>
                )}
              </button>
            </div>
          </>
        )
      }
    >
      <div className="quiz-dots" ref={dotsRef}>
        {mcqs.map((q, i) => {
          const a = answers[q.id];
          const state = a
            ? a.isCorrect
              ? "is-correct"
              : "is-wrong"
            : i === index
              ? "is-current"
              : "";
          return (
            <button
              type="button"
              key={q.id}
              className={`quiz-dot ${state} ${i === index ? "is-current" : ""}`}
              onClick={() => setIndex(i)}
              aria-label={`السؤال ${i + 1}`}
            >
              {a ? a.isCorrect ? <Check size={14} /> : <X size={14} /> : i + 1}
            </button>
          );
        })}
      </div>

      {finished ? (
        <div className="quiz-result">
          <Star size={36} />
          <h2>
            النتيجة: {score} / {mcqs.length}
          </h2>
          <p>
            {answeredCount < mcqs.length
              ? `جاوبت ${answeredCount} من ${mcqs.length} سؤال.`
              : score === mcqs.length
                ? "ممتاز! كل الإجابات صحيحة 🎉"
                : "راجع الأسئلة الغلط وجرّب مرة ثانية."}
          </p>
          <div className="quiz-result-actions">
            {score < answeredCount && (
              <button
                type="button"
                className="primary-button"
                onClick={() => restart(true)}
              >
                <RotateCcw size={16} /> أعد الأسئلة الغلط
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => restart(false)}
            >
              ابدأ من جديد
            </button>
            <button type="button" className="secondary-button" onClick={onBack}>
              رجوع
            </button>
          </div>
        </div>
      ) : (
        mcq && (
          <div className="quiz-body">
            <div className="quiz-meta">
              <span>
                {mcq.questionType && (
                  <small className="quiz-type">{mcq.questionType}</small>
                )}
                السؤال {index + 1} من {mcqs.length}
                {mcq.sourcePage !== undefined && (
                  <small className="quiz-source">
                    {" "}
                    · صفحة {mcq.sourcePage}
                  </small>
                )}
              </span>
              <span className="quiz-score">
                <Star size={15} /> النتيجة: {score}
              </span>
            </div>
            {mcq.validationStatus === "flagged" && (
              <div className="inline-alert warning">
                <CircleAlert size={14} />
                <span>
                  هذا السؤال يحتاج مراجعة
                  {mcq.validationNote ? `: ${mcq.validationNote}` : ""}
                </span>
              </div>
            )}
            <div className="quiz-question en" dir="ltr">
              {mcq.questionEn}
            </div>
            <div className="quiz-choices">
              {mcq.choices.map((choice, i) => {
                const isRemoved = removed.includes(i);
                const state = answer
                  ? i === answer.correctIndex
                    ? "is-correct"
                    : i === answer.selected
                      ? "is-wrong"
                      : "is-dim"
                  : pendingIndex === i
                    ? "is-pending"
                    : "";
                return (
                  <button
                    type="button"
                    key={i}
                    className={`quiz-choice ${state} ${isRemoved ? "is-removed" : ""}`}
                    disabled={!!answer || isRemoved || pendingIndex !== null}
                    onClick={() => choose(i)}
                    dir="ltr"
                  >
                    <span className="quiz-choice-letter">{LETTERS[i]}</span>
                    <span className="quiz-choice-text en">{choice}</span>
                    {pendingIndex === i && (
                      <Loader2 size={16} className="spin" />
                    )}
                  </button>
                );
              })}
            </div>
            {error && (
              <div className="inline-alert error">
                <CircleAlert size={15} />
                {error}
              </div>
            )}
            {answer && (
              <div
                className={
                  answer.isCorrect
                    ? "quiz-explanation is-correct"
                    : "quiz-explanation is-wrong"
                }
              >
                <strong>
                  {answer.isCorrect ? "إجابة صحيحة ✓" : "إجابة خاطئة ✗"}
                </strong>
                <p className="en" dir="ltr">
                  {answer.explanationEn}
                </p>
              </div>
            )}
          </div>
        )
      )}

      <StudyAiSheet
        target={aiTarget}
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        request={aiRequest}
      />
    </StudyShell>
  );
}
