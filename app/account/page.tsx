"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  RotateCcw,
  Settings,
  TriangleAlert,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// Real route for Bottom Nav's "👤 حسابي". Also keeps مِرآة reachable (still
// lives at "/", unchanged) now that Bottom Nav's "🏠" points at "/subjects"
// (ملفاتي) as of PR10 — plus every other page AppSidebar used to expose, so
// removing the persistent sidebar never strands an existing feature.
const QUICK_LINKS = [
  { href: "/", label: "مِرآة", icon: BookOpen },
  { href: "/today", label: "لوحة اليوم", icon: LayoutDashboard },
  { href: "/review", label: "المراجعة اليومية", icon: RotateCcw },
  { href: "/books/quizzes", label: "اختباراتي", icon: ClipboardList },
  {
    href: "/books/question-files",
    label: "ملفات الأسئلة",
    icon: ClipboardList,
  },
  { href: "/books/weak-points", label: "نقاط الضعف", icon: TriangleAlert },
  { href: "/books/stats", label: "إحصائياتي", icon: BarChart3 },
  { href: "/materials", label: "مكتبة الأدمن", icon: GraduationCap },
] as const;

const PLAN_LABELS: Record<string, string> = {
  free: "مجانية",
  premium: "بريميوم",
};

export default function AccountPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const name = session?.user?.name || session?.user?.email || "حسابي";
  const initial = name.trim().charAt(0).toUpperCase() || "؟";

  const profileQuery = trpc.auth.profile.useQuery();
  const statsQuery = trpc.books.stats.useQuery();
  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: () => profileQuery.refetch(),
  });

  const [academicYear, setAcademicYear] = useState("");
  const [specialty, setSpecialty] = useState("");
  useEffect(() => {
    if (!profileQuery.data) return;
    setAcademicYear(profileQuery.data.academicYear ?? "");
    setSpecialty(profileQuery.data.specialty ?? "");
  }, [profileQuery.data]);

  return (
    <section className="upload-view">
      <div className="cards-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> حسابي
          </div>
          <h1>
            مرحبًا، <em>{session?.user?.name || "طالب"}.</em>
          </h1>
          <p>{session?.user?.email}</p>
        </div>
      </div>

      <div
        className="empty-state"
        style={{ alignItems: "flex-start", textAlign: "right" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div className="sidebar-account-avatar">{initial}</div>
          <div>
            <strong>{name}</strong>
            {isAdmin && <div style={{ fontSize: 13, opacity: 0.7 }}>أدمن</div>}
          </div>
        </div>

        {/* PR18 — real, saved profile fields (no fake settings/language
            toggles added: this app has no i18n/notification system to back
            them, so a control here would do nothing real). */}
        <div
          style={{ display: "flex", gap: 12, flexWrap: "wrap", width: "100%" }}
        >
          <label style={{ flex: "1 1 160px" }}>
            <span style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
              السنة الدراسية
            </span>
            <input
              value={academicYear}
              onChange={event => setAcademicYear(event.target.value)}
              placeholder="مثال: السنة الثالثة"
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ flex: "1 1 160px" }}>
            <span style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
              التخصص
            </span>
            <input
              value={specialty}
              onChange={event => setSpecialty(event.target.value)}
              placeholder="مثال: طب بشري"
              style={{ width: "100%" }}
            />
          </label>
        </div>
        <button
          type="button"
          className="secondary-button"
          style={{ marginTop: 10 }}
          disabled={updateProfile.isPending}
          onClick={() =>
            updateProfile.mutate({
              academicYear: academicYear.trim() || null,
              specialty: specialty.trim() || null,
            })
          }
        >
          حفظ
        </button>
        {updateProfile.isSuccess && (
          <p style={{ fontSize: 12, color: "#528c6d", marginTop: 6 }}>
            تم الحفظ.
          </p>
        )}

        {profileQuery.data && (
          <p style={{ fontSize: 12, color: "#8a9493", marginTop: 14 }}>
            الاشتراك:{" "}
            <strong>
              {PLAN_LABELS[profileQuery.data.plan] ?? profileQuery.data.plan}
            </strong>
            {profileQuery.data.planExpiresAt &&
              ` · حتى ${new Date(profileQuery.data.planExpiresAt).toLocaleDateString("ar-EG")}`}
          </p>
        )}
      </div>

      {/* PR18 — real study statistics, from lib/db-books.ts's getBookStatsForUser. */}
      {statsQuery.data && (
        <div className="stats-row" style={{ margin: "18px 0" }}>
          <div className="stat-card">
            <span>الملفات</span>
            <strong>{statsQuery.data.fileCount}</strong>
          </div>
          <div className="stat-card">
            <span>البطاقات</span>
            <strong>{statsQuery.data.cardCount}</strong>
          </div>
          <div className="stat-card">
            <span>أسئلة الاختبارات المُجابة</span>
            <strong>{statsQuery.data.quizQuestionsAnsweredCount}</strong>
          </div>
          <div className="stat-card">
            <span>متوسط الدرجة</span>
            <strong>{statsQuery.data.accuracyPercent}%</strong>
          </div>
          <div className="stat-card accent">
            <span>بطاقات تمت مراجعتها</span>
            <strong>{statsQuery.data.cardsReviewed}</strong>
          </div>
        </div>
      )}

      <div className="library-grid">
        {QUICK_LINKS.map(link => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href} className="library-card">
              <Icon size={20} />
              <span>{link.label}</span>
            </Link>
          );
        })}
        {isAdmin && (
          <Link href="/admin" className="library-card">
            <Settings size={20} />
            <span>لوحة تحكم الأدمن</span>
          </Link>
        )}
      </div>

      <div className="header-actions" style={{ marginTop: 24 }}>
        <button
          type="button"
          className="secondary-button"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut size={16} /> تسجيل الخروج
        </button>
      </div>
    </section>
  );
}
