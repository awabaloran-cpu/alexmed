"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Loader2,
  Search,
  Send,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { StudentAvatar } from "./StudentAvatar";

// 📤 Owner-side sharing sheet for one Study Pack: pick one of your
// colleagues (app/shared is where they are added), confirm, send — plus the
// "👥 تمت المشاركة مع" list with revoke. Every rule (ownership, colleagues
// only, duplicates, blocks, cooldown) is enforced by the server; this only
// shows its answer.

type Student = {
  id: string;
  name: string | null;
  image: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "بانتظار الرد",
  accepted: "لديه وصول",
  declined: "رفض الطلب",
};

export function ShareStudyPackModal({
  bookId,
  bookTitle,
  onClose,
}: {
  bookId: string;
  bookTitle: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Student | null>(null);
  const [sentTo, setSentTo] = useState<Student | null>(null);

  const colleagues = trpc.colleagues.list.useQuery();
  const shares = trpc.sharing.sharesForBook.useQuery({ bookId });
  const send = trpc.sharing.sendRequest.useMutation({
    onSuccess: () => {
      setSentTo(selected);
      setSelected(null);
      setQuery("");
      utils.sharing.sharesForBook.invalidate({ bookId });
    },
  });
  const revoke = trpc.sharing.revoke.useMutation({
    onSuccess: () => utils.sharing.sharesForBook.invalidate({ bookId }),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sharedWith = shares.data ?? [];
  // A colleague who already has the file (or a request waiting) is in the
  // list below, not offered again.
  const taken = new Set(
    sharedWith
      .filter(share => share.status !== "declined")
      .map(share => share.recipientId)
  );
  const wanted = query.trim().toLowerCase();
  const everyone = colleagues.data ?? [];
  const results = everyone.filter(
    student =>
      !taken.has(student.id) &&
      (!wanted || (student.name ?? "").toLowerCase().includes(wanted))
  );

  return (
    <div className="upload-chooser-backdrop sh-backdrop" onClick={onClose}>
      <div
        className="upload-chooser-sheet sh-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sh-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="upload-chooser-handle" />
        <div className="sh-head">
          <div>
            <h2 id="sh-title">أرسل الملف لزميل</h2>
            <p className="sh-sub" dir="auto">
              {bookTitle}
            </p>
          </div>
          <button
            type="button"
            className="sh-icon-button"
            aria-label="إغلاق"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {sentTo ? (
          <div className="sh-success" role="status">
            <span className="sh-success-icon">
              <Check size={22} />
            </span>
            <strong>✓ تم إرسال الطلب</strong>
            <span>
              سيظهر الملف عند <bdi>{sentTo.name || "زميلك"}</bdi> بعد قبوله.
            </span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSentTo(null)}
            >
              إرسال لزميل آخر
            </button>
          </div>
        ) : selected ? (
          <div className="sh-confirm">
            <div className="sh-student is-selected">
              <StudentAvatar name={selected.name} username={selected.id} />
              <span className="sh-student-text">
                <strong dir="auto">{selected.name || "زميل"}</strong>
                <span>من زملائك</span>
              </span>
            </div>
            <p className="sh-explain">
              سيحصل على نفس المحتوى الجاهز: الملخص، البطاقات، الأسئلة، الخريطة
              الذهنية و<bdi>Exam Focus</bdi> — بدون إعادة توليد، وبدون تقدّمك أو
              ملاحظاتك الشخصية.
            </p>
            {send.error && (
              <p className="sh-error" role="alert">
                {send.error.message}
              </p>
            )}
            <div className="sh-actions">
              <button
                type="button"
                className="primary-button"
                disabled={send.isPending}
                onClick={() =>
                  send.mutate({ bookId, recipientId: selected.id })
                }
              >
                {send.isPending ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Send size={16} />
                )}
                إرسال الملف
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={send.isPending}
                onClick={() => {
                  setSelected(null);
                  send.reset();
                }}
              >
                رجوع
              </button>
            </div>
          </div>
        ) : (
          <>
            {everyone.length > 6 && (
              <label className="sh-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="ابحث في زملائك"
                  aria-label="ابحث في زملائك"
                  dir="auto"
                  maxLength={64}
                />
              </label>
            )}
            <div className="sh-results" aria-live="polite">
              {colleagues.isLoading ? (
                <Loader2 size={16} className="spin" />
              ) : everyone.length === 0 ? (
                <p className="sh-hint">
                  الملفات تُرسل لزملائك فقط، ولا زملاء لديك بعد.
                </p>
              ) : results.length === 0 ? (
                <p className="sh-hint">
                  {wanted
                    ? "لا زميل بهذا الاسم."
                    : "كل زملائك لديهم هذا الملف أو طلب بانتظارهم."}
                </p>
              ) : (
                results.map(student => (
                  <button
                    key={student.id}
                    type="button"
                    className="sh-student"
                    onClick={() => setSelected(student)}
                  >
                    <StudentAvatar name={student.name} username={student.id} />
                    <span className="sh-student-text">
                      <strong dir="auto">{student.name || "زميل"}</strong>
                    </span>
                  </button>
                ))
              )}
              <Link href="/shared" className="sh-more">
                <UserPlus size={14} aria-hidden="true" /> أضف زميلًا جديدًا
              </Link>
            </div>
          </>
        )}

        <div className="sh-shared">
          <h3>
            <Users size={16} aria-hidden="true" /> تمت المشاركة مع
          </h3>
          {shares.isLoading ? (
            <Loader2 size={16} className="spin" />
          ) : sharedWith.length === 0 ? (
            <p className="sh-hint">لم تشارك هذا الملف مع أحد بعد.</p>
          ) : (
            <ul>
              {sharedWith.map(share => (
                <li key={share.shareId} className="sh-shared-row">
                  <StudentAvatar
                    name={share.recipientName}
                    username={share.recipientUsername ?? ""}
                    size={32}
                  />
                  <span className="sh-student-text">
                    <strong dir="auto">
                      {share.recipientName || share.recipientUsername}
                    </strong>
                    <span className={`sh-status is-${share.status}`}>
                      {STATUS_LABEL[share.status] ?? share.status}
                    </span>
                  </span>
                  {share.status !== "declined" && (
                    <button
                      type="button"
                      className="sh-revoke"
                      disabled={revoke.isPending}
                      onClick={() => {
                        const who =
                          share.recipientName || `@${share.recipientUsername}`;
                        const message =
                          share.status === "pending"
                            ? `سحب طلب المشاركة المرسل إلى ${who}؟`
                            : `إلغاء وصول ${who} لهذا الملف؟ سيختفي من مكتبته فورًا.`;
                        if (window.confirm(message)) {
                          revoke.mutate({ shareId: share.shareId });
                        }
                      }}
                    >
                      <UserMinus size={14} />
                      {share.status === "pending" ? "سحب" : "إلغاء الوصول"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
