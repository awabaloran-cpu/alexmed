"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  BarChart3,
  Briefcase,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin", label: "نظرة عامة", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "المستخدمون", icon: Users, exact: false },
  {
    href: "/admin/materials",
    label: "مكتبة الأدمن",
    icon: GraduationCap,
    exact: false,
  },
  { href: "/admin/jobs", label: "الوظائف", icon: Briefcase, exact: false },
] as const;

// Deliberately its own component, not a themed variant of AppSidebar — a
// completely separate nav model (no مِرآة/كتبي items at all) for a
// completely separate audience (admins only, gated in app/admin/layout.tsx),
// per the explicit "لوحة تحكم منفصلة تمامًا عن التطبيق" request.
export default function AdminSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const accountName = session?.user?.name || session?.user?.email || "";
  const accountInitial = accountName.trim().charAt(0).toUpperCase() || "؟";

  return (
    <aside className="flex h-screen w-64 flex-col border-e border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheck size={18} strokeWidth={2.4} />
        </div>
        <div>
          <strong className="block text-sm font-semibold text-foreground">
            لوحة التحكم
          </strong>
          <span className="text-xs text-muted-foreground">Admin Console</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map(item => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Icon size={17} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-4">
        {session?.user && (
          <div className="mb-3 flex items-center gap-3 rounded-lg bg-secondary px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {accountInitial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {session.user.name || "المسؤول"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {session.user.email}
              </p>
            </div>
            <button
              type="button"
              title="تسجيل الخروج"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-muted-foreground hover:text-destructive"
            >
              <LogOut size={15} />
            </button>
          </div>
        )}
        <Link
          href="/"
          className="flex items-center justify-center gap-2 rounded-lg py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <BarChart3 size={13} /> رجوع إلى التطبيق
        </Link>
      </div>
    </aside>
  );
}
