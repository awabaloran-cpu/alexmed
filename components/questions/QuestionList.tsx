"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  XCircle,
} from "lucide-react";
import s from "./QuestionList.module.css";

// One question-file question as the cards render it — the safe projection
// lib/db-question-files.ts's readQuestionFileContent returns.
export type QuestionListItem = {
  id: string;
  questionText: string;
  options: string[] | null;
  extractedAnswerIndex: number | null;
  aiInferredAnswerIndex: number | null;
  explanationText: string | null;
  sourcePage: number;
  keywords: string[] | null;
  aiExplanationAr: string | null;
  // «اربطها» — a one-line memory hook (newer files only).
  mnemonicAr?: string | null;
  imageUrl: string | null;
  // The Arabic version (from the file itself, or machine-translated once
  // in the pipeline — translationSource says which).
  questionTextAr?: string | null;
  optionsAr?: string[] | null;
  translationSource?: string | null;
};

// The answer a card checks against: the file's own stated answer, else the
// pipeline's AI suggestion (labelled as such), else none.
export function correctAnswerOf(question: QuestionListItem): {
  index: number | null;
  fromAi: boolean;
} {
  if (question.extractedAnswerIndex !== null) {
    return { index: question.extractedAnswerIndex, fromAi: false };
  }
  if (question.aiInferredAnswerIndex !== null) {
    return { index: question.aiInferredAnswerIndex, fromAi: true };
  }
  return { index: null, fromAi: false };
}

export type OptionState = "idle" | "correct" | "wrong" | "chosen" | "dimmed";

// Pure (unit-tested): how option `i` looks once the card is answered or
// revealed. Before that every option is idle and tappable.
export function optionState(
  i: number,
  card: { selected: number | null; revealed: boolean; correct: number | null }
): OptionState {
  if (!card.revealed) return "idle";
  if (card.correct === null) return card.selected === i ? "chosen" : "idle";
  if (i === card.correct) return "correct";
  if (i === card.selected) return "wrong";
  return "dimmed";
}

const STATE_CLASS: Record<OptionState, string> = {
  idle: "",
  correct: s.correct,
  wrong: s.wrong,
  chosen: s.chosen,
  dimmed: s.dimmed,
};

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
function arabicNumber(n: number): string {
  return String(n).replace(/\d/g, d => ARABIC_DIGITS[Number(d)]);
}

// The question-file cards, shared by a student's own question file, a
// doctor's protected set (student view and the doctor's preview).
// Tap an option to answer: correct turns green; a wrong pick turns red and
// the correct option turns green. "أظهر الإجابة" reveals without choosing.
// The Arabic version sits behind "عرض الترجمة".
//
// `watermark` (a protected set's student view only) tiles a faint diagonal
// line of text over each card, image included. It makes a screenshot
// traceable to the account it came from; it cannot stop one being taken.
// `revealAll` (the doctor's review) shows every answer at once.
//
// layout "deck" (default): one question at a time — progress, previous /
// next, a question picker, and ← → keys; each question keeps its answer
// while the student moves around. layout "list": every card, stacked (the
// doctor's all-answers review).
//
// Optional, and all off by default (a doctor's set uses none of them):
//  - `initialAnswers` (questionId → chosen option) restores saved answers,
//    and the deck opens on the first question not answered yet;
//  - `onAnswered` is told each choice, for the caller to save;
//  - `breakEvery` + `renderBreak` put a pause the caller draws after every
//    N-th question when the student moves on (deck only). This component
//    knows nothing about what the pause contains.
export type DeckBreak = {
  // How many questions are behind the student at this pause.
  afterPosition: number;
  total: number;
  // The tally over the questions since the previous pause.
  answered: number;
  correct: number;
  onContinue: () => void;
};

export default function QuestionList({
  questions,
  watermark,
  revealAll = false,
  layout = "deck",
  initialAnswers,
  onAnswered,
  breakEvery,
  renderBreak,
  renderComplete,
}: {
  questions: QuestionListItem[];
  watermark?: string;
  revealAll?: boolean;
  layout?: "deck" | "list";
  initialAnswers?: Record<string, number>;
  onAnswered?: (questionId: string, selectedIndex: number) => void;
  breakEvery?: number;
  renderBreak?: (info: DeckBreak) => ReactNode;
  // Drawn under the deck once every question has an answer (deck only) —
  // e.g. the result and a way to share it. Like the break, this component
  // does not know what it contains.
  renderComplete?: (result: { answered: number; correct: number }) => ReactNode;
}) {
  const watermarkImage = watermark ? watermarkTile(watermark) : null;
  const [answers, setAnswers] = useState<Record<string, CardAnswer>>(() =>
    restoredAnswers(initialAnswers)
  );
  const answerFor = (id: string) =>
    answers[id] ?? { selected: null, revealed: false };
  const setAnswer = (id: string) => (next: CardAnswer) => {
    setAnswers(current => ({ ...current, [id]: next }));
    if (next.revealed && next.selected !== null) {
      onAnswered?.(id, next.selected);
    }
  };

  const card = (question: QuestionListItem, i: number) => (
    <QuestionCard
      key={question.id}
      question={question}
      position={i + 1}
      total={questions.length}
      watermarkImage={watermarkImage}
      revealAll={revealAll}
      answer={answerFor(question.id)}
      onAnswer={setAnswer(question.id)}
    />
  );

  if (layout === "list") {
    return <div className={s.list}>{questions.map(card)}</div>;
  }
  return (
    <QuestionDeck
      questions={questions}
      answers={answers}
      renderCard={card}
      startIndex={firstUnansweredIndex(questions, initialAnswers)}
      breakEvery={renderBreak ? breakEvery : undefined}
      renderBreak={renderBreak}
      renderComplete={renderComplete}
    />
  );
}

type CardAnswer = { selected: number | null; revealed: boolean };

// Pure (unit-tested): saved choices as the cards' own state — answered and
// revealed, exactly as the student left them.
export function restoredAnswers(
  saved: Record<string, number> | undefined
): Record<string, CardAnswer> {
  const answers: Record<string, CardAnswer> = {};
  for (const [id, selected] of Object.entries(saved ?? {})) {
    answers[id] = { selected, revealed: true };
  }
  return answers;
}

// Pure (unit-tested): where a returning student resumes — the first
// question without a saved answer (the first one when nothing is saved or
// everything is answered).
export function firstUnansweredIndex(
  questions: QuestionListItem[],
  saved: Record<string, number> | undefined
): number {
  if (!saved || !Object.keys(saved).length) return 0;
  const index = questions.findIndex(question => !(question.id in saved));
  return index === -1 ? 0 : index;
}

// Pure (unit-tested): moving forward from question `fromIndex` (0-based)
// crosses a pause when that question closes a group of `every` — except
// after the last question, where there is nothing to continue to.
export function breakAfterIndex(
  fromIndex: number,
  total: number,
  every: number | undefined
): boolean {
  if (!every || every < 1) return false;
  const position = fromIndex + 1;
  return position < total && position % every === 0;
}

// Pure (unit-tested): the student's running tally for the progress line.
export function deckProgress(
  questions: QuestionListItem[],
  answers: Record<string, CardAnswer>
) {
  let answered = 0;
  let correctCount = 0;
  for (const question of questions) {
    const answer = answers[question.id];
    if (!answer || answer.selected === null) continue;
    answered++;
    if (answer.selected === correctAnswerOf(question).index) correctCount++;
  }
  return { answered, correct: correctCount };
}

function QuestionDeck({
  questions,
  answers,
  renderCard,
  startIndex = 0,
  breakEvery,
  renderBreak,
  renderComplete,
}: {
  questions: QuestionListItem[];
  answers: Record<string, CardAnswer>;
  renderCard: (question: QuestionListItem, i: number) => ReactNode;
  startIndex?: number;
  breakEvery?: number;
  renderBreak?: (info: DeckBreak) => ReactNode;
  renderComplete?: (result: { answered: number; correct: number }) => ReactNode;
}) {
  const [index, setIndex] = useState(startIndex);
  // The question index a pause is holding the student before, and the
  // pauses already shown (each appears once per visit, however the student
  // moves around afterwards).
  const [pausedBefore, setPausedBefore] = useState<number | null>(null);
  const shownBreaks = useRef(new Set<number>());
  const total = questions.length;
  const safeIndex = Math.min(index, Math.max(0, total - 1));
  const go = (next: number) => setIndex(Math.max(0, Math.min(total - 1, next)));
  const { answered, correct } = deckProgress(questions, answers);

  // One step forward — the only move that can meet a pause.
  const goNext = () => {
    if (safeIndex >= total - 1) return;
    if (
      renderBreak &&
      breakAfterIndex(safeIndex, total, breakEvery) &&
      !shownBreaks.current.has(safeIndex)
    ) {
      shownBreaks.current.add(safeIndex);
      setPausedBefore(safeIndex + 1);
      return;
    }
    go(safeIndex + 1);
  };
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;
  const paused = pausedBefore !== null;

  // ← / → between questions (RTL: ← is "next"), unless typing somewhere.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) {
        return;
      }
      if (paused) return;
      if (event.key === "ArrowLeft") goNextRef.current();
      if (event.key === "ArrowRight") setIndex(i => Math.max(0, i - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, paused]);

  if (!total) return null;
  if (pausedBefore !== null && renderBreak) {
    const group = questions.slice(
      Math.max(0, pausedBefore - (breakEvery ?? pausedBefore)),
      pausedBefore
    );
    const tally = deckProgress(group, answers);
    return (
      <div className={s.deck}>
        {renderBreak({
          afterPosition: pausedBefore,
          total,
          answered: tally.answered,
          correct: tally.correct,
          onContinue: () => {
            setPausedBefore(null);
            go(pausedBefore);
          },
        })}
      </div>
    );
  }
  return (
    <div className={s.deck}>
      <div className={s.progress}>
        <div className={s.progressText}>
          <span>
            السؤال {safeIndex + 1} من {total}
          </span>
          {answered > 0 && (
            <span className={s.tally}>
              أجبت {answered} · صحيح {correct}
            </span>
          )}
        </div>
        <div
          className={s.progressBar}
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={safeIndex + 1}
          aria-label="التقدم في الأسئلة"
        >
          <span style={{ width: `${((safeIndex + 1) / total) * 100}%` }} />
        </div>
      </div>

      {renderCard(questions[safeIndex], safeIndex)}

      <nav className={s.deckNav} aria-label="التنقل بين الأسئلة">
        <button
          type="button"
          className={s.navButton}
          disabled={safeIndex === 0}
          onClick={() => go(safeIndex - 1)}
        >
          <ChevronRight size={17} aria-hidden="true" /> السابق
        </button>
        <label className={s.jump}>
          <span className="sr-only">انتقل إلى سؤال</span>
          <select
            value={safeIndex}
            onChange={event => go(Number(event.target.value))}
          >
            {questions.map((question, i) => {
              const answer = answers[question.id];
              const mark =
                answer?.selected == null
                  ? ""
                  : answer.selected === correctAnswerOf(question).index
                    ? " ✓"
                    : " ✗";
              return (
                <option key={question.id} value={i}>
                  {i + 1}
                  {mark}
                </option>
              );
            })}
          </select>
        </label>
        <button
          type="button"
          className={`${s.navButton} ${s.navNext}`}
          disabled={safeIndex === total - 1}
          onClick={goNext}
        >
          التالي <ChevronLeft size={17} aria-hidden="true" />
        </button>
      </nav>

      {renderComplete && answered === total
        ? renderComplete({ answered, correct })
        : null}
    </div>
  );
}

function QuestionCard({
  question,
  position,
  total,
  watermarkImage,
  revealAll,
  answer,
  onAnswer,
}: {
  question: QuestionListItem;
  position: number;
  total: number;
  watermarkImage: string | null;
  revealAll: boolean;
  answer: CardAnswer;
  onAnswer: (next: CardAnswer) => void;
}) {
  const [showTranslation, setShowTranslation] = useState(false);
  const { selected, revealed: revealedByUser } = answer;
  const revealed = revealAll || revealedByUser;
  const { index: correct, fromAi } = correctAnswerOf(question);
  const options = question.options ?? [];
  const hasTranslation = !!question.questionTextAr;
  const answeredRight = selected !== null && selected === correct;

  return (
    <article className={s.card} aria-label={`سؤال ${position} من ${total}`}>
      {watermarkImage && (
        <div
          aria-hidden="true"
          data-testid="question-watermark"
          className={s.watermark}
          style={{ backgroundImage: watermarkImage }}
        />
      )}

      <div className={s.head}>
        <span className={s.label} dir="ltr">
          {/* Arabic is never letter-spaced (it breaks the joining). */}
          <span className={s.labelEn}>QUESTION</span> / السؤال
        </span>
        <span className={s.counter} dir="ltr">
          {position} / {total}
        </span>
      </div>

      {question.imageUrl && (
        // Same URL for every question sharing this page's image — never
        // re-fetched or duplicated in storage.
        <img src={question.imageUrl} alt="" className={s.image} />
      )}

      <p className={s.question} dir="auto">
        {question.questionText}
      </p>

      {options.length > 0 && (
        <ol className={s.options} dir="auto">
          {options.map((option, i) => {
            const state = optionState(i, { selected, revealed, correct });
            return (
              <li key={i}>
                <button
                  type="button"
                  className={`${s.option} ${STATE_CLASS[state]}`}
                  disabled={revealed}
                  aria-pressed={selected === i}
                  data-state={state}
                  onClick={() => onAnswer({ selected: i, revealed: true })}
                >
                  <span className={s.num}>{i + 1}.</span>
                  <span className={s.optionText}>{option}</span>
                  {state === "correct" && (
                    <CheckCircle2
                      size={18}
                      className={s.mark}
                      color="var(--nl-correct)"
                      aria-hidden="true"
                    />
                  )}
                  {state === "wrong" && (
                    <XCircle
                      size={18}
                      className={s.mark}
                      color="var(--nl-wrong)"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {revealed && (
        <div role="status" className={s.explain}>
          {selected !== null && correct !== null && (
            <p
              className={`${s.result} ${answeredRight ? s.resultCorrect : s.resultWrong}`}
            >
              {answeredRight ? "إجابة صحيحة" : "إجابة خاطئة"}
            </p>
          )}
          {correct === null ? (
            <p className={`${s.result} ${s.resultNeutral}`}>
              {options.length
                ? "لا توجد إجابة مذكورة لهذا السؤال في الملف."
                : question.explanationText ||
                  "لا توجد إجابة مذكورة لهذا السؤال."}
            </p>
          ) : fromAi ? (
            <p className={s.aiNote}>
              <Sparkles size={12} aria-hidden="true" /> إجابة مقترحة من الذكاء
              الاصطناعي — لم تُذكر إجابة في الملف الأصلي.
            </p>
          ) : null}
          {question.explanationText && options.length > 0 && (
            <p dir="auto">{question.explanationText}</p>
          )}
          {question.aiExplanationAr && (
            <p className={s.explainAr} dir="rtl">
              {question.aiExplanationAr}
            </p>
          )}
          {question.mnemonicAr && (
            <p className={s.mnemonic} dir="auto">
              <span aria-hidden="true">🔗</span> <strong>اربطها:</strong>{" "}
              {question.mnemonicAr}
            </p>
          )}
          {!!question.keywords?.length && (
            <div className={s.keywords}>
              {question.keywords.map(keyword => (
                <span key={keyword} className={s.keyword}>
                  {keyword}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {showTranslation && hasTranslation && (
        <div className={s.translation} dir="rtl" lang="ar">
          {question.translationSource === "machine" && (
            <span className={s.machineTag}>ترجمة آلية</span>
          )}
          <p className={s.translationQuestion}>{question.questionTextAr}</p>
          {!!question.optionsAr?.length && (
            <ol className={s.translationOptions}>
              {question.optionsAr.map((option, i) => (
                <li key={i}>
                  <span>{arabicNumber(i + 1)}.</span>
                  <span>{option}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {(!revealAll || hasTranslation) && (
        <div className={s.footer}>
          <div className={s.footerStart}>
            {!revealed && (
              <button
                type="button"
                className={s.textButton}
                onClick={() => onAnswer({ selected, revealed: true })}
              >
                أظهر الإجابة
              </button>
            )}
            {revealedByUser && !revealAll && (
              <button
                type="button"
                className={s.textButton}
                onClick={() => onAnswer({ selected: null, revealed: false })}
              >
                إعادة
              </button>
            )}
          </div>
          {hasTranslation && (
            <button
              type="button"
              className={s.pill}
              aria-expanded={showTranslation}
              onClick={() => setShowTranslation(value => !value)}
            >
              {showTranslation ? "إخفاء الترجمة" : "عرض الترجمة"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// One tile of the repeated watermark as a CSS background: the text at a
// diagonal, in ink at ~9% opacity, so it stays readable-through on both the
// question text and the page image.
export function watermarkTile(text: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="150">` +
    `<text x="130" y="80" text-anchor="middle" transform="rotate(-24 130 75)" ` +
    `font-family="sans-serif" font-size="13" fill="#1b2340" fill-opacity="0.09">` +
    `${escapeXml(text)}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
