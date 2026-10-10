"use client";

// Home's command center: one clear "what now?" answer, then the student's
// books. Everything comes from queries the app already serves (books.list,
// the two due-card queues, subjects' exam dates) — no new data, and nothing
// shown that the server didn't return.
import Link from "next/link";
import { useSession } from "next-auth/react";
import { CalendarClock, ChevronLeft, Loader2, Upload } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { bookDisplayTitle } from "@/lib/book-title";

function greeting(hour: number) {
  if (hour < 5) return "سهرة دراسة";
  if (hour < 12) return "صباح الخير";
  return "مساء الخير";
}

function daysUntil(value: string | Date) {
  const ms = new Date(value).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function daysLabel(days: number) {
  if (days <= 0) return "اليوم";
  if (days === 1) return "غدًا";
  if (days === 2) return "بعد يومين";
  return `بعد ${days} ${days <= 10 ? "أيام" : "يومًا"}`;
}

type BookRow = {
  id: string;
  fileName: string;
  chapterCount: number;
  completeChapterCount: number;
};

function bookState(book: BookRow) {
  if (book.chapterCount === 0) return "reading" as const;
  if (book.completeChapterCount === 0) return "preparing" as const;
  return "ready" as const;
}

// The one thing to do now, and why — shared by the home and /today so both
// always give the same answer.
export function useStudyNext() {
  const booksQuery = trpc.books.list.useQuery();
  const booksDue = trpc.books.dueCards.useQuery();
  const decksDue = trpc.decks.dueCards.useQuery();
  const subjectsQuery = trpc.subjects.list.useQuery();

  const books = (booksQuery.data ?? []) as BookRow[];
  const dueCount = (booksDue.data?.length ?? 0) + (decksDue.data?.length ?? 0);
  const loading =
    booksQuery.isLoading || booksDue.isLoading || decksDue.isLoading;

  const exam = (subjectsQuery.data ?? [])
    .filter(subject => subject.examDate && daysUntil(subject.examDate) >= 0)
    .sort(
      (a, b) =>
        new Date(a.examDate!).getTime() - new Date(b.examDate!).getTime()
    )[0];

  const preparing = books.find(book => bookState(book) !== "ready");
  const readyBook = books.find(book => bookState(book) === "ready");

  let next: {
    title: string;
    detail: string;
    href: string;
    action: string;
    busy?: boolean;
  };
  if (dueCount > 0) {
    next = {
      title:
        dueCount === 1
          ? "بطاقة واحدة جاهزة للمراجعة"
          : `${dueCount} بطاقة جاهزة للمراجعة`,
      detail: `حوالي ${Math.max(1, Math.round(dueCount / 3))} دقيقة، والمراجعة في وقتها تثبّت المعلومة.`,
      href: "/review",
      action: "ابدأ المراجعة",
    };
  } else if (preparing) {
    next = {
      title: `نجهّز «${bookDisplayTitle(preparing.fileName)}»`,
      detail: "نقرأ الصفحات ونقسّمها لفصول. تقدر تفتحه وتتابع التقدّم.",
      href: `/books/${preparing.id}`,
      action: "افتح الكتاب",
      busy: true,
    };
  } else if (readyBook) {
    next = {
      title: `تابع «${bookDisplayTitle(readyBook.fileName)}»`,
      detail: "لا يوجد شيء مستحق للمراجعة الآن. أكمل من حيث توقفت.",
      href: `/books/${readyBook.id}`,
      action: "تابع الدراسة",
    };
  } else {
    next = {
      title: "ارفع أول كتاب لك",
      detail:
        "ملف PDF من مقرّرك يكفي. نحوّله لبطاقات وأسئلة وملخص وخريطة ذهنية.",
      href: "/books/upload",
      action: "ارفع كتابًا",
    };
  }

  return {
    next,
    loading,
    books,
    dueCount,
    exam,
    subjects: subjectsQuery.data ?? [],
    subjectsLoading: subjectsQuery.isLoading,
  };
}

// "مهمتك التالية الآن": one title, the reason, one button.
export function NextTaskCard({
  state,
}: {
  state: ReturnType<typeof useStudyNext>;
}) {
  const { next, loading, books, dueCount, exam } = state;
  return (
    <section
      className={`home-next${loading ? " is-loading" : ""}`}
      aria-labelledby="home-next-title"
      aria-busy={loading}
    >
      {loading ? (
        <>
          <span className="home-next-skeleton" />
          <span className="home-next-skeleton is-short" />
        </>
      ) : (
        <>
          <h2 id="home-next-title">{next.title}</h2>
          <p>{next.detail}</p>
          <Link href={next.href} className="nl-marker-button">
            {next.busy ? (
              <Loader2 size={17} className="spin" aria-hidden="true" />
            ) : !books.length && dueCount === 0 ? (
              <Upload size={17} aria-hidden="true" />
            ) : null}
            {next.action}
          </Link>
          {exam && (
            <p className="home-next-exam">
              <CalendarClock size={16} aria-hidden="true" />
              امتحان {exam.name} {daysLabel(daysUntil(exam.examDate!))}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function StudyNext() {
  const { data: session } = useSession();
  const state = useStudyNext();
  const { books } = state;
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const hello = greeting(new Date().getHours());

  return (
    <>
      <header className="home-head">
        <h1>
          {hello}
          {firstName ? `، ${firstName}` : ""}
        </h1>
      </header>

      <NextTaskCard state={state} />

      {books.length > 0 && (
        <section className="home-section" aria-labelledby="home-books-title">
          <div className="home-section-head">
            <h2 id="home-books-title">كتبك</h2>
            <Link href="/today">خطة اليوم</Link>
          </div>
          <ul className="home-book-list">
            {books.slice(0, 4).map(book => {
              const state = bookState(book);
              return (
                <li key={book.id}>
                  <Link href={`/books/${book.id}`} className="home-book-row">
                    <span
                      className={`home-book-spine is-${state}`}
                      aria-hidden="true"
                    />
                    <span className="home-book-text">
                      <strong>
                        <bdi>{bookDisplayTitle(book.fileName)}</bdi>
                      </strong>
                      <span>
                        {state === "ready"
                          ? book.chapterCount === 1
                            ? "جاهز للدراسة"
                            : `${book.completeChapterCount} من ${book.chapterCount} أجزاء جاهزة`
                          : state === "preparing"
                            ? "نجهّز أدوات الدراسة…"
                            : "نقرأ الصفحات…"}
                      </span>
                    </span>
                    <ChevronLeft size={18} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
