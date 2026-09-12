"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Workflow,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// Real mind map (PR18 + audit Phase 6) — a plain expandable/collapsible tree
// built from real book/chapter content, no charting library. Book -> Chapter
// -> (key points, terms, visuals, hierarchical sections) as real levels.
// Sections (audit Phase 6) are generated lazily per chapter — see
// generateMindMapSections below — purely reorganizing this chapter's own
// already-generated explanation/keyPoints into Sections -> Key concepts, so
// they can never introduce a fact the chapter's analysis didn't already
// contain. Visuals (audit Phase 7) are real book_visual_assets rows, each
// with the real page it came from — never invented, only ever what
// analyze-page-visuals actually extracted.
const ASSET_TYPE_LABEL_AR: Record<string, string> = {
  image: "صورة",
  diagram: "مخطط",
  table: "جدول",
  screenshot: "لقطة صفحة",
  chart: "رسم بياني",
};

export default function BookMindMapPage() {
  const params = useParams<{ bookId: string }>();
  const utils = trpc.useUtils();
  const mapQuery = trpc.books.getMindMap.useQuery({ id: params.bookId });
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());
  const generateSections = trpc.books.generateMindMapSections.useMutation({
    onSuccess: () => utils.books.getMindMap.invalidate({ id: params.bookId }),
  });

  function toggleChapter(id: string) {
    setOpenChapters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="upload-view">
      <div className="cards-header">
        <div>
          <Link
            href={`/books/${params.bookId}`}
            className="eyebrow"
            style={{ marginBottom: 8 }}
          >
            <span className="eyebrow-dot" /> ‹ رجوع للكتاب
          </Link>
          <h1>الخريطة الذهنية</h1>
          <p>عرض بصري لمفاهيم هذا الكتاب وعلاقاتها ببعض.</p>
        </div>
      </div>

      {mapQuery.isError ? (
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>تعذر تحميل الخريطة</h3>
        </div>
      ) : mapQuery.isLoading ? (
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
          <h3>جاري التحميل...</h3>
        </div>
      ) : !mapQuery.data?.chapters.length ? (
        <div className="empty-state">
          <Workflow size={28} />
          <h3>لا توجد فصول مكتملة بعد</h3>
          <p>ستظهر الخريطة هنا بعد اكتمال تحليل الفصول.</p>
        </div>
      ) : (
        <div className="panel-card">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 14,
            }}
          >
            <BookOpen size={18} />
            <strong>{mapQuery.data.book.fileName}</strong>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mapQuery.data.chapters.map(chapter => {
              const isOpen = openChapters.has(chapter.id);
              // Every chapter here already has status "complete" (filtered
              // in getBookMindMapForUser), so it always has at least the
              // "generate hierarchical sections" action available.
              const hasContent = true;
              const isGeneratingThis =
                generateSections.isPending &&
                generateSections.variables?.chapterId === chapter.id;
              return (
                <div
                  key={chapter.id}
                  style={{ border: "1px solid #e4ded5", borderRadius: 10 }}
                >
                  <button
                    type="button"
                    onClick={() => toggleChapter(chapter.id)}
                    disabled={!hasContent}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      padding: "10px 14px",
                      background: "transparent",
                      cursor: hasContent ? "pointer" : "default",
                      opacity: hasContent ? 1 : 0.5,
                    }}
                  >
                    <strong style={{ fontSize: 13 }}>{chapter.title}</strong>
                    {hasContent &&
                      (isOpen ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronLeft size={16} />
                      ))}
                  </button>
                  {isOpen && hasContent && (
                    <div
                      style={{
                        padding: "0 14px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      {chapter.mindMapSections?.length ? (
                        <div>
                          <span className="micro-label">أقسام الفصل</span>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 10,
                              marginTop: 6,
                            }}
                          >
                            {chapter.mindMapSections.map((section, i) => (
                              <div
                                key={i}
                                style={{
                                  border: "1px solid #eee2d6",
                                  borderRadius: 8,
                                  padding: "8px 10px",
                                }}
                              >
                                <strong style={{ fontSize: 12 }}>
                                  {section.title}
                                </strong>
                                {!!section.sourcePages.length && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: "#9a9186",
                                      marginRight: 6,
                                    }}
                                  >
                                    صفحات {section.sourcePages.join("، ")}
                                  </span>
                                )}
                                <p
                                  style={{
                                    fontSize: 11,
                                    margin: "4px 0 0",
                                    color: "#5a5147",
                                  }}
                                >
                                  {section.explanationAr}
                                </p>
                                {!!section.concepts.length && (
                                  <div
                                    style={{
                                      display: "flex",
                                      flexWrap: "wrap",
                                      gap: 6,
                                      marginTop: 6,
                                    }}
                                  >
                                    {section.concepts.map((concept, j) => (
                                      <span
                                        key={j}
                                        title={concept.explanationAr}
                                        style={{
                                          fontSize: 11,
                                          padding: "4px 9px",
                                          borderRadius: 999,
                                          background: "#f3ede0",
                                          color: "#6b5b3d",
                                        }}
                                      >
                                        {concept.termAr} · {concept.termEn}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={isGeneratingThis}
                          onClick={() =>
                            generateSections.mutate({ chapterId: chapter.id })
                          }
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            width: "fit-content",
                          }}
                        >
                          {isGeneratingThis ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          <span>بناء الخريطة الهرمية لهذا الفصل</span>
                        </button>
                      )}
                      {!!chapter.keyPoints?.length && (
                        <div>
                          <span className="micro-label">أهم النقاط</span>
                          <ul style={{ margin: "6px 0 0" }}>
                            {chapter.keyPoints.map((point, i) => (
                              <li key={i} style={{ fontSize: 12 }}>
                                {point}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {!!chapter.terms.length && (
                        <div>
                          <span className="micro-label">مصطلحات</span>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 6,
                              marginTop: 6,
                            }}
                          >
                            {chapter.terms.map((term, i) => (
                              <span
                                key={i}
                                style={{
                                  fontSize: 11,
                                  padding: "4px 9px",
                                  borderRadius: 999,
                                  background: "#eef3f2",
                                  color: "#3a4a4d",
                                }}
                              >
                                {term.ar} · {term.en}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {!!chapter.visuals.length && (
                        <div>
                          <span className="micro-label">صور ومخططات</span>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                              marginTop: 6,
                            }}
                          >
                            {chapter.visuals.map((visual, i) => (
                              <div
                                key={i}
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 6,
                                  fontSize: 11,
                                  color: "#5a5147",
                                }}
                              >
                                <ImageIcon
                                  size={13}
                                  style={{ marginTop: 2, flexShrink: 0 }}
                                />
                                <span>
                                  <strong>
                                    {ASSET_TYPE_LABEL_AR[visual.assetType] ??
                                      visual.assetType}
                                  </strong>{" "}
                                  — صفحة {visual.pageNumber}
                                  {visual.descriptionAr
                                    ? `: ${visual.descriptionAr}`
                                    : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
