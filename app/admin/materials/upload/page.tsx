"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleAlert,
  FileText,
  Loader2,
  RotateCcw,
  Upload as UploadIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";

type Stage = "idle" | "uploading" | "processing";
const POLL_INTERVAL_MS = 3000;
const TERMINAL_STATUSES = new Set([
  "ready_for_review",
  "published",
  "archived",
  "failed",
]);

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// رفع مادة أدمن جديدة: نفس تدفّق التخزين المباشر (upload-url ثم PUT) اللي
// تستخدمه مِرآة، لكن مع حقول التصنيف/الصعوبة/اللغة، وزر "بدء المعالجة" واحد
// يشغّل الرفع + إنشاء المسودة + بدء الاستخراج خلفيًا، ثم يعرض شاشة تقدم حية.
export default function AdminMaterialUploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">(
    "medium"
  );
  const [language, setLanguage] = useState("both");
  const [stage, setStage] = useState<Stage>("idle");
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const createDraft = trpc.adminMaterials.createDraft.useMutation();
  const startProcessing = trpc.adminMaterials.startProcessing.useMutation();
  const retryBatch = trpc.adminMaterials.retryBatch.useMutation();
  const utils = trpc.useUtils();

  const materialQuery = trpc.adminMaterials.get.useQuery(
    { materialId: materialId ?? "" },
    {
      enabled: !!materialId,
      refetchInterval: query => {
        const status = query.state.data?.material.status;
        return status && !TERMINAL_STATUSES.has(status)
          ? POLL_INTERVAL_MS
          : false;
      },
    }
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
    if (!title) setTitle(nextFile.name.replace(/\.pdf$/i, ""));
  }

  async function startAll() {
    if (!file || !title.trim()) return;
    setError("");
    setStage("uploading");
    try {
      const uploadUrlResponse = await fetch("/api/admin/materials/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          contentType: "application/pdf",
        }),
      });
      const uploadData = await uploadUrlResponse.json();
      if (!uploadUrlResponse.ok)
        throw new Error(uploadData.error || "تعذر تجهيز رابط الرفع.");

      const putResponse = await fetch(uploadData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!putResponse.ok)
        throw new Error(
          "تعذر رفع الملف للتخزين. تحقق من الاتصال وحاول مرة أخرى."
        );

      const draft = await createDraft.mutateAsync({
        fileName: file.name,
        fileKey: uploadData.key,
        title: title.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        difficulty,
        language,
      });

      setStage("processing");
      setMaterialId(draft.materialId);
      await startProcessing.mutateAsync({ materialId: draft.materialId });
    } catch (processingError) {
      setStage("idle");
      setError(
        processingError instanceof Error
          ? processingError.message
          : "حدث خطأ غير متوقع."
      );
    }
  }

  const data = materialQuery.data;
  const material = data?.material;
  const batches = data?.batches ?? [];
  const completeBatches = batches.filter(b => b.status === "complete").length;
  const failedBatches = batches.filter(b => b.status === "failed");
  const pagesNeedingOcr = material?.pagesNeedingOcr?.length ?? 0;

  return (
    <section className="upload-view">
      <div className="intro-grid">
        <div className="intro-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" /> لوحة تحكم الأدمن
          </div>
          <h1>
            رفع مادة <em>جديدة.</em>
          </h1>
        </div>
      </div>

      <div className="workspace-grid">
        <div className="upload-card panel-card">
          {stage === "idle" && (
            <>
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">٠١ / الملف</span>
                  <h2>اختر ملف PDF</h2>
                </div>
                <FileText size={23} className="heading-icon" />
              </div>
              <div
                className="drop-zone"
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
                <strong>{file ? file.name : "اسحب الملف إلى هنا"}</strong>
                <span>
                  {file
                    ? `${formatBytes(file.size)} · جاهز للرفع`
                    : "أو اضغط للاختيار"}
                </span>
              </div>

              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <input
                  className="text-input"
                  placeholder="اسم المادة"
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                />
                <textarea
                  className="text-input"
                  placeholder="الوصف"
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  rows={3}
                />
                <input
                  className="text-input"
                  placeholder="التصنيف (مثلاً: تشريح، فسيولوجي)"
                  value={category}
                  onChange={event => setCategory(event.target.value)}
                />
                <div style={{ display: "flex", gap: 10 }}>
                  <select
                    className="text-input"
                    value={difficulty}
                    onChange={event =>
                      setDifficulty(
                        event.target.value as "easy" | "medium" | "hard"
                      )
                    }
                  >
                    <option value="easy">سهل</option>
                    <option value="medium">متوسط</option>
                    <option value="hard">صعب</option>
                  </select>
                  <select
                    className="text-input"
                    value={language}
                    onChange={event => setLanguage(event.target.value)}
                  >
                    <option value="both">عربي/إنجليزي</option>
                    <option value="ar">عربي</option>
                    <option value="en">إنجليزي</option>
                  </select>
                </div>
              </div>

              {error && (
                <div className="inline-alert error" style={{ marginTop: 12 }}>
                  <CircleAlert size={16} />
                  {error}
                </div>
              )}

              <button
                type="button"
                className="primary-button"
                style={{ marginTop: 18 }}
                disabled={!file || !title.trim()}
                onClick={startAll}
              >
                بدء المعالجة
              </button>
            </>
          )}

          {stage === "uploading" && (
            <div className="live-progress" role="status" aria-live="polite">
              <div className="progress-heading">
                <Loader2 size={17} className="spin" />
                <strong>جاري رفع الملف...</strong>
              </div>
            </div>
          )}

          {stage === "processing" && (
            <>
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">٠٢ / المعالجة</span>
                  <h2>{material?.title ?? title}</h2>
                </div>
              </div>

              {!material || material.status === "processing" ? (
                <div className="live-progress">
                  <div className="progress-heading">
                    <Loader2 size={16} className="spin" />
                    <strong>قيد المعالجة...</strong>
                  </div>
                  <p className="progress-caption">
                    صفحات الملف: {material?.pageCount ?? 0} · صفحات تحتاج OCR
                    متبقية: {pagesNeedingOcr} · دفعات: {completeBatches}/
                    {batches.length} مكتملة
                    {failedBatches.length
                      ? ` (${failedBatches.length} فاشلة)`
                      : ""}{" "}
                    · بطاقات ناتجة حتى الآن: {data?.liveCardCount ?? 0}
                  </p>
                </div>
              ) : material.status === "failed" ? (
                <div className="inline-alert error wide">
                  <CircleAlert size={16} />
                  {material.extractionError ||
                    "تعذّرت معالجة هذا الملف. راجع الدفعات الفاشلة أدناه."}
                </div>
              ) : (
                <div className="inline-alert success wide">
                  <CheckCircle2 size={16} />
                  انتهت المعالجة — {data?.liveCardCount ?? 0} بطاقة جاهزة
                  للمراجعة.
                </div>
              )}

              {failedBatches.length > 0 && (
                <div className="library-grid" style={{ marginTop: 14 }}>
                  {failedBatches.map(batch => (
                    <div className="library-item" key={batch.id}>
                      <div className="library-item-icon">
                        <CircleAlert size={18} />
                      </div>
                      <div className="library-item-meta">
                        <strong>
                          صفحة {batch.startPage}–{batch.endPage}
                        </strong>
                        <span>{batch.errorMessage || "تعذّر التوليد"}</span>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={retryBatch.isPending}
                        onClick={() => {
                          retryBatch.mutate(
                            { batchId: batch.id },
                            {
                              onSuccess: () =>
                                utils.adminMaterials.get.invalidate({
                                  materialId: materialId!,
                                }),
                            }
                          );
                        }}
                      >
                        <RotateCcw size={14} /> إعادة المحاولة
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {material && material.status === "ready_for_review" && (
                <button
                  type="button"
                  className="primary-button"
                  style={{ marginTop: 18 }}
                  onClick={() =>
                    router.push(`/admin/materials/${material.id}/review`)
                  }
                >
                  مراجعة البطاقات
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
