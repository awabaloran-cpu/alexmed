"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Plus, Sparkles, User } from "lucide-react";

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
const ITEMS = [
  { href: "/subjects", label: "الرئيسية", icon: Home },
  { href: "/books/upload", label: "إضافة", icon: Plus },
  { href: "/assistant", label: "مساعد AI", icon: Sparkles },
  { href: "/account", label: "حسابي", icon: User },
] as const;

// PR17 — "✨ مساعد AI" carries the student's current context automatically
// when they're inside a chapter, book, or folder, per the confirmed
// requirement. app/assistant/page.tsx reads these same params to open the
// right chat.ask scope immediately instead of showing the no-context picker.
export function resolveAssistantHref(pathname: string): string {
  const chapterMatch = pathname.match(/^\/books\/[^/]+\/chapters\/([^/]+)/);
  if (chapterMatch)
    return `/assistant?scope=chapter&chapterId=${chapterMatch[1]}`;

  const bookMatch = pathname.match(/^\/books\/([^/]+)$/);
  if (bookMatch) return `/assistant?scope=book&bookId=${bookMatch[1]}`;

  const subjectMatch = pathname.match(/^\/subjects\/([^/]+)$/);
  if (subjectMatch)
    return `/assistant?scope=subject&subjectId=${subjectMatch[1]}`;

  return "/assistant";
}

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="student-bottom-nav" aria-label="التنقّل الرئيسي">
      {ITEMS.map(item => {
        const href =
          item.href === "/assistant"
            ? resolveAssistantHref(pathname)
            : item.href;
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={href}
            className={
              active
                ? "student-bottom-nav-item active"
                : "student-bottom-nav-item"
            }
            aria-current={active ? "page" : undefined}
          >
            <Icon size={20} strokeWidth={active ? 2.4 : 2} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
