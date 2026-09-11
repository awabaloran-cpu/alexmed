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
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import BookPageViewer from "@/components/BookPageViewer";

type AssistantTab = "explanation" | "terms" | "cards" | "mcqs";

// "الصفحات الأصلية" tab content is now the page's permanent middle column
// instead of a tab — everything else (شرح/مصطلحات/بطاقات/اختبار) moved into
// a persistent right-hand assistant panel, per StudyOS's reader layout:
// [فصول الكتاب] [صفحة PDF] [المساعد + تبويبات]. "اسألني"/"اختبرني"/
// "ملاحظاتي" are placeholders — they need the RAG-chat (later PR), adaptive
// quiz (later PR), and annotations (later PR) work respectively, which
// aren't built yet; showing "قريبًا" here is honest, not a stub pretending
// to work.
const ASSISTANT_TABS: { id: AssistantTab; label: string }[] = [
  { id: "explanation", label: "الشرح" },
  { id: "terms", label: "المصطلحات" },
  { id: "cards", label: "البطاقات" },
  { id: "mcqs", label: "الاختبار" },
];
const COMING_SOON_TABS = ["اسألني", "اختبرني الآن", "ملاحظاتي"];

export default function ChapterDetailPage() {
  const params = useParams<{ bookId: string; chapterId: string }>();
  const bookQuery = trpc.books.get.useQuery({ id: params.bookId });
  const chapterQuery = trpc.books.getChapter.useQuery({ id: params.chapterId });
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("explanation");
  const [pageIndex, setPageIndex] = useState(0);

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

  if (!chapterQuery.data) {
    return (
      <section className="upload-view">
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>تعذر العثور على هذا الفصل</h3>
        </div>
      </section>
    );
  }

  const { chapter, terms, cards, mcqs, pages } = chapterQuery.data;
  const currentPage = pages[pageIndex];
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
                  onClick={() => setPageIndex(i => Math.max(0, i - 1))}
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
                  onClick={() =>
                    setPageIndex(i => Math.min(pages.length - 1, i + 1))
                  }
                >
                  التالية <ChevronLeft size={16} />
                </button>
              </div>

              {currentPage && (
                <BookPageViewer
                  page={currentPage}
                  visuals={currentPage.visuals}
                  showExtractedText
                />
              )}
            </div>
          )}
        </div>

        {/* عمود المساعد — تبويبات الشرح/المصطلحات/البطاقات/الاختبار */}
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
        </aside>
      </div>
    </section>
  );
}
