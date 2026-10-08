"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
import ShareLinkPanel from "@/components/sharing/ShareLinkPanel";
import { bookDisplayTitle } from "@/lib/book-title";

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
    <div className={`book-stage is-${status}`}>
      {status === "done" && <CheckCircle2 size={16} aria-hidden="true" />}
      {status === "active" && (
        <Loader2 size={16} className="spin" aria-hidden="true" />
      )}
      {status === "failed" && <CircleAlert size={16} aria-hidden="true" />}
      {status === "pending" && <Circle size={16} aria-hidden="true" />}
      <span>
        {label}
        {detail && <small>{detail}</small>}
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

  const toolState = chaptersNotStarted
    ? "locked"
    : !chaptersPhaseDone
      ? "generating"
      : "ready";
  const studyModes = [
    {
      key: "cards",
      icon: Layers3,
      label: "بطاقات",
      purpose: "احفظ بالتكرار المتباعد، بطاقة بطاقة",
      count: `${totalCards} بطاقة`,
      href: `/books/${bookId}/study?tool=cards`,
    },
    {
      key: "mcqs",
      icon: ClipboardList,
      label: "اختبار",
      purpose: "أسئلة اختيار من متعدد كأنك في الامتحان",
      count: `${totalMcqs} سؤال`,
      href: `/books/${bookId}/study?tool=mcqs`,
    },
    {
      key: "summary",
      icon: NotebookText,
      label: "ملخص",
      purpose: "الشرح كاملًا في صفحة مرتبة للقراءة",
      count: null,
      href: `/books/${bookId}/study?tool=explanation`,
    },
    {
      key: "mindmap",
      icon: Workflow,
      label: "خريطة ذهنية",
      purpose: "كيف ترتبط المفاهيم ببعضها",
      count: null,
      href: `/books/${bookId}/mindmap`,
    },
    // Quizlet-style match game over this file's own cards
    // (app/books/[bookId]/match).
    {
      key: "match",
      icon: Gamepad2,
      label: "لعبة المطابقة",
      purpose: "طابق كل سؤال بجوابه قبل ما يخلص الوقت",
      count: null,
      href: `/books/${bookId}/match`,
    },
  ] as const;
  const examFocusReady =
    examFocusDeck?.deck.status === "complete" ||
    examFocusDeck?.deck.status === "partial_failed";
  const examFocusBusy =
    examFocusDeck?.deck.status === "processing" ||
    examFocusDeck?.deck.status === "finalizing";
  const chaptersLabel =
    chapters.length === 1 ? "جزء واحد" : `${chapters.length} أجزاء`;

  return (
    <section className="cards-view book-view">
      <header className="book-head">
        <Link href={isShared ? "/shared" : "/books"} className="eyebrow">
          <ChevronRight size={15} aria-hidden="true" />
          {isShared ? "مشترك معي" : "كتبي"}
        </Link>
        <h1>
          <bdi>{bookDisplayTitle(book.fileName)}</bdi>
        </h1>
        <p className="book-meta">
          {book.pageCount} صفحة
          {hasChapters ? `، ${chaptersLabel}` : ""}
          {toolState === "ready" && hasChapters && !failedChapters.length && (
            <span className="book-status is-ready">
              <CheckCircle2 size={14} aria-hidden="true" /> جاهز للدراسة
            </span>
          )}
          {(isExtracting || toolState === "generating") && (
            <span className="book-status is-busy">
              <Loader2 size={14} className="spin" aria-hidden="true" />
              {isExtracting ? "نقرأ الصفحات" : "نجهّز أدوات الدراسة"}
            </span>
          )}
        </p>
        {isShared && (
          <span className="sh-badge">
            <UserRound size={13} aria-hidden="true" /> مشترك من{" "}
            <bdi>{ownerLabel}</bdi>
          </span>
        )}
        {isShared ? (
          <div className="book-actions">
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
          </div>
        ) : (
          <div className="book-actions sh-owner-controls">
            <label className="book-folder-field">
              <span>المجلد</span>
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
                <option value="">بدون مجلد</option>
                {(subjectsQuery.data ?? []).map(subject => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button sh-share-button"
              onClick={() => setShareOpen(true)}
            >
              <Share2 size={16} aria-hidden="true" /> مشاركة
            </button>
          </div>
        )}
      </header>
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
      {/* 🔗 Share by link (lib/share-links.ts) — next to the share by
          username above; both give the same access to the same copy. */}
      {isOwner && book.status !== "extracting" && book.status !== "failed" && (
        <ShareLinkPanel bookId={bookId} />
      )}

      {/* Study modes. No chapter is analyzed until the student asks for it
          (one click prepares cards, questions, summary and mind map together
          — lib/trpc/booksRouter.ts's startChapterAnalysis). Exam Focus has
          its own whole-file pipeline, so it is always openable once the
          pages are read. */}
      <section className="book-study" aria-labelledby="book-study-title">
        <h2 id="book-study-title" className="book-section-title">
          ادرس هذا الكتاب
        </h2>
        {!hasChapters ? (
          <p className="book-quiet">
            أدوات الدراسة تظهر هنا بعد ما نخلّص قراءة صفحات الملف.
          </p>
        ) : (
          <>
            {examFocusUnavailable ? (
              <div className="book-examfocus is-locked">
                <span className="book-examfocus-name">
                  <Flame size={18} aria-hidden="true" /> Exam Focus
                </span>
                <strong>أهم ما يأتي في الامتحان</strong>
                <span>لم يُنشئه صاحب الملف بعد</span>
              </div>
            ) : (
              <Link
                href={`/books/${bookId}/exam-focus`}
                className="book-examfocus"
              >
                <span className="book-examfocus-name">
                  <Flame size={18} aria-hidden="true" /> Exam Focus
                </span>
                <strong>أهم ما يأتي في الامتحان من هذا الكتاب</strong>
                <span>
                  {examFocusReady
                    ? `${examFocusDeck!.deck.totalCards} معلومة مركّزة، مرتبة حسب الأهمية`
                    : examFocusBusy
                      ? "نحلّل الكتاب ونستخرج المعلومات المهمة…"
                      : "نستخرج المعلومات التي يتكرر سؤالها ونرتبها لك"}
                </span>
                <span className="nl-marker-button">
                  {examFocusBusy && (
                    <Loader2 size={16} className="spin" aria-hidden="true" />
                  )}
                  {examFocusDeck ? "افتح Exam Focus" : "جهّز Exam Focus"}
                </span>
              </Link>
            )}

            {toolState === "locked" && !isShared && (
              <div className="book-generate">
                <p>
                  جهّز البطاقات والأسئلة والملخص والخريطة الذهنية لهذا الكتاب
                  بضغطة واحدة. تقدر تسكّر الصفحة، التجهيز يكمل لحاله.
                </p>
                <button
                  type="button"
                  className="primary-button"
                  disabled={startAnalysis.isPending}
                  onClick={() => startAnalysis.mutate({ bookId })}
                >
                  {startAnalysis.isPending ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  جهّز أدوات الدراسة
                </button>
                {startAnalysis.error && (
                  <p className="book-error" role="alert">
                    تعذّر بدء التجهيز. تحقق من اتصالك وحاول مرة أخرى.
                  </p>
                )}
              </div>
            )}
            {toolState === "locked" && isShared && (
              <p className="book-quiet">لم يبدأ صاحب الملف التجهيز بعد.</p>
            )}
            {toolState === "generating" && (
              <div className="book-progress">
                <div className="book-progress-label">
                  <span>نجهّز أدوات الدراسة</span>
                  <b>{analysisProgressPercent}%</b>
                </div>
                <div
                  className="book-progress-track"
                  role="progressbar"
                  aria-label="تقدّم التجهيز"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={analysisProgressPercent}
                >
                  <i
                    style={{
                      width: `${Math.max(4, analysisProgressPercent)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <ul className={`book-modes is-${toolState}`}>
              {studyModes.map(mode => {
                const Icon = mode.icon;
                const open = toolState === "ready" && !!firstCompleteChapter;
                const body = (
                  <>
                    <span className="book-mode-glyph" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span className="book-mode-text">
                      <strong>{mode.label}</strong>
                      <span>{mode.purpose}</span>
                    </span>
                    <span className="book-mode-end">
                      {open ? (
                        <>
                          {mode.count && <small>{mode.count}</small>}
                          <ChevronLeft size={18} aria-hidden="true" />
                        </>
                      ) : toolState === "generating" ? (
                        <small>قيد التجهيز</small>
                      ) : (
                        <Lock size={15} aria-label="غير جاهز بعد" />
                      )}
                    </span>
                  </>
                );
                return (
                  <li key={mode.key} className={`book-mode is-${mode.key}`}>
                    {open ? (
                      <Link href={mode.href} className="book-mode-row">
                        {body}
                      </Link>
                    ) : (
                      <div className="book-mode-row" aria-disabled="true">
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/* "عرض الملف" opens app/books/[bookId]/read, which embeds the
          browser's own PDF viewer (real selection/search/print). */}
      {book.fileKey && (
        <Link href={`/books/${bookId}/read`} className="book-source">
          <FileText size={20} aria-hidden="true" />
          <span>
            <strong>الملف الأصلي</strong>
            <span>
              {book.pageCount} صفحة، رُفع{" "}
              {new Date(book.createdAt).toLocaleDateString("ar-u-nu-latn")}
            </span>
          </span>
          <span className="book-source-action">
            <Eye size={16} aria-hidden="true" /> عرض
          </span>
        </Link>
      )}

      {/* Pipeline internals — real per-stage and per-page state — stay one
          tap away instead of competing with studying. Open while work is
          still running so progress is visible. */}
      <details className="book-processing" open={!pipelineReady || undefined}>
        <summary>
          تفاصيل المعالجة
          {pipelineReady && (
            <span className="book-processing-done">
              <CheckCircle2 size={14} aria-hidden="true" /> مكتملة
            </span>
          )}
        </summary>
        {coverageQuery.data && coverageQuery.data.totalPages > 0 && (
          <dl className="book-processing-stats">
            <div>
              <dt>صفحات مُجهّزة بصريًا</dt>
              <dd>
                {coverageQuery.data.totalPages -
                  coverageQuery.data.visualPending}
                /{coverageQuery.data.totalPages}
              </dd>
            </div>
            <div>
              <dt>صفحات فيها صور أو مخططات</dt>
              <dd>{coverageQuery.data.pagesWithVisuals}</dd>
            </div>
            {coverageQuery.data.needsReview > 0 && (
              <div className="is-alert">
                <dt>تحتاج مراجعة</dt>
                <dd>{coverageQuery.data.needsReview}</dd>
              </div>
            )}
            {coverageQuery.data.failed > 0 && (
              <div className="is-alert">
                <dt>صفحات فشل تحليلها</dt>
                <dd>{coverageQuery.data.failed}</dd>
              </div>
            )}
          </dl>
        )}

        {coverageDetailQuery.data &&
          coverageDetailQuery.data.totalPages > 0 && (
            <p
              className={`book-coverage ${coverageDetailQuery.data.status === "COMPLETE" ? "is-complete" : ""}`}
            >
              {coverageDetailQuery.data.status === "COMPLETE" ? (
                <CheckCircle2 size={15} aria-hidden="true" />
              ) : (
                <Loader2 size={15} className="spin" aria-hidden="true" />
              )}
              <span>
                تغطية المعالجة {coverageDetailQuery.data.coverage}% (
                {coverageDetailQuery.data.processedPages} من{" "}
                {coverageDetailQuery.data.totalPages} صفحة)
                {coverageDetailQuery.data.missingPages.length > 0 && (
                  <>
                    . صفحات تحتاج معالجة:{" "}
                    {coverageDetailQuery.data.missingPages.join("، ")}
                  </>
                )}
                {coverageDetailQuery.data.failedPages.length > 0 && (
                  <>
                    . صفحات فشلت:{" "}
                    {coverageDetailQuery.data.failedPages.join("، ")}
                  </>
                )}
              </span>
            </p>
          )}

        {!pipelineReady && book.status !== "failed" && (
          <div className="book-stages">
            <p className="book-quiet">
              تقدر تسكّر الصفحة وترجع بعدين من أي جهاز، ما راح يضيع أي تقدّم.
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
                    ? `${completeCount}/${chapters.length}`
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
      </details>

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
          {failedChapters.length === 0 && failedTextPages.length === 0 ? (
            // Only page pictures failed: the text was read, so the study
            // tools are built from all of it.
            <>
              قُرئ نص الكتاب كاملًا، لكن تعذّر تحليل صور{" "}
              {coverageQuery.data?.failed ?? "بعض"} صفحة. أدوات الدراسة
              تُبنى من النص كله.
            </>
          ) : (
            <>
              اكتمل معظم الكتاب، لكن {failedChapters.length} فصل تعذّر تحليله
              {failedTextPages.length > 0
                ? ` و${failedTextPages.length} صفحة تعذّرت قراءتها`
                : ""}
              . يمكنك إعادة المحاولة أدناه.
            </>
          )}
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
