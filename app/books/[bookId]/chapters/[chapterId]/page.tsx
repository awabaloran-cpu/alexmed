"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  List,
  Mic,
  Printer,
  Search,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { findSourceHighlight } from "@/lib/text-source-match";
import BookPageViewer from "@/components/BookPageViewer";
import QuizMode from "@/components/study/QuizMode";
import FlashcardsMode from "@/components/study/FlashcardsMode";
import SummaryMode from "@/components/study/SummaryMode";
import PartStudyLauncher from "@/components/study/PartStudyLauncher";
import { CARD_TYPE_LABEL_AR, questionTypeLabel } from "@/lib/knowledge-labels";
import RichText from "@/components/assistant/RichText";
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
// Tabs that open a full-screen study mode (components/study/*) instead of
// rendering inline in the assistant column.
type StudyMode = "explanation" | "cards" | "mcqs";
const STUDY_MODES: readonly string[] = ["explanation", "cards", "mcqs"];

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
// now real (PR5: RAG chat). The disabled "اختبرني الآن" (قريبًا) tab was
// removed: a placeholder for a feature that never shipped, and it pushed
// the tab bar off-screen on desktop.
const ASSISTANT_TABS: { id: AssistantTab; label: string }[] = [
  { id: "explanation", label: "الشرح" },
  { id: "terms", label: "المصطلحات" },
  { id: "cards", label: "البطاقات" },
  { id: "mcqs", label: "الاختبار" },
  { id: "notes", label: "ملاحظاتي" },
  { id: "chat", label: "اسألني" },
];

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
  // البطاقات والاختبار صاروا اختياريين (مو جزء من تحليل الفصل التلقائي) —
  // نفس نمط generateVisualInsights فوق تمامًا.
  const generateFlashcards = trpc.books.generateChapterFlashcards.useMutation({
    onSuccess: () =>
      utils.books.getChapter.invalidate({ id: params.chapterId }),
  });
  const generateMcqs = trpc.books.generateChapterMcqs.useMutation({
    onSuccess: () =>
      utils.books.getChapter.invalidate({ id: params.chapterId }),
  });
  const generateMedicalNotePages =
    trpc.books.generateMedicalNotePages.useMutation({
      onSuccess: () =>
        utils.books.getChapter.invalidate({ id: params.chapterId }),
    });
  // Preselected when arriving from the book page's study-tools chooser
  // (app/books/[bookId]/page.tsx links here with ?tool=cards|mcqs|explanation)
  // or from the daily review queue's "عرض في الكتاب" link (app/review/page.tsx
  // links here with ?page=N&focusCard=ID, in which case the البطاقات tab is
  // the useful default so the student sees the card next to its source).
  const focusCardId = searchParams.get("focusCard");
  const [assistantTab, setAssistantTab] = useState<AssistantTab>(() => {
    const tool = searchParams.get("tool");
    if (tool === "cards" || tool === "mcqs" || tool === "explanation") {
      return tool;
    }
    return focusCardId ? "cards" : "explanation";
  });
  // Arriving from the book page's chooser (?tool=) opens the full-screen
  // mode straight away; back from it then returns to the book page, since
  // that's where the student came from. Tapping one of these tabs on this
  // page opens the same mode, and back just closes it.
  const router = useRouter();
  const initialTool = searchParams.get("tool");
  const openedFromToolRef = useRef(
    !!initialTool && STUDY_MODES.includes(initialTool)
  );
  const [studyMode, setStudyMode] = useState<StudyMode | null>(() =>
    initialTool && STUDY_MODES.includes(initialTool)
      ? (initialTool as StudyMode)
      : null
  );
  function closeStudyMode() {
    if (openedFromToolRef.current) {
      router.push(`/books/${params.bookId}`);
      return;
    }
    setStudyMode(null);
  }
  const [pageIndex, setPageIndex] = useState(0);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [summaryPage, setSummaryPage] = useState(0);
  const [completedSummaryPages, setCompletedSummaryPages] = useState<number[]>(
    []
  );
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const appliedInitialPageRef = useRef(false);

  const { chapter, terms, cards, mcqs, pages } = chapterQuery.data ?? {
    chapter: null,
    terms: [],
    cards: [],
    mcqs: [],
    pages: [],
  };
  // 📤 Opened through an accepted share — generation stays owner-only.
  const isSharedPack = chapterQuery.data?.access.role === "shared";
  const currentPage = pages[pageIndex];
  const summarySections = useMemo(
    () => [
      {
        id: "overview",
        label: "Overview",
        arabicLabel: "نظرة عامة",
        kind: "overview" as const,
      },
      {
        id: "english",
        label: "English explanation",
        arabicLabel: "الشرح الأساسي",
        kind: "english" as const,
      },
      {
        id: "arabic",
        label: "Arabic support",
        arabicLabel: "الشرح العربي",
        kind: "arabic" as const,
      },
      ...(chapter?.keyPoints?.length
        ? [
            {
              id: "high-yield",
              label: "High-Yield review",
              arabicLabel: "نقاط الامتحان",
              kind: "high-yield" as const,
            },
          ]
        : []),
    ],
    [chapter?.keyPoints?.length]
  );
  const summaryProgress = summarySections.length
    ? Math.round((completedSummaryPages.length / summarySections.length) * 100)
    : 0;
  const summaryEncouragement =
    completedSummaryPages.length === summarySections.length
      ? "🎉 خلصت الملخص! الآن البطاقات هي التي ستخاف منك، وليس العكس."
      : completedSummaryPages.length > 0
        ? "🔥 ممتاز! صفحة وراء صفحة، والامتحان بدأ يشعر بالقلق."
        : "🚀 البداية القوية نصف العلامة—ابدأ بالصفحة الحالية وخذها بهدوء.";
  const toggleSummaryPageDone = () => {
    setCompletedSummaryPages(current =>
      current.includes(summaryPage)
        ? current.filter(page => page !== summaryPage)
        : [...current, summaryPage]
    );
  };

  // Jumps to the page a due-card/mcq's "عرض في الكتاب" link pointed at, once
  // `pages` has loaded — a ref (not a dependency-gated effect) guards this
  // since pageIndex itself is a legitimate 0 for a student manually paging
  // back to page 1, so "have we already consumed the URL's ?page=" can't be
  // inferred from pageIndex's value alone.
  useEffect(() => {
    if (appliedInitialPageRef.current || !pages.length) return;
    const requestedPage = Number(searchParams.get("page"));
    if (!Number.isFinite(requestedPage) || requestedPage <= 0) return;
    const targetIndex = pages.findIndex(p => p.pageNumber === requestedPage);
    if (targetIndex !== -1) setPageIndex(targetIndex);
    appliedInitialPageRef.current = true;
  }, [pages, searchParams]);

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

  // Ratings from the full-screen FlashcardsMode go through the FSRS
  // scheduler (rateBookCard) — the one review implementation.
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

  const bookTitle = (bookQuery.data?.book.fileName ?? chapter.title).replace(
    /\.pdf$/i,
    ""
  );
  if (studyMode === "mcqs") {
    return (
      <QuizMode
        title={bookTitle}
        subtitle={chapter.title}
        aiTarget={{ scope: "chapter", chapterId: chapter.id }}
        mcqs={mcqs.map(mcq => ({
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
        onBack={closeStudyMode}
        onSubmit={(mcqId, selectedIndex) =>
          submitMcqAttempt.mutateAsync({ mcqId, selectedIndex })
        }
        onGenerate={
          isSharedPack
            ? undefined
            : () => generateMcqs.mutate({ chapterId: chapter.id })
        }
        generating={generateMcqs.isPending}
      />
    );
  }
  if (studyMode === "cards") {
    return (
      <FlashcardsMode
        title={bookTitle}
        subtitle={chapter.title}
        aiTarget={{ scope: "chapter", chapterId: chapter.id }}
        bookId={params.bookId}
        cards={cards.map(card => ({
          id: card.id,
          questionEn: card.questionEn,
          questionAr: card.questionAr,
          answerEn: card.answerEn,
          answerAr: card.answerAr,
          relatedTermEn: card.relatedTermEn,
          relatedTermAr: terms.find(
            term => term.en.toLowerCase() === card.relatedTermEn?.toLowerCase()
          )?.ar,
          sourcePage: card.sourcePage,
          cardType: card.cardType
            ? CARD_TYPE_LABEL_AR[
                card.cardType as keyof typeof CARD_TYPE_LABEL_AR
              ]
            : undefined,
        }))}
        onBack={closeStudyMode}
        onRate={(cardId, rating) => rateCard.mutate({ cardId, rating })}
        onGenerate={
          isSharedPack
            ? undefined
            : () => generateFlashcards.mutate({ chapterId: chapter.id })
        }
        generating={generateFlashcards.isPending}
      />
    );
  }
  if (studyMode === "explanation") {
    return (
      <SummaryMode
        bookTitle={bookTitle}
        chapters={[
          {
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
          },
        ]}
        aiTarget={{ scope: "chapter", chapterId: chapter.id }}
        onBack={closeStudyMode}
        onComposeNotes={
          isSharedPack
            ? undefined
            : chapterId => generateMedicalNotePages.mutate({ chapterId })
        }
        composingChapterId={
          generateMedicalNotePages.isPending ? chapter.id : null
        }
      />
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

  // "عرض في الكتاب" deep link (see app/review/page.tsx) — locates the due
  // card's answer inside this page's extracted text so the student sees
  // exactly where it came from, the same way their own highlight
  // annotations already render. No stored source range exists for this
  // (see lib/text-source-match.ts's header comment), so it's computed here,
  // and only rendered when a real match is found — never a guessed range.
  const focusedCard = focusCardId
    ? cards.find(card => card.id === focusCardId)
    : undefined;
  const sourceHighlightRange =
    focusedCard && currentPage
      ? (findSourceHighlight(currentPage.extractedText, focusedCard.answerEn) ??
        findSourceHighlight(currentPage.extractedText, focusedCard.answerAr))
      : null;

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
                  highlights={[
                    ...highlightAnnotations.map(a => ({
                      start: a.positionJson!.start,
                      end: a.positionJson!.end,
                      color: a.color,
                    })),
                    ...(sourceHighlightRange
                      ? [{ ...sourceHighlightRange, color: "#bfe6cf" }]
                      : []),
                  ]}
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
          <div
            className="cards-toolbar"
            style={{ gap: 6, marginBottom: 14, flexWrap: "wrap" }}
          >
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
                onClick={() => {
                  setAssistantTab(t.id);
                  if (STUDY_MODES.includes(t.id)) {
                    setStudyMode(t.id as StudyMode);
                  }
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {assistantTab === "explanation" && (
            <>
              <div className="composer-launcher">
                <div>
                  <span className="eyebrow">
                    <span className="eyebrow-dot green" /> AI Medical Note
                    Composer
                  </span>
                  <strong>حوّل الفصل إلى صفحات مراجعة طبية منظمة</strong>
                  <small>
                    Definition · Clinical features · Diagnosis · Management ·
                    Red flags
                  </small>
                </div>
                {!chapter.medicalNotePages && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={generateMedicalNotePages.isPending}
                    onClick={() =>
                      generateMedicalNotePages.mutate({ chapterId: chapter.id })
                    }
                  >
                    {generateMedicalNotePages.isPending
                      ? "Designing notes…"
                      : "✨ Compose medical notes"}
                  </button>
                )}
                {chapter.medicalNotePages && (
                  <span className="composer-ready">✅ Ready</span>
                )}
              </div>
              {chapter.medicalNotePages && (
                <div className="composer-pages">
                  {chapter.medicalNotePages.map((notePage, pageIndex) => (
                    <article
                      className="composer-page"
                      key={`${notePage.title}-${pageIndex}`}
                    >
                      <div className="composer-page-head">
                        <span>
                          PAGE {String(pageIndex + 1).padStart(2, "0")}
                        </span>
                        <small>
                          Source: p.{notePage.sourcePages.join(", ") || "—"}
                        </small>
                      </div>
                      <h2>{notePage.title}</h2>
                      <p className="composer-subtitle">{notePage.subtitle}</p>
                      {notePage.blocks.map((block, blockIndex) => (
                        <section
                          className={`composer-block tone-${block.tone}`}
                          key={`${block.heading}-${blockIndex}`}
                        >
                          <div className="composer-block-heading">
                            <span>
                              {block.tone === "warning"
                                ? "⚠️"
                                : block.tone === "high_yield"
                                  ? "⚡"
                                  : block.tone === "clinical"
                                    ? "🩺"
                                    : "•"}
                            </span>
                            <strong>{block.heading}</strong>
                            <small>
                              p.{block.sourcePages.join(", ") || "—"}
                            </small>
                          </div>
                          {block.bodyEn && (
                            <p className="en" dir="ltr">
                              {block.bodyEn}
                            </p>
                          )}
                          {block.bodyAr && <p dir="rtl">{block.bodyAr}</p>}
                          {!!block.items.length && (
                            <ul>
                              {block.items.map((item, itemIndex) => (
                                <li key={itemIndex}>{item}</li>
                              ))}
                            </ul>
                          )}
                        </section>
                      ))}
                    </article>
                  ))}
                </div>
              )}
              <div className="summary-reader">
                <div className="summary-reader-toolbar">
                  <div className="summary-reader-breadcrumb">
                    <List size={15} />
                    <span>Study document</span>
                    <b>/</b>
                    <span>{chapter.title}</span>
                  </div>
                  <div className="summary-reader-actions">
                    <span className="summary-progress-label">
                      📚 {summaryProgress}% studied
                    </span>
                    <span>
                      Page {summaryPage + 1} of {summarySections.length}
                    </span>
                    <button
                      type="button"
                      className="summary-page-nav"
                      disabled={summaryPage === 0}
                      onClick={() =>
                        setSummaryPage(page => Math.max(0, page - 1))
                      }
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="summary-page-nav"
                      disabled={summaryPage === summarySections.length - 1}
                      onClick={() =>
                        setSummaryPage(page =>
                          Math.min(summarySections.length - 1, page + 1)
                        )
                      }
                    >
                      Next
                    </button>
                    <button
                      type="button"
                      className="summary-print-button"
                      onClick={() => window.print()}
                      title="Print summary"
                    >
                      <Printer size={14} /> Print
                    </button>
                  </div>
                </div>
                <div className="summary-reader-layout">
                  <aside className="summary-toc" aria-label="Summary contents">
                    <span className="micro-label">Contents / الفهرس</span>
                    {summarySections.map((section, index) => (
                      <button
                        type="button"
                        key={section.id}
                        className={summaryPage === index ? "active" : ""}
                        onClick={() => {
                          setSummaryPage(index);
                          document
                            .getElementById(`summary-${section.id}`)
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                        }}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{section.label}</strong>
                        <small>{section.arabicLabel}</small>
                      </button>
                    ))}
                  </aside>
                  <div className="summary-document">
                    <div className="summary-panel">
                      <div className="summary-motivation" role="status">
                        <span className="summary-motivation-emoji">
                          {summaryProgress === 100 ? "🏆" : "💪"}
                        </span>
                        <div>
                          <strong>{summaryEncouragement}</strong>
                          <small>Study smart · لا تحفظ كل شيء دفعة واحدة</small>
                        </div>
                        <div
                          className="summary-progress-track"
                          aria-label={`Study progress ${summaryProgress}%`}
                        >
                          <span style={{ width: `${summaryProgress}%` }} />
                        </div>
                      </div>
                      <div className="summary-panel-header">
                        <div>
                          <span className="eyebrow">
                            <span className="eyebrow-dot green" /> Study summary
                          </span>
                          <h2>فهم الفصل، ثم راجعه بذكاء</h2>
                          <p>English-first explanation with Arabic support</p>
                        </div>
                        <div className="summary-language-badge">
                          <span>EN</span>
                          <small>+ عربي</small>
                        </div>
                      </div>
                      <div
                        className="visual-summary-page"
                        id={`summary-${summarySections[summaryPage]?.id}`}
                      >
                        <div className="visual-summary-page-number">
                          {String(summaryPage + 1).padStart(2, "0")}
                        </div>
                        {summaryPage === 0 && (
                          <>
                            <div className="visual-summary-cover-mark">
                              <Sparkles size={22} />
                            </div>
                            <span className="micro-label">
                              Chapter overview / نظرة عامة
                            </span>
                            <h2 className="visual-summary-title">
                              {chapter.title}
                            </h2>
                            <p className="visual-summary-subtitle">
                              High-yield visual study notes · English-first with
                              Arabic support
                            </p>
                            {chapter.chapterSummary && (
                              <div
                                className="summary-hero"
                                id="summary-overview"
                              >
                                <div className="summary-hero-mark">
                                  <Sparkles size={18} />
                                </div>
                                <div>
                                  <span className="micro-label">
                                    Chapter summary / ملخص الفصل
                                  </span>
                                  <p className="en" dir="ltr">
                                    {chapter.chapterSummary}
                                  </p>
                                </div>
                              </div>
                            )}
                            {!!chapter.keyPoints?.length && (
                              <div className="summary-keypoints">
                                <div className="summary-keypoints-heading">
                                  <span className="summary-keypoints-icon">
                                    ⚡
                                  </span>
                                  <div>
                                    <span className="micro-label">
                                      Exam focus
                                    </span>
                                    <strong>High-Yield للامتحان</strong>
                                  </div>
                                </div>
                                <ul>
                                  {chapter.keyPoints.map((point, i) => (
                                    <li key={i}>
                                      <span>{i + 1}</span>
                                      {point}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </>
                        )}
                        {summaryPage === 1 && (
                          <section
                            className="summary-section summary-section-primary"
                            id="summary-english"
                          >
                            <div className="summary-section-title">
                              <span className="summary-step">01</span>
                              <div>
                                <span className="micro-label">
                                  Primary study layer
                                </span>
                                <h3>English explanation</h3>
                              </div>
                            </div>
                            <p className="en summary-body" dir="ltr">
                              {chapter.explanationEn}
                            </p>
                          </section>
                        )}
                        {summaryPage === 2 && (
                          <section
                            className="summary-section summary-section-support"
                            id="summary-arabic"
                          >
                            <div className="summary-section-title">
                              <span className="summary-step">02</span>
                              <div>
                                <span className="micro-label">
                                  Support layer
                                </span>
                                <h3>شرح عربي مبسط</h3>
                              </div>
                            </div>
                            <p className="summary-body" dir="rtl">
                              {chapter.explanationAr}
                            </p>
                          </section>
                        )}
                        {summaryPage === 3 && !!chapter.keyPoints?.length && (
                          <div
                            className="summary-keypoints"
                            id="summary-high-yield"
                          >
                            <div className="summary-keypoints-heading">
                              <span className="summary-keypoints-icon">⚡</span>
                              <div>
                                <span className="micro-label">Exam focus</span>
                                <strong>High-Yield للامتحان</strong>
                              </div>
                            </div>
                            <ul>
                              {chapter.keyPoints.map((point, i) => (
                                <li key={i}>
                                  <span>{i + 1}</span>
                                  {point}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {summaryPage === 0 &&
                          pages.some(page => page.visuals.length > 0) && (
                            <div className="visual-summary-visuals">
                              <span className="micro-label">
                                Visual anchors / الصور والمخططات
                              </span>
                              {pages
                                .filter(page => page.visuals.length > 0)
                                .map(page => (
                                  <div
                                    className="visual-summary-visual-card"
                                    key={page.pageNumber}
                                  >
                                    <div className="visual-summary-image-wrap">
                                      <img
                                        src={`/api/books/${params.bookId}/pages/${page.pageNumber}/image`}
                                        alt={`Original page ${page.pageNumber}`}
                                        loading="lazy"
                                      />
                                      <span>Page {page.pageNumber}</span>
                                    </div>
                                    <div>
                                      {page.visuals.map((visual, index) => (
                                        <div
                                          className="visual-summary-visual"
                                          key={`${page.pageNumber}-${index}`}
                                        >
                                          <strong>{visual.assetType}</strong>
                                          <p dir="ltr">
                                            {visual.descriptionEn ||
                                              "Visual description unavailable."}
                                          </p>
                                          <p dir="rtl">
                                            {visual.descriptionAr ||
                                              "لا يوجد شرح عربي متاح."}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          )}
                        <div className="visual-summary-page-footer">
                          <button
                            type="button"
                            className={
                              completedSummaryPages.includes(summaryPage)
                                ? "summary-done-button is-done"
                                : "summary-done-button"
                            }
                            onClick={toggleSummaryPageDone}
                          >
                            {completedSummaryPages.includes(summaryPage)
                              ? "✅ Page mastered"
                              : "☑️ Mark page studied"}
                          </button>
                          <span>
                            {completedSummaryPages.includes(summaryPage)
                              ? "أحسنت، لا تنسَ مراجعتها لاحقًا"
                              : "اضغط بعد فهم الصفحة—not just reading it 😉"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {assistantTab === "terms" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="term-dictionary-intro">
                <span>📖</span>
                <div>
                  <strong>Interactive medical dictionary</strong>
                  <small>
                    اضغط على أي مصطلح لفهمه بسرعة — English, Arabic,
                    pronunciation & clinical context.
                  </small>
                </div>
              </div>
              {terms.map(term => (
                <div
                  className={
                    selectedTermId === term.id
                      ? "term-dictionary-card is-open"
                      : "term-dictionary-card"
                  }
                  key={term.id}
                >
                  <button
                    type="button"
                    className="term-dictionary-trigger"
                    onClick={() =>
                      setSelectedTermId(
                        selectedTermId === term.id ? null : term.id
                      )
                    }
                  >
                    <span>
                      <strong className="en" dir="ltr">
                        {term.en}
                      </strong>
                      <small dir="rtl">{term.ar}</small>
                    </span>
                    <b>{selectedTermId === term.id ? "−" : "+"}</b>
                  </button>
                  {selectedTermId === term.id &&
                    (() => {
                      const relatedCard = cards.find(
                        card =>
                          card.relatedTermEn?.toLowerCase() ===
                          term.en.toLowerCase()
                      );
                      return (
                        <div className="term-dictionary-detail">
                          <div>
                            <span className="micro-label">
                              Pronunciation / النطق
                            </span>
                            <p className="en">
                              {term.pronunciation || "Not provided"}
                            </p>
                          </div>
                          <div>
                            <span className="micro-label">
                              Simple meaning / المعنى المبسط
                            </span>
                            <p>
                              {term.ar} —{" "}
                              <span className="en">
                                {relatedCard?.answerEn ||
                                  `A medical concept related to ${term.en}.`}
                              </span>
                            </p>
                          </div>
                          <div>
                            <span className="micro-label">
                              Clinical example / مثال سريري
                            </span>
                            <p className="en" dir="ltr">
                              {relatedCard?.questionEn ||
                                "Review the related flashcard for a clinical application."}
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                </div>
              ))}
              {!terms.length && <p>لا توجد مصطلحات لهذا الفصل.</p>}
            </div>
          )}

          {(assistantTab === "cards" || assistantTab === "mcqs") && (
            <PartStudyLauncher
              kind={assistantTab}
              bookId={params.bookId}
              startPage={chapter.startPage}
              endPage={chapter.endPage}
              total={assistantTab === "cards" ? cards.length : mcqs.length}
              flagged={
                assistantTab === "mcqs"
                  ? mcqs.filter(mcq => mcq.validationStatus === "flagged")
                      .length
                  : 0
              }
              onThisPage={
                assistantTab === "cards"
                  ? pageCardsAndMcqs.cards.length
                  : pageCardsAndMcqs.mcqs.length
              }
              currentPageNumber={currentPage?.pageNumber}
              onOpen={() => setStudyMode(assistantTab)}
              onGenerate={
                isSharedPack
                  ? undefined
                  : () =>
                      (assistantTab === "cards"
                        ? generateFlashcards
                        : generateMcqs
                      ).mutate({ chapterId: params.chapterId })
              }
              generating={
                assistantTab === "cards"
                  ? generateFlashcards.isPending
                  : generateMcqs.isPending
              }
              error={
                (assistantTab === "cards"
                  ? generateFlashcards.error
                  : (generateMcqs.error ?? validateMcqs.error)
                )?.message
              }
              validation={
                assistantTab === "mcqs" && mcqs.length && !isSharedPack
                  ? {
                      pending: validateMcqs.isPending,
                      result: validateMcqs.data ?? null,
                      run: () => validateMcqs.mutate({ chapterId: chapter.id }),
                    }
                  : undefined
              }
            />
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
                      {message.role === "assistant" ? (
                        <RichText text={message.content} />
                      ) : (
                        <p style={{ whiteSpace: "pre-line" }} dir="auto">
                          {message.content}
                        </p>
                      )}
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
