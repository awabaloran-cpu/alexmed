"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Layers3,
  ListChecks,
  Loader2,
  Sparkles,
} from "lucide-react";

// The part (chapter) page's البطاقات / الاختبار tabs. The part page is a
// reader (PDF + explanation + terms + notes + chat), so its study tools must
// not be a second implementation: this panel only states the scope ("this
// part, pages X–Y" vs the whole file) and opens the SAME full-screen
// FlashcardsMode / QuizMode the file page uses, scoped to this part. The
// inline card list, inline review queue and inline MCQ list that used to
// live here duplicated those modes and are gone.
export default function PartStudyLauncher({
  kind,
  bookId,
  startPage,
  endPage,
  total,
  flagged,
  onThisPage,
  currentPageNumber,
  onOpen,
  onGenerate,
  generating,
  error,
  validation,
}: {
  kind: "cards" | "mcqs";
  bookId: string;
  startPage: number;
  endPage: number;
  total: number;
  flagged: number;
  onThisPage: number;
  currentPageNumber?: number;
  onOpen: () => void;
  // Absent for a shared (read-only) Study Pack — generation is owner-only.
  onGenerate?: () => void;
  generating: boolean;
  // Last failed generate / validate call — shown, never swallowed.
  error?: string;
  validation?: {
    pending: boolean;
    result: { valid: number; flagged: number; generated: number } | null;
    run: () => void;
  };
}) {
  const isCards = kind === "cards";
  const noun = isCards ? "بطاقة" : "سؤال";
  return (
    <div className="panel-card part-study">
      <span className="micro-label">
        {isCards ? "بطاقات هذا الجزء" : "اختبار هذا الجزء"} · صفحة {startPage}–
        {endPage}
      </span>

      {total > 0 ? (
        <>
          <p className="part-study-count">
            {total} {noun}
            {currentPageNumber !== undefined && (
              <small>
                {" "}
                · منها {onThisPage} من الصفحة {currentPageNumber}
              </small>
            )}
          </p>
          <button type="button" className="primary-button" onClick={onOpen}>
            {isCards ? <Layers3 size={16} /> : <ListChecks size={16} />}
            {isCards ? "ابدأ مراجعة هذا الجزء" : "ابدأ اختبار هذا الجزء"}
          </button>
        </>
      ) : onGenerate ? (
        <button
          type="button"
          className="primary-button"
          disabled={generating}
          onClick={onGenerate}
        >
          {generating ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {isCards ? "توليد البطاقات لهذا الجزء" : "توليد اختبار لهذا الجزء"}
        </button>
      ) : (
        <p className="part-study-count">
          لم يولّد صاحب الملف {isCards ? "بطاقات" : "أسئلة"} لهذا الجزء بعد.
        </p>
      )}

      {validation && (
        <>
          <button
            type="button"
            className="secondary-button"
            disabled={validation.pending}
            onClick={validation.run}
          >
            {validation.pending ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            التحقق من صحة الأسئلة
          </button>
          {(validation.result || flagged > 0) && (
            <small className="part-study-note">
              {validation.result
                ? `صحيحة: ${validation.result.valid} · تحتاج مراجعة: ${validation.result.flagged}${
                    validation.result.generated > 0
                      ? ` · أُضيف ${validation.result.generated} سؤال لتغطية صفحات ناقصة`
                      : ""
                  }`
                : `${flagged} سؤال يحتاج مراجعة — يظهر عليه تنبيه داخل الاختبار.`}
            </small>
          )}
        </>
      )}

      {error && (
        <p className="inline-alert error" role="alert">
          تعذّر إكمال الطلب: {error} — حاول مرة ثانية.
        </p>
      )}

      <Link
        href={`/books/${bookId}/study?tool=${kind}`}
        className="part-study-whole"
      >
        {isCards
          ? "أو راجع بطاقات الملف كاملاً ←"
          : "أو اختبر نفسك على الملف كاملاً ←"}
      </Link>
    </div>
  );
}
