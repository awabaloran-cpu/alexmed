"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Layers3 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

type Rating = "hard" | "good" | "easy";

// Normalized shape both مِرآة's `decks.dueCards` and كتبي's `books.dueCards`
// rows get mapped into, so one queue/UI can show either kind of card without
// a server-side merged endpoint or a polymorphic schema — see Item C of the
// approved plan for why this stays a client-side merge.
type DueCard = {
  id: string;
  source: "book" | "deck";
  questionAr: string;
  questionEn: string;
  answerAr: string;
  answerEn: string;
  tag: string;
  relatedTermEn?: string | null;
  dueAt: string | Date;
};

export default function ReviewPage() {
  const booksDue = trpc.books.dueCards.useQuery();
  const decksDue = trpc.decks.dueCards.useQuery();
  const utils = trpc.useUtils();

  const rateBookCard = trpc.books.rateCard.useMutation({
    onSuccess: () => {
      utils.books.dueCards.invalidate();
      utils.decks.dueCards.invalidate();
    },
  });
  const rateDeckCard = trpc.decks.rateCard.useMutation({
    onSuccess: () => {
      utils.books.dueCards.invalidate();
      utils.decks.dueCards.invalidate();
    },
  });

  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const cards = useMemo<DueCard[]>(() => {
    const fromBooks: DueCard[] = (booksDue.data ?? []).map(card => ({
      id: card.id,
      source: "book",
      questionAr: card.questionAr,
      questionEn: card.questionEn,
      answerAr: card.answerAr,
      answerEn: card.answerEn,
      tag: `${card.bookFileName} · ${card.chapterTitle} · صفحة ${card.sourcePage}`,
      relatedTermEn: card.relatedTermEn,
      dueAt: card.dueAt,
    }));
    const fromDecks: DueCard[] = (decksDue.data ?? []).map(card => ({
      id: card.id,
      source: "deck",
      questionAr: card.questionArabic,
      questionEn: card.question,
      answerAr: card.answerArabic,
      answerEn: card.answer,
      tag: `${card.deckFileName} · صفحة ${card.sourcePage}`,
      relatedTermEn: card.keyword,
      dueAt: card.dueAt,
    }));
    return [...fromBooks, ...fromDecks].sort(
      (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    );
  }, [booksDue.data, decksDue.data]);

  const card = cards[index];
  const isPending = rateBookCard.isPending || rateDeckCard.isPending;
  const isLoading = booksDue.isLoading || decksDue.isLoading;
  const isError = booksDue.isError || decksDue.isError;

  function rate(rating: Rating) {
    if (!card) return;
    if (card.source === "book") {
      rateBookCard.mutate({ cardId: card.id, rating });
    } else {
      rateDeckCard.mutate({ cardId: card.id, rating });
    }
    setShowAnswer(false);
    setIndex(current => Math.min(current, Math.max(0, cards.length - 2)));
  }

  // كتبي-only 4th rating (FSRS's "Again"/lapse grade) — لا يوجد ما يقابله في
  // مِرآة (SM-2 stays a 3-button hard/good/easy scale, unchanged), so this is
  // a separate function/button rather than widening the shared Rating type
  // and risking a "again" ever reaching decksRouter's still-3-value enum.
  function rateAgain() {
    if (!card || card.source !== "book") return;
    rateBookCard.mutate({ cardId: card.id, rating: "again" });
    setShowAnswer(false);
    setIndex(current => Math.min(current, Math.max(0, cards.length - 2)));
  }

  if (isLoading) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <Layers3 size={28} />
          <h3>جاري تحميل بطاقاتك...</h3>
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <Layers3 size={28} />
          <h3>تعذر تحميل المراجعة</h3>
          <p>تحقق من اتصالك وحاول مرة أخرى.</p>
          <button
            type="button"
            className="secondary-button"
            style={{ marginTop: 14 }}
            onClick={() => {
              booksDue.refetch();
              decksDue.refetch();
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </section>
    );
  }

  if (!cards.length) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <CheckCircle2 size={28} />
          <h3>ممتاز، مافيش بطاقات مستحقة اليوم</h3>
          <p>ارجع بعدين، أو ارفع كتاب/ملف جديد.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot green" /> المراجعة اليومية
          </div>
          <h1>
            بطاقة {index + 1} من {cards.length}
          </h1>
          <p>باقي لك {cards.length - index} بطاقة فقط.</p>
        </div>
      </div>

      <article className="flashcard">
        <div className="flashcard-topline">
          <span className="card-tag">{card.tag}</span>
        </div>
        <div className="question-block">
          <span className="micro-label">السؤال / QUESTION</span>
          <h2>{card.questionAr}</h2>
          <p>{card.questionEn}</p>
        </div>
        <div className={showAnswer ? "answer-block revealed" : "answer-block"}>
          {showAnswer ? (
            <>
              <span className="micro-label">الإجابة / ANSWER</span>
              <div className="answer-pair">
                <strong>{card.answerAr}</strong>
                <span>{card.answerEn}</span>
              </div>
              {card.relatedTermEn && (
                <div className="concept-grid">
                  <div>
                    <span>المصطلح المرتبط</span>
                    <strong className="en">{card.relatedTermEn}</strong>
                  </div>
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              className="reveal-button"
              onClick={() => setShowAnswer(true)}
            >
              <span className="reveal-icon">?</span>
              <strong>اظهر الإجابة</strong>
              <small>Show Answer</small>
            </button>
          )}
        </div>
      </article>

      {showAnswer && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${card.source === "book" ? 4 : 3}, 1fr)`,
            gap: 12,
            marginTop: 20,
          }}
        >
          {card.source === "book" && (
            <button
              type="button"
              className="secondary-button"
              style={{
                background: "#f7ded9",
                color: "#974d49",
                border: "none",
              }}
              disabled={isPending}
              onClick={rateAgain}
            >
              لم أتذكر
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            style={{ background: "#faeddc", color: "#936239", border: "none" }}
            disabled={isPending}
            onClick={() => rate("hard")}
          >
            صعبة
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isPending}
            onClick={() => rate("good")}
          >
            جيدة
          </button>
          <button
            type="button"
            className="secondary-button"
            style={{ background: "#e3f0e8", color: "#528c6d", border: "none" }}
            disabled={isPending}
            onClick={() => rate("easy")}
          >
            سهلة
          </button>
        </div>
      )}
    </section>
  );
}
