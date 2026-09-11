"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Loader2, Plus } from "lucide-react";
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

// Minimal "موادي" surface for PR2 — create/list/rename subjects and see
// how many books each holds. Deliberately NOT the full StudyOS dashboard
// (progress bars, weak points, exam countdown) described in later phases —
// this PR is the schema + backend foundation (books.profile, subjects
// table), not a full workspace redesign (see the PR-splitting rule: don't
// mix a migration with a full UI redesign in one PR).
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

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> StudyOS
          </div>
          <h1>موادي</h1>
          <p>نظّم كتبك ومصادرك حسب المادة.</p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => setShowForm(value => !value)}
        >
          <Plus size={16} /> إضافة مادة
        </button>
      </div>

      {showForm && (
        <div className="panel-card" style={{ marginBottom: 18 }}>
          <div className="panel-heading">
            <h2>مادة جديدة</h2>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="اسم المادة (مثال: تشريح، رياضيات ١)"
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
                createMutation.mutate({ name: name.trim(), type: type as never })
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
              تعذّر إنشاء المادة. حاول مرة أخرى.
            </p>
          )}
        </div>
      )}

      {listQuery.isLoading ? (
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
        </div>
      ) : !listQuery.data?.length ? (
        <div className="empty-state">
          <h3>لا توجد مواد بعد</h3>
          <p>أنشئ مادتك الأولى لتبدأ بتنظيم كتبك.</p>
        </div>
      ) : (
        <div className="library-grid">
          {listQuery.data.map(subject => (
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
                  {TYPE_LABELS[subject.type] ?? subject.type} ·{" "}
                  {subject.bookCount} كتاب
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
