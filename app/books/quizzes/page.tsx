"use client";

import { CircleAlert, ClipboardList } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import McqCard from "@/components/McqCard";

export default function QuizzesPage() {
  const mcqsQuery = trpc.books.listMcqs.useQuery();
  const submitAttempt = trpc.books.submitMcqAttempt.useMutation();

  const mcqs = mcqsQuery.data ?? [];

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> اختباراتي
          </div>
          <h1>
            اختبر <em>فهمك.</em>
          </h1>
          <p>أسئلة من كل الفصول اللي درستها في كل كتبك.</p>
        </div>
      </div>

      {mcqsQuery.isError ? (
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>تعذر تحميل الاختبارات</h3>
          <p>تحقق من اتصالك وحاول مرة أخرى.</p>
          <button
            type="button"
            className="secondary-button"
            style={{ marginTop: 14 }}
            onClick={() => mcqsQuery.refetch()}
          >
            إعادة المحاولة
          </button>
        </div>
      ) : mcqsQuery.isLoading ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <h3>جاري تحميل الأسئلة...</h3>
        </div>
      ) : !mcqs.length ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <h3>مافيش أسئلة لسه</h3>
          <p>هتظهر هنا تلقائيًا لما تحلّل فصول من كتبك.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mcqs.map(mcq => (
            <McqCard
              key={mcq.id}
              mcq={{
                id: mcq.id,
                questionEn: mcq.questionEn,
                choices: mcq.choices as string[],
                correctIndex: mcq.correctIndex,
                explanationEn: mcq.explanationEn,
              }}
              meta={`${mcq.bookFileName} · ${mcq.chapterTitle}`}
              onSubmit={(mcqId, selectedIndex) =>
                submitAttempt.mutateAsync({ mcqId, selectedIndex })
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
