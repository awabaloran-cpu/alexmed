"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Gamepad2, Home, Sparkles, User, Users } from "lucide-react";
import NiroAvatar from "@/components/niro/NiroAvatar";
import { trpc } from "@/lib/trpc-client";
import { NIRO_NAME } from "@/lib/niro";

// The persistent student-facing navigation.
//
// "🏠 الرئيسية" points at "/subjects" (the "ملفاتي" folders view — see
// app/subjects/page.tsx). مِرآة itself still lives at "/".
// Since 2026-10-14 the middle of the bar is "استكشف" (app/discover): the
// "+" and its chooser are gone, and what it offered (كتاب دراسي, ملف أسئلة,
// كود من دكتورك) is a row of cards on the home (components/home/HomeAdd.tsx).
// RTL order: الرئيسية + ألعاب/الغرف to the right of استكشف, Niro + حسابي to
// its left.
const ITEMS = [
  { href: "/subjects", label: "الرئيسية", icon: Home },
  { href: "/games", label: "ألعاب", icon: Gamepad2 },
  { href: "/discover", label: "استكشف", icon: Compass },
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

// 👥 While Study Rooms is on (docs/study-rooms), "الغرف" takes the games'
// place in the bar and the games move to a row at the end of the home page
// (components/home/HomeGamesRow.tsx). Off: the games stay in the bar.
const ROOMS_ITEM = { href: "/rooms", label: "الغرف", icon: Users } as const;

export default function BottomNav() {
  const pathname = usePathname();
  const roomsOn =
    trpc.rooms.enabled.useQuery(undefined, {
      staleTime: Infinity,
      retry: false,
    }).data?.enabled === true;
  const items = roomsOn
    ? ITEMS.map(item => (item.href === "/games" ? ROOMS_ITEM : item))
    : ITEMS;

  return (
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
            HOME_SECTIONS.some(prefix => pathname.startsWith(prefix)));
        const Icon = item.icon;
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
  );
}
