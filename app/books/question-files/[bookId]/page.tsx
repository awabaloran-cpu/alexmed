"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";

const POLL_INTERVAL_MS = 3000;

// PR16 — shows exactly what was really found in the file: the extracted
// answer (if the source stated one) is visually distinct from "no answer in
// source" — never filled in with a guess. aiInferredAnswerIndex is reserved
// schema for a possible future feature and is never read here since nothing
// writes it yet.
export default function QuestionFileDetailPage() {
  const params = useParams<{ bookId: string }>();
  const utils = trpc.useUtils();
  const fileQuery = trpc.questionFiles.get.useQuery(
    { bookId: params.bookId },
    {
      refetchInterval: query =>
        query.state.data?.book.status === "extracting"
          ? POLL_INTERVAL_MS
          : false,
    }
  );
  const retryExtraction = trpc.questionFiles.retryExtraction.useMutation({
    onSuccess: () =>
      utils.questionFiles.get.invalidate({ bookId: params.bookId }),
  });

  if (fileQuery.isLoading) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
          <h3>جاري التحميل...</h3>
        </div>
      </section>
    );
  }

  if (!fileQuery.data) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>تعذر العثور على هذا الملف</h3>
          <Link
            href="/books/question-files"
            className="secondary-button"
            style={{ marginTop: 12 }}
          >
            العودة لملفات الأسئلة
          </Link>
        </div>
      </section>
    );
  }

  const { book, questions } = fileQuery.data;

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <Link
            href="/books/question-files"
            className="eyebrow"
            style={{ marginBottom: 8 }}
          >
            <span className="eyebrow-dot" /> ‹ ملفات الأسئلة
          </Link>
          <h1>{book.fileName}</h1>
          <p>{questions.length} سؤال مستخرج</p>
        </div>
      </div>

      {book.status === "extracting" && (
        <div className="inline-alert warning wide">
          <Loader2 size={16} className="spin" />
          جاري استخراج الأسئلة من الملف — تقدر تسكّر الصفحة وترجع بعدين.
        </div>
      )}

      {book.status === "failed" && (
        <div className="inline-alert error wide">
          <CircleAlert size={16} />
          <span>
            {book.extractionError || "تعذر استخراج الأسئلة من هذا الملف."}
          </span>
          <button
            type="button"
            className="secondary-button"
            style={{ marginRight: 12 }}
            disabled={retryExtraction.isPending}
            onClick={() => retryExtraction.mutate({ bookId: book.id })}
          >
            <RotateCcw size={14} /> إعادة المعالجة
          </button>
        </div>
      )}

      {book.status === "complete" && !questions.length && (
        <div className="empty-state">
          <ClipboardList size={28} />
          <h3>لم يتم العثور على أسئلة</h3>
        </div>
      )}

      {!!questions.length && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {questions.map((question, i) => (
            <div className="panel-card" key={question.id}>
              <span className="section-kicker">
                سؤال {i + 1} · صفحة {question.sourcePage}
              </span>
              <strong style={{ display: "block", marginTop: 8 }}>
                {question.questionText}
              </strong>
              {!!question.options?.length && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginTop: 10,
                  }}
                >
                  {question.options.map((option, optionIndex) => {
                    const isExtractedAnswer =
                      question.extractedAnswerIndex === optionIndex;
                    return (
                      <div
                        key={optionIndex}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid",
                          borderColor: isExtractedAnswer
                            ? "#69a17f"
                            : "#e4ded5",
                          background: isExtractedAnswer ? "#e3f0e8" : "#fffdf9",
                          fontSize: 13,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {isExtractedAnswer && (
                          <CheckCircle2 size={14} color="#528c6d" />
                        )}
                        {option}
                      </div>
                    );
                  })}
                </div>
              )}
              {question.extractedAnswerIndex === null &&
                !question.extractedAnswerText && (
                  <p style={{ fontSize: 12, color: "#974d49", marginTop: 8 }}>
                    لم تُذكر إجابة صحيحة لهذا السؤال في الملف الأصلي.
                  </p>
                )}
              {question.explanationText && (
                <p style={{ fontSize: 12, color: "#8a9493", marginTop: 8 }}>
                  {question.explanationText}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
