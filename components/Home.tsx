"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardPaste,
  Download,
  FileText,
  KeyRound,
  Languages,
  Layers3,
  Library,
  Lightbulb,
  Loader2,
  Plus,
  RotateCcw,
  ScanText,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  Volume2,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import BottomNav from "@/components/BottomNav";
import { MarkableText, MarkingSurface } from "@/components/CardMarks";
import MirrorTextInput from "@/components/MirrorTextInput";
import SubjectPicker from "@/components/SubjectPicker";

type PageText = { page: number; text: string; hasText: boolean; ocr?: boolean };
type Card = {
  id: string;
  question: string;
  questionArabic: string;
  answer: string;
  answerArabic: string;
  explanation: string;
  explanationArabic: string;
  keyIdea: string;
  keyIdeaArabic: string;
  keyword: string;
  keywordArabic: string;
  sourcePage: number;
  status: "complete" | "needs_review";
  confidence: "high" | "medium" | "low";
  // Multimodal مِرآة — same URL reused verbatim for every card whose
  // sourcePage falls in this image's page range (see lib/db.ts's
  // getDeckWithCards), never re-fetched or duplicated in storage. null for
  // a card with no associated figure or for any non-مِرآة deck.
  imageUrl?: string | null;
  // Which section of the deck (its original upload, or a later pasted-text
  // addition) this card belongs to — see lib/deck-sections.ts.
  sectionId?: string;
};

type View = "upload" | "cards" | "library";
type Stage = "idle" | "extracting" | "processing" | "ready";
const UPLOAD_MAX_MB = Number(process.env.NEXT_PUBLIC_UPLOAD_MAX_MB) || 250;
// Same polling convention as app/mirror/[jobId]/page.tsx — once a deck's
// originating مِرآة job reaches one of these, no more cards are coming.
const POLL_INTERVAL_MS = 3000;
const TERMINAL_JOB_STATUSES = new Set(["complete", "partial_failed", "failed"]);

const depthOptions = [
  { value: "quick", label: "سريع", caption: "مراجعة خاطفة" },
  { value: "balanced", label: "متوازن", caption: "الأفضل للامتحان" },
  { value: "detailed", label: "مفصّل", caption: "شرح أعمق" },
];

const sampleFeatures = [
  {
    icon: ScanText,
    title: "لا سؤال يضيع",
    text: "يفحص كل صفحة ويعرض الصفحات التي تحتاج مراجعة.",
  },
  {
    icon: Languages,
    title: "English + عربي",
    text: "سؤال، إجابة، شرح، وفكرة رئيسية باللغتين.",
  },
  {
    icon: KeyRound,
    title: "كلمة تقودك",
    text: "يبرز clue أو trigger word الذي يبني عليه الجواب.",
  },
];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeCsv(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [file, setFile] = useState<File | null>(null);
  const [currentFileName, setCurrentFileName] = useState("");
  const [pages, setPages] = useState<PageText[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [fileUrl, setFileUrl] = useState("");
  const [openDeckId, setOpenDeckId] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState("");
  const [processedPages, setProcessedPages] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  // Lets other pages (e.g. account's quick links) send the student straight
  // to "مكتبتي" instead of always landing on the upload screen — same
  // deep-link shape as ?openDeck= below, just for the view instead of a
  // specific deck.
  const [view, setView] = useState<View>(() =>
    searchParams.get("view") === "library" ? "library" : "upload"
  );
  const [depth, setDepth] = useState("balanced");
  const [activeCard, setActiveCard] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [query, setQuery] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [speakingTarget, setSpeakingTarget] = useState<string | null>(null);
  // Upload screen: PDF file vs pasted question text. textTargetDeckId
  // preselects a file as the destination when the student came from that
  // file's "إضافة أسئلة" button.
  const [inputMode, setInputMode] = useState<"pdf" | "text">("pdf");
  const [textTargetDeckId, setTextTargetDeckId] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState("all");
  // Mandatory-folder-on-upload (PDF tab only — MirrorTextInput owns its own
  // subject choice for the "new" destination it submits).
  const [subjectId, setSubjectId] = useState("");

  const utils = trpc.useUtils();
  const decksQuery = trpc.decks.list.useQuery(undefined, {
    enabled: view === "library",
  });
  const subjectsQuery = trpc.subjects.list.useQuery(undefined, {
    enabled: view === "library",
  });
  const setDeckSubjectMutation = trpc.decks.setSubject.useMutation({
    onSuccess: () => {
      utils.decks.list.invalidate();
      utils.subjects.list.invalidate();
    },
  });
  const deleteDeckMutation = trpc.decks.delete.useMutation({
    onSuccess: () => {
      utils.decks.list.invalidate();
    },
  });

  // Live-updating deck view: while the deck's originating مِرآة job is still
  // generating (job.status not yet terminal), keeps polling so new batches'
  // cards simply appear — this is what lets a student open a large file's
  // deck and start reviewing the first ready cards immediately instead of
  // waiting for every batch to finish. A deck with no associated job (job:
  // null) — or one whose job already finished — never polls, same as a
  // plain one-time fetch.
  const deckQuery = trpc.decks.get.useQuery(
    { id: openDeckId ?? "" },
    {
      enabled: view === "cards" && !!openDeckId,
      refetchInterval: query => {
        const status = query.state.data?.job?.status;
        return status && !TERMINAL_JOB_STATUSES.has(status)
          ? POLL_INTERVAL_MS
          : false;
      },
    }
  );
  const jobStatus = deckQuery.data?.job?.status ?? null;
  const isLive = !!jobStatus && !TERMINAL_JOB_STATUSES.has(jobStatus);
  const liveJobId = deckQuery.data?.job?.id ?? null;
  const failedBatchCount = deckQuery.data?.job?.failedBatchCount ?? 0;
  const sections = deckQuery.data?.sections ?? [];
  const sectionById = new Map(sections.map(section => [section.id, section]));

  // Merges newly-arrived cards onto the end of local state (by id, so
  // existing cards — and the student's activeCard position — are never
  // touched) and syncs the deck's display metadata. Runs on first load too:
  // `cards` starts empty for a freshly-opened deck, so every fetched card is
  // "new" and gets appended in the order getDeckWithCards returns them.
  useEffect(() => {
    const data = deckQuery.data;
    if (!data) return;
    setCurrentFileName(data.deck.fileName);
    setPageCount(data.deck.pageCount);
    setDepth(data.deck.depth);
    setProcessedPages(data.deck.pageCount);
    setCards(prev => {
      const seen = new Set(prev.map(card => card.id));
      const incoming = data.cards.filter(card => !seen.has(card.id));
      return incoming.length ? [...prev, ...incoming] : prev;
    });
  }, [deckQuery.data]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  // A مِرآة generation job (see app/mirror/[jobId]/page.tsx) redirects here
  // with ?openDeck=<id> once it graduates into a real deck, so the user
  // lands on the same "cards" browsing view they used to see immediately
  // after generation finished, instead of an empty upload screen.
  useEffect(() => {
    const deckId = searchParams.get("openDeck");
    if (!deckId) return;
    router.replace("/");
    openDeck(deckId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function speakEnglish(text: string, target: string) {
    if (!text.trim()) return;
    if (!("speechSynthesis" in window)) {
      setError("النطق الصوتي غير مدعوم في هذا المتصفح.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.82;
    utterance.pitch = 1;
    utterance.onend = () => setSpeakingTarget(null);
    utterance.onerror = () => setSpeakingTarget(null);
    setSpeakingTarget(target);
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    setSpeakingTarget(null);
  }

  const visibleCards = cards.filter(card => {
    const haystack =
      `${card.question} ${card.questionArabic} ${card.answer} ${card.keyIdea} ${card.keyword}`.toLowerCase();
    return (
      (!query.trim() || haystack.includes(query.toLowerCase())) &&
      (!onlyReview || card.status === "needs_review") &&
      (sectionFilter === "all" || card.sectionId === sectionFilter)
    );
  });
  const selectedCard = visibleCards[activeCard] ?? visibleCards[0];

  // Where a card came from, for its label: a real page for an uploaded PDF,
  // but for a pasted-text section the page number is only an internal chunk
  // counter, so its section's name is shown instead.
  function cardOrigin(card: Card) {
    const section = card.sectionId ? sectionById.get(card.sectionId) : null;
    return section?.sourceType === "text"
      ? { short: section.label, tag: section.label }
      : { short: `صفحة ${card.sourcePage}`, tag: `PAGE ${card.sourcePage}` };
  }

  // Sends the student to the paste-text form with `deckId` preselected as the
  // destination (they are still shown the new-file / add-to-file choice).
  function startAddingTo(deckId: string | null) {
    setTextTargetDeckId(deckId);
    setInputMode("text");
    setError("");
    setView("upload");
  }
  const progress = pageCount
    ? Math.min(100, Math.round((processedPages / pageCount) * 100))
    : 0;

  function chooseFile(nextFile: File | undefined) {
    setError("");
    setWarning("");
    if (!nextFile) return;
    if (
      nextFile.type !== "application/pdf" &&
      !nextFile.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("اختَر ملف PDF فقط.");
      return;
    }
    if (nextFile.size > UPLOAD_MAX_MB * 1024 * 1024) {
      setError(`حجم الملف أكبر من ${UPLOAD_MAX_MB}MB في النسخة الحالية.`);
      return;
    }
    setFile(nextFile);
    setCurrentFileName(nextFile.name);
    setOpenDeckId(null);
    setStage("idle");
    setCards([]);
    setPages([]);
    setProcessedPages(0);
    setPageCount(0);
    setFileUrl("");
  }

  // Upload + extract + OCR + generation all now live on the server (Item D
  // of the reliability plan) so progress survives a closed tab or a
  // different device — this function's only job is to hand the file to
  // /api/mirror/upload-and-plan and send the user to the resumable
  // /mirror/[jobId] page, which drives batch generation the same way
  // app/books/[bookId]/page.tsx drives chapter analysis.
  async function startProcessing() {
    if (!file || !subjectId) return;
    setError("");
    setWarning("");
    setStage("extracting");

    try {
      const uploadUrlResponse = await fetch("/api/pdf/upload-url", {
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

      const planResponse = await fetch("/api/mirror/upload-and-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: uploadData.key,
          fileName: file.name,
          depth,
          subjectId,
        }),
      });
      const planned = await planResponse.json();
      if (!planResponse.ok)
        throw new Error(planned.error || "تعذر تجهيز الملف للتوليد.");

      router.push(`/mirror/${planned.jobId}`);
    } catch (processingError) {
      setStage("idle");
      setError(
        processingError instanceof Error
          ? processingError.message
          : "حدث خطأ غير متوقع."
      );
    }
  }

  function reset() {
    setFile(null);
    setCurrentFileName("");
    setOpenDeckId(null);
    setPages([]);
    setCards([]);
    setPageCount(0);
    setFileUrl("");
    setProcessedPages(0);
    setStage("idle");
    setView("upload");
    setError("");
    setWarning("");
    setQuery("");
    setOnlyReview(false);
    setSectionFilter("all");
    setActiveCard(0);
    setShowAnswer(false);
    setSubjectId("");
  }

  // Just switches into the deck's live view — deckQuery (above) does the
  // actual fetching/polling, and its effect populates cards/metadata as data
  // arrives. Kept synchronous (no fetch here) so this also works as the
  // target of the ?openDeck= redirect effect below, which may run before
  // the deck's first batch even exists yet.
  function openDeck(deckId: string) {
    setLibraryError("");
    setFile(null);
    setOpenDeckId(deckId);
    setCards([]);
    setPages([]);
    setFileUrl("");
    setStage("ready");
    setView("cards");
    setQuery("");
    setOnlyReview(false);
    setSectionFilter("all");
    setActiveCard(0);
    setShowAnswer(false);
  }

  async function removeDeck(deckId: string) {
    setLibraryError("");
    try {
      await deleteDeckMutation.mutateAsync({ id: deckId });
      if (openDeckId === deckId) reset();
    } catch {
      setLibraryError("تعذر حذف هذا الملف. حاول مرة أخرى.");
    }
  }

  function downloadCsv() {
    if (!cards.length) return;
    const header = [
      "Question EN",
      "Question AR",
      "Answer EN",
      "Answer AR",
      "Explanation EN",
      "Explanation AR",
      "Key idea",
      "Keyword",
      "Page",
      "Status",
    ];
    const rows = cards.map(card => [
      card.question,
      card.questionArabic,
      card.answer,
      card.answerArabic,
      card.explanation,
      card.explanationArabic,
      card.keyIdea,
      card.keyword,
      String(card.sourcePage),
      card.status,
    ]);
    const csv = [header, ...rows]
      .map(row => row.map(escapeCsv).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${currentFileName.replace(/\.pdf$/i, "") || "study-cards"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function goToCard(direction: number) {
    if (!visibleCards.length) return;
    stopSpeaking();
    setActiveCard(current => {
      const next = current + direction;
      // While more cards may still be on the way, stop at the last ready
      // one instead of wrapping back to the first — the "جاري تجهيز المزيد"
      // banner takes over from here rather than looping the session.
      if (isLive && next >= visibleCards.length) return current;
      return (next + visibleCards.length) % visibleCards.length;
    });
    setShowAnswer(false);
  }

  const miratReviewCount = cards.filter(
    card => card.status === "needs_review"
  ).length;

  return (
    <div className="app-shell">
      <main className="main-content">
        <div className="cards-header">
          <div>
            <Link href="/subjects" className="eyebrow">
              <span className="eyebrow-dot" /> ‹ رجوع للرئيسية
            </Link>
            <h1>
              {view === "upload"
                ? "ملفات الأسئلة"
                : view === "library"
                  ? "مكتبتي"
                  : "بطاقات المذاكرة"}
            </h1>
            <p>
              {view === "upload"
                ? "حوّل ملف أسئلتك إلى بطاقات مذاكرة سريعة."
                : view === "library"
                  ? "ملفات الأسئلة اللي رفعتها سابقًا."
                  : currentFileName}
            </p>
          </div>
        </div>

        {/* Replaces AppSidebar's onMiratNavigate buttons (PR9) — same three
            destinations, same state setters, navigation shape only. */}
        <nav className="cards-toolbar" aria-label="أقسام ملفات الأسئلة">
          <button
            type="button"
            className={
              view === "upload" ? "filter-button active" : "filter-button"
            }
            onClick={() => {
              setView("upload");
              setOnlyReview(false);
              setActiveCard(0);
            }}
          >
            <Upload size={15} /> رفع ملف جديد
          </button>
          <button
            type="button"
            className={
              view === "cards" && !onlyReview
                ? "filter-button active"
                : "filter-button"
            }
            disabled={!cards.length}
            onClick={() => {
              setView("cards");
              setOnlyReview(false);
              setActiveCard(0);
            }}
          >
            <Layers3 size={15} /> بطاقاتي ({cards.length || "—"})
          </button>
          <button
            type="button"
            className={
              view === "cards" && onlyReview
                ? "filter-button active"
                : "filter-button"
            }
            disabled={!cards.length}
            onClick={() => {
              setView("cards");
              setOnlyReview(true);
              setActiveCard(0);
            }}
          >
            <CircleAlert size={15} /> تحتاج مراجعة ({miratReviewCount || "—"})
          </button>
          <button
            type="button"
            className={
              view === "library" ? "filter-button active" : "filter-button"
            }
            onClick={() => {
              setView("library");
              setOnlyReview(false);
              setActiveCard(0);
            }}
          >
            <Library size={15} /> مكتبتي
          </button>
        </nav>

        {view === "upload" && (
          <section className="upload-view">
            <div className="intro-grid">
              <div className="intro-copy">
                <div className="eyebrow">
                  <span className="eyebrow-dot" /> من ملف طويل إلى مذاكرة أذكى
                </div>
                <h1>
                  خلي كل سؤال
                  <br />
                  <em>يثبت بدماغك.</em>
                </h1>
                <p className="intro-lede">
                  ارفع أسئلة مادتك، وNiroLearn يرتّبها لك كروتًا واضحة: السؤال،
                  الجواب، الفكرة، والكلمة المفتاحية — بالعربي والإنجليزي.
                </p>
              </div>
              <div className="intro-stamp">
                <div className="stamp-top">BUILT FOR</div>
                <strong>
                  EXAM
                  <br />
                  WEEK
                </strong>
                <div className="stamp-line" />
                <span>focus on the clue</span>
              </div>
            </div>

            <div className="feature-strip">
              {sampleFeatures.map(({ icon: Icon, title, text }) => (
                <div className="feature-item" key={title}>
                  <div className="feature-icon">
                    <Icon size={18} />
                  </div>
                  <div>
                    <strong>{title}</strong>
                    <span>{text}</span>
                  </div>
                </div>
              ))}
            </div>

            <div
              className="input-mode-tabs"
              role="group"
              aria-label="طريقة إدخال الأسئلة"
            >
              <button
                type="button"
                className="input-mode-tab"
                aria-pressed={inputMode === "pdf"}
                onClick={() => setInputMode("pdf")}
              >
                <FileText size={16} /> ملف PDF
              </button>
              <button
                type="button"
                className="input-mode-tab"
                aria-pressed={inputMode === "text"}
                onClick={() => setInputMode("text")}
              >
                <ClipboardPaste size={16} /> نص أسئلة
              </button>
            </div>

            {inputMode === "text" ? (
              <MirrorTextInput
                key={textTargetDeckId ?? "none"}
                depth={depth}
                depthOptions={depthOptions}
                onDepthChange={setDepth}
                initialDeckId={textTargetDeckId}
              />
            ) : (
              <div className="workspace-grid">
                <div className="upload-card panel-card">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">01 / UPLOAD</span>
                      <h2>ابدأ بملف الأسئلة</h2>
                    </div>
                    <FileText size={23} className="heading-icon" />
                  </div>
                  <div
                    className={
                      dragActive ? "drop-zone drag-active" : "drop-zone"
                    }
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
                      <Upload size={23} />
                    </div>
                    <strong>{file ? file.name : "اسحب ملف PDF هنا"}</strong>
                    <span>
                      {file
                        ? `${formatBytes(file.size)} · جاهز للتحليل`
                        : "أو اضغط لاختيار الملف من جهازك"}
                    </span>
                    {!file && (
                      <small>
                        حد أقصى {UPLOAD_MAX_MB}MB · يدعم الملفات الكبيرة
                        والدفعات المتعددة وPDF المصوّر عبر OCR
                      </small>
                    )}
                  </div>
                  {file && (
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
                  {error && (
                    <div className="inline-alert error">
                      <CircleAlert size={16} />
                      {error}
                    </div>
                  )}
                  {warning && (
                    <div className="inline-alert warning">
                      <CircleAlert size={16} />
                      {warning}
                    </div>
                  )}
                  {stage === "extracting" && (
                    <div
                      className="live-progress"
                      role="status"
                      aria-live="polite"
                    >
                      <div className="progress-heading">
                        <div className="progress-orbit">
                          <ScanText size={17} />
                        </div>
                        <div>
                          <strong>نرفع الملف ونجهّزه للتوليد</strong>
                          <span>
                            هتنقل تلقائيًا لصفحة التقدّم فور اكتمال الرفع — تقدر
                            تسكّر الصفحة وترجع بعدين من أي جهاز.
                          </span>
                        </div>
                      </div>
                      <div className="progress-dots">
                        <span /> <span /> <span />
                      </div>
                    </div>
                  )}
                </div>

                <div className="settings-card panel-card">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">02 / STYLE</span>
                      <h2>شكل البطاقة</h2>
                    </div>
                    <Sparkles size={23} className="heading-icon" />
                  </div>
                  <p className="setting-description">
                    اختر مستوى الشرح المناسب لوقت مذاكرتك.
                  </p>
                  <div className="depth-options">
                    {depthOptions.map(option => (
                      <button
                        type="button"
                        key={option.value}
                        className={
                          depth === option.value
                            ? "depth-option selected"
                            : "depth-option"
                        }
                        onClick={() => setDepth(option.value)}
                      >
                        <span className="radio-dot" />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.caption}</small>
                        </span>
                        {option.value === "balanced" && (
                          <b className="recommended">موصى به</b>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="language-note">
                    <Languages size={17} />
                    <div>
                      <strong>كل شيء بلغتين</strong>
                      <span>English first · الترجمة العربية بجانبه</span>
                    </div>
                  </div>
                  <SubjectPicker value={subjectId} onChange={setSubjectId} />
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!file || !subjectId || stage === "extracting"}
                    onClick={startProcessing}
                  >
                    {stage === "extracting" ? (
                      <>
                        <Loader2 size={18} className="spin" /> جاري الرفع...
                      </>
                    ) : (
                      <>
                        حوّل إلى بطاقات <ArrowUp size={18} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
            <p className="disclaimer">
              <ShieldCheck size={15} /> أداة مساعدة للمذاكرة وليست بديلًا عن
              مرجع المادة أو توجيهًا طبيًا. راجع البطاقات ذات العلامة الصفراء.
            </p>
          </section>
        )}

        {view === "cards" && (
          <section className="cards-view">
            <div className="cards-header">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-dot green" /> جلسة المذاكرة جاهزة
                </div>
                <h1>
                  بطاقاتك <em>تتكلم.</em>
                </h1>
                <p>
                  {currentFileName || "ملف الأسئلة"} ·{" "}
                  {pageCount > 0 && `${pageCount} صفحة · `}
                  {cards.length} بطاقة مولّدة
                </p>
              </div>
              <div className="header-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={downloadCsv}
                  disabled={!cards.length}
                >
                  <Download size={16} /> تصدير CSV
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => startAddingTo(openDeckId)}
                  disabled={!openDeckId}
                >
                  <Plus size={16} /> إضافة أسئلة
                </button>
                <button type="button" className="ghost-button" onClick={reset}>
                  <RotateCcw size={16} /> ملف جديد
                </button>
              </div>
            </div>
            {deckQuery.isError && (
              <div className="inline-alert error wide">
                <CircleAlert size={16} />
                <span>تعذر فتح هذا الملف. حاول مرة أخرى.</span>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ marginRight: 12 }}
                  onClick={() => setView("library")}
                >
                  العودة لمكتبتي
                </button>
              </div>
            )}
            {warning && (
              <div className="inline-alert warning wide">
                <CircleAlert size={16} />
                {warning}
              </div>
            )}
            <div className="stats-row">
              <div className="stat-card">
                <span>البطاقات</span>
                <strong>{cards.length}</strong>
                <small>بطاقة قابلة للمراجعة</small>
              </div>
              {pageCount > 0 ? (
                <div className="stat-card">
                  <span>تغطية الصفحات</span>
                  <strong>
                    {processedPages}/{pageCount}
                  </strong>
                  <small>{progress}% من الملف</small>
                </div>
              ) : (
                <div className="stat-card">
                  <span>المجموعات</span>
                  <strong>{Math.max(1, sections.length)}</strong>
                  <small>مجموعة أسئلة في هذا الملف</small>
                </div>
              )}
              <div className="stat-card accent">
                <span>تحتاج تدقيقًا</span>
                <strong>
                  {cards.filter(card => card.status === "needs_review").length}
                </strong>
                <small>أسئلة ناقصة أو غير واضحة</small>
              </div>
            </div>
            {sections.length > 1 && (
              <div
                className="section-chips"
                role="group"
                aria-label="مجموعات الأسئلة في الملف"
              >
                {[
                  { id: "all", label: "الكل", cardCount: cards.length },
                  ...sections,
                ].map(section => (
                  <button
                    key={section.id}
                    type="button"
                    className={
                      sectionFilter === section.id
                        ? "filter-button active"
                        : "filter-button"
                    }
                    onClick={() => {
                      setSectionFilter(section.id);
                      setActiveCard(0);
                      setShowAnswer(false);
                    }}
                  >
                    {section.label}
                    <span className="section-chip-count">
                      {section.cardCount}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="cards-toolbar">
              <div className="search-box">
                <span>⌕</span>
                <input
                  value={query}
                  onChange={event => {
                    setQuery(event.target.value);
                    setActiveCard(0);
                  }}
                  placeholder="ابحث في السؤال أو الكلمة المفتاحية..."
                />
              </div>
              <button
                type="button"
                className={
                  onlyReview ? "filter-button active" : "filter-button"
                }
                onClick={() => {
                  setOnlyReview(current => !current);
                  setActiveCard(0);
                }}
              >
                <CircleAlert size={15} />{" "}
                {onlyReview ? "كل البطاقات" : "تحتاج مراجعة فقط"}
              </button>
            </div>
            {stage !== "ready" && (
              <div className="processing-banner">
                <Loader2 size={18} className="spin" />
                <div>
                  <strong>نحوّل الملف إلى بطاقات...</strong>
                  <span>
                    اكتملت معالجة {processedPages} من {pageCount} صفحة
                  </span>
                </div>
                <div className="small-progress">
                  <i style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
            {isLive && (
              <div className="processing-banner">
                <Loader2 size={18} className="spin" />
                <div>
                  <strong>جاري تجهيز المزيد من البطاقات...</strong>
                  <span>
                    {cards.length} بطاقة جاهزة حتى الآن — تقدر تكمل مذاكرتك وهي
                    توصل تلقائيًا.
                  </span>
                </div>
              </div>
            )}
            {jobStatus === "complete" && (
              <div className="inline-alert success wide">
                <CheckCircle2 size={16} />
                اكتملت كل البطاقات.
              </div>
            )}
            {failedBatchCount > 0 && (
              <div className="inline-alert warning wide">
                <CircleAlert size={16} />
                <span>
                  تعذر توليد {failedBatchCount}{" "}
                  {failedBatchCount === 1 ? "جزء" : "أجزاء"}
                  {isLive ? " حتى الآن — الباقي مستمر بالخلفية." : " من الملف."}
                </span>
                {liveJobId && (
                  <Link
                    href={`/mirror/${liveJobId}?noRedirect=1`}
                    className="secondary-button"
                    style={{ marginRight: 12 }}
                  >
                    التفاصيل
                  </Link>
                )}
              </div>
            )}
            {!selectedCard ? (
              <div className="empty-state">
                <Layers3 size={28} />
                <h3>لا توجد بطاقات هنا</h3>
                <p>جرّب إزالة البحث أو فلتر المراجعة.</p>
              </div>
            ) : (
              <div className="review-layout">
                <div className="card-list">
                  {visibleCards.map((card, index) => (
                    <button
                      key={card.id}
                      className={
                        selectedCard.id === card.id
                          ? "list-card selected"
                          : "list-card"
                      }
                      type="button"
                      onClick={() => {
                        setActiveCard(index);
                        setShowAnswer(false);
                      }}
                    >
                      <span className="list-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="list-copy">
                        <strong dir="auto">
                          {card.question || card.questionArabic}
                        </strong>
                        <small>
                          {cardOrigin(card).short} ·{" "}
                          {card.keywordArabic || card.keyword}
                        </small>
                      </span>
                      {card.status === "needs_review" ? (
                        <CircleAlert size={16} className="list-alert" />
                      ) : (
                        <CheckCircle2 size={16} className="list-check" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="flashcard-wrap">
                  <div className="flashcard-meta">
                    <span>
                      بطاقة{" "}
                      {String(visibleCards.indexOf(selectedCard) + 1).padStart(
                        2,
                        "0"
                      )}{" "}
                      من {String(visibleCards.length).padStart(2, "0")}
                    </span>
                    <span
                      className={
                        selectedCard.status === "needs_review"
                          ? "review-pill"
                          : "complete-pill"
                      }
                    >
                      {selectedCard.status === "needs_review" ? (
                        <>
                          <CircleAlert size={13} /> تحتاج مراجعة
                        </>
                      ) : (
                        <>
                          <Check size={13} /> واضحة
                        </>
                      )}
                    </span>
                  </div>
                  <MarkingSurface cardId={selectedCard.id}>
                    <article className="flashcard">
                      <div className="flashcard-topline">
                        <span className="card-tag">
                          QUESTION · {cardOrigin(selectedCard).tag}
                        </span>
                        <span className="card-confidence">
                          {selectedCard.confidence} confidence
                        </span>
                      </div>
                      <div className="question-block">
                        {selectedCard.imageUrl && (
                          <img
                            src={selectedCard.imageUrl}
                            alt=""
                            style={{
                              display: "block",
                              width: "100%",
                              maxWidth: 420,
                              borderRadius: 10,
                              marginBottom: 12,
                              border: "1px solid #e4ded5",
                            }}
                          />
                        )}
                        <span className="micro-label">QUESTION / السؤال</span>
                        <h2 dir="ltr">
                          <MarkableText
                            field="question"
                            text={selectedCard.question}
                          />
                        </h2>
                        <p dir="rtl">
                          <MarkableText
                            field="questionArabic"
                            text={selectedCard.questionArabic}
                          />
                        </p>
                      </div>
                      <div
                        className={
                          showAnswer ? "answer-block revealed" : "answer-block"
                        }
                      >
                        {showAnswer ? (
                          <>
                            <span className="micro-label">
                              الإجابة والشرح / ANSWER & WHY
                            </span>
                            <div className="answer-pair">
                              <strong dir="ltr">
                                <MarkableText
                                  field="answer"
                                  text={selectedCard.answer}
                                />
                              </strong>
                              <span dir="rtl">
                                <MarkableText
                                  field="answerArabic"
                                  text={selectedCard.answerArabic}
                                />
                              </span>
                            </div>
                            <div className="explanation-pair">
                              <p dir="ltr">
                                <MarkableText
                                  field="explanation"
                                  text={selectedCard.explanation}
                                />
                              </p>
                              <p dir="rtl">
                                <MarkableText
                                  field="explanationArabic"
                                  text={selectedCard.explanationArabic}
                                />
                              </p>
                            </div>
                            <div className="concept-grid">
                              <div>
                                <span>
                                  <Lightbulb size={14} /> الفكرة الأساسية
                                </span>
                                <strong dir="ltr">
                                  <MarkableText
                                    field="keyIdea"
                                    text={selectedCard.keyIdea}
                                  />
                                </strong>
                                <small dir="rtl">
                                  <MarkableText
                                    field="keyIdeaArabic"
                                    text={selectedCard.keyIdeaArabic}
                                  />
                                </small>
                              </div>
                              <div>
                                <span>
                                  <KeyRound size={14} /> الكلمة المفتاحية
                                </span>
                                <strong dir="ltr">
                                  <MarkableText
                                    field="keyword"
                                    text={selectedCard.keyword}
                                  />
                                </strong>
                                <small dir="rtl">
                                  <MarkableText
                                    field="keywordArabic"
                                    text={selectedCard.keywordArabic}
                                  />
                                </small>
                              </div>
                            </div>
                          </>
                        ) : (
                          <button
                            className="reveal-button"
                            type="button"
                            onClick={() => setShowAnswer(true)}
                          >
                            <span className="reveal-icon">?</span>
                            <strong>اظهر الإجابة والشرح</strong>
                            <small>Reveal answer & explanation</small>
                          </button>
                        )}
                      </div>
                    </article>
                  </MarkingSurface>
                  <div className="card-navigation">
                    <button type="button" onClick={() => goToCard(-1)}>
                      <ChevronRight size={17} /> السابقة
                    </button>
                    <button
                      type="button"
                      className="next"
                      onClick={() => goToCard(1)}
                    >
                      التالية <ChevronLeft size={17} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {view === "library" && (
          <section className="upload-view">
            <div className="cards-header">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-dot" /> ملفاتك المحفوظة
                </div>
                <h1>
                  مكتبتك <em>دائمًا هنا.</em>
                </h1>
                <p>افتح أي ملف سابق وشاهد بطاقاته من غير ما تعيد الرفع.</p>
              </div>
            </div>
            {libraryError && (
              <div className="inline-alert error wide">
                <CircleAlert size={16} />
                {libraryError}
              </div>
            )}
            {decksQuery.isError ? (
              <div className="empty-state">
                <CircleAlert size={28} />
                <h3>تعذر تحميل مكتبتك</h3>
                <p>تحقق من اتصالك وحاول مرة أخرى.</p>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ marginTop: 14 }}
                  onClick={() => decksQuery.refetch()}
                >
                  إعادة المحاولة
                </button>
              </div>
            ) : decksQuery.isLoading ? (
              <div className="empty-state">
                <Loader2 size={28} className="spin" />
                <h3>جاري تحميل مكتبتك...</h3>
              </div>
            ) : !decksQuery.data?.length ? (
              <div className="empty-state">
                <Library size={28} />
                <h3>مكتبتك فارغة</h3>
                <p>ارفع ملفك الأول وسيظهر هنا تلقائيًا بعد التوليد.</p>
              </div>
            ) : (
              <div className="library-grid">
                {decksQuery.data.map(deck => (
                  <div className="library-item" key={deck.id}>
                    <div className="library-item-icon deck-item-icon">
                      <FileText size={18} />
                    </div>
                    <div className="library-item-meta">
                      <strong>
                        {deck.fileName}
                        <span className="content-type-badge">ملف أسئلة</span>
                      </strong>
                      <span>
                        {deck.pageCount > 0 && `${deck.pageCount} صفحة · `}
                        {deck.cardCount} بطاقة ·{" "}
                        {new Date(deck.createdAt).toLocaleDateString("ar-u-nu-latn")}
                      </span>
                    </div>
                    <select
                      value={deck.subjectId ?? "__none__"}
                      disabled={setDeckSubjectMutation.isPending}
                      onChange={event => {
                        const value = event.target.value;
                        setDeckSubjectMutation.mutate({
                          deckId: deck.id,
                          subjectId: value === "__none__" ? null : value,
                        });
                      }}
                    >
                      <option value="__none__">بدون مجلد</option>
                      {(subjectsQuery.data ?? []).map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <div className="library-item-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => openDeck(deck.id)}
                      >
                        فتح
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        aria-label="إضافة أسئلة لهذا الملف"
                        title="إضافة أسئلة لهذا الملف"
                        onClick={() => startAddingTo(deck.id)}
                      >
                        <Plus size={16} />
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        aria-label="حذف"
                        onClick={() => removeDeck(deck.id)}
                        disabled={deleteDeckMutation.isPending}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
