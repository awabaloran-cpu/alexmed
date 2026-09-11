"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { BookOpen, Loader2 } from "lucide-react";
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

// Minimal subject detail: which books are in it, with a way to move any
// book to a different subject (or unassign it) — see app/subjects/page.tsx
// for why this stays a plain list rather than the full StudyOS dashboard.
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

  if (subjectQuery.isLoading || booksQuery.isLoading) {
    return (
      <section className="cards-view">
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
        </div>
      </section>
    );
  }

  if (!subjectQuery.data) {
    return (
      <section className="cards-view">
        <div className="empty-state">
          <h3>تعذّر العثور على هذه المادة</h3>
          <Link href="/subjects" className="secondary-button">
            العودة لموادي
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
            <span className="eyebrow-dot" /> ‹ موادي
          </Link>
          <h1>{subject.name}</h1>
          <p>
            {TYPE_LABELS[subject.type] ?? subject.type} ·{" "}
            {booksInSubject.length} كتاب
          </p>
        </div>
      </div>

      {!booksInSubject.length ? (
        <div className="empty-state">
          <h3>لا توجد كتب في هذه المادة بعد</h3>
          <Link href="/books/upload" className="secondary-button">
            ارفع كتابًا
          </Link>
        </div>
      ) : (
        <div className="library-grid">
          {booksInSubject.map(book => (
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
                  {book.completeChapterCount}/{book.chapterCount} فصل مكتمل
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
          ))}
        </div>
      )}
    </section>
  );
}
