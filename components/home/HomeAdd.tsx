"use client";

// What a student can add, as cards on the home: the two upload flows the
// app has (a study book at /books/upload, a question file at "/") and —
// only while Protected Doctor Question Sets is on — a doctor's access code.
// These were the bottom bar's "+" until 2026-10-14. A new folder has its
// own button beside "مجلداتي" below.
import Link from "next/link";
import { BookOpen, KeyRound, ListChecks, type LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import s from "./HomeAdd.module.css";

type Choice = {
  href: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
};

const CHOICES: Choice[] = [
  {
    href: "/books/upload",
    title: "كتاب دراسي",
    hint: "شرح وبطاقات واختبارات لكل فصل",
    icon: BookOpen,
    tone: s.book,
  },
  {
    href: "/",
    title: "ملف أسئلة",
    hint: "يتحوّل إلى بطاقات مذاكرة",
    icon: ListChecks,
    tone: s.questions,
  },
];

const ACCESS_CODE: Choice = {
  href: "/question-sets",
  title: "كود من دكتورك",
  hint: "أسئلة محمية بكود الوصول",
  icon: KeyRound,
  tone: s.code,
};

export function HomeAdd() {
  const doctorSetsOn =
    trpc.questionSets.enabled.useQuery(undefined, {
      staleTime: Infinity,
      retry: false,
    }).data === true;
  const choices = doctorSetsOn ? [...CHOICES, ACCESS_CODE] : CHOICES;

  return (
    <nav className={s.add} aria-label="أضف للدراسة">
      {choices.map(({ href, title, hint, icon: Icon, tone }) => (
        <Link key={href} href={href} className={`${s.card} ${tone}`}>
          <span className={s.icon} aria-hidden="true">
            <Icon size={22} />
          </span>
          <strong>{title}</strong>
          <span className={s.hint}>{hint}</span>
        </Link>
      ))}
    </nav>
  );
}
