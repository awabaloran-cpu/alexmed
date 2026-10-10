"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  FolderPlus,
  Gamepad2,
  Home,
  KeyRound,
  ListChecks,
  Plus,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import NiroAvatar from "@/components/niro/NiroAvatar";
import { trpc } from "@/lib/trpc-client";
import { NIRO_NAME } from "@/lib/niro";

// Replaces AppSidebar as the persistent student-facing navigation (PR9).
// AppSidebar.tsx is intentionally left in place (unused by student pages
// after this change) rather than deleted — removing a component several
// files still statically import is a bigger, less reversible change than
// simply not rendering it anymore. A later cleanup pass can remove it once
// PR9-PR18 are all verified stable.
//
// "🏠 الرئيسية" points at "/subjects" as of PR10 (the "ملفاتي" folders
// view — see app/subjects/page.tsx). مِرآة itself is unaffected and still
// lives at "/", reachable via app/account/page.tsx's quick links.
// RTL order: الرئيسية + ألعاب sit to the right of the + button and مساعد AI
// + حسابي to its left, so the bar is balanced two-and-two.
const ITEMS = [
  { href: "/subjects", label: "الرئيسية", icon: Home },
  { href: "/games", label: "ألعاب", icon: Gamepad2 },
  { href: "/books/upload", label: "إضافة", icon: Plus },
  // The AI tab IS Niro (lib/niro.ts): his avatar instead of a generic icon.
  { href: "/assistant", label: NIRO_NAME, icon: Sparkles },
  { href: "/account", label: "حسابي", icon: User },
] as const;

// PR17 — "✨ مساعد AI" carries the student's current context automatically
// when they're inside a chapter, book, or folder, per the confirmed
// requirement. app/assistant/page.tsx reads these same params to open the
// right chat.ask scope immediately instead of showing the no-context picker.
const HOME_SECTIONS = ["/books", "/review", "/today", "/shared"];

const STATIC_BOOK_ROUTES = new Set([
  "upload",
  "question-files",
  "quizzes",
  "review",
  "stats",
  "weak-points",
]);

export function resolveAssistantHref(pathname: string): string {
  const chapterMatch = pathname.match(/^\/books\/[^/]+\/chapters\/([^/]+)/);
  if (chapterMatch)
    return `/assistant?scope=chapter&chapterId=${chapterMatch[1]}`;

  // /books/upload, /books/stats … are pages, not books.
  const bookMatch = pathname.match(/^\/books\/([^/]+)$/);
  if (bookMatch && !STATIC_BOOK_ROUTES.has(bookMatch[1]))
    return `/assistant?scope=book&bookId=${bookMatch[1]}`;

  const subjectMatch = pathname.match(/^\/subjects\/([^/]+)$/);
  if (subjectMatch)
    return `/assistant?scope=subject&subjectId=${subjectMatch[1]}`;

  return "/assistant";
}

// Real upload entry points only — NiroLearn has exactly two, already-existing
// flows (كتبي's chaptered book pipeline at /books/upload, and مِرآة's
// simpler question-file-to-flashcards flow at "/"). Deliberately not a
// larger grid: adding cards for capabilities the app doesn't have (voice
// recording, photo solve, ...) would be a stub pretending to work.
const UPLOAD_CHOICES = [
  {
    href: "/books/upload",
    title: "كتاب دراسي",
    description: "فصول، شرح، بطاقات، اختبارات وملخص لكل فصل.",
    icon: BookOpen,
  },
  {
    href: "/",
    title: "ملف أسئلة",
    description: "حوّل ملف أسئلة إلى بطاقات مذاكرة سريعة.",
    icon: ListChecks,
  },
  // The home page's former "إنشاء مجلد" button lives here now (one place
  // for every "add" action); app/subjects/page.tsx opens its form on ?new=1.
  {
    href: "/subjects?new=1",
    title: "مجلد جديد",
    description: "نظّم ملفاتك حسب المادة.",
    icon: FolderPlus,
  },
] as const;

const ACCESS_CODE_CHOICE = {
  href: "/question-sets",
  title: "كود من دكتورك",
  description: "أضف مجموعة أسئلة محمية بكود الوصول.",
  icon: KeyRound,
} as const;

// 👥 While Study Rooms is on (docs/study-rooms), "الغرف" takes the games'
// place in the bar and the games move to a row at the end of the home page
// (components/home/HomeGamesRow.tsx). Off: the bar is exactly as before.
const ROOMS_ITEM = { href: "/rooms", label: "الغرف", icon: Users } as const;

export default function BottomNav() {
  const pathname = usePathname();
  const [chooserOpen, setChooserOpen] = useState(false);
  const roomsOn =
    trpc.rooms.enabled.useQuery(undefined, { staleTime: Infinity, retry: false })
      .data?.enabled === true;
  const items = roomsOn
    ? ITEMS.map(item => (item.href === "/games" ? ROOMS_ITEM : item))
    : ITEMS;
  // 🔒 "كود من دكتورك" joins the choices only while Protected Doctor
  // Question Sets is switched on — asked for when the sheet opens, not on
  // every page load.
  const doctorSetsOn =
    trpc.questionSets.enabled.useQuery(undefined, {
      enabled: chooserOpen,
      staleTime: Infinity,
      retry: false,
    }).data === true;
  const choices = doctorSetsOn
    ? [...UPLOAD_CHOICES, ACCESS_CODE_CHOICE]
    : UPLOAD_CHOICES;

  return (
    <>
      <nav className="student-bottom-nav" aria-label="التنقّل الرئيسي">
        {items.map(item => {
          const href =
            item.href === "/assistant"
              ? resolveAssistantHref(pathname)
              : item.href;
          // Books, review and today's plan all live under Home.
          const active =
            pathname.startsWith(item.href) ||
            (item.href === "/subjects" &&
              HOME_SECTIONS.some(prefix => pathname.startsWith(prefix)) &&
              !pathname.startsWith("/books/upload"));
          const Icon = item.icon;

          // The upload action gets a raised, filled FAB instead of a flat
          // icon+label item — the one thing on this bar a student reaches
          // for constantly (starting a new upload), so it should read as
          // the primary action at a glance instead of blending in as a
          // fourth equal-weight tab. Tapping it opens a chooser (below)
          // rather than jumping straight into one flow.
          if (item.href === "/books/upload") {
            return (
              <button
                key={item.href}
                type="button"
                className="student-bottom-nav-fab-wrap"
                aria-label={item.label}
                aria-haspopup="dialog"
                aria-expanded={chooserOpen}
                onClick={() => setChooserOpen(true)}
              >
                <span className="student-bottom-nav-fab">
                  <Icon size={26} strokeWidth={2.4} />
                </span>
              </button>
            );
          }

          const isNiro = item.href === "/assistant";
          return (
            <Link
              key={item.href}
              href={href}
              className={`student-bottom-nav-item${isNiro ? " is-niro" : ""}${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
              aria-label={isNiro ? `اسأل ${NIRO_NAME}` : undefined}
            >
              {isNiro ? (
                <NiroAvatar size={24} spark={active ? "glow" : undefined} />
              ) : (
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
              )}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {chooserOpen && (
        <div
          className="upload-chooser-backdrop"
          onClick={() => setChooserOpen(false)}
        >
          <div
            className="upload-chooser-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="ماذا تريد أن تضيف؟"
            onClick={event => event.stopPropagation()}
          >
            <div className="upload-chooser-handle" />
            <h2>ماذا تريد أن تضيف؟</h2>
            {choices.map(choice => {
              const Icon = choice.icon;
              return (
                <Link
                  key={choice.href}
                  href={choice.href}
                  className="upload-chooser-option"
                  onClick={() => setChooserOpen(false)}
                >
                  <span className="upload-chooser-icon">
                    <Icon size={22} />
                  </span>
                  <span className="upload-chooser-text">
                    <strong>{choice.title}</strong>
                    <span>{choice.description}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
