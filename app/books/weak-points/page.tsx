"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, TriangleAlert } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import McqCard from "@/components/McqCard";

export default function WeakPointsPage() {
  const weakPointsQuery = trpc.books.listWeakPoints.useQuery();
  const submitAttempt = trpc.books.submitMcqAttempt.useMutation();
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

  const data = weakPointsQuery.data ?? { chapters: [], questions: [] };
  const questions = data.questions.filter(q => !resolvedIds.has(q.mcqId));

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> نقاط الضعف
          </div>
          <h1>
            راجع <em>اللي غلطت فيه.</em>
          </h1>
          <p>
            أسئلة آخر إجابة لك عليها كانت غلط — جاوب صح عشان تختفي من القائمة.
          </p>
        </div>
      </div>

      {weakPointsQuery.isError ? (
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>تعذر تحميل نقاط الضعف</h3>
          <p>تحقق من اتصالك وحاول مرة أخرى.</p>
          <button
            type="button"
            className="secondary-button"
            style={{ marginTop: 14 }}
            onClick={() => weakPointsQuery.refetch()}
          >
            إعادة المحاولة
          </button>
        </div>
      ) : weakPointsQuery.isLoading ? (
        <div className="empty-state">
          <TriangleAlert size={28} />
          <h3>جاري التحميل...</h3>
        </div>
      ) : !questions.length ? (
        <div className="empty-state">
          <CheckCircle2 size={28} />
          <h3>مافيش نقاط ضعف حاليًا</h3>
          <p>لسه ما جاوبتش غلط على أي سؤال، أو جاوبت صح على كل اللي غلطته.</p>
        </div>
      ) : (
        <>
          {data.chapters.length > 0 && (
            <div className="panel-card" style={{ marginBottom: 18 }}>
              <span className="section-kicker">أضعف الفصول</span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                {data.chapters.map(chapter => (
                  <Link
                    key={chapter.chapterId}
                    href={`/books/${chapter.bookId}/chapters/${chapter.chapterId}`}
                    className="nav-item"
                    style={{ justifyContent: "space-between" }}
                  >
                    <span>
                      {chapter.bookFileName} · {chapter.chapterTitle}
                    </span>
                    <b className="review-count">{chapter.wrongCount}</b>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {questions.map(q => (
              <McqCard
                key={q.mcqId}
                mcq={{
                  id: q.mcqId,
                  questionEn: q.questionEn,
                  choices: q.choices,
                  correctIndex: q.correctIndex,
                  explanationEn: q.explanationEn,
                }}
                meta={`${q.bookFileName} · ${q.chapterTitle}`}
                onSubmit={(mcqId, selectedIndex) =>
                  submitAttempt.mutateAsync({ mcqId, selectedIndex })
                }
                onAnswered={result => {
                  if (result.isCorrect) {
                    // Delayed so the student actually sees McqCard's green
                    // reveal + explanation before the card disappears —
                    // removing it in the same tick (the original bug here)
                    // meant the feedback never painted at all.
                    setTimeout(() => {
                      setResolvedIds(prev => new Set(prev).add(q.mcqId));
                    }, 1600);
                  }
                }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
