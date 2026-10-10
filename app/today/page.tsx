"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { NextTaskCard, useStudyNext } from "@/components/home/StudyNext";
import { bookDisplayTitle } from "@/lib/book-title";
import { trpc } from "@/lib/trpc-client";
import s from "./today.module.css";

// Short forms: seven of them share one row on a phone.
const WEEKDAY_SHORT_AR = [
  "أحد",
  "إثنين",
  "ثلاثاء",
  "أربعاء",
  "خميس",
  "جمعة",
  "سبت",
];

const localDayKey = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

const TYPE_LABELS: Record<string, string> = {
  general: "عام",
  medical: "طبي",
  english: "لغة إنجليزية",
  mathematics: "رياضيات",
  aptitude: "قدرات",
  programming: "برمجة",
  custom: "مخصص",
};

function daysUntil(value: string | Date) {
  const ms = new Date(value).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function examLabel(days: number) {
  if (days <= 0) return "الامتحان اليوم";
  if (days === 1) return "الامتحان غدًا";
  if (days === 2) return "بعد يومين";
  return `بعد ${days} ${days <= 10 ? "أيام" : "يومًا"}`;
}

// The server counts by the student's own days (the page sends its clock's
// offset): today and the six after it, each with its count (0 when none).
function weekAhead(forecast: { day: string; count: number }[]) {
  const counts = new Map(
    forecast.map(entry => [String(entry.day).slice(0, 10), entry.count])
  );
  const start = new Date();
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + offset
    );
    const key = localDayKey(date);
    return {
      key,
      name: offset === 0 ? "اليوم" : WEEKDAY_SHORT_AR[date.getDay()],
      count: counts.get(key) ?? 0,
      today: offset === 0,
    };
  });
}

// "خطة اليوم": the next thing to do first — the same answer the home gives
// (components/home/StudyNext.tsx) — then the week of reviews ahead, and the
// rest folded away. Only what the existing queries return is shown; nothing
// here is estimated or made up.
export default function TodayPage() {
  const state = useStudyNext();
  const forecastQuery = trpc.books.upcomingForecast.useQuery({
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
  });

  const week = weekAhead(forecastQuery.data ?? []);
  const weekTotal = week.reduce((sum, day) => sum + day.count, 0);
  const busiest = Math.max(1, ...week.map(day => day.count));

  const subjects = [...state.subjects].sort((a, b) => {
    const left = a.examDate ? new Date(a.examDate).getTime() : Infinity;
    const right = b.examDate ? new Date(b.examDate).getTime() : Infinity;
    return left - right;
  });

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1>خطة اليوم</h1>
        <p>الخطوة التالية أولًا، ثم ما ينتظرك هذا الأسبوع.</p>
      </header>

      <NextTaskCard state={state} />

      <section className={s.week} aria-labelledby="today-week-title">
        <div className={s.weekHead}>
          <h2 id="today-week-title">مراجعات الأسبوع القادم</h2>
          {!forecastQuery.isLoading && weekTotal > 0 && (
            <span>{weekTotal} بطاقة</span>
          )}
        </div>
        {forecastQuery.isLoading ? (
          <span className={s.skeleton} aria-hidden="true" />
        ) : weekTotal === 0 ? (
          <p className={s.weekEmpty}>
            لا توجد مراجعات مجدولة خلال الأيام السبعة القادمة.
          </p>
        ) : (
          <ol className={s.days}>
            {week.map(day => (
              <li
                key={day.key}
                className={`${s.day}${day.today ? ` ${s.today}` : ""}`}
                aria-label={`${day.name}: ${day.count} بطاقة`}
              >
                <span className={`${s.count}${day.count ? "" : ` ${s.none}`}`}>
                  {day.count || "–"}
                </span>
                <span className={s.track} aria-hidden="true">
                  <span
                    className={s.bar}
                    style={{
                      height: day.count
                        ? `${Math.max(8, (day.count / busiest) * 100)}%`
                        : 0,
                    }}
                  />
                </span>
                <span className={s.dayName}>{day.name}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <details className={s.fold}>
        <summary>
          موادك
          <span>
            {state.subjectsLoading ? "" : `${subjects.length} `}
            <ChevronLeft size={18} aria-hidden="true" />
          </span>
        </summary>
        <div className={s.foldBody}>
          {state.subjectsLoading ? (
            <span className={s.skeleton} aria-hidden="true" />
          ) : subjects.length === 0 ? (
            <p className={s.emptyNote}>
              لم تُنشئ أي مادة بعد.{" "}
              <Link href="/subjects">أنشئ مادتك الأولى</Link>
            </p>
          ) : (
            <ul className={s.rows}>
              {subjects.map(subject => {
                const days = subject.examDate
                  ? daysUntil(subject.examDate)
                  : null;
                return (
                  <li key={subject.id}>
                    <Link href={`/subjects/${subject.id}`} className={s.row}>
                      <span className={s.rowText}>
                        <strong dir="auto">{subject.name}</strong>
                        <span>
                          {TYPE_LABELS[subject.type] ?? subject.type} ·{" "}
                          {subject.bookCount} كتاب
                        </span>
                      </span>
                      {days !== null && days >= 0 && (
                        <span className={s.examSoon}>{examLabel(days)}</span>
                      )}
                      <ChevronLeft size={18} aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>

      {state.books.length > 0 && (
        <details className={s.fold}>
          <summary>
            كتبك
            <span>
              {state.books.length} <ChevronLeft size={18} aria-hidden="true" />
            </span>
          </summary>
          <div className={s.foldBody}>
            <ul className={s.rows}>
              {state.books.slice(0, 8).map(book => (
                <li key={book.id}>
                  <Link href={`/books/${book.id}`} className={s.row}>
                    <span className={s.rowText}>
                      <strong dir="auto">
                        {bookDisplayTitle(book.fileName)}
                      </strong>
                      <span>
                        {book.chapterCount === 0
                          ? "نقرأ الصفحات…"
                          : book.completeChapterCount === 0
                            ? "نجهّز أدوات الدراسة…"
                            : book.chapterCount === 1
                              ? "جاهز للدراسة"
                              : `${book.completeChapterCount} من ${book.chapterCount} أجزاء جاهزة`}
                      </span>
                    </span>
                    <ChevronLeft size={18} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}
