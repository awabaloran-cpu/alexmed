"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, Loader2, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import QuizMode from "@/components/study/QuizMode";
import FlashcardsMode from "@/components/study/FlashcardsMode";
import SummaryMode from "@/components/study/SummaryMode";
import StudyShell from "@/components/study/StudyShell";
import NiroThinking from "@/components/niro/NiroThinking";
import { CARD_TYPE_LABEL_AR, questionTypeLabel } from "@/lib/knowledge-labels";

type Tool = "cards" | "mcqs" | "explanation";

// Studying the WHOLE file, not its first chapter. The book page's
// بطاقات / اختبار / ملخص used to open only the first chapter (pages 1–8 of a
// fixed-window split — usually the lecturer/objectives pages), which is
// exactly the "questions about the doctor instead of the material" bug.
// This page gathers every chapter's content in page order, generates the
// on-demand cards/MCQs for any chapter that doesn't have them yet (one
// chapter at a time, with visible progress), and shows the real coverage —
// never a silent "complete".
export default function BookStudyPage() {
  const params = useParams<{ bookId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const bookId = params.bookId;
  const rawTool = searchParams.get("tool");
  const tool: Tool =
    rawTool === "mcqs" || rawTool === "explanation" ? rawTool : "cards";

  const utils = trpc.useUtils();
  const contentQuery = trpc.books.getStudyContent.useQuery({ bookId });
  const generateFlashcards = trpc.books.generateChapterFlashcards.useMutation();
  const generateMcqs = trpc.books.generateChapterMcqs.useMutation();
  const submitMcqAttempt = trpc.books.submitMcqAttempt.useMutation();
  const rateCard = trpc.books.rateCard.useMutation();
  // Generation runs as background jobs (lib/generation-jobs.ts): clicks and
  // the automatic pass below only queue them, and the page follows their
  // status here — polled every few seconds while anything is waiting.
  const [waitingJobs, setWaitingJobs] = useState<{
    kind: "flashcards" | "mcqs";
    chapters: { id: string; title: string }[];
    rebuild: boolean;
    errors: string[];
  } | null>(null);
  const [notesChapterId, setNotesChapterId] = useState<string | null>(null);
  const jobsQuery = trpc.books.generationJobs.useQuery(
    { bookId },
    { enabled: !!waitingJobs || !!notesChapterId, refetchInterval: 3000 }
  );
  const composeNotes = trpc.books.generateMedicalNotePages.useMutation({
    onSuccess: (_job, variables) => {
      setNotesChapterId(variables.chapterId);
      void utils.books.generationJobs.invalidate({ bookId });
    },
  });

  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    current: string;
    errors: string[];
    rebuild: boolean;
  } | null>(null);
  const startedRef = useRef(false);
  const deckStartedRef = useRef(false);
  const [deckUnavailable, setDeckUnavailable] = useState(false);
  const [rebuildRequested, setRebuildRequested] = useState(false);
  const [matrixOpen, setMatrixOpen] = useState(false);

  const data = contentQuery.data;
  const analyzed = data?.chapters.filter(c => c.status === "complete") ?? [];

  // Generate cards/MCQs for every analyzed chapter still missing them —
  // sequentially (each call is itself chunked over every page server-side).
  // 📤 A shared Study Pack is read-only: the recipient studies what the
  // owner already generated and never triggers generation (AI cost).
  const isShared = data?.access.role === "shared";
  const isOwner = data?.access.role === "owner";
  const studyTool = tool !== "explanation";
  const kind = tool === "cards" ? "cards" : "mcqs";

  // 🧠 Knowledge base = the file's Exam Focus facts. Cards and questions are
  // derived from it (server: lib/knowledge-study.ts), so before generating
  // anything we make sure it exists — started here if needed, then waited
  // for. If it can't be built, generation falls back to V1 on the server.
  const knowledgeQuery = trpc.books.getKnowledgeCoverage.useQuery(
    { bookId },
    { enabled: studyTool }
  );
  const deckQuery = trpc.examFocus.get.useQuery(
    { bookId },
    {
      enabled: studyTool && isOwner,
      retry: false,
      refetchInterval: query => {
        const status = query.state.data?.deck.status;
        return status === "processing" || status === "finalizing"
          ? 4000
          : false;
      },
    }
  );
  const startDeck = trpc.examFocus.start.useMutation({
    onSuccess: () => utils.examFocus.get.invalidate({ bookId }),
    onError: () => setDeckUnavailable(true),
  });
  const { mutate: resumeDeck } = trpc.examFocus.resume.useMutation();
  const deckStatus = deckQuery.data?.deck.status ?? null;
  const deckProcessing =
    deckStatus === "processing" || deckStatus === "finalizing";
  const deckSettled =
    deckUnavailable ||
    deckQuery.isError ||
    deckStatus === "complete" ||
    deckStatus === "partial_failed" ||
    deckStatus === "failed";
  const knowledgeReady =
    deckStatus === "complete" || deckStatus === "partial_failed";

  const have = new Set(
    (tool === "cards" ? (data?.cards ?? []) : (data?.mcqs ?? [])).map(
      item => item.chapterId
    )
  );
  const missing = analyzed.filter(chapter => !have.has(chapter.id));
  // Chapters whose output still comes from V1 page-text generation.
  const v1Chapters = analyzed.filter(chapter => {
    const sources = knowledgeQuery.data?.chapters.find(
      c => c.chapterId === chapter.id
    )?.[kind];
    return !!sources && sources.v1 > 0 && sources.knowledge === 0;
  });
  const needsKnowledge =
    isOwner && studyTool && (missing.length > 0 || rebuildRequested);

  // Start the knowledge base when something needs generating.
  useEffect(() => {
    if (!needsKnowledge || deckStartedRef.current) return;
    if (deckQuery.isSuccess && deckQuery.data === null) {
      deckStartedRef.current = true;
      startDeck.mutate({ bookId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsKnowledge, deckQuery.isSuccess, deckQuery.data, bookId]);

  // Safety net while it builds: re-queue anything that stopped moving.
  useEffect(() => {
    if (!deckProcessing || !needsKnowledge) return;
    const timer = setInterval(() => resumeDeck({ bookId }), 45_000);
    return () => clearInterval(timer);
  }, [deckProcessing, needsKnowledge, bookId, resumeDeck]);

  useEffect(() => {
    if (!data || startedRef.current || !studyTool || !isOwner) return;
    if (!deckSettled) return;
    const jobs = [
      ...missing.map(chapter => ({ chapter, rebuild: false })),
      ...(rebuildRequested && knowledgeReady
        ? v1Chapters.map(chapter => ({ chapter, rebuild: true }))
        : []),
    ];
    if (!jobs.length) {
      if (rebuildRequested) setRebuildRequested(false);
      return;
    }
    startedRef.current = true;
    (async () => {
      // Queue every chapter's job up front — each call returns as soon as
      // the job is queued (the server's queue decides how many run at once).
      const errors: string[] = [];
      const queued: { id: string; title: string }[] = [];
      const rebuild = jobs.some(job => job.rebuild);
      setProgress({
        done: 0,
        total: jobs.length,
        current: "",
        errors,
        rebuild,
      });
      const mutation = tool === "cards" ? generateFlashcards : generateMcqs;
      for (const job of jobs) {
        try {
          await mutation.mutateAsync({
            chapterId: job.chapter.id,
            rebuild: job.rebuild || undefined,
          });
          queued.push({ id: job.chapter.id, title: job.chapter.title });
        } catch {
          errors.push(job.chapter.title);
        }
      }
      // A fresh read, so a previous run's "completed" row can't be taken
      // for this one's.
      await utils.books.generationJobs.fetch({ bookId });
      setWaitingJobs({
        kind: tool === "cards" ? "flashcards" : "mcqs",
        chapters: queued,
        rebuild,
        errors,
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tool, deckSettled, rebuildRequested]);

  // Follow the queued jobs: live progress while any is waiting or running,
  // then refresh the content once every one has finished or failed.
  useEffect(() => {
    if (!waitingJobs || !jobsQuery.data) return;
    const rows = waitingJobs.chapters.map(chapter => ({
      chapter,
      job: jobsQuery.data.find(
        job => job.chapterId === chapter.id && job.kind === waitingJobs.kind
      ),
    }));
    const failed = rows
      .filter(row => row.job?.status === "failed")
      .map(row => row.chapter.title);
    const settled = rows.filter(
      row => row.job?.status === "completed" || row.job?.status === "failed"
    ).length;
    const errors = [...waitingJobs.errors, ...failed];
    const total = rows.length + waitingJobs.errors.length;
    if (settled < rows.length) {
      const running = rows.find(row => row.job?.status === "processing");
      const waiting = rows.filter(
        row => !row.job || row.job.status === "queued"
      ).length;
      setProgress({
        done: settled + waitingJobs.errors.length,
        total,
        current: running
          ? running.chapter.title
          : `في قائمة الانتظار (${waiting})`,
        errors,
        rebuild: waitingJobs.rebuild,
      });
      return;
    }
    setWaitingJobs(null);
    void Promise.all([
      utils.books.getStudyContent.invalidate({ bookId }),
      utils.books.getKnowledgeCoverage.invalidate({ bookId }),
    ]).then(() => {
      setRebuildRequested(false);
      setProgress(
        errors.length
          ? { done: total, total, current: "", errors, rebuild: false }
          : null
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsQuery.data, waitingJobs]);

  // Medical notes for one chapter: refresh when its job settles.
  useEffect(() => {
    if (!notesChapterId || !jobsQuery.data) return;
    const job = jobsQuery.data.find(
      row => row.chapterId === notesChapterId && row.kind === "medical_notes"
    );
    if (job && (job.status === "completed" || job.status === "failed")) {
      setNotesChapterId(null);
      void utils.books.getStudyContent.invalidate({ bookId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsQuery.data, notesChapterId]);

  function requestRebuild() {
    const message =
      tool === "cards"
        ? "سيتم استبدال البطاقات الحالية ببطاقات مبنية من قاعدة المعرفة (كل حقائق الملف)، وسيضيع تقدّم مراجعة البطاقات القديمة. متابعة؟"
        : "سيتم استبدال الأسئلة الحالية بأسئلة تطبيقية مبنية من قاعدة المعرفة (كل حقائق الملف). متابعة؟";
    if (!window.confirm(message)) return;
    startedRef.current = false;
    setRebuildRequested(true);
  }

  const back = () => router.push(`/books/${bookId}`);

  if (contentQuery.isLoading || !data) {
    return (
      <StudyShell
        title={contentQuery.error ? "تعذر التحميل" : "جاري التحميل"}
        onBack={back}
      >
        <div className="study-empty">
          {contentQuery.error ? (
            <>
              <CircleAlert size={28} />
              <h3>تعذر تحميل محتوى الملف</h3>
              <p>تحقق من اتصالك ثم أعد المحاولة. تقدّمك محفوظ.</p>
              <button
                type="button"
                className="secondary-button"
                disabled={contentQuery.isFetching}
                onClick={() => contentQuery.refetch()}
              >
                إعادة المحاولة
              </button>
            </>
          ) : (
            <Loader2 size={28} className="spin" />
          )}
        </div>
      </StudyShell>
    );
  }

  const title = data.book.fileName.replace(/\.pdf$/i, "");
  const manifest = data.manifest;
  const subtitle = `الملف كاملاً · ${manifest.totalPages} صفحة · ${data.chapters.length} أجزاء`;
  const outputKind =
    tool === "cards" ? "flashcards" : tool === "mcqs" ? "mcqs" : "summary";
  const output = manifest.outputs[outputKind];

  // Honest coverage line — shows exactly what was read, analyzed and
  // generated from; a warning style whenever anything is short of 100%.
  const warn =
    manifest.extractedPages < manifest.totalPages ||
    analyzed.length < data.chapters.length ||
    (!!output && (output.status === "PARTIAL" || output.status === "FAILED")) ||
    !!progress?.errors.length;
  // 🧭 Coverage Matrix: Knowledge Item → cards / questions → pages.
  const matrixRows = knowledgeQuery.data?.rows ?? [];
  const coveredOf = (row: (typeof matrixRows)[number]) =>
    kind === "cards" ? row.cardIds.length > 0 : row.questionIds.length > 0;
  const coveredCount = matrixRows.filter(coveredOf).length;
  const knowledgeLine =
    studyTool && (matrixRows.length > 0 || v1Chapters.length > 0) ? (
      <>
        {matrixRows.length > 0 && (
          <>
            {" "}
            ·{" "}
            <button
              type="button"
              className="knowledge-link"
              onClick={() => setMatrixOpen(true)}
            >
              🧠 المعرفة: {kind === "cards" ? "البطاقات" : "الأسئلة"} تغطي{" "}
              {coveredCount}/{matrixRows.length} حقيقة
            </button>
          </>
        )}
        {isOwner && v1Chapters.length > 0 && deckStatus !== "failed" && (
          <>
            {" "}
            ·{" "}
            <button
              type="button"
              className="knowledge-link"
              onClick={requestRebuild}
              disabled={!!progress || rebuildRequested}
            >
              ✨ أعد بناء {kind === "cards" ? "البطاقات" : "الأسئلة"} من قاعدة
              المعرفة
            </button>
          </>
        )}
      </>
    ) : null;
  const matrixSheet = matrixOpen ? (
    <div className="study-sheet-backdrop" onClick={() => setMatrixOpen(false)}>
      <div
        className="study-sheet knowledge-matrix"
        role="dialog"
        aria-modal="true"
        aria-label="خريطة تغطية المعرفة"
        onClick={event => event.stopPropagation()}
      >
        <div className="study-sheet-head">
          <strong>
            🧭 خريطة التغطية · {coveredCount}/{matrixRows.length}
          </strong>
          <button
            type="button"
            onClick={() => setMatrixOpen(false)}
            aria-label="إغلاق"
          >
            <X size={18} />
          </button>
        </div>
        <p className="knowledge-matrix-hint">
          كل حقيقة من 🔥 Exam Focus ← البطاقات 🃏 والأسئلة ❓ المبنية منها ←
          صفحاتها.
        </p>
        <ol className="study-sheet-body knowledge-matrix-list">
          {matrixRows.map(row => (
            <li
              key={row.itemId}
              className={coveredOf(row) ? undefined : "is-uncovered"}
            >
              <span className="knowledge-matrix-title" dir="auto">
                <b>#{row.orderIndex}</b> {row.title}
              </span>
              <small>
                ص {row.sourcePages.join("، ")} · 🃏 {row.cardIds.length} · ❓{" "}
                {row.questionIds.length}
                {row.questionTypes.length > 0 &&
                  ` (${[...new Set(row.questionTypes.map(questionTypeLabel))].join("، ")})`}
              </small>
            </li>
          ))}
        </ol>
      </div>
    </div>
  ) : null;

  const notice = (
    <span className={warn ? "study-coverage is-warn" : "study-coverage"}>
      قُرئت {manifest.extractedPages}/{manifest.totalPages} صفحة · حُلّل{" "}
      {analyzed.length}/{data.chapters.length} أجزاء
      {output && output.requiredChunks > 0 && (
        <>
          {" "}
          · التغطية {output.coveredChunks}/{output.requiredChunks} مقاطع
        </>
      )}
      {!!manifest.failedPages.length && (
        <> · تعذّرت قراءة الصفحات {manifest.failedPages.join("، ")}</>
      )}
      {!!progress?.errors.length && (
        <> · فشل التوليد لـ: {progress.errors.join("، ")}</>
      )}
      {knowledgeLine}
      {matrixSheet}
    </span>
  );

  if (needsKnowledge && !deckSettled && !progress) {
    const units = deckQuery.data?.units ?? [];
    const doneUnits = units.filter(unit => unit.status === "complete").length;
    return (
      <StudyShell
        title={title}
        subtitle={subtitle}
        onBack={back}
        notice={notice}
      >
        <div className="study-empty">
          <NiroThinking text="Niro يبني قاعدة المعرفة من الملف كاملاً… 🧠" />
          <h3>نجهّز كل حقائق الملف أولاً</h3>
          <p>
            {tool === "cards" ? "البطاقات" : "الأسئلة"} تُبنى من قاعدة معرفة
            واحدة تغطي كل صفحة — نفس حقائق 🔥 Exam Focus.
            {units.length > 0 && (
              <>
                {" "}
                الأجزاء: {doneUnits}/{units.length}
              </>
            )}
          </p>
          {units.length > 0 && (
            <div className="flash-progress-track" style={{ width: "70%" }}>
              <i style={{ width: `${(doneUnits / units.length) * 100}%` }} />
            </div>
          )}
        </div>
      </StudyShell>
    );
  }

  if (progress && progress.done < progress.total) {
    return (
      <StudyShell
        title={title}
        subtitle={subtitle}
        onBack={back}
        notice={notice}
      >
        <div className="study-empty">
          <Loader2 size={28} className="spin" />
          <h3>
            {progress.rebuild ? "إعادة بناء" : "توليد"}{" "}
            {tool === "cards" ? "البطاقات" : "الأسئلة"}{" "}
            {knowledgeReady ? "من قاعدة المعرفة" : "من الملف كاملاً"}
          </h3>
          <p>
            {progress.done} من {progress.total} جاهز
            {progress.current ? ` · جاري الآن: ${progress.current}` : ""}
          </p>
          <div className="flash-progress-track" style={{ width: "70%" }}>
            <i
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      </StudyShell>
    );
  }

  const termsByChapter = new Map<string, { en: string; ar: string }[]>();
  for (const term of data.terms) {
    termsByChapter.set(term.chapterId, [
      ...(termsByChapter.get(term.chapterId) ?? []),
      term,
    ]);
  }
  const aiTarget = { scope: "book" as const, bookId };
  const regenerate = () => {
    startedRef.current = false;
    utils.books.getStudyContent.invalidate({ bookId });
  };

  if (tool === "mcqs") {
    return (
      <QuizMode
        adBookId={bookId}
        title={title}
        subtitle={subtitle}
        notice={notice}
        aiTarget={aiTarget}
        mcqs={data.mcqs.map(mcq => ({
          id: mcq.id,
          questionEn: mcq.questionEn,
          choices: mcq.choices as string[],
          correctIndex: mcq.correctIndex,
          explanationEn: mcq.explanationEn,
          validationStatus: mcq.validationStatus,
          validationNote: mcq.validationNote,
          sourcePage: mcq.sourcePage,
          questionType: questionTypeLabel(mcq.questionType),
        }))}
        onBack={back}
        onSubmit={(mcqId, selectedIndex) =>
          submitMcqAttempt.mutateAsync({ mcqId, selectedIndex })
        }
        onGenerate={isShared ? undefined : regenerate}
        generating={false}
      />
    );
  }

  if (tool === "cards") {
    return (
      <FlashcardsMode
        title={title}
        subtitle={subtitle}
        notice={notice}
        aiTarget={aiTarget}
        bookId={bookId}
        cards={data.cards.map(card => ({
          id: card.id,
          questionEn: card.questionEn,
          questionAr: card.questionAr,
          answerEn: card.answerEn,
          answerAr: card.answerAr,
          relatedTermEn: card.relatedTermEn,
          relatedTermAr: termsByChapter
            .get(card.chapterId)
            ?.find(
              term =>
                term.en.toLowerCase() === card.relatedTermEn?.toLowerCase()
            )?.ar,
          sourcePage: card.sourcePage,
          cardType: card.cardType
            ? CARD_TYPE_LABEL_AR[
                card.cardType as keyof typeof CARD_TYPE_LABEL_AR
              ]
            : undefined,
        }))}
        onBack={back}
        onRate={(cardId, rating) => rateCard.mutate({ cardId, rating })}
        onGenerate={isShared ? undefined : regenerate}
        generating={false}
      />
    );
  }

  return (
    <SummaryMode
      bookTitle={title}
      subtitle={subtitle}
      notice={notice}
      aiTarget={aiTarget}
      chapters={analyzed.map(chapter => ({
        id: chapter.id,
        title: chapter.title,
        startPage: chapter.startPage,
        endPage: chapter.endPage,
        chapterSummary: chapter.chapterSummary,
        explanationEn: chapter.explanationEn,
        explanationAr: chapter.explanationAr,
        keyPoints: chapter.keyPoints,
        medicalNotePages: chapter.medicalNotePages,
        summarySections: chapter.coverageManifest?.summarySections,
      }))}
      onBack={back}
      onComposeNotes={
        isShared ? undefined : chapterId => composeNotes.mutate({ chapterId })
      }
      composingChapterId={
        composeNotes.isPending
          ? (composeNotes.variables?.chapterId ?? null)
          : notesChapterId
      }
    />
  );
}
