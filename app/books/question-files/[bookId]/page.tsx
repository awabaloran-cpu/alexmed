"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef } from "react";
import {
  CircleAlert,
  ClipboardList,
  Flag,
  Loader2,
  RotateCcw,
  Users,
} from "lucide-react";
import AdBreak from "@/components/ads/AdBreak";
import ShareResultCard from "@/components/growth/ShareResultCard";
import ShareLinkPanel from "@/components/sharing/ShareLinkPanel";
import { adPreviewRequested } from "@/components/ads/useAdBreak";
import QuestionList from "@/components/questions/QuestionList";
import { trpc } from "@/lib/trpc-client";

const POLL_INTERVAL_MS = 3000;

// A long file is explained as the student moves through it (server:
// lib/question-file-window.ts). The page says where the student is when an
// unexplained question is this close ahead, at most once every few
// questions, then looks for the new explanations for a while.
const PREPARE_WHEN_WITHIN = 15;
const ASK_EVERY = 5;
const PREPARED_SPAN = 30;
const WATCH_INTERVAL_MS = 5000;
const WATCH_FOR_MS = 120_000;

const owed = (question: { aiStatus?: string | null }) =>
  question.aiStatus === "pending" || question.aiStatus === "processing";

// PR16 — shows exactly what was really found in the file: the extracted
// answer (if the source stated one) is visually distinct from "no answer in
// source" — never filled in with a guess.
//
// Multimodal upgrade — every question is now automatically run through
// vision-aware AI (lib/question-file-analysis.ts) right after upload, image
// or not: keywords/aiExplanationAr always end up populated, imageUrl only
// when this question's page range actually had one (never an empty
// container), and aiInferredAnswerIndex only when the source itself gave no
// answer — always rendered with its own distinct "AI-suggested" label, never
// blended visually with a real extractedAnswerIndex.
export default function QuestionFileDetailPage() {
  const params = useParams<{ bookId: string }>();
  const utils = trpc.useUtils();
  // Where the page last asked for the questions ahead, and the stretch it
  // is now waiting on.
  const askedAt = useRef<number | null>(null);
  const watching = useRef<{ from: number; until: number } | null>(null);
  const fileQuery = trpc.questionFiles.get.useQuery(
    { bookId: params.bookId },
    {
      refetchInterval: query => {
        const data = query.state.data;
        if (
          data?.book.status === "extracting" ||
          (data?.book.status === "complete" && data.coverage.done === false)
        ) {
          return POLL_INTERVAL_MS;
        }
        const watch = watching.current;
        if (!data || !watch || Date.now() > watch.until) return false;
        return data.questions
          .slice(watch.from, watch.from + PREPARED_SPAN)
          .some(owed)
          ? WATCH_INTERVAL_MS
          : false;
      },
    }
  );
  const retryExtraction = trpc.questionFiles.retryExtraction.useMutation({
    onSuccess: () =>
      utils.questionFiles.get.invalidate({ bookId: params.bookId }),
  });
  // Saved answers (so the student resumes where they stopped) and what, if
  // anything, to show between groups of questions (lib/ads/policy.ts).
  // Neither may hold the questions back: a failure just means "none".
  const attempts = trpc.questionFiles.attempts.useQuery(
    { bookId: params.bookId },
    { retry: false, refetchOnWindowFocus: false, staleTime: Infinity }
  );
  const adPolicy = trpc.ads.questionBreakPolicy.useQuery(
    { bookId: params.bookId, preview: adPreviewRequested() },
    { retry: false, refetchOnWindowFocus: false, staleTime: Infinity }
  );
  const saveAttempt = trpc.questionFiles.saveAttempt.useMutation();
  const reached = trpc.questionFiles.reached.useMutation();
  const prepareAhead = (questionId: string, index: number) => {
    const list = fileQuery.data?.questions ?? [];
    if (!list.slice(index, index + PREPARE_WHEN_WITHIN).some(owed)) return;
    if (
      askedAt.current !== null &&
      Math.abs(index - askedAt.current) < ASK_EVERY
    ) {
      return;
    }
    askedAt.current = index;
    reached.mutate(
      { bookId: params.bookId, questionId },
      {
        onSuccess: result => {
          if (result.preparing) {
            watching.current = {
              from: index,
              until: Date.now() + WATCH_FOR_MS,
            };
          }
          void utils.questionFiles.get.invalidate({ bookId: params.bookId });
        },
      }
    );
  };
  const report = trpc.sharing.reportFile.useMutation();

  if (fileQuery.isLoading || attempts.isLoading) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
          <h3>جاري التحميل...</h3>
        </div>
      </section>
    );
  }

  if (!fileQuery.data) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>تعذر العثور على هذا الملف</h3>
          <Link
            href="/books/question-files"
            className="secondary-button"
            style={{ marginTop: 12 }}
          >
            العودة لملفات الأسئلة
          </Link>
        </div>
      </section>
    );
  }

  const { book, questions, shared, sharedBy } = fileQuery.data;
  const ads = adPolicy.data;

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <Link
            href="/books/question-files"
            className="eyebrow"
            style={{ marginBottom: 8 }}
          >
            <span className="eyebrow-dot" /> ‹ ملفات الأسئلة
          </Link>
          <h1>{book.fileName}</h1>
          <p>{questions.length} سؤال مستخرج</p>
        </div>
      </div>

      {/* 🔗 A classmate's file: who shared it, and a way to report it. The
          owner instead gets the share-by-link panel. */}
      {shared ? (
        <div className="inline-alert wide" role="note">
          <Users size={16} aria-hidden="true" />
          <span>
            شاركه معك {sharedBy ?? "زميلك"}. إجاباتك وتقدّمك خاصة بك.
          </span>
          <button
            type="button"
            className="secondary-button"
            style={{ marginRight: 12 }}
            disabled={report.isPending || report.isSuccess}
            onClick={() => report.mutate({ bookId: book.id })}
          >
            <Flag size={14} aria-hidden="true" />{" "}
            {report.isSuccess ? "وصل بلاغك" : "إبلاغ"}
          </button>
        </div>
      ) : book.status !== "extracting" && book.status !== "failed" ? (
        <ShareLinkPanel bookId={book.id} />
      ) : null}

      {book.status === "extracting" && (
        <div className="inline-alert warning wide">
          <Loader2 size={16} className="spin" />
          جاري استخراج الأسئلة من الملف — تقدر تسكّر الصفحة وترجع بعدين.
        </div>
      )}

      {book.status === "failed" && !shared && (
        <div className="inline-alert error wide">
          <CircleAlert size={16} />
          <span>
            {book.extractionError || "تعذر استخراج الأسئلة من هذا الملف."}
          </span>
          <button
            type="button"
            className="secondary-button"
            style={{ marginRight: 12 }}
            disabled={retryExtraction.isPending}
            onClick={() => retryExtraction.mutate({ bookId: book.id })}
          >
            <RotateCcw size={14} /> إعادة المعالجة
          </button>
        </div>
      )}

      {book.status === "complete" && !questions.length && (
        <div className="empty-state">
          <ClipboardList size={28} />
          <h3>لم يتم العثور على أسئلة</h3>
        </div>
      )}

      {!!questions.length && (
        <QuestionList
          questions={questions}
          initialAnswers={attempts.data}
          onShown={prepareAhead}
          onAnswered={(questionId, selectedIndex) =>
            saveAttempt.mutate({ bookId: book.id, questionId, selectedIndex })
          }
          renderComplete={result => (
            <ShareResultCard {...result} bookId={book.id} shared={shared} />
          )}
          {...(ads?.enabled
            ? {
                breakEvery: ads.questionsPerBreak,
                renderBreak: info => (
                  <AdBreak policy={ads} bookId={book.id} info={info} />
                ),
              }
            : {})}
        />
      )}
    </section>
  );
}
