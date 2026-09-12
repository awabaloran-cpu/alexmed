"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  ClipboardList,
  Layers3,
  Loader2,
  NotebookText,
  RotateCcw,
  Workflow,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import PdfViewer from "@/components/PdfViewer";

// Background analysis now happens entirely server-side, driven by Upstash
// QStash workers (see app/api/books/analyze-chapter/route.ts) — this page's
// only job is to poll chapter status and show simple aggregate progress. It
// never calls analyze-chapter itself, so closing the tab or losing
// connection never stops analysis; reopening this page just resumes showing
// the same server-side progress.
const POLL_INTERVAL_MS = 3000;
const TERMINAL_BOOK_STATUSES = new Set([
  "complete",
  "partial_failed",
  "failed",
]);

// Audit Phase 14 — real, granular processing stages. Deliberately reflects
// this app's ACTUAL pipeline (three genuinely-async stages that really run
// server-side, plus a coverage-validation gate) rather than a generic
// example sequence — mind map generation and question validation are NOT
// listed here because they are on-demand actions (see the mind map/chapter
// reader pages), not automatic pipeline steps; listing them here would
// misrepresent them as running automatically, which is exactly the "fake
// progress" the audit forbids.
type StageStatus = "done" | "active" | "pending" | "failed";

function StageRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: StageStatus;
  detail?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 0",
        opacity: status === "pending" ? 0.5 : 1,
      }}
    >
      {status === "done" && <CheckCircle2 size={16} color="#528c6d" />}
      {status === "active" && <Loader2 size={16} className="spin" />}
      {status === "failed" && <CircleAlert size={16} color="#974d49" />}
      {status === "pending" && <Circle size={16} />}
      <span style={{ fontSize: 12 }}>
        {label}
        {detail && <span style={{ color: "#9a9186" }}> — {detail}</span>}
      </span>
    </div>
  );
}

export default function BookDetailPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;
  const utils = trpc.useUtils();
  const bookQuery = trpc.books.get.useQuery(
    { id: bookId },
    {
      refetchInterval: query => {
        const status = query.state.data?.book.status;
        return status && TERMINAL_BOOK_STATUSES.has(status)
          ? false
          : POLL_INTERVAL_MS;
      },
    }
  );
  const retryChapter = trpc.books.retryChapter.useMutation({
    onSuccess: () => utils.books.get.invalidate({ id: bookId }),
  });
  const retryExtraction = trpc.books.retryExtraction.useMutation({
    onSuccess: () => utils.books.get.invalidate({ id: bookId }),
  });
  const retryPageText = trpc.books.retryPageText.useMutation({
    onSuccess: () => {
      utils.books.get.invalidate({ id: bookId });
      utils.books.listPages.invalidate({ bookId });
    },
  });
  const subjectsQuery = trpc.subjects.list.useQuery();
  const setSubject = trpc.books.setSubject.useMutation({
    onSuccess: () => utils.books.get.invalidate({ id: bookId }),
  });
  const coverageQuery = trpc.books.getCoverageReport.useQuery(
    { bookId },
    {
      refetchInterval: query => {
        const report = query.state.data;
        // Keep polling while any page still needs visual processing —
        // independent of (and typically outlasting) chapter completion.
        return report && report.totalPages > 0 && report.visualPending > 0
          ? POLL_INTERVAL_MS
          : false;
      },
    }
  );
  // Audit Phase 3/14 — the real page-numbered coverage engine (distinct from
  // getCoverageReport's aggregate counts above): names exactly which pages
  // are missing/failed instead of a bare count, and its own "status" is
  // computed from real per-page processing state, never from an LLM claim.
  const coverageDetailQuery = trpc.books.getCoverageDetail.useQuery(
    { bookId },
    {
      refetchInterval: query =>
        query.state.data && query.state.data.status !== "COMPLETE"
          ? POLL_INTERVAL_MS
          : false,
    }
  );
  const pagesQuery = trpc.books.listPages.useQuery({ bookId });
  const failedTextPages = (pagesQuery.data ?? []).filter(
    page => page.textStatus === "failed"
  );

  if (bookQuery.isLoading) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
          <h3>جاري تحميل الكتاب...</h3>
        </div>
      </section>
    );
  }

  if (!bookQuery.data) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>تعذر العثور على هذا الكتاب</h3>
          <Link
            href="/books"
            className="secondary-button"
            style={{ marginTop: 12 }}
          >
            العودة لكتبي
          </Link>
        </div>
      </section>
    );
  }

  const { book, chapters } = bookQuery.data;
  const completeCount = chapters.filter(c => c.status === "complete").length;
  const failedChapters = chapters.filter(c => c.status === "failed");
  const isExtracting = book.status === "extracting";
  const isAnalyzing =
    !isExtracting &&
    book.status !== "complete" &&
    book.status !== "partial_failed" &&
    book.status !== "failed";
  // "Chapter phase done" = every chapter reached a terminal state
  // (complete or failed) — same rollup rule finalizeBookIfDone itself uses
  // server-side (see lib/db-books.ts's computeBookRollupStatus), so this
  // never disagrees with what actually decided book.status.
  const chaptersPhaseDone =
    !isExtracting && chapters.length > 0 && !isAnalyzing;
  const pipelineReady =
    chaptersPhaseDone &&
    !failedChapters.length &&
    coverageDetailQuery.data?.status === "COMPLETE";
  // First complete chapter — study tools open here; this is a real interim
  // destination (per-chapter tabs already exist), not a placeholder. A
  // book-wide session across all chapters is PR14/PR15's job.
  const firstCompleteChapter = chapters.find(c => c.status === "complete");

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <Link href="/books" className="eyebrow" style={{ marginBottom: 8 }}>
            <span className="eyebrow-dot" /> ‹ رجوع لكتبي
          </Link>
          <h1>{book.fileName}</h1>
          <p>
            {book.pageCount} صفحة · {chapters.length} فصل · {completeCount}/
            {chapters.length} مكتمل
          </p>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12 }}>المادة</span>
          <select
            value={book.subjectId ?? ""}
            disabled={setSubject.isPending}
            onChange={event => {
              const value = event.target.value;
              setSubject.mutate({
                bookId,
                subjectId: value || null,
              });
            }}
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

      {/* Real PDF.js viewer of the original file (PR13) — the extract/OCR
          pipeline keeps running server-side unchanged; this is purely an
          additive way to actually read the real PDF, not a replacement for
          it. fileKey can be briefly null right after upload before the
          extraction job records it — the panel just doesn't render then. */}
      {book.fileKey && (
        <PdfViewer
          src={`/api/files/${book.fileKey}`}
          fileName={book.fileName}
        />
      )}

      {/* Study Tools (PR12) — reuses existing bookCards/bookMcqs/
          bookChapters.explanationAr+keyPoints via the chapter reader's own
          tabs (?tool= preselects one). No new AI generation here. */}
      <div className="study-tools-panel">
        <div className="panel-heading">
          <h2>ماذا تريد أن تفعل بهذا الملف؟</h2>
        </div>
        {!firstCompleteChapter ? (
          <p style={{ fontSize: 13, color: "#8a9493" }}>
            الأدوات ستكون متاحة بعد اكتمال تحليل أول فصل.
          </p>
        ) : (
          <div className="study-tools-grid">
            <Link
              href={`/books/${bookId}/chapters/${firstCompleteChapter.id}?tool=cards`}
              className="study-tool-card"
            >
              <Layers3 size={22} />
              <span>بطاقات</span>
            </Link>
            <Link
              href={`/books/${bookId}/chapters/${firstCompleteChapter.id}?tool=mcqs`}
              className="study-tool-card"
            >
              <ClipboardList size={22} />
              <span>اختبارات</span>
            </Link>
            <Link
              href={`/books/${bookId}/chapters/${firstCompleteChapter.id}?tool=explanation`}
              className="study-tool-card"
            >
              <NotebookText size={22} />
              <span>ملخص</span>
            </Link>
            <Link href={`/books/${bookId}/mindmap`} className="study-tool-card">
              <Workflow size={22} />
              <span>خريطة ذهنية</span>
            </Link>
          </div>
        )}
      </div>

      {coverageQuery.data && coverageQuery.data.totalPages > 0 && (
        <div className="stats-row" style={{ marginBottom: 18 }}>
          <div className="stat-card">
            <span>صفحات مُجهّزة بصريًا</span>
            <strong>
              {coverageQuery.data.totalPages - coverageQuery.data.visualPending}
              /{coverageQuery.data.totalPages}
            </strong>
          </div>
          <div className="stat-card">
            <span>صفحات فيها صور/مخططات</span>
            <strong>{coverageQuery.data.pagesWithVisuals}</strong>
          </div>
          {coverageQuery.data.needsReview > 0 && (
            <div className="stat-card accent">
              <span>تحتاج مراجعة</span>
              <strong>{coverageQuery.data.needsReview}</strong>
            </div>
          )}
          {coverageQuery.data.failed > 0 && (
            <div className="stat-card accent">
              <span>صفحات فشل تحليلها</span>
              <strong>{coverageQuery.data.failed}</strong>
            </div>
          )}
        </div>
      )}

      {coverageDetailQuery.data && coverageDetailQuery.data.totalPages > 0 && (
        <div
          className={`inline-alert wide ${coverageDetailQuery.data.status === "COMPLETE" ? "success" : "warning"}`}
        >
          {coverageDetailQuery.data.status === "COMPLETE" ? (
            <CheckCircle2 size={16} />
          ) : (
            <Loader2 size={16} className="spin" />
          )}
          <span>
            تغطية المعالجة: {coverageDetailQuery.data.coverage}% (
            {coverageDetailQuery.data.processedPages}/
            {coverageDetailQuery.data.totalPages} صفحة)
            {coverageDetailQuery.data.missingPages.length > 0 && (
              <>
                {" "}
                — بعض الصفحات تحتاج معالجة:{" "}
                {coverageDetailQuery.data.missingPages.join("، ")}
              </>
            )}
            {coverageDetailQuery.data.failedPages.length > 0 && (
              <>
                {" "}
                — صفحات فشلت: {coverageDetailQuery.data.failedPages.join("، ")}
              </>
            )}
          </span>
        </div>
      )}

      {!pipelineReady && book.status !== "failed" && (
        <div className="study-tools-panel">
          <span className="micro-label">مراحل المعالجة</span>
          <p style={{ fontSize: 11, color: "#9a9186", margin: "2px 0 6px" }}>
            تقدر تسكّر الصفحة وترجع بعدين من أي جهاز، مش هنفقد أي تقدم.
          </p>
          {/* book.status === "failed" is excluded by the wrapping condition
              above, so reaching this row always means extraction succeeded. */}
          <StageRow
            label="قراءة الصفحات"
            status={isExtracting ? "active" : "done"}
          />
          <StageRow
            label="تحليل الفصول (الشرح، البطاقات، الأسئلة)"
            status={
              isExtracting
                ? "pending"
                : chaptersPhaseDone
                  ? failedChapters.length
                    ? "failed"
                    : "done"
                  : "active"
            }
            detail={
              chapters.length
                ? `${completeCount}/${chapters.length} فصل`
                : undefined
            }
          />
          <StageRow
            label="استخراج الصور والمخططات"
            status={
              isExtracting
                ? "pending"
                : !coverageQuery.data || coverageQuery.data.totalPages === 0
                  ? "pending"
                  : coverageQuery.data.visualPending > 0
                    ? "active"
                    : "done"
            }
            detail={
              coverageQuery.data && coverageQuery.data.totalPages > 0
                ? `${coverageQuery.data.totalPages - coverageQuery.data.visualPending}/${coverageQuery.data.totalPages} صفحة`
                : undefined
            }
          />
          <StageRow
            label="التحقق من اكتمال التغطية"
            status={
              !chaptersPhaseDone
                ? "pending"
                : coverageDetailQuery.data?.status === "COMPLETE"
                  ? "done"
                  : "active"
            }
            detail={
              coverageDetailQuery.data &&
              coverageDetailQuery.data.totalPages > 0
                ? `${coverageDetailQuery.data.coverage}%`
                : undefined
            }
          />
        </div>
      )}

      {book.status === "failed" && (
        <div className="inline-alert error wide">
          <CircleAlert size={16} />
          <span>
            {book.extractionError ||
              "تعذّرت قراءة هذا الكتاب. جرّب إعادة المحاولة أو رفع نسخة أخرى منه."}
          </span>
          <button
            type="button"
            className="secondary-button"
            style={{ marginRight: 12 }}
            disabled={retryExtraction.isPending}
            onClick={() => retryExtraction.mutate({ bookId })}
          >
            <RotateCcw size={14} /> إعادة محاولة الاستخراج
          </button>
          <Link
            href="/books/upload"
            className="secondary-button"
            style={{ marginRight: 12 }}
          >
            ارفع كتابًا جديدًا
          </Link>
        </div>
      )}

      {book.status === "partial_failed" && (
        <div className="inline-alert warning wide">
          <CircleAlert size={16} />
          اكتمل معظم الكتاب، لكن {failedChapters.length} فصل تعذّر تحليله
          {failedTextPages.length > 0
            ? ` و${failedTextPages.length} صفحة تعذّرت قراءتها`
            : ""}
          . يمكنك إعادة المحاولة أدناه.
        </div>
      )}

      {book.chapterDetectionConfidence === "low" && (
        <div className="inline-alert warning wide">
          اكتشفنا تقسيم الكتاب بشكل تقريبي. يمكنك مراجعة أسماء الفصول وحدود
          الصفحات.
        </div>
      )}

      {failedTextPages.length > 0 && (
        <div className="library-grid" style={{ marginBottom: 18 }}>
          {failedTextPages.map(page => (
            <div className="library-item" key={page.id}>
              <div className="library-item-icon">
                <CircleAlert size={18} />
              </div>
              <div className="library-item-meta">
                <strong>صفحة {page.pageNumber}</strong>
                <span>
                  {page.textErrorMessage || "تعذّرت قراءة هذه الصفحة ضوئيًا"}
                </span>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={retryPageText.isPending}
                onClick={() => retryPageText.mutate({ pageId: page.id })}
              >
                <RotateCcw size={14} /> إعادة المحاولة
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="library-grid">
        {chapters.map(chapter => (
          <div className="library-item" key={chapter.id}>
            {chapter.status === "complete" ? (
              <Link
                href={`/books/${bookId}/chapters/${chapter.id}`}
                className="library-item-icon"
                style={{ display: "contents" }}
              >
                <div className="library-item-icon">
                  <CheckCircle2 size={18} />
                </div>
                <div className="library-item-meta">
                  <strong>{chapter.title}</strong>
                  <span>
                    صفحة {chapter.startPage}–{chapter.endPage} · مكتمل
                  </span>
                </div>
              </Link>
            ) : (
              <>
                <div className="library-item-icon">
                  {chapter.status === "failed" ? (
                    <CircleAlert size={18} />
                  ) : (
                    <Loader2 size={18} className="spin" />
                  )}
                </div>
                <div className="library-item-meta">
                  <strong>{chapter.title}</strong>
                  <span>
                    صفحة {chapter.startPage}–{chapter.endPage} ·{" "}
                    {chapter.status === "failed"
                      ? chapter.errorMessage || "تعذر التحليل"
                      : "جارٍ التحليل..."}
                  </span>
                </div>
                {chapter.status === "failed" && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={retryChapter.isPending}
                    onClick={() =>
                      retryChapter.mutate({ chapterId: chapter.id })
                    }
                  >
                    <RotateCcw size={14} /> إعادة المحاولة
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
