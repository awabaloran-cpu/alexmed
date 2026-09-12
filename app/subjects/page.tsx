"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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

// "الرئيسية" — ملفاتي (PR10). Folders reuse the existing subjects concept
// (lib/db-subjects.ts, subjectsRouter) rather than a new Folders system, per
// the confirmed architecture decision. Bottom Nav's "🏠" points here as of
// PR10 — مِرآة itself is untouched and still lives at "/" (linked from
// app/account/page.tsx's quick links); only the bottom nav's home
// destination changed, not مِرآة's own route or behavior.
export default function SubjectsPage() {
  const utils = trpc.useUtils();
  const listQuery = trpc.subjects.list.useQuery();
  const createMutation = trpc.subjects.create.useMutation({
    onSuccess: () => {
      utils.subjects.list.invalidate();
      setName("");
      setShowForm(false);
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("general");
  const [query, setQuery] = useState("");

  const subjects = listQuery.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return subjects;
    return subjects.filter(subject => subject.name.includes(q));
  }, [subjects, query]);

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> الرئيسية
          </div>
          <h1>ملفاتي</h1>
          <p>مجلداتك الدراسية — كل مجلد يجمع ملفاتك حسب المادة.</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowForm(value => !value)}
          >
            <Plus size={16} /> إنشاء مجلد
          </button>
        </div>
      </div>

      {!!subjects.length && (
        <div className="cards-toolbar">
          <div className="search-box">
            <span>⌕</span>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="ابحث عن مجلد..."
            />
          </div>
        </div>
      )}

      {showForm && (
        <div className="panel-card" style={{ marginBottom: 18 }}>
          <div className="panel-heading">
            <h2>مجلد جديد</h2>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="اسم المجلد (مثال: تشريح، رياضيات ١)"
              style={{ flex: "1 1 220px" }}
            />
            <select
              value={type}
              onChange={event => setType(event.target.value)}
            >
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary-button"
              disabled={!name.trim() || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  name: name.trim(),
                  type: type as never,
                })
              }
            >
              {createMutation.isPending ? (
                <Loader2 size={16} className="spin" />
              ) : (
                "إنشاء"
              )}
            </button>
          </div>
          {createMutation.error && (
            <p style={{ color: "#c0392b", marginTop: 8 }}>
              تعذّر إنشاء المجلد. حاول مرة أخرى.
            </p>
          )}
        </div>
      )}

      {listQuery.isError ? (
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>تعذر تحميل ملفاتك</h3>
          <p>تحقق من اتصالك وحاول مرة أخرى.</p>
          <button
            type="button"
            className="secondary-button"
            style={{ marginTop: 14 }}
            onClick={() => listQuery.refetch()}
          >
            إعادة المحاولة
          </button>
        </div>
      ) : listQuery.isLoading ? (
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
          <h3>جاري تحميل ملفاتك...</h3>
        </div>
      ) : !subjects.length ? (
        <div className="empty-state">
          <BookOpen size={28} />
          <h3>ابدأ برفع أول ملف دراسي</h3>
          <Link
            href="/books/upload"
            className="primary-button"
            style={{ marginTop: 14, width: "auto", padding: "0 22px" }}
          >
            <Plus size={16} /> رفع ملف
          </Link>
        </div>
      ) : !filtered.length ? (
        <div className="empty-state">
          <h3>لا نتائج مطابقة</h3>
          <p>جرّب اسمًا آخر للبحث.</p>
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map(subject => {
            const lastUpdate = formatLastUpdate(subject.lastUpdatedAt);
            return (
              <Link
                key={subject.id}
                href={`/subjects/${subject.id}`}
                className="library-item"
                style={{ display: "contents" }}
              >
                <div className="library-item-icon">
                  <BookOpen size={18} />
                </div>
                <div className="library-item-meta">
                  <strong>{subject.name}</strong>
                  <span>
                    {subject.bookCount} ملف
                    {lastUpdate ? ` · آخر تحديث ${lastUpdate}` : ""}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
