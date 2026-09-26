"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  CircleAlert,
  ClipboardList,
  FileText,
  Loader2,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import SubjectPicker from "@/components/SubjectPicker";

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

// plain fetch() gives no upload-progress events at all, so a large file on a
// slow connection just sits at a static spinner for however long the PUT
// takes — indistinguishable from a genuine hang. A real student hit exactly
// this (40MB, ~10 minutes, no visible movement) and navigated away thinking
// it had frozen, which killed the in-flight upload with no error ever shown
// (the component was already unmounted by then). XMLHttpRequest is the only
// browser API that exposes real upload-progress events for a PUT body.
function putFileWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(
          new Error("تعذر رفع الملف للتخزين. تحقق من الاتصال وحاول مرة أخرى.")
        );
    };
    xhr.onerror = () =>
      reject(
        new Error("تعذر رفع الملف للتخزين. تحقق من الاتصال وحاول مرة أخرى.")
      );
    xhr.send(file);
  });
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
  const [dragActive, setDragActive] = useState(false);
  const [profile, setProfile] = useState("general");
  // Pre-selected when arriving from a folder's "＋ إضافة ملف" button
  // (app/subjects/[subjectId]/page.tsx links to /books/upload?subjectId=...).
  const [subjectId, setSubjectId] = useState(
    () => searchParams.get("subjectId") ?? ""
  );

  function chooseFile(nextFile: File | undefined) {
    setError("");
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
        throw new Error(uploadUrlData.error || "تعذر تجهيز رابط الرفع.");

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
          throw new Error(planData.error || "تعذر تجهيز ملف الأسئلة.");
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
        throw new Error(planData.error || "تعذر تجهيز الكتاب.");

      router.push(`/books/${planData.bookId}`);
    } catch (processingError) {
      setStage("idle");
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
              {!file && <small>ملفات PDF فقط، حتى ٢٥٠ ميجابايت</small>}
            </div>
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
            <div style={{ marginTop: 14 }}>
              <span style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
                ما نوع هذا الملف؟
              </span>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{
                    flex: "1 1 160px",
                    flexDirection: "column",
                    minHeight: 64,
                  }}
                  onClick={() => setFileKind("study_book")}
                >
                  <BookOpen size={20} />
                  <span>كتاب دراسي</span>
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{
                    flex: "1 1 160px",
                    flexDirection: "column",
                    minHeight: 64,
                  }}
                  onClick={() => setFileKind("question_file")}
                >
                  <ClipboardList size={20} />
                  <span>ملف أسئلة</span>
                </button>
              </div>
            </div>
          )}

          {file && stage === "idle" && fileKind === "study_book" && (
            <div style={{ marginTop: 14 }}>
              <label>
                <span
                  style={{ display: "block", fontSize: 12, marginBottom: 4 }}
                >
                  نوع المادة
                </span>
                <select
                  value={profile}
                  onChange={event => setProfile(event.target.value)}
                  style={{ width: "100%" }}
                >
                  {Object.entries(PROFILE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {file && stage === "idle" && fileKind === "question_file" && (
            <div className="inline-alert" style={{ marginTop: 14 }}>
              <ClipboardList size={16} />
              سيتم استخراج الأسئلة الموجودة فعليًا في الملف — لن يتم توليد أسئلة
              جديدة بالذكاء الاصطناعي.
            </div>
          )}

          {file && stage === "idle" && fileKind && (
            <div style={{ marginTop: 14 }}>
              <SubjectPicker value={subjectId} onChange={setSubjectId} />
            </div>
          )}

          {error && (
            <div className="inline-alert error">
              <CircleAlert size={16} />
              {error}
            </div>
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
            <p style={{ marginTop: 12, fontSize: 11, color: "#8a9493" }}>
              لا تسكّر الصفحة أو تنتقل لصفحة ثانية أثناء الرفع — الملف عم ينتقل
              مباشرة من متصفحك، وأي تنقّل بيلغي الرفع.
            </p>
          )}
          {stage === "planning" && (
            <p style={{ marginTop: 12, fontSize: 11, color: "#8a9493" }}>
              الملف وصل للتخزين — تقدر تسكّر الصفحة وترجع بعدين، مش هنفقد أي
              تقدم من هون وطالع.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
