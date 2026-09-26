"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  CheckCircle2,
  Share2,
  Trash2,
  UserRound,
  Circle,
  CircleAlert,
  ClipboardList,
  Eye,
  FileText,
  Flame,
  Layers3,
  Loader2,
  Lock,
  Gamepad2,
  NotebookText,
  RotateCcw,
  Sparkles,
  Workflow,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ShareStudyPackModal } from "@/components/sharing/ShareStudyPackModal";

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
  const router = useRouter();
  const utils = trpc.useUtils();
  const [shareOpen, setShareOpen] = useState(false);
  const bookQuery = trpc.books.get.useQuery(
    { id: bookId },
    {
      retry: false,
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
  // Student's explicit "ابدأ" click on any of the four study-tools cards —
  // see lib/trpc/booksRouter.ts's startChapterAnalysis for why any one card
  // starts the same shared generation for all four.
  const startAnalysis = trpc.books.startChapterAnalysis.useMutation({
    onSuccess: () => utils.books.get.invalidate({ id: bookId }),
  });
  // Safety net while an already-started analysis is unfinished: every
  // minute, asks the server to re-queue any chapter that stopped moving (a
  // lost queue message or a worker killed mid-run). The server decides
  // what's actually stalled, so this never double-runs a healthy chapter.
  const resumeAnalysis = trpc.books.resumeChapterAnalysis.useMutation();
  // 📤 Opened through an accepted share: read-only study of the owner's
  // content — no generation, retries, folders or deletion (owner-only).
  const isShared = bookQuery.data?.access.role === "shared";
  const isOwner = bookQuery.data?.access.role === "owner";
  const removeFromLibrary = trpc.sharing.removeFromLibrary.useMutation({
    onSuccess: () => {
      utils.sharing.sharedWithMe.invalidate();
      router.push("/shared");
    },
  });
  const chapterStatuses = bookQuery.data?.chapters.map(c => c.status) ?? [];
  const analysisInFlight =
    isOwner &&
    chapterStatuses.some(status => status !== "pending") &&
    chapterStatuses.some(
      status =>
        status === "pending" || status === "processing" || status === "retrying"
    );
  const { mutate: resumeMutate } = resumeAnalysis;
  useEffect(() => {
    if (!analysisInFlight) return;
    resumeMutate({ bookId });
    const timer = setInterval(() => resumeMutate({ bookId }), 60_000);
    return () => clearInterval(timer);
  }, [analysisInFlight, bookId, resumeMutate]);
  const subjectsQuery = trpc.subjects.list.useQuery(undefined, {
    enabled: isOwner,
  });
  // 🔥 Exam Focus tile status (its own pipeline — see exam-focus/page.tsx).
  // For a shared file with no owner deck the server answers
  // PRECONDITION_FAILED (a recipient can't start one) — shown on the tile.
  const examFocusQuery = trpc.examFocus.get.useQuery(
    { bookId },
    { retry: false }
  );
  const examFocusDeck = examFocusQuery.data;
  const examFocusUnavailable =
    isShared && examFocusQuery.error?.data?.code === "PRECONDITION_FAILED";
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

  const { book, chapters, totalCards, totalMcqs, access } = bookQuery.data;
  const ownerLabel =
    access.ownerName ||
    (access.ownerUsername ? `@${access.ownerUsername}` : "");
  const completeCount = chapters.filter(c => c.status === "complete").length;
  const failedChapters = chapters.filter(c => c.status === "failed");
  const isExtracting = book.status === "extracting";
  const hasChapters = chapters.length > 0;
  // Nobody has clicked "ابدأ" on any of the four study-tools cards yet —
  // generation no longer starts automatically after extraction (see
  // app/api/books/extract/route.ts), so every chapter genuinely stays
  // "pending" until startChapterAnalysis is called.
  const chaptersNotStarted =
    hasChapters && chapters.every(c => c.status === "pending");
  // "Chapter phase done" = every chapter reached a terminal state (complete
  // or failed) — same rollup rule finalizeBookIfDone itself uses server-side
  // (see lib/db-books.ts's computeBookRollupStatus).
  const chaptersPhaseDone =
    hasChapters &&
    chapters.every(c => c.status === "complete" || c.status === "failed");
  const pipelineReady =
    chaptersPhaseDone &&
    !failedChapters.length &&
    coverageDetailQuery.data?.status === "COMPLETE";
  // First complete chapter — study tools open here; this is a real interim
  // destination (per-chapter tabs already exist), not a placeholder. A
  // book-wide session across all chapters is PR14/PR15's job.
  const firstCompleteChapter = chapters.find(c => c.status === "complete");
  const analysisProgressPercent = hasChapters
    ? Math.round((completeCount / chapters.length) * 100)
    : 0;

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <Link
            href={isShared ? "/shared" : "/books"}
            className="eyebrow"
            style={{ marginBottom: 8 }}
          >
            <span className="eyebrow-dot" /> ‹{" "}
            {isShared ? "رجوع لمشترك معي" : "رجوع لكتبي"}
          </Link>
          <h1>{book.fileName}</h1>
          <p>
            {book.pageCount} صفحة · {chapters.length} فصل · {completeCount}/
            {chapters.length} مكتمل
          </p>
          {isShared && (
            <span className="sh-badge">
              <UserRound size={13} aria-hidden="true" /> مشترك من{" "}
              <bdi>{ownerLabel}</bdi>
            </span>
          )}
        </div>
        {isShared ? (
          <button
            type="button"
            className="secondary-button sh-remove-button"
            disabled={removeFromLibrary.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "إزالة هذا الملف من مكتبتك؟ يبقى الأصل عند صاحبه، ويمكنه مشاركته معك من جديد."
                )
              ) {
                removeFromLibrary.mutate({ bookId });
              }
            }}
          >
            {removeFromLibrary.isPending ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Trash2 size={15} />
            )}
            إزالة من مكتبتي
          </button>
        ) : (
          <div className="sh-owner-controls">
            <button
              type="button"
              className="primary-button sh-share-button"
              onClick={() => setShareOpen(true)}
            >
              <Share2 size={16} /> مشاركة
            </button>
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
        )}
      </div>
      {shareOpen && (
        <ShareStudyPackModal
          bookId={bookId}
          bookTitle={book.fileName}
          onClose={() => setShareOpen(false)}
        />
      )}
      {removeFromLibrary.error && (
        <div className="inline-alert error wide" role="alert">
          <CircleAlert size={16} /> {removeFromLibrary.error.message}
        </div>
      )}

      {/* Study Tools (PR12, reshaped for the mandatory-choice gate) — reuses
          existing bookCards/bookMcqs/bookChapters.explanationAr+keyPoints via
          the chapter reader's own tabs (?tool= preselects one). No chapter is
          analyzed until the student picks one of these four cards; see
          lib/trpc/booksRouter.ts's startChapterAnalysis. */}
      <div className="study-tools-panel">
        <div className="panel-heading">
          <h2>ماذا تريد أن تفعل بهذا الملف؟</h2>
        </div>
        {!hasChapters ? (
          <p style={{ fontSize: 13, color: "#8a9493" }}>
            الأدوات ستكون متاحة بعد اكتمال قراءة صفحات الملف.
          </p>
        ) : (
          <>
            <div className="study-tools-grid">
              {[
                {
                  icon: ClipboardList,
                  label: "اختبار",
                  detail: `${totalMcqs} سؤال`,
                },
                {
                  icon: Layers3,
                  label: "بطاقات",
                  detail: `${totalCards} بطاقة`,
                },
                { icon: NotebookText, label: "ملخص", detail: undefined },
                { icon: Workflow, label: "خريطة ذهنية", detail: undefined },
                // Quizlet-style match game over this file's own cards
                // (app/books/[bookId]/match).
                {
                  icon: Gamepad2,
                  label: "لعبة المطابقة",
                  detail: "طابق السؤال بجوابه",
                },
              ].map(({ icon: Icon, label, detail }, toolIndex) => {
                // 🔥 Exam Focus sits third (after اختبار/بطاقات). It has its
                // own whole-file pipeline, independent of chapter analysis,
                // so it's always openable once the pages are read.
                const examFocusTile =
                  toolIndex !== 2 ? null : examFocusUnavailable ? (
                    <div
                      key="exam-focus"
                      className="study-tool-card is-exam-focus is-locked"
                    >
                      <Flame size={22} aria-hidden="true" />
                      <span>🔥 Exam Focus</span>
                      <small>لم يُنشئه صاحب الملف بعد</small>
                    </div>
                  ) : (
                    <Link
                      key="exam-focus"
                      href={`/books/${bookId}/exam-focus`}
                      className="study-tool-card is-exam-focus"
                    >
                      <span className="ef-tile-new">جديد</span>
                      <Flame size={22} aria-hidden="true" />
                      <span>🔥 Exam Focus</span>
                      <small>
                        {examFocusDeck?.deck.status === "complete" ||
                        examFocusDeck?.deck.status === "partial_failed"
                          ? `${examFocusDeck.deck.totalCards} بطاقة high-yield`
                          : examFocusDeck?.deck.status === "processing" ||
                              examFocusDeck?.deck.status === "finalizing"
                            ? "قيد التحليل…"
                            : "أهم معلومات الامتحان"}
                      </small>
                      <span className="secondary-button">
                        {examFocusDeck ? "افتح 🔥" : "ابدأ 🔥"}
                      </span>
                    </Link>
                  );
                const state = chaptersNotStarted
                  ? "locked"
                  : !chaptersPhaseDone
                    ? "generating"
                    : "ready";
                return (
                  <Fragment key={label}>
                    {examFocusTile}
                    <div className={`study-tool-card is-${state}`}>
                      <Icon size={22} />
                      <span>{label}</span>
                      {state === "ready" && detail && <small>{detail}</small>}
                      {state === "locked" && isShared && (
                        <small>لم يبدأ صاحب الملف التوليد بعد</small>
                      )}
                      {state === "locked" && !isShared && (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={startAnalysis.isPending}
                          onClick={() => startAnalysis.mutate({ bookId })}
                        >
                          {startAnalysis.isPending ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          ابدأ
                        </button>
                      )}
                      {state === "generating" && (
                        <small className="study-tool-progress">
                          <Loader2 size={13} className="spin" /> قيد التوليد…{" "}
                          {analysisProgressPercent}%
                        </small>
                      )}
                      {state === "ready" &&
                        firstCompleteChapter &&
                        (label === "بطاقات" ? (
                          <Link
                            href={`/books/${bookId}/study?tool=cards`}
                            className="secondary-button"
                          >
                            ابدأ المراجعة
                          </Link>
                        ) : label === "اختبار" ? (
                          <Link
                            href={`/books/${bookId}/study?tool=mcqs`}
                            className="secondary-button"
                          >
                            اختبر نفسك
                          </Link>
                        ) : label === "ملخص" ? (
                          <Link
                            href={`/books/${bookId}/study?tool=explanation`}
                            className="secondary-button"
                          >
                            عرض
                          </Link>
                        ) : label === "لعبة المطابقة" ? (
                          <Link
                            href={`/books/${bookId}/match`}
                            className="secondary-button"
                          >
                            العب 🎮
                          </Link>
                        ) : (
                          <Link
                            href={`/books/${bookId}/mindmap`}
                            className="secondary-button"
                          >
                            عرض
                          </Link>
                        ))}
                    </div>
                  </Fragment>
                );
              })}
            </div>
            {chaptersNotStarted && !isShared && (
              <p className="study-tools-note">
                <Lock size={12} /> التوليد يجهّز البطاقات والاختبار والملخص
                والخريطة الذهنية معًا لنفس الملف — اضغط أي بطاقة للبدء.
              </p>
            )}
          </>
        )}
      </div>

      {/* File overview (learnra-style bottom card) — "عرض الملف" opens a
          dedicated read page (app/books/[bookId]/read) that embeds the
          browser's own native PDF viewer, instead of a custom in-page
          renderer: real text selection/copy/search/print, plus (in
          Chromium) the browser's own built-in highlight/note tools. */}
      {book.fileKey && (
        <div className="study-tools-panel file-overview-panel">
          <div className="panel-heading">
            <h2>نظرة عامة على الملف</h2>
          </div>
          <div className="file-overview-row">
            <div className="file-overview-meta">
              <FileText size={20} />
              <div>
                <strong>{book.fileName}</strong>
                <span>
                  {new Date(book.createdAt).toLocaleDateString("ar-u-nu-latn")}{" "}
                  · {book.pageCount} صفحة
                </span>
              </div>
            </div>
            <Link href={`/books/${bookId}/read`} className="primary-button">
              <Eye size={16} /> عرض الملف
            </Link>
          </div>
        </div>
      )}

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
              isExtracting || chaptersNotStarted
                ? "pending"
                : chaptersPhaseDone
                  ? failedChapters.length
                    ? "failed"
                    : "done"
                  : "active"
            }
            detail={
              chaptersNotStarted
                ? "بانتظار اختيارك"
                : chapters.length
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
          {isOwner && (
            <>
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
            </>
          )}
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

      {isOwner && failedTextPages.length > 0 && (
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

      {/* Parts are processing units, not a place to study: a finished part
          is not listed or opened (the file is studied as a whole above).
          Only parts still being analyzed, or that failed, are shown — the
          owner needs their progress and the retry button. */}
      {chapters.some(chapter => chapter.status !== "complete") && (
        <div className="library-grid">
          {chapters
            .filter(chapter => chapter.status !== "complete")
            .map(chapter => (
              <div className="library-item" key={chapter.id}>
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
                {chapter.status === "failed" && isOwner && (
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
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
