"use client";

import Link from "next/link";
import { CircleAlert, ClipboardList, Loader2, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

const STATUS_LABELS: Record<string, string> = {
  extracting: "جاري الاستخراج...",
  complete: "تم الاستخراج",
  failed: "تعذر الاستخراج",
  pending: "قيد الانتظار",
  processing: "جاري المعالجة",
  partial_failed: "اكتمل جزئيًا",
};

// PR16 — "ملفات الأسئلة" lives as its own section, deliberately separate
// from ملفاتي/كتبي (a question file is never shown as a normal study book,
// per the confirmed architecture decision).
export default function QuestionFilesPage() {
  const filesQuery = trpc.questionFiles.list.useQuery();
  const files = filesQuery.data ?? [];

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> ملفات الأسئلة
          </div>
          <h1>
            بنوك أسئلتك <em>الجاهزة.</em>
          </h1>
          <p>أسئلة مستخرجة مباشرة من ملفاتك — بدون توليد بالذكاء الاصطناعي.</p>
        </div>
        <div className="header-actions">
          <Link href="/books/upload" className="secondary-button">
            <Plus size={16} /> رفع ملف أسئلة
          </Link>
        </div>
      </div>

      {filesQuery.isError ? (
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>تعذر تحميل ملفات الأسئلة</h3>
          <p>تحقق من اتصالك وحاول مرة أخرى.</p>
          <button
            type="button"
            className="secondary-button"
            style={{ marginTop: 14 }}
            onClick={() => filesQuery.refetch()}
          >
            إعادة المحاولة
          </button>
        </div>
      ) : filesQuery.isLoading ? (
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
          <h3>جاري التحميل...</h3>
        </div>
      ) : !files.length ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <h3>لا توجد ملفات أسئلة بعد</h3>
          <p>ارفع ملف أسئلة واختر "ملف أسئلة" عند الرفع.</p>
          <Link
            href="/books/upload"
            className="primary-button"
            style={{ marginTop: 14, width: "auto", padding: "0 22px" }}
          >
            <Plus size={16} /> رفع ملف
          </Link>
        </div>
      ) : (
        <div className="library-grid">
          {files.map(file => (
            <Link
              key={file.id}
              href={`/books/question-files/${file.id}`}
              className="library-item"
              style={{ display: "contents" }}
            >
              <div className="library-item-icon">
                <ClipboardList size={18} />
              </div>
              <div className="library-item-meta">
                <strong>{file.fileName}</strong>
                <span>
                  {STATUS_LABELS[file.status] ?? file.status}
                  {file.status === "complete"
                    ? ` · ${file.questionCount} سؤال`
                    : ""}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
