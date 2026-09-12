"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import McqCard, { type McqSubmitResult } from "@/components/McqCard";

const COUNT_OPTIONS = [10, 20, 30, 50] as const;

type Mcq = {
  id: string;
  questionEn: string;
  choices: string[];
  correctIndex: number;
  explanationEn: string;
  sourcePage: number;
  validationStatus: "pending" | "valid" | "flagged";
  validationNote: string | null;
  chapterTitle: string;
  bookFileName: string;
};

type Answer = { mcq: Mcq; result: McqSubmitResult };

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Real quiz experience (PR15) over the existing bookMcqs/submitMcqAttempt —
// no new question-generation, no difficulty/type filters (bookMcqs carries
// no such field yet, and inventing one here would be fake metadata, not a
// real filter). Source file + question count are the only setup controls
// since they're the only ones backed by real data.
export default function QuizzesPage() {
  const mcqsQuery = trpc.books.listMcqs.useQuery();
  const submitAttempt = trpc.books.submitMcqAttempt.useMutation();

  const allMcqs = (mcqsQuery.data ?? []) as Mcq[];
  const sourceOptions = Array.from(new Set(allMcqs.map(m => m.bookFileName)));

  const [phase, setPhase] = useState<"setup" | "active" | "results">("setup");
  const [source, setSource] = useState("");
  const [count, setCount] = useState<number>(10);
  const [session, setSession] = useState<Mcq[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [showMistakes, setShowMistakes] = useState(false);

  const pool = source
    ? allMcqs.filter(m => m.bookFileName === source)
    : allMcqs;

  function startQuiz(questions: Mcq[]) {
    setSession(questions);
    setIndex(0);
    setAnswers([]);
    setShowMistakes(false);
    setPhase("active");
  }

  const current = session[index];
  const currentAnswer = answers[index];
  const score = answers.filter(a => a.result.isCorrect).length;
  const percent = answers.length
    ? Math.round((score / answers.length) * 100)
    : 0;
  const mistakes = answers.filter(a => !a.result.isCorrect);

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
      ) : !allMcqs.length ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <h3>مافيش أسئلة لسه</h3>
          <p>هتظهر هنا تلقائيًا لما تحلّل فصول من كتبك.</p>
        </div>
      ) : phase === "setup" ? (
        <div className="panel-card" style={{ maxWidth: 480 }}>
          <span className="section-kicker">إعداد الاختبار</span>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              marginTop: 14,
            }}
          >
            <label>
              <span style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
                المصدر
              </span>
              <select
                value={source}
                onChange={event => setSource(event.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">كل الملفات ({allMcqs.length} سؤال)</option>
                {sourceOptions.map(name => (
                  <option key={name} value={name}>
                    {name} (
                    {allMcqs.filter(m => m.bookFileName === name).length} سؤال)
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
                عدد الأسئلة
              </span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {COUNT_OPTIONS.map(option => (
                  <button
                    key={option}
                    type="button"
                    className={
                      count === option
                        ? "filter-button active"
                        : "filter-button"
                    }
                    onClick={() => setCount(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={!pool.length}
              onClick={() =>
                startQuiz(shuffled(pool).slice(0, Math.min(count, pool.length)))
              }
            >
              ابدأ الاختبار ({Math.min(count, pool.length)} سؤال)
            </button>
            {!pool.length && (
              <p style={{ fontSize: 12, color: "#974d49" }}>
                لا توجد أسئلة لهذا المصدر.
              </p>
            )}
          </div>
        </div>
      ) : phase === "active" && current ? (
        <div style={{ maxWidth: 560 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
              fontSize: 12,
              color: "#8d9895",
            }}
          >
            <span>
              سؤال {index + 1} / {session.length}
            </span>
            <span>
              {current.bookFileName} · {current.chapterTitle} · صفحة{" "}
              {current.sourcePage}
            </span>
          </div>
          {current.validationStatus === "flagged" && (
            <div className="inline-alert warning" style={{ marginBottom: 10 }}>
              <CircleAlert size={14} />
              <span>
                هذا السؤال يحتاج مراجعة
                {current.validationNote ? `: ${current.validationNote}` : ""}
              </span>
            </div>
          )}
          <McqCard
            key={current.id}
            mcq={{
              id: current.id,
              questionEn: current.questionEn,
              choices: current.choices,
              correctIndex: current.correctIndex,
              explanationEn: current.explanationEn,
            }}
            onSubmit={(mcqId, selectedIndex) =>
              submitAttempt.mutateAsync({ mcqId, selectedIndex })
            }
            onAnswered={result => {
              setAnswers(prev => {
                const next = [...prev];
                next[index] = { mcq: current, result };
                return next;
              });
            }}
          />
          {currentAnswer && (
            <button
              type="button"
              className="primary-button"
              style={{ marginTop: 14 }}
              onClick={() => {
                if (index + 1 < session.length) {
                  setIndex(i => i + 1);
                } else {
                  setPhase("results");
                }
              }}
            >
              {index + 1 < session.length ? "التالي" : "عرض النتيجة"}
            </button>
          )}
        </div>
      ) : (
        phase === "results" && (
          <div
            style={{
              maxWidth: 560,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div className="panel-card" style={{ textAlign: "center" }}>
              <span className="section-kicker">النتيجة</span>
              <p style={{ fontSize: 34, fontWeight: 800, margin: "10px 0 0" }}>
                {score}/{answers.length}
              </p>
              <p style={{ fontSize: 16, color: "#8a9493" }}>{percent}%</p>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="secondary-button"
                disabled={!mistakes.length}
                onClick={() => setShowMistakes(v => !v)}
              >
                <TriangleAlert size={14} /> مراجعة الأخطاء ({mistakes.length})
              </button>
              <Link href="/books/weak-points" className="secondary-button">
                <TriangleAlert size={14} /> نقاط الضعف
              </Link>
              <button
                type="button"
                className="secondary-button"
                onClick={() => startQuiz(shuffled(session))}
              >
                <RotateCcw size={14} /> إعادة الاختبار
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPhase("setup")}
              >
                اختبار جديد
              </button>
            </div>

            {showMistakes && (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {mistakes.map(a => (
                  <div className="panel-card" key={a.mcq.id}>
                    <span className="section-kicker">
                      {a.mcq.bookFileName} · {a.mcq.chapterTitle}
                    </span>
                    <strong
                      className="en"
                      style={{ display: "block", marginTop: 8 }}
                    >
                      {a.mcq.questionEn}
                    </strong>
                    <p style={{ fontSize: 12, color: "#528c6d", marginTop: 8 }}>
                      <CheckCircle2
                        size={13}
                        style={{ verticalAlign: "middle" }}
                      />{" "}
                      {a.mcq.choices[a.mcq.correctIndex]}
                    </p>
                    <p style={{ fontSize: 12, color: "#8a9493" }}>
                      {a.mcq.explanationEn}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </section>
  );
}
