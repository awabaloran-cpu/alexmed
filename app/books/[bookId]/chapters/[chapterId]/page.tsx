"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Layers3,
  Loader2,
  Mic,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import BookPageViewer from "@/components/BookPageViewer";
import McqCard from "@/components/McqCard";
import {
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  speak,
  startListening,
  stopSpeaking,
  type SpeechRecognitionHandle,
} from "@/lib/voice";

type AssistantTab =
  | "explanation"
  | "terms"
  | "cards"
  | "mcqs"
  | "notes"
  | "chat";
type ChatScope = "page" | "chapter" | "book" | "subject";

const CHAT_SCOPE_LABELS: Record<ChatScope, string> = {
  page: "هذه الصفحة",
  chapter: "هذا الفصل",
  book: "هذا الكتاب",
  subject: "هذه المادة",
};

// "الصفحات الأصلية" tab content is now the page's permanent middle column
// instead of a tab — everything else (شرح/مصطلحات/بطاقات/اختبار/ملاحظاتي/
// اسألني) moved into a persistent right-hand assistant panel, per StudyOS's
// reader layout: [فصول الكتاب] [صفحة PDF] [المساعد + تبويبات]. "اسألني" is
// now real (PR5: RAG chat) — "اختبرني الآن" (an adaptive quiz FLOW, distinct
// from just asking the chat to quiz you conversationally) stays a
// placeholder for PR6's error-tracking/quiz work; showing "قريبًا" there is
// honest, not a stub pretending to work.
const ASSISTANT_TABS: { id: AssistantTab; label: string }[] = [
  { id: "explanation", label: "الشرح" },
  { id: "terms", label: "المصطلحات" },
  { id: "cards", label: "البطاقات" },
  { id: "mcqs", label: "الاختبار" },
  { id: "notes", label: "ملاحظاتي" },
  { id: "chat", label: "اسألني" },
];
const COMING_SOON_TABS = ["اختبرني الآن"];

type PendingSelection = { selectedText: string; start: number; end: number };

export default function ChapterDetailPage() {
  const params = useParams<{ bookId: string; chapterId: string }>();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const bookQuery = trpc.books.get.useQuery({ id: params.bookId });
  const chapterQuery = trpc.books.getChapter.useQuery({ id: params.chapterId });
  // Audit Phase 5 — Question Validation Agent, triggered lazily from here
  // (same lazy/idempotent pattern as generateMindMapSections): re-fetches
  // the chapter afterward so mcqs[].validationStatus/validationNote reflect
  // the fresh verdicts.
  const validateMcqs = trpc.books.validateChapterMcqs.useMutation({
    onSuccess: () =>
      utils.books.getChapter.invalidate({ id: params.chapterId }),
  });
  // Audit Phase 7 — connects the explanation to this chapter's real
  // visuals, lazily (same pattern as the two mutations above).
  const generateVisualInsights = trpc.books.generateVisualInsights.useMutation({
    onSuccess: () =>
      utils.books.getChapter.invalidate({ id: params.chapterId }),
  });
  // Preselected when arriving from the book page's study-tools chooser
  // (app/books/[bookId]/page.tsx links here with ?tool=cards|mcqs|explanation).
  const [assistantTab, setAssistantTab] = useState<AssistantTab>(() => {
    const tool = searchParams.get("tool");
    return tool === "cards" || tool === "mcqs" || tool === "explanation"
      ? tool
      : "explanation";
  });
  const [pageIndex, setPageIndex] = useState(0);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { chapter, terms, cards, mcqs, pages } = chapterQuery.data ?? {
    chapter: null,
    terms: [],
    cards: [],
    mcqs: [],
    pages: [],
  };
  const currentPage = pages[pageIndex];

  const annotationsQuery = trpc.annotations.listForPage.useQuery(
    { pageId: currentPage?.id ?? "" },
    { enabled: !!currentPage }
  );
  const invalidateAnnotations = () => {
    utils.annotations.listForPage.invalidate({ pageId: currentPage?.id });
  };
  const createAnnotation = trpc.annotations.create.useMutation({
    onSuccess: () => {
      invalidateAnnotations();
      setPendingSelection(null);
      setNoteDraft("");
    },
  });
  const deleteAnnotation = trpc.annotations.delete.useMutation({
    onSuccess: invalidateAnnotations,
  });
  const createCard = trpc.annotations.createCard.useMutation();
  const submitMcqAttempt = trpc.books.submitMcqAttempt.useMutation();

  // ── بطاقات (PR14) — a real flip session over this chapter's existing
  // bookCards, rating through the existing FSRS scheduler (rateBookCard).
  // Snapshotting the queue at "ابدأ المراجعة" time keeps the session stable
  // even if the underlying query refetches mid-session.
  const [studyQueue, setStudyQueue] = useState<typeof cards>([]);
  const [studyIndex, setStudyIndex] = useState(0);
  const [studyShowAnswer, setStudyShowAnswer] = useState(false);
  const rateCard = trpc.books.rateCard.useMutation({
    onSuccess: () =>
      utils.books.getChapter.invalidate({ id: params.chapterId }),
  });

  const subjectId = bookQuery.data?.book.subjectId ?? null;
  const searchQueryResult = trpc.annotations.searchInSubject.useQuery(
    { subjectId: subjectId ?? "", query: searchQuery },
    { enabled: !!subjectId && searchQuery.trim().length > 0 }
  );

  // ── اسألني (PR5: RAG chat) ────────────────────────────────────────────
  const [chatScope, setChatScope] = useState<ChatScope>("page");
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const getOrCreateChatSession = trpc.chat.getOrCreateSession.useMutation({
    onSuccess: session => setChatSessionId(session.id),
  });
  const chatMessagesQuery = trpc.chat.listMessages.useQuery(
    { sessionId: chatSessionId ?? "" },
    { enabled: !!chatSessionId }
  );

  // ── الصوت (PR8) — browser-only (Web Speech API), a voice front-end onto
  // the exact same chat above: the mic just fills chatInput with a
  // transcript, and read-aloud just speaks assistantMessage.content — no
  // new RAG/session logic. Support is feature-detected in an effect (not at
  // render time) so server-rendered and first-client-render HTML match;
  // controls stay hidden rather than rendering a button that would silently
  // do nothing in an unsupported browser (Firefox has no SpeechRecognition
  // at all; Safari's support is partial).
  const [voiceSupport, setVoiceSupport] = useState({
    recognition: false,
    synthesis: false,
  });
  useEffect(() => {
    setVoiceSupport({
      recognition: isSpeechRecognitionSupported(),
      synthesis: isSpeechSynthesisSupported(),
    });
  }, []);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [readAloud, setReadAloud] = useState(false);
  const recognizerRef = useRef<SpeechRecognitionHandle | null>(null);

  const askChat = trpc.chat.ask.useMutation({
    onSuccess: data => {
      setChatInput("");
      chatMessagesQuery.refetch();
      if (readAloud && data.assistantMessage) {
        speak(data.assistantMessage.content, "ar-SA");
      }
    },
  });
  const createNoteFromMessage = trpc.chat.createNoteFromMessage.useMutation();
  const createCardFromMessage = trpc.chat.createCardFromMessage.useMutation();

  function toggleListening() {
    if (isListening) {
      recognizerRef.current?.stop();
      return;
    }
    setVoiceError("");
    const handle = startListening(
      "ar-SA",
      transcript => {
        setChatInput(prev => (prev ? `${prev} ${transcript}` : transcript));
      },
      message => setVoiceError(message),
      () => setIsListening(false)
    );
    if (handle) {
      recognizerRef.current = handle;
      setIsListening(true);
    }
  }

  // (Re)opens the right session whenever the student switches scope or, for
  // page scope, moves to a different page — one session per (scope,
  // target), reused across visits (see lib/db-chat.ts).
  useEffect(() => {
    if (assistantTab !== "chat") return;
    stopSpeaking(); // never keep reading a stale answer after switching scope
    setChatSessionId(null);
    if (chatScope === "page" && currentPage) {
      getOrCreateChatSession.mutate({ scope: "page", pageId: currentPage.id });
    } else if (chatScope === "chapter") {
      getOrCreateChatSession.mutate({
        scope: "chapter",
        chapterId: params.chapterId,
      });
    } else if (chatScope === "book") {
      getOrCreateChatSession.mutate({ scope: "book", bookId: params.bookId });
    } else if (chatScope === "subject" && subjectId) {
      getOrCreateChatSession.mutate({ scope: "subject", subjectId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantTab, chatScope, currentPage?.id]);

  if (chapterQuery.isLoading) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
          <h3>جاري تحميل الفصل...</h3>
        </div>
      </section>
    );
  }

  if (!chapter) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>تعذر العثور على هذا الفصل</h3>
        </div>
      </section>
    );
  }

  const pageCardsAndMcqs = currentPage
    ? {
        cards: cards.filter(card => card.sourcePage === currentPage.pageNumber),
        mcqs: mcqs.filter(mcq => mcq.sourcePage === currentPage.pageNumber),
      }
    : { cards: [], mcqs: [] };
  const pagesProgressPercent = pages.length
    ? Math.round(((pageIndex + 1) / pages.length) * 100)
    : 0;
  const allChapters = bookQuery.data?.chapters ?? [];
  const highlightAnnotations = (annotationsQuery.data ?? []).filter(
    a => a.type === "highlight" && a.positionJson
  );

  function saveHighlightOnly() {
    if (!currentPage || !pendingSelection) return;
    createAnnotation.mutate({
      bookId: params.bookId,
      pageId: currentPage.id,
      type: "highlight",
      selectedText: pendingSelection.selectedText,
      positionJson: {
        start: pendingSelection.start,
        end: pendingSelection.end,
      },
    });
  }

  function saveAsNote() {
    if (!currentPage) return;
    createAnnotation.mutate({
      bookId: params.bookId,
      pageId: currentPage.id,
      type: "note",
      content: noteDraft.trim(),
      ...(pendingSelection
        ? {
            selectedText: pendingSelection.selectedText,
            positionJson: {
              start: pendingSelection.start,
              end: pendingSelection.end,
            },
          }
        : {}),
    });
  }

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <Link
            href={`/books/${params.bookId}`}
            className="eyebrow"
            style={{ marginBottom: 8 }}
          >
            <span className="eyebrow-dot" /> ‹ رجوع للكتاب
          </Link>
          <h1>{chapter.title}</h1>
          <p>
            صفحة {chapter.startPage}–{chapter.endPage}
          </p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        {/* عمود الفصول — يسمح بالتنقل بين فصول الكتاب دون الرجوع لصفحة الكتاب */}
        <nav
          style={{
            flex: "1 1 200px",
            maxWidth: 240,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
          aria-label="فصول الكتاب"
        >
          {allChapters.map(c => (
            <Link
              key={c.id}
              href={`/books/${params.bookId}/chapters/${c.id}`}
              className={
                c.id === params.chapterId ? "nav-item active" : "nav-item"
              }
              style={{
                pointerEvents: c.status === "complete" ? "auto" : "none",
                opacity: c.status === "complete" ? 1 : 0.5,
              }}
            >
              {c.status === "complete" ? (
                <CheckCircle2 size={15} />
              ) : (
                <Loader2 size={15} className="spin" />
              )}
              <span>{c.title}</span>
            </Link>
          ))}
        </nav>

        {/* عمود الصفحة — المحتوى الأساسي */}
        <div style={{ flex: "3 1 420px", minWidth: 0 }}>
          {!pages.length ? (
            <div className="empty-state">
              <Loader2 size={28} className="spin" />
              <h3>صفحات هذا الفصل قيد التجهيز البصري...</h3>
              <p>النصوص والبطاقات جاهزة باللوحة الجانبية بالفعل.</p>
            </div>
          ) : (
            <div>
              <div className="progress-track" aria-label="تقدم صفحات الفصل">
                <i style={{ width: `${pagesProgressPercent}%` }} />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  margin: "10px 0 16px",
                }}
              >
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pageIndex === 0}
                  onClick={() => {
                    setPageIndex(i => Math.max(0, i - 1));
                    setPendingSelection(null);
                  }}
                >
                  <ChevronRight size={16} /> السابقة
                </button>
                <span style={{ fontSize: 12, color: "#8d9895" }}>
                  صفحة {pageIndex + 1} من {pages.length}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pageIndex >= pages.length - 1}
                  onClick={() => {
                    setPageIndex(i => Math.min(pages.length - 1, i + 1));
                    setPendingSelection(null);
                  }}
                >
                  التالية <ChevronLeft size={16} />
                </button>
              </div>

              {currentPage && (
                <BookPageViewer
                  page={currentPage}
                  visuals={currentPage.visuals}
                  showExtractedText
                  highlights={highlightAnnotations.map(a => ({
                    start: a.positionJson!.start,
                    end: a.positionJson!.end,
                    color: a.color,
                  }))}
                  onTextSelected={data => {
                    setPendingSelection(data);
                    setAssistantTab("notes");
                  }}
                />
              )}
            </div>
          )}
        </div>

        {/* عمود المساعد — تبويبات الشرح/المصطلحات/البطاقات/الاختبار/ملاحظاتي */}
        <aside style={{ flex: "2 1 280px", minWidth: 260 }}>
          <div className="cards-toolbar" style={{ gap: 6, marginBottom: 14 }}>
            {ASSISTANT_TABS.map(t => (
              <button
                type="button"
                key={t.id}
                className={
                  assistantTab === t.id
                    ? "filter-button active"
                    : "filter-button"
                }
                aria-pressed={assistantTab === t.id}
                onClick={() => setAssistantTab(t.id)}
              >
                {t.label}
              </button>
            ))}
            {COMING_SOON_TABS.map(label => (
              <button
                type="button"
                key={label}
                className="filter-button"
                disabled
                title="قريبًا"
                style={{ opacity: 0.5, cursor: "not-allowed" }}
              >
                {label}
              </button>
            ))}
          </div>

          {assistantTab === "explanation" && (
            <div
              className="panel-card"
              style={{ display: "flex", flexDirection: "column", gap: 18 }}
            >
              {chapter.chapterSummary && (
                <div>
                  <span className="micro-label">ملخص الفصل</span>
                  <p>{chapter.chapterSummary}</p>
                </div>
              )}
              <div>
                <span className="micro-label">الشرح بالعربي</span>
                <p style={{ whiteSpace: "pre-line" }}>
                  {chapter.explanationAr}
                </p>
              </div>
              <div>
                <span className="micro-label">English Explanation</span>
                <p
                  className="en"
                  style={{ whiteSpace: "pre-line", direction: "ltr" }}
                >
                  {chapter.explanationEn}
                </p>
              </div>
              {/* Audit Phase 7 — connects the explanation above to this
                  chapter's real images/diagrams/tables (never blocks or
                  reorders chapter/visual analysis themselves; purely an
                  additive, on-demand enrichment — see
                  generateVisualInsights). Only offered when the chapter
                  actually has visuals to connect. */}
              {pages.some(page => page.visuals.length > 0) && (
                <div>
                  <span className="micro-label">ربط الشرح بالصور</span>
                  {chapter.visualInsightsAr === null ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={generateVisualInsights.isPending}
                      onClick={() =>
                        generateVisualInsights.mutate({ chapterId: chapter.id })
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        width: "fit-content",
                        marginTop: 6,
                      }}
                    >
                      {generateVisualInsights.isPending ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      <span>اربط الشرح بصور هذا الفصل</span>
                    </button>
                  ) : chapter.visualInsightsAr ? (
                    <p style={{ whiteSpace: "pre-line" }}>
                      {chapter.visualInsightsAr}
                    </p>
                  ) : (
                    <p style={{ fontSize: 12, color: "#9a9186" }}>
                      لا تضيف صور هذا الفصل معلومة جديدة على الشرح.
                    </p>
                  )}
                </div>
              )}
              {/* PR18 — "⚡ High-Yield للامتحان": the exact same real
                  chapter.keyPoints already generated by the analysis
                  pipeline, just labeled and emphasized for exam prep —
                  no regeneration, no new AI call. */}
              {!!chapter.keyPoints?.length && (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "#fff8e6",
                    border: "1px solid #f0dba0",
                  }}
                >
                  <span className="micro-label">⚡ High-Yield للامتحان</span>
                  <ul style={{ margin: "8px 0 0" }}>
                    {chapter.keyPoints.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {assistantTab === "terms" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {terms.map(term => (
                <div className="panel-card" key={term.id}>
                  <strong>{term.ar}</strong>
                  <p style={{ fontSize: 12, color: "#8a9493" }}>
                    {term.en} · {term.pronunciation}
                  </p>
                </div>
              ))}
              {!terms.length && <p>لا توجد مصطلحات لهذا الفصل.</p>}
            </div>
          )}

          {assistantTab === "cards" && !studyQueue.length && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {!!cards.length && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    setStudyQueue(cards);
                    setStudyIndex(0);
                    setStudyShowAnswer(false);
                  }}
                >
                  <Layers3 size={16} /> ابدأ المراجعة ({cards.length})
                </button>
              )}
              {(currentPage ? pageCardsAndMcqs.cards : cards).map(card => (
                <div className="panel-card" key={card.id}>
                  <strong>{card.questionAr}</strong>
                  <p style={{ fontSize: 12, color: "#8a9493" }}>
                    {card.answerAr}
                  </p>
                </div>
              ))}
              {!(currentPage ? pageCardsAndMcqs.cards : cards).length && (
                <p>لا توجد بطاقات لهذه الصفحة.</p>
              )}
            </div>
          )}

          {assistantTab === "cards" &&
            !!studyQueue.length &&
            (studyIndex >= studyQueue.length ? (
              <div className="panel-card" style={{ textAlign: "center" }}>
                <span className="micro-label">انتهت المراجعة</span>
                <p style={{ margin: "10px 0 18px" }}>
                  راجعت {studyQueue.length} بطاقة من هذا الفصل. 🎉
                </p>
                <div
                  style={{ display: "flex", gap: 8, justifyContent: "center" }}
                >
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setStudyIndex(0);
                      setStudyShowAnswer(false);
                    }}
                  >
                    <RotateCcw size={14} /> إعادة المراجعة
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setStudyQueue([])}
                  >
                    رجوع لقائمة البطاقات
                  </button>
                </div>
              </div>
            ) : (
              <div className="panel-card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 14,
                  }}
                >
                  <span className="micro-label">
                    بطاقة {studyIndex + 1} / {studyQueue.length}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setStudyQueue([])}
                  >
                    إنهاء
                  </button>
                </div>

                <div>
                  <span className="micro-label">السؤال</span>
                  <p style={{ fontSize: 15, fontWeight: 600 }}>
                    {studyQueue[studyIndex].questionAr}
                  </p>
                </div>

                {!studyShowAnswer ? (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ marginTop: 14 }}
                    onClick={() => setStudyShowAnswer(true)}
                  >
                    إظهار الإجابة
                  </button>
                ) : (
                  <>
                    <div style={{ marginTop: 14 }}>
                      <span className="micro-label">الإجابة</span>
                      <p>{studyQueue[studyIndex].answerAr}</p>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, 1fr)",
                        gap: 6,
                        marginTop: 16,
                      }}
                    >
                      {(
                        [
                          { rating: "again", label: "لم أتذكر" },
                          { rating: "hard", label: "صعبة" },
                          { rating: "good", label: "جيدة" },
                          { rating: "easy", label: "سهلة" },
                        ] as const
                      ).map(option => (
                        <button
                          key={option.rating}
                          type="button"
                          className="secondary-button"
                          disabled={rateCard.isPending}
                          onClick={() => {
                            rateCard.mutate({
                              cardId: studyQueue[studyIndex].id,
                              rating: option.rating,
                            });
                            setStudyIndex(i => i + 1);
                            setStudyShowAnswer(false);
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}

          {assistantTab === "mcqs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {!!mcqs.length && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={validateMcqs.isPending}
                  onClick={() =>
                    chapter && validateMcqs.mutate({ chapterId: chapter.id })
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "fit-content",
                  }}
                >
                  {validateMcqs.isPending ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  <span>التحقق من صحة الأسئلة</span>
                </button>
              )}
              {validateMcqs.data && (
                <p style={{ fontSize: 11, color: "#5a5147" }}>
                  صحيحة: {validateMcqs.data.valid} · تحتاج مراجعة:{" "}
                  {validateMcqs.data.flagged}
                  {validateMcqs.data.generated > 0 &&
                    ` · تم توليد ${validateMcqs.data.generated} سؤال جديد لتغطية صفحات ناقصة`}
                </p>
              )}
              {(currentPage ? pageCardsAndMcqs.mcqs : mcqs).map(mcq => (
                <div key={mcq.id}>
                  {mcq.validationStatus === "flagged" && (
                    <div
                      className="inline-alert warning"
                      style={{ marginBottom: 6 }}
                    >
                      <CircleAlert size={14} />
                      <span>
                        هذا السؤال يحتاج مراجعة
                        {mcq.validationNote ? `: ${mcq.validationNote}` : ""}
                      </span>
                    </div>
                  )}
                  <McqCard
                    mcq={{
                      id: mcq.id,
                      questionEn: mcq.questionEn,
                      choices: mcq.choices as string[],
                      correctIndex: mcq.correctIndex,
                      explanationEn: mcq.explanationEn,
                    }}
                    onSubmit={(mcqId, selectedIndex) =>
                      submitMcqAttempt.mutateAsync({ mcqId, selectedIndex })
                    }
                  />
                </div>
              ))}
              {!(currentPage ? pageCardsAndMcqs.mcqs : mcqs).length && (
                <p>لا توجد أسئلة لهذه الصفحة.</p>
              )}
            </div>
          )}

          {assistantTab === "notes" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {pendingSelection && (
                <div className="panel-card" style={{ background: "#fff8e6" }}>
                  <span className="micro-label">النص المحدد</span>
                  <p style={{ fontStyle: "italic" }}>
                    “{pendingSelection.selectedText}”
                  </p>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={createAnnotation.isPending}
                      onClick={saveHighlightOnly}
                    >
                      ظلّل فقط
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setPendingSelection(null)}
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}

              <div className="panel-card">
                <span className="micro-label">
                  {pendingSelection
                    ? "احفظ كملاحظة على هذا التحديد"
                    : "ملاحظة جديدة"}
                </span>
                <textarea
                  value={noteDraft}
                  onChange={event => setNoteDraft(event.target.value)}
                  placeholder="اكتب ملاحظتك هنا..."
                  rows={3}
                  style={{ width: "100%", marginTop: 8 }}
                />
                <button
                  type="button"
                  className="primary-button"
                  style={{ marginTop: 8 }}
                  disabled={!noteDraft.trim() || createAnnotation.isPending}
                  onClick={saveAsNote}
                >
                  حفظ الملاحظة
                </button>
              </div>

              {subjectId && (
                <div className="panel-card">
                  <span className="micro-label">
                    <Search size={12} style={{ verticalAlign: "middle" }} />{" "}
                    البحث في ملاحظات المادة
                  </span>
                  <input
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="ابحث في كل ملاحظات هذه المادة..."
                    style={{ width: "100%", marginTop: 8 }}
                  />
                  {searchQuery.trim() && (
                    <div
                      style={{
                        marginTop: 10,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {searchQueryResult.isLoading && <p>جاري البحث...</p>}
                      {searchQueryResult.data?.map(result => (
                        <div key={result.annotation.id} className="list-card">
                          <span className="list-copy">
                            <strong>
                              {result.bookFileName} · صفحة {result.pageNumber}
                            </strong>
                            <small>
                              {result.annotation.content ||
                                result.annotation.selectedText}
                            </small>
                          </span>
                        </div>
                      ))}
                      {searchQueryResult.data &&
                        !searchQueryResult.data.length && (
                          <p>لا نتائج مطابقة.</p>
                        )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <span className="micro-label">ملاحظات هذه الصفحة</span>
                {!annotationsQuery.data?.length ? (
                  <p style={{ marginTop: 8 }}>
                    لا توجد ملاحظات لهذه الصفحة بعد. حدّد نصًا أو أضف ملاحظة
                    أعلاه.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      marginTop: 8,
                    }}
                  >
                    {annotationsQuery.data.map(annotation => (
                      <div className="panel-card" key={annotation.id}>
                        {annotation.selectedText && (
                          <p style={{ fontStyle: "italic", marginBottom: 4 }}>
                            “{annotation.selectedText}”
                          </p>
                        )}
                        {annotation.content && <p>{annotation.content}</p>}
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={createCard.isPending}
                            onClick={() =>
                              createCard.mutate({
                                annotationId: annotation.id,
                              })
                            }
                          >
                            أنشئ بطاقة
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={deleteAnnotation.isPending}
                            onClick={() =>
                              deleteAnnotation.mutate({ id: annotation.id })
                            }
                            aria-label="حذف الملاحظة"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {createCard.isSuccess &&
                          createCard.variables?.annotationId ===
                            annotation.id && (
                            <p style={{ fontSize: 11, color: "#5d9b78" }}>
                              تم إنشاء البطاقة.
                            </p>
                          )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {assistantTab === "chat" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                className="cards-toolbar"
                style={{
                  gap: 6,
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(Object.keys(CHAT_SCOPE_LABELS) as ChatScope[])
                    .filter(scope => scope !== "subject" || !!subjectId)
                    .map(scope => (
                      <button
                        type="button"
                        key={scope}
                        className={
                          chatScope === scope
                            ? "filter-button active"
                            : "filter-button"
                        }
                        onClick={() => setChatScope(scope)}
                      >
                        {CHAT_SCOPE_LABELS[scope]}
                      </button>
                    ))}
                </div>
                {voiceSupport.synthesis && (
                  <button
                    type="button"
                    className="filter-button"
                    title={
                      readAloud
                        ? "إيقاف نطق الإجابات"
                        : "نطق الإجابات بصوت عالٍ"
                    }
                    aria-pressed={readAloud}
                    onClick={() => {
                      if (readAloud) stopSpeaking();
                      setReadAloud(prev => !prev);
                    }}
                  >
                    {readAloud ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  </button>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  maxHeight: 420,
                  overflowY: "auto",
                }}
              >
                {!chatSessionId || chatMessagesQuery.isLoading ? (
                  <p style={{ fontSize: 12, color: "#8d9895" }}>
                    جاري التحضير...
                  </p>
                ) : !chatMessagesQuery.data?.length ? (
                  <p style={{ fontSize: 12, color: "#8d9895" }}>
                    اسأل عن {CHAT_SCOPE_LABELS[chatScope]} — مثلًا: "لخّص هذا في
                    خمس نقاط" أو "اختبرني".
                  </p>
                ) : (
                  chatMessagesQuery.data.map(message => (
                    <div
                      key={message.id}
                      className="panel-card"
                      style={{
                        background:
                          message.role === "user" ? "#eef3f2" : "#fff",
                        alignSelf:
                          message.role === "user" ? "flex-end" : "flex-start",
                        maxWidth: "90%",
                      }}
                    >
                      <p style={{ whiteSpace: "pre-line" }}>
                        {message.content}
                      </p>
                      {!!message.citedPages?.length && (
                        <p
                          style={{
                            fontSize: 11,
                            color: "#8a9493",
                            marginTop: 6,
                          }}
                        >
                          المصدر:{" "}
                          {message.citedPages
                            .map(cite => `صفحة ${cite.pageNumber}`)
                            .join("، ")}
                        </p>
                      )}
                      {message.role === "assistant" &&
                        !!message.citedPages?.length && (
                          <div
                            style={{ display: "flex", gap: 8, marginTop: 8 }}
                          >
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={createNoteFromMessage.isPending}
                              onClick={() =>
                                createNoteFromMessage.mutate({
                                  messageId: message.id,
                                })
                              }
                            >
                              حوّل لملاحظة
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={createCardFromMessage.isPending}
                              onClick={() =>
                                createCardFromMessage.mutate({
                                  messageId: message.id,
                                })
                              }
                            >
                              أنشئ بطاقة
                            </button>
                          </div>
                        )}
                    </div>
                  ))
                )}
                {askChat.isPending && (
                  <p style={{ fontSize: 12, color: "#8d9895" }}>
                    <Loader2 size={12} className="spin" /> جاري التفكير...
                  </p>
                )}
              </div>

              {voiceError && (
                <p style={{ fontSize: 12, color: "#974d49" }}>{voiceError}</p>
              )}

              <form
                style={{ display: "flex", gap: 8 }}
                onSubmit={event => {
                  event.preventDefault();
                  if (!chatSessionId || !chatInput.trim()) return;
                  askChat.mutate({
                    sessionId: chatSessionId,
                    question: chatInput.trim(),
                  });
                }}
              >
                <input
                  value={chatInput}
                  onChange={event => setChatInput(event.target.value)}
                  placeholder="اكتب سؤالك..."
                  style={{ flex: 1 }}
                  disabled={!chatSessionId || askChat.isPending}
                />
                {voiceSupport.recognition && (
                  <button
                    type="button"
                    className={
                      isListening
                        ? "secondary-button active"
                        : "secondary-button"
                    }
                    style={
                      isListening
                        ? { background: "#f7ded9", color: "#974d49" }
                        : undefined
                    }
                    disabled={!chatSessionId}
                    title={isListening ? "إيقاف الاستماع" : "اسأل بصوتك"}
                    aria-pressed={isListening}
                    onClick={toggleListening}
                  >
                    <Mic size={16} />
                  </button>
                )}
                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    !chatSessionId || !chatInput.trim() || askChat.isPending
                  }
                  aria-label="إرسال"
                >
                  <Send size={16} />
                </button>
              </form>
              {isListening && (
                <p style={{ fontSize: 12, color: "#8d9895" }}>
                  جارٍ الاستماع...
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
