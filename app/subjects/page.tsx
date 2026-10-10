"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  CircleAlert,
  FolderPlus,
  Loader2,
  Plus,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { SharedHomeWidget } from "@/components/sharing/SharedHomeWidget";
import { StudyNext } from "@/components/home/StudyNext";
import { HomeGamesRow } from "@/components/home/HomeGamesRow";

// Cycled by list position (not the subject's own type/color, since none is
// stored) purely to make one folder visually distinct from its neighbor in
// the grid — count must match the number of .subject-folder-card-N rules
// defined in app/globals.css.
const FOLDER_COLOR_COUNT = 5;

const TYPE_LABELS: Record<string, string> = {
  general: "عام",
  medical: "طبي",
  english: "لغة إنجليزية",
  mathematics: "رياضيات",
  aptitude: "قدرات",
  programming: "برمجة",
  custom: "مخصص",
};

// The folder search box only appears from this many folders on.
const SEARCH_MIN_FOLDERS = 5;

function formatLastUpdate(value: string | Date | null | undefined) {
  if (!value) return null;
  // Western digits, matching every other number in the app ("2 ملف").
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
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

  // The bottom bar's "+ → مجلد جديد" lands here with ?new=1.
  const searchParams = useSearchParams();
  const wantsNewFolder = searchParams.get("new") === "1";
  const [showForm, setShowForm] = useState(wantsNewFolder);
  useEffect(() => {
    if (wantsNewFolder) setShowForm(true);
  }, [wantsNewFolder]);
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
    <section className="cards-view home-view">
      <StudyNext />

      <SharedHomeWidget />

      <div className="home-section-head home-folders-head">
        <h2>مجلداتي</h2>
        {!showForm && (
          <button
            type="button"
            className="home-text-button"
            onClick={() => setShowForm(true)}
          >
            <FolderPlus size={16} aria-hidden="true" /> مجلد جديد
          </button>
        )}
      </div>

      {/* Search only once there are enough folders to need it. */}
      {subjects.length >= SEARCH_MIN_FOLDERS && (
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
        <div className="home-folder-form">
          <div className="home-folder-form-row">
            <input
              aria-label="اسم المجلد"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="اسم المجلد (مثال: تشريح، رياضيات 1)"
              style={{ flex: "1 1 220px" }}
            />
            <select
              aria-label="نوع المادة"
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
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowForm(false)}
            >
              إلغاء
            </button>
          </div>
          {createMutation.error && (
            <p className="home-form-error" role="alert">
              تعذّر إنشاء المجلد. تحقق من الاسم وحاول مرة أخرى.
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
        <p className="home-folders-empty">
          لا توجد مجلدات بعد. المجلد يجمع كتب مادة واحدة وملفات أسئلتها.{" "}
          {!showForm && (
            <button
              type="button"
              className="home-text-button"
              onClick={() => setShowForm(true)}
            >
              <Plus size={15} aria-hidden="true" /> أنشئ مجلدًا
            </button>
          )}
        </p>
      ) : !filtered.length ? (
        <div className="empty-state">
          <h3>لا نتائج مطابقة</h3>
          <p>جرّب اسمًا آخر للبحث.</p>
        </div>
      ) : (
        <ul className="home-folder-list">
          {filtered.map((subject, i) => {
            const lastUpdate = formatLastUpdate(subject.lastUpdatedAt);
            return (
              <li key={subject.id}>
                <Link
                  href={`/subjects/${subject.id}`}
                  className={`home-folder-row is-tab-${i % FOLDER_COLOR_COUNT}`}
                >
                  <span className="home-folder-tab" aria-hidden="true" />
                  <span className="home-folder-text">
                    <strong>{subject.name}</strong>
                    <span>
                      {subject.bookCount === 1
                        ? "كتاب واحد"
                        : `${subject.bookCount} كتب`}
                      {subject.deckCount
                        ? `، ${subject.deckCount} ملف أسئلة`
                        : ""}
                      {lastUpdate ? `، آخر تحديث ${lastUpdate}` : ""}
                    </span>
                  </span>
                  <ChevronLeft size={18} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <HomeGamesRow />
    </section>
  );
}
