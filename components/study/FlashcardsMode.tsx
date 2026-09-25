"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  CircleCheck,
  CircleHelp,
  Clock3,
  GraduationCap,
  Languages,
  Lightbulb,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import StudyShell from "./StudyShell";
import NiroAvatar from "@/components/niro/NiroAvatar";
import { NIRO_NAME } from "@/lib/niro";
import StudyAiSheet, { type AiRequest, type AiTarget } from "./StudyAiSheet";

export type StudyCard = {
  id: string;
  questionEn: string;
  questionAr: string;
  answerEn: string;
  answerAr: string;
  relatedTermEn?: string | null;
  relatedTermAr?: string | null;
  sourcePage: number;
  // 🧠 Knowledge-based cards: what the card tests (تعريف / آلية / …).
  cardType?: string;
};

type Rating = "again" | "hard" | "good" | "easy";

const RATINGS: { rating: Rating; label: string }[] = [
  { rating: "again", label: "لم أتذكر" },
  { rating: "hard", label: "صعبة" },
  { rating: "good", label: "جيدة" },
  { rating: "easy", label: "سهلة" },
];

function formatElapsed(ms: number) {
  const total = Math.floor(ms / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

// Full-screen flip-card session over a chapter's bookCards: timer +
// متبقي / قيد التعلم / متقن counters, EN⇄عربي toggle, tap-to-flip card, and
// ترجمة / شرح / محادثة actions. Ratings go through the existing FSRS
// rateCard mutation (onRate) — "لم أتذكر"/"صعبة" count as قيد التعلم,
// "جيدة"/"سهلة" as متقن.
export default function FlashcardsMode({
  title,
  subtitle,
  aiTarget,
  notice,
  bookId,
  cards,
  onBack,
  onRate,
  onGenerate,
  generating,
}: {
  title: string;
  subtitle?: string;
  aiTarget: AiTarget;
  notice?: ReactNode;
  bookId: string;
  cards: StudyCard[];
  onBack: () => void;
  onRate: (cardId: string, rating: Rating) => void;
  // Absent for a shared (read-only) Study Pack — generation is owner-only.
  onGenerate?: () => void;
  generating: boolean;
}) {
  // Snapshot so a refetch mid-session (after each rating) can't reshuffle it.
  const [queue, setQueue] = useState<StudyCard[]>(cards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [sheet, setSheet] = useState<"explain" | "source" | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRequest, setAiRequest] = useState<AiRequest | null>(null);

  useEffect(() => {
    if (!queue.length && cards.length) setQueue(cards);
  }, [cards, queue.length]);

  const finished = queue.length > 0 && index >= queue.length;

  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [finished]);

  const card = finished ? null : queue[index];
  const ratingValues = Object.values(ratings);
  const learning = ratingValues.filter(
    r => r === "again" || r === "hard"
  ).length;
  const mastered = ratingValues.filter(
    r => r === "good" || r === "easy"
  ).length;

  function rate(rating: Rating) {
    if (!card) return;
    onRate(card.id, rating);
    setRatings(current => ({ ...current, [card.id]: rating }));
    setFlipped(false);
    setIndex(i => i + 1);
  }

  function restart(onlyLearning: boolean) {
    const next = onlyLearning
      ? queue.filter(c => ratings[c.id] === "again" || ratings[c.id] === "hard")
      : queue;
    setQueue(next.length ? next : queue);
    setRatings({});
    setIndex(0);
    setFlipped(false);
    setStartedAt(Date.now());
    setNow(Date.now());
  }

  function openChat() {
    if (card) {
      setAiRequest({
        question: `اشرح لي هذه البطاقة بشكل أعمق:\nالسؤال: ${card.questionEn}\nالإجابة: ${card.answerEn}`,
        id: Date.now(),
      });
    }
    setAiOpen(true);
  }

  if (!cards.length) {
    return (
      <StudyShell
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        notice={notice}
      >
        <div className="study-empty">
          <Sparkles size={28} />
          <h3>لا توجد بطاقات لهذا الجزء بعد</h3>
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
              توليد البطاقات لهذا الجزء
            </button>
          ) : (
            <p>لم يولّد صاحب الملف بطاقات لهذا الجزء بعد.</p>
          )}
        </div>
      </StudyShell>
    );
  }

  const question = card
    ? lang === "en"
      ? card.questionEn
      : card.questionAr
    : "";
  const answer = card ? (lang === "en" ? card.answerEn : card.answerAr) : "";
  const textDir = lang === "en" ? "ltr" : "rtl";

  return (
    <StudyShell
      title={title}
      subtitle={subtitle}
      onBack={onBack}
      notice={notice}
      footer={
        !finished &&
        (flipped ? (
          <div className="flash-ratings">
            {RATINGS.map(option => (
              <button
                type="button"
                key={option.rating}
                className={`flash-rating is-${option.rating}`}
                onClick={() => rate(option.rating)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flash-actions">
            <button
              type="button"
              onClick={() => setLang(l => (l === "en" ? "ar" : "en"))}
            >
              <span className="flash-action-icon">
                <Languages size={20} />
              </span>
              ترجمة
            </button>
            <button type="button" onClick={() => setSheet("explain")}>
              <span className="flash-action-icon is-green">
                <Lightbulb size={20} />
              </span>
              شرح
            </button>
            <button type="button" onClick={openChat}>
              <span className="flash-action-icon">
                <NiroAvatar size={24} expression="explaining" />
              </span>
              اسأل {NIRO_NAME}
            </button>
          </div>
        ))
      }
    >
      <div className="flash-stats">
        <div className="flash-stat-row">
          <span className="flash-stat">
            <b>
              <Clock3 size={13} /> {formatElapsed(now - startedAt)}
            </b>
            <small>الوقت</small>
          </span>
          <span className="flash-stat is-blue">
            <b>
              <CircleHelp size={13} /> {Math.max(0, queue.length - index)}
            </b>
            <small>متبقي</small>
          </span>
          <span className="flash-stat is-orange">
            <b>
              <GraduationCap size={13} /> {learning}
            </b>
            <small>قيد التعلم</small>
          </span>
          <span className="flash-stat is-green">
            <b>
              <CircleCheck size={13} /> {mastered}
            </b>
            <small>متقن</small>
          </span>
          <button
            type="button"
            className="flash-lang"
            onClick={() => setLang(l => (l === "en" ? "ar" : "en"))}
            aria-label="تغيير لغة البطاقة"
          >
            {lang === "en" ? "EN" : "ع"}
          </button>
        </div>
        <div className="flash-progress">
          <span>
            البطاقة: {Math.min(index + 1, queue.length)}/{queue.length}
          </span>
          <div className="flash-progress-track">
            <i
              style={{
                width: `${(Math.min(index, queue.length) / queue.length) * 100}%`,
              }}
            />
          </div>
        </div>
      </div>

      {finished ? (
        <div className="quiz-result">
          <CircleCheck size={36} />
          <h2>انتهت المراجعة 🎉</h2>
          <p>
            راجعت {queue.length} بطاقة في {formatElapsed(now - startedAt)} —
            متقن {mastered}، قيد التعلم {learning}.
          </p>
          <div className="quiz-result-actions">
            {learning > 0 && (
              <button
                type="button"
                className="primary-button"
                onClick={() => restart(true)}
              >
                <RotateCcw size={16} /> راجع البطاقات الصعبة
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
        card && (
          <div
            className={flipped ? "flash-card is-flipped" : "flash-card"}
            onClick={event => {
              if ((event.target as HTMLElement).closest("button")) return;
              setFlipped(f => !f);
            }}
          >
            <div className="flash-card-top">
              <span
                className={
                  flipped ? "flash-card-label is-answer" : "flash-card-label"
                }
              >
                {flipped ? "الإجابة" : "السؤال"}
                {!flipped && card.cardType && <> · {card.cardType}</>}
              </span>
              <button
                type="button"
                className="flash-source-button"
                onClick={() => setSheet("source")}
              >
                عرض مصدر السؤال 👀
              </button>
            </div>
            <div className="flash-card-content" dir={textDir}>
              <p className={lang === "en" ? "en" : ""}>
                {flipped ? answer : question}
              </p>
              {flipped && (card.relatedTermEn || card.relatedTermAr) && (
                <small className="flash-term">
                  {card.relatedTermEn}
                  {card.relatedTermAr ? ` · ${card.relatedTermAr}` : ""}
                </small>
              )}
            </div>
            <span className="flash-card-hint">
              {flipped ? "اضغط لرؤية السؤال" : "اضغط للقلب"}
            </span>
          </div>
        )
      )}

      {sheet && card && (
        <div className="study-sheet-backdrop" onClick={() => setSheet(null)}>
          <div
            className="study-sheet"
            onClick={event => event.stopPropagation()}
          >
            <div className="study-sheet-head">
              <strong>
                {sheet === "source"
                  ? `مصدر السؤال — صفحة ${card.sourcePage}`
                  : "شرح البطاقة"}
              </strong>
              <button
                type="button"
                onClick={() => setSheet(null)}
                aria-label="إغلاق"
              >
                <X size={18} />
              </button>
            </div>
            <div className="study-sheet-body">
              {sheet === "source" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="flash-source-image"
                  src={`/api/books/${bookId}/pages/${card.sourcePage}/image`}
                  alt={`الصفحة ${card.sourcePage}`}
                />
              ) : (
                <>
                  <span className="micro-label">QUESTION / السؤال</span>
                  <p className="en" dir="ltr">
                    <b>{card.questionEn}</b>
                  </p>
                  <p>{card.questionAr}</p>
                  <span className="micro-label">ANSWER / الإجابة</span>
                  <p className="en" dir="ltr">
                    {card.answerEn}
                  </p>
                  <p>{card.answerAr}</p>
                  {(card.relatedTermEn || card.relatedTermAr) && (
                    <>
                      <span className="micro-label">TERM / المصطلح</span>
                      <p>
                        <b className="en">{card.relatedTermEn}</b>
                        {card.relatedTermAr ? ` — ${card.relatedTermAr}` : ""}
                      </p>
                    </>
                  )}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setSheet(null);
                      openChat();
                    }}
                  >
                    <NiroAvatar size={18} expression="explaining" /> اسأل{" "}
                    {NIRO_NAME} عنها
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
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
