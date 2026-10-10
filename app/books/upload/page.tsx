"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Check,
  ChevronLeft,
  CircleAlert,
  ClipboardList,
  FileText,
  Loader2,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import SubjectPicker from "@/components/SubjectPicker";
import { trpc } from "@/lib/trpc-client";
import type { BillingErrorDetails } from "@/lib/billing/catalog";
import {
  PlanLimitError,
  UpgradePrompt,
  errorFromResponseBody,
} from "@/components/billing/UpgradePrompt";
import { putFileWithProgress } from "@/lib/upload-client";
import s from "./upload.module.css";

type Stage = "idle" | "uploading" | "planning";
type FileKind = "study_book" | "question_file";

const PROFILE_LABELS: Record<string, string> = {
  general: "عام",
  medical: "طبي",
  english: "لغة إنجليزية",
  mathematics: "رياضيات",
  aptitude: "قدرات",
  programming: "برمجة",
  custom: "مخصص",
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Upload + extraction/OCR + chapter analysis all live on the server (see
// app/api/books/extract/route.ts and app/api/books/analyze-chapter/route.ts,
// both QStash-driven background workers) — this page's only job is to hand
// the file off and send the user to the resumable /books/[bookId] page,
// which polls status from here on. It used to drive chapter analysis itself
// with a client-side loop; that broke once analyze-chapter became a
// QStash-signature-verified worker no longer callable from the browser.
export default function BookUploadPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileKind, setFileKind] = useState<FileKind | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  // 💳 Set when the student's plan refused the file (size / daily quota).
  const [limitDetails, setLimitDetails] = useState<BillingErrorDetails | null>(
    null
  );
  const usage = trpc.billing.mine.useQuery();
  const [dragActive, setDragActive] = useState(false);
  const [profile, setProfile] = useState("general");
  // Pre-selected when arriving from a folder's "＋ إضافة ملف" button
  // (app/subjects/[subjectId]/page.tsx links to /books/upload?subjectId=...).
  const [subjectId, setSubjectId] = useState(
    () => searchParams.get("subjectId") ?? ""
  );

  function chooseFile(nextFile: File | undefined) {
    setError("");
    setLimitDetails(null);
    if (!nextFile) return;
    if (
      nextFile.type !== "application/pdf" &&
      !nextFile.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("اختَر ملف PDF فقط.");
      return;
    }
    setFile(nextFile);
    setFileKind(null);
  }

  async function startProcessing() {
    if (!file || !fileKind || !subjectId) return;
    setError("");
    setUploadProgress(0);
    setStage("uploading");

    try {
      const uploadUrlResponse = await fetch("/api/books/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          contentType: "application/pdf",
        }),
      });
      const uploadUrlData = await uploadUrlResponse.json();
      if (!uploadUrlResponse.ok)
        throw errorFromResponseBody(uploadUrlData, "تعذر تجهيز رابط الرفع.");

      await putFileWithProgress(
        uploadUrlData.uploadUrl,
        file,
        "application/pdf",
        setUploadProgress
      );

      setStage("planning");

      if (fileKind === "question_file") {
        const planResponse = await fetch(
          "/api/books/extract-questions-and-plan",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: uploadUrlData.key,
              fileName: file.name,
              subjectId,
            }),
          }
        );
        const planData = await planResponse.json();
        if (!planResponse.ok)
          throw errorFromResponseBody(planData, "تعذر تجهيز ملف الأسئلة.");
        router.push(`/books/question-files/${planData.bookId}`);
        return;
      }

      const planResponse = await fetch("/api/books/extract-and-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: uploadUrlData.key,
          fileName: file.name,
          profile,
          ...(subjectId ? { subjectId } : {}),
        }),
      });
      const planData = await planResponse.json();
      if (!planResponse.ok)
        throw errorFromResponseBody(planData, "تعذر تجهيز الكتاب.");

      router.push(`/books/${planData.bookId}`);
    } catch (processingError) {
      setStage("idle");
      if (processingError instanceof PlanLimitError) {
        setLimitDetails(processingError.details);
      }
      setError(
        processingError instanceof Error
          ? processingError.message
          : "حدث خطأ غير متوقع."
      );
    }
  }

  const isProcessing = stage === "uploading" || stage === "planning";

  return (
    <section className="upload-view">
      <div className="intro-grid">
        <div className="intro-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" /> رفع كتاب جديد
          </div>
          <h1>
            ارفع كتابك،
            <br />
            <em>واحنا نتكفّل بالباقي.</em>
          </h1>
          <p className="intro-lede">
            مهما كان حجم الكتاب — ٥٠ أو ٣٠٠ صفحة — هنقسّمه لك تلقائيًا لفصول
            صغيرة، ونحلّل كل فصل على حدة.
          </p>
        </div>
      </div>

      <div className="workspace-grid">
        <div className="upload-card panel-card">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">٠١ / الملف</span>
              <h2>اختر كتابك</h2>
            </div>
            <FileText size={23} className="heading-icon" />
          </div>

          {stage === "idle" && (
            <div
              className={dragActive ? "drop-zone drag-active" : "drop-zone"}
              onDragOver={event => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={event => {
                event.preventDefault();
                setDragActive(false);
                chooseFile(event.dataTransfer.files?.[0]);
              }}
              role="button"
              tabIndex={0}
              aria-label="اختر ملف PDF من جهازك"
              onKeyDown={event => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={event => chooseFile(event.target.files?.[0])}
              />
              <div className="upload-icon">
                <UploadIcon size={23} />
              </div>
              <strong>{file ? file.name : "اسحب الكتاب إلى هنا"}</strong>
              <span>
                {file
                  ? `${formatBytes(file.size)} · جاهز للرفع`
                  : "أو اضغط لاختيار ملف من جهازك"}
              </span>
              {!file && (
                <small>
                  ملفات PDF فقط
                  {usage.data
                    ? `، حتى ${usage.data.maxFileSizeMb}MB في باقتك`
                    : ""}
                </small>
              )}
            </div>
          )}

          {!file && stage === "idle" && (
            <ul className={s.facts}>
              <li>
                <Check size={15} aria-hidden="true" />
                نقرأ الصفحات المصوّرة (سكانر) أيضًا.
              </li>
              <li>
                <Check size={15} aria-hidden="true" />
                تبدأ الدراسة من أول النتائج والباقي يكتمل في الخلفية.
              </li>
            </ul>
          )}

          {file && stage === "idle" && (
            <div className="selected-file">
              <div className="selected-file-icon">
                <FileText size={18} />
              </div>
              <div>
                <strong>{file.name}</strong>
                <span>{formatBytes(file.size)} · PDF</span>
              </div>
              <button
                type="button"
                aria-label="إزالة الملف"
                onClick={event => {
                  event.stopPropagation();
                  setFile(null);
                  setFileKind(null);
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* PR16 — file-type classification, required before any of the
              real processing endpoints are called: a question file skips
              the subject/profile pipeline entirely and goes to the separate
              extraction pipeline instead. */}
          {file && stage === "idle" && !fileKind && (
            <fieldset className={s.kinds}>
              <legend>ما نوع هذا الملف؟</legend>
              <button
                type="button"
                className={s.kind}
                onClick={() => setFileKind("study_book")}
              >
                <BookOpen size={20} aria-hidden="true" />
                <strong>كتاب دراسي</strong>
                <span>ملخص، بطاقات، اختبار وخريطة ذهنية لكل فصل.</span>
              </button>
              <button
                type="button"
                className={s.kind}
                onClick={() => setFileKind("question_file")}
              >
                <ClipboardList size={20} aria-hidden="true" />
                <strong>ملف أسئلة</strong>
                <span>أسئلة الملف نفسها مع شرح عربي لكل سؤال.</span>
              </button>
            </fieldset>
          )}

          {file && stage === "idle" && fileKind && (
            <div className={s.chosen}>
              {fileKind === "study_book" ? (
                <BookOpen size={18} aria-hidden="true" />
              ) : (
                <ClipboardList size={18} aria-hidden="true" />
              )}
              <p>
                <strong>
                  {fileKind === "study_book" ? "كتاب دراسي" : "ملف أسئلة"}
                </strong>
                <span>
                  {fileKind === "study_book"
                    ? "سنجهّز لكل فصل: ملخصًا، بطاقات، اختبارًا وخريطة ذهنية."
                    : "نستخرج الأسئلة الموجودة فعليًا في الملف ونشرحها — لا نولّد أسئلة جديدة."}
                </span>
              </p>
              <button type="button" onClick={() => setFileKind(null)}>
                تغيير
              </button>
            </div>
          )}

          {file && stage === "idle" && fileKind && (
            <div className={s.field}>
              <SubjectPicker value={subjectId} onChange={setSubjectId} />
            </div>
          )}

          {file && stage === "idle" && fileKind === "study_book" && (
            <details className={s.optional}>
              <summary>
                إعدادات اختيارية
                <ChevronLeft size={16} aria-hidden="true" />
              </summary>
              <label className={s.optionalField}>
                <span>نوع المادة</span>
                <select
                  value={profile}
                  onChange={event => setProfile(event.target.value)}
                >
                  {Object.entries(PROFILE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <small>
                  يضبط أسلوب الشرح والأسئلة. اتركه «عام» إن لم تكن متأكدًا.
                </small>
              </label>
            </details>
          )}

          {error &&
            (limitDetails ? (
              <UpgradePrompt details={limitDetails} message={error} />
            ) : (
              <div className="inline-alert error">
                <CircleAlert size={16} />
                {error}
              </div>
            ))}

          {/* 💳 What the student's plan still allows today. */}
          {usage.data && !isProcessing && (
            <p className="upload-quota">
              متبقي اليوم: {usage.data.books.daily.remaining ?? "∞"} ملفات دراسة
              · {usage.data.questions.daily.remaining ?? "∞"} ملفات أسئلة · حتى{" "}
              <bdi dir="ltr">{usage.data.maxFileSizeMb}MB</bdi> للملف ·{" "}
              <a href="/account/plan" className="underline">
                باقتي
              </a>
            </p>
          )}

          {isProcessing && (
            <div className="live-progress" role="status" aria-live="polite">
              <div className="progress-heading">
                <div className="progress-orbit">
                  <Loader2 size={17} className="spin" />
                </div>
                <div>
                  <strong>
                    {stage === "uploading"
                      ? "جاري رفع الملف"
                      : "جاري تجهيز الكتاب"}
                  </strong>
                  {stage === "uploading" && (
                    <span>
                      {formatBytes(
                        Math.round(((file?.size ?? 0) * uploadProgress) / 100)
                      )}{" "}
                      من {formatBytes(file?.size ?? 0)}
                    </span>
                  )}
                </div>
                {stage === "uploading" && <b>{uploadProgress}%</b>}
              </div>
              {stage === "uploading" && (
                <div className="progress-track">
                  <i style={{ width: `${Math.max(uploadProgress, 4)}%` }} />
                </div>
              )}
            </div>
          )}

          {stage === "idle" && fileKind && (
            <button
              type="button"
              className="primary-button"
              style={{ marginTop: 18 }}
              disabled={!file || !subjectId}
              onClick={startProcessing}
            >
              {fileKind === "question_file"
                ? "استخراج الأسئلة"
                : "حوّل إلى فصول"}
            </button>
          )}

          {/* Only true once the file is fully in storage (stage "planning" —
              server-side from here on, resumable). During "uploading" the
              raw PUT is a plain client-side network transfer with no resume
              support — closing/navigating away kills it outright. Telling
              someone it's safe to leave DURING the upload is exactly what
              caused a real student's upload to silently die after they
              waited ~10 minutes with no progress feedback and left. */}
          {stage === "uploading" && (
            <p className={s.note}>
              لا تسكّر الصفحة أو تنتقل لصفحة ثانية أثناء الرفع — الملف عم ينتقل
              مباشرة من متصفحك، وأي تنقّل بيلغي الرفع.
            </p>
          )}
          {stage === "planning" && (
            <p className={s.note}>
              الملف وصل للتخزين — تقدر تسكّر الصفحة وترجع بعدين، مش هنفقد أي
              تقدم من هون وطالع.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
