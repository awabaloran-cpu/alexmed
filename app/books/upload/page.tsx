"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  FileText,
  Loader2,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";

type Stage = "idle" | "uploading" | "planning";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [profile, setProfile] = useState("general");
  const [subjectId, setSubjectId] = useState("");
  const subjectsQuery = trpc.subjects.list.useQuery();

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
  }

  async function startProcessing() {
    if (!file) return;
    setError("");
    setStage("uploading");

    try {
      const uploadUrlResponse = await fetch("/api/books/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type || "application/pdf",
        }),
      });
      const uploadUrlData = await uploadUrlResponse.json();
      if (!uploadUrlResponse.ok)
        throw new Error(uploadUrlData.error || "تعذر تجهيز رابط الرفع.");

      const putResponse = await fetch(uploadUrlData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });
      if (!putResponse.ok)
        throw new Error(
          "تعذر رفع الملف للتخزين. تحقق من الاتصال وحاول مرة أخرى."
        );

      setStage("planning");
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
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {stage === "idle" && (
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 14,
              }}
            >
              <label style={{ flex: "1 1 160px" }}>
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
              <label style={{ flex: "1 1 160px" }}>
                <span
                  style={{ display: "block", fontSize: 12, marginBottom: 4 }}
                >
                  المادة (اختياري)
                </span>
                <select
                  value={subjectId}
                  onChange={event => setSubjectId(event.target.value)}
                  style={{ width: "100%" }}
                >
                  <option value="">بدون مادة</option>
                  {(subjectsQuery.data ?? []).map(subject => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </label>
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
                </div>
              </div>
            </div>
          )}

          {stage === "idle" && (
            <button
              type="button"
              className="primary-button"
              style={{ marginTop: 18 }}
              disabled={!file}
              onClick={startProcessing}
            >
              حوّل إلى فصول
            </button>
          )}

          {isProcessing && (
            <p style={{ marginTop: 12, fontSize: 11, color: "#8a9493" }}>
              تقدر تسكّر الصفحة وترجع بعدين — مش هنفقد أي تقدم، وهيكمل من حيث
              وقفت.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
