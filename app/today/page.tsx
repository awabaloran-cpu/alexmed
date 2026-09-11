"use client";

import Link from "next/link";
import { BookOpen, CalendarClock, CheckCircle2, Layers3 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

const TYPE_LABELS: Record<string, string> = {
  general: "عام",
  medical: "طبي",
  english: "لغة إنجليزية",
  mathematics: "رياضيات",
  aptitude: "قدرات",
  programming: "برمجة",
  custom: "مخصص",
};

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString("ar", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function daysUntil(value: string | Date) {
  const ms = new Date(value).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// "لوحة اليوم" (PR3) — a new, additive landing page that aggregates real
// data already served by existing endpoints (subjects, مِرآة/كتبي due cards,
// books) across every subject. Deliberately does NOT replace "/" (مِرآة's
// own home stays exactly as-is, per the "don't touch مِرآة" rule) — this is
// an additional StudyOS-wide entry point, linked from the sidebar.
// "اختبار مقترح"/"نقاط ضعف متكررة" from the original StudyOS plan are
// deferred (they need the quiz/error-tracking work in a later PR) rather
// than shown with fabricated data.
export default function TodayPage() {
  const subjectsQuery = trpc.subjects.list.useQuery();
  const booksDue = trpc.books.dueCards.useQuery();
  const decksDue = trpc.decks.dueCards.useQuery();
  const booksQuery = trpc.books.list.useQuery();

  const dueCount = (booksDue.data?.length ?? 0) + (decksDue.data?.length ?? 0);

  const upcomingExam = (subjectsQuery.data ?? [])
    .filter(subject => subject.examDate && daysUntil(subject.examDate) >= 0)
    .sort(
      (a, b) =>
        new Date(a.examDate!).getTime() - new Date(b.examDate!).getTime()
    )[0];

  // Most recently created book that already has at least one usable
  // chapter — the best honest "keep reading" suggestion available without
  // a dedicated read/unread tracking column (which doesn't exist yet).
  const suggestedBook = (booksQuery.data ?? []).find(
    book => book.completeChapterCount > 0
  );

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> StudyOS
          </div>
          <h1>ماذا ستدرس اليوم؟</h1>
          <p>نظرة سريعة على كل موادك في مكان واحد.</p>
        </div>
      </div>

      <div className="stats-row" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <span>بطاقات مستحقة اليوم</span>
          <strong>{dueCount}</strong>
        </div>
        {upcomingExam && (
          <div className="stat-card accent">
            <span>أقرب امتحان</span>
            <strong>
              {upcomingExam.name} · {daysUntil(upcomingExam.examDate!)} يوم
            </strong>
          </div>
        )}
      </div>

      <h2 style={{ marginBottom: 12 }}>موادك</h2>
      {subjectsQuery.isLoading ? (
        <p>جاري التحميل...</p>
      ) : !subjectsQuery.data?.length ? (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          <h3>لم تُنشئ أي مادة بعد</h3>
          <Link href="/subjects" className="secondary-button">
            أنشئ مادتك الأولى
          </Link>
        </div>
      ) : (
        <div className="library-grid" style={{ marginBottom: 24 }}>
          {subjectsQuery.data.map(subject => (
            <Link
              key={subject.id}
              href={`/subjects/${subject.id}`}
              className="library-item"
              style={{ display: "contents" }}
            >
              <div className="library-item-icon">
                <BookOpen size={18} />
              </div>
              <div className="library-item-meta">
                <strong>{subject.name}</strong>
                <span>
                  {TYPE_LABELS[subject.type] ?? subject.type} ·{" "}
                  {subject.bookCount} كتاب
                  {subject.examDate
                    ? ` · امتحان ${formatDate(subject.examDate)}`
                    : ""}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        <div className="panel-card">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">المراجعة</span>
              <h2>المستحق اليوم</h2>
            </div>
            <Layers3 size={20} className="heading-icon" />
          </div>
          {dueCount > 0 ? (
            <>
              <p>{dueCount} بطاقة بانتظار مراجعتك من مِرآة وكتبي معًا.</p>
              <Link
                href="/review"
                className="primary-button"
                style={{ marginTop: 12, display: "inline-flex" }}
              >
                ابدأ المراجعة
              </Link>
            </>
          ) : (
            <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle2 size={16} /> لا توجد بطاقات مستحقة الآن.
            </p>
          )}
        </div>

        <div className="panel-card">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">كتبي</span>
              <h2>تابع القراءة</h2>
            </div>
            <BookOpen size={20} className="heading-icon" />
          </div>
          {suggestedBook ? (
            <>
              <p>{suggestedBook.fileName}</p>
              <Link
                href={`/books/${suggestedBook.id}`}
                className="secondary-button"
                style={{ marginTop: 12, display: "inline-flex" }}
              >
                افتح الكتاب
              </Link>
            </>
          ) : (
            <p>ارفع كتابك الأول لتبدأ.</p>
          )}
        </div>

        {upcomingExam && (
          <div className="panel-card">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">موعد</span>
                <h2>موعد الاختبار القادم</h2>
              </div>
              <CalendarClock size={20} className="heading-icon" />
            </div>
            <p>
              {upcomingExam.name} — {formatDate(upcomingExam.examDate!)} (بعد{" "}
              {daysUntil(upcomingExam.examDate!)} يوم)
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
