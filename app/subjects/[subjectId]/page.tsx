"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { BookOpen, CircleAlert, Loader2, Plus } from "lucide-react";
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

function formatLastUpdate(value: string | Date | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

// Folder page (PR11) — real PDF cards from the existing books table, scoped
// to this subject/folder, plus the existing move-to-another-folder control
// (setSubject). See app/subjects/page.tsx for why folders reuse subjects
// rather than a new Folders system.
export default function SubjectDetailPage() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params.subjectId;
  const utils = trpc.useUtils();

  const subjectQuery = trpc.subjects.get.useQuery({ id: subjectId });
  const subjectsQuery = trpc.subjects.list.useQuery();
  const booksQuery = trpc.books.list.useQuery();
  const setSubject = trpc.books.setSubject.useMutation({
    onSuccess: () => {
      utils.books.list.invalidate();
      utils.subjects.list.invalidate();
    },
  });

  if (subjectQuery.isError || booksQuery.isError) {
    return (
      <section className="cards-view">
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>تعذر تحميل هذا المجلد</h3>
          <p>تحقق من اتصالك وحاول مرة أخرى.</p>
          <button
            type="button"
            className="secondary-button"
            style={{ marginTop: 14 }}
            onClick={() => {
              subjectQuery.refetch();
              booksQuery.refetch();
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </section>
    );
  }

  if (subjectQuery.isLoading || booksQuery.isLoading) {
    return (
      <section className="cards-view">
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
          <h3>جاري تحميل المجلد...</h3>
        </div>
      </section>
    );
  }

  if (!subjectQuery.data) {
    return (
      <section className="cards-view">
        <div className="empty-state">
          <h3>تعذّر العثور على هذا المجلد</h3>
          <Link
            href="/subjects"
            className="secondary-button"
            style={{ marginTop: 14 }}
          >
            العودة لملفاتي
          </Link>
        </div>
      </section>
    );
  }

  const subject = subjectQuery.data;
  const booksInSubject = (booksQuery.data ?? []).filter(
    book => book.subjectId === subjectId
  );
  const otherSubjects = (subjectsQuery.data ?? []).filter(
    s => s.id !== subjectId
  );

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <Link
            href="/subjects"
            className="eyebrow"
            style={{ marginBottom: 8 }}
          >
            <span className="eyebrow-dot" /> ‹ ملفاتي
          </Link>
          <h1>{subject.name}</h1>
          <p>
            {TYPE_LABELS[subject.type] ?? subject.type} ·{" "}
            {booksInSubject.length} ملف
          </p>
        </div>
        <div className="header-actions">
          <Link
            href={`/books/upload?subjectId=${subjectId}`}
            className="secondary-button"
          >
            <Plus size={16} /> إضافة ملف
          </Link>
        </div>
      </div>

      {!booksInSubject.length ? (
        <div className="empty-state">
          <BookOpen size={28} />
          <h3>لا توجد ملفات في هذا المجلد بعد</h3>
          <Link
            href={`/books/upload?subjectId=${subjectId}`}
            className="primary-button"
            style={{ marginTop: 14, width: "auto", padding: "0 22px" }}
          >
            <Plus size={16} /> إضافة ملف
          </Link>
        </div>
      ) : (
        <div className="library-grid">
          {booksInSubject.map(book => {
            const lastUpdate = formatLastUpdate(book.updatedAt);
            return (
              <div className="library-item" key={book.id}>
                <div className="library-item-icon">
                  <BookOpen size={18} />
                </div>
                <Link
                  href={`/books/${book.id}`}
                  className="library-item-meta"
                  style={{ display: "block" }}
                >
                  <strong>{book.fileName}</strong>
                  <span>
                    {book.pageCount} صفحة
                    {lastUpdate ? ` · آخر استخدام ${lastUpdate}` : ""}
                    {book.chapterCount
                      ? ` · ${book.completeChapterCount}/${book.chapterCount} فصل مكتمل`
                      : ""}
                  </span>
                </Link>
                <select
                  value={subjectId}
                  disabled={setSubject.isPending}
                  onChange={event => {
                    const value = event.target.value;
                    setSubject.mutate({
                      bookId: book.id,
                      subjectId: value === "__none__" ? null : value,
                    });
                  }}
                >
                  <option value={subjectId}>{subject.name}</option>
                  <option value="__none__">بدون مادة</option>
                  {otherSubjects.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
