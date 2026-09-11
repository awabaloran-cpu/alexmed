"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  Search,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import BookPageViewer from "@/components/BookPageViewer";

type AssistantTab = "explanation" | "terms" | "cards" | "mcqs" | "notes";

// "الصفحات الأصلية" tab content is now the page's permanent middle column
// instead of a tab — everything else (شرح/مصطلحات/بطاقات/اختبار/ملاحظاتي)
// moved into a persistent right-hand assistant panel, per StudyOS's reader
// layout: [فصول الكتاب] [صفحة PDF] [المساعد + تبويبات]. "ملاحظاتي" is now
// real (PR4: annotations/highlighting) — "اسألني"/"اختبرني الآن" stay
// placeholders since they need the RAG-chat and adaptive-quiz work from
// later PRs; showing "قريبًا" is honest, not a stub pretending to work.
const ASSISTANT_TABS: { id: AssistantTab; label: string }[] = [
  { id: "explanation", label: "الشرح" },
  { id: "terms", label: "المصطلحات" },
  { id: "cards", label: "البطاقات" },
  { id: "mcqs", label: "الاختبار" },
  { id: "notes", label: "ملاحظاتي" },
];
const COMING_SOON_TABS = ["اسألني", "اختبرني الآن"];

type PendingSelection = { selectedText: string; start: number; end: number };

export default function ChapterDetailPage() {
  const params = useParams<{ bookId: string; chapterId: string }>();
  const utils = trpc.useUtils();
  const bookQuery = trpc.books.get.useQuery({ id: params.bookId });
  const chapterQuery = trpc.books.getChapter.useQuery({ id: params.chapterId });
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("explanation");
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

  const subjectId = bookQuery.data?.book.subjectId ?? null;
  const searchQueryResult = trpc.annotations.searchInSubject.useQuery(
    { subjectId: subjectId ?? "", query: searchQuery },
    { enabled: !!subjectId && searchQuery.trim().length > 0 }
  );

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
              {!!chapter.keyPoints?.length && (
                <div>
                  <span className="micro-label">أهم النقاط</span>
                  <ul>
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

          {assistantTab === "cards" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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

          {assistantTab === "mcqs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {(currentPage ? pageCardsAndMcqs.mcqs : mcqs).map(mcq => (
                <div className="panel-card" key={mcq.id}>
                  <strong className="en">{mcq.questionEn}</strong>
                  <ul style={{ marginTop: 10 }}>
                    {(mcq.choices as string[]).map((choice, i) => (
                      <li
                        key={i}
                        className="en"
                        style={{
                          fontWeight: i === mcq.correctIndex ? 700 : 400,
                          color: i === mcq.correctIndex ? "#5d9b78" : undefined,
                        }}
                      >
                        {choice}
                      </li>
                    ))}
                  </ul>
                  <p style={{ marginTop: 8, fontSize: 12, color: "#8a9493" }}>
                    {mcq.explanationEn}
                  </p>
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
        </aside>
      </div>
    </section>
  );
}
