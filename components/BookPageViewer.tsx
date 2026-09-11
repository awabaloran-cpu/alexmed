"use client";

import { useState } from "react";
import { CircleAlert, Loader2, Minus, Plus, X } from "lucide-react";

export type BookPageViewerVisual = {
  id: string;
  assetType: "image" | "diagram" | "table" | "screenshot" | "chart";
  descriptionAr: string | null;
  descriptionEn: string | null;
  confidence: "high" | "medium" | "low" | null;
  reviewStatus: "complete" | "needs_review";
};

export type BookPageViewerPage = {
  id: string;
  bookId: string;
  pageNumber: number;
  extractedText: string | null;
  visualStatus:
    | "pending"
    | "processing"
    | "complete"
    | "needs_review"
    | "failed";
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  image: "صورة",
  diagram: "مخطط",
  table: "جدول",
  screenshot: "لقطة شاشة",
  chart: "رسم بياني",
};

export type BookPageViewerHighlight = {
  start: number;
  end: number;
  color?: string | null;
};

// Splits extractedText into plain-text/<mark> segments per the given
// character ranges — see the annotations table's schema comment
// (drizzle/schema.ts) for why positions are character offsets rather than
// pixel coordinates. Overlapping/out-of-order ranges are clamped/sorted
// defensively since they come from student-created rows, not a controlled
// source.
export function renderTextWithHighlights(
  text: string,
  ranges: BookPageViewerHighlight[]
): React.ReactNode {
  if (!ranges.length) return text;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((range, index) => {
    const start = Math.max(0, Math.min(range.start, text.length), cursor);
    const end = Math.max(start, Math.min(range.end, text.length));
    if (start > cursor) nodes.push(text.slice(cursor, start));
    if (end > start) {
      nodes.push(
        <mark key={index} style={{ backgroundColor: range.color || "#ffe08a" }}>
          {text.slice(start, end)}
        </mark>
      );
      cursor = end;
    }
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

// مكوّن عرض صفحة كتبي الأصلية قابل لإعادة الاستخدام — يدعم: عرض كامل بدون
// قص (object-fit:contain دومًا)، تكبير بالضغط (Lightbox + Zoom In/Out +
// ملاءمة للشاشة)، تمرير أفقي/عمودي للصور العريضة/الطويلة، lazy loading،
// placeholder أثناء التحميل، رسالة خطأ واضحة عند الفشل، alt نصّي، رقم
// الصفحة. summaryNode/cardsNode/mcqsNode تُمرَّر من الأب (شرح/بطاقات/أسئلة
// الفصل مشتركة بين كل صفحاته) وتُعرض فقط عند تفعيل العلم المطابق.
// onTextSelected (PR4) — reports a selection made inside the extracted-text
// paragraph as {selectedText, start, end} character offsets, so the parent
// can turn it into a highlight/note annotation without this component
// needing to know anything about annotations itself.
export default function BookPageViewer({
  page,
  visuals = [],
  showExtractedText = false,
  showSummary = false,
  showCards = false,
  showMcqs = false,
  summaryNode,
  cardsNode,
  mcqsNode,
  highlights = [],
  onTextSelected,
}: {
  page: BookPageViewerPage;
  visuals?: BookPageViewerVisual[];
  showExtractedText?: boolean;
  showSummary?: boolean;
  showCards?: boolean;
  showMcqs?: boolean;
  summaryNode?: React.ReactNode;
  cardsNode?: React.ReactNode;
  mcqsNode?: React.ReactNode;
  highlights?: BookPageViewerHighlight[];
  onTextSelected?: (data: {
    selectedText: string;
    start: number;
    end: number;
  }) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  const imageSrc = `/api/books/${page.bookId}/pages/${page.pageNumber}/image`;
  const altText = `صفحة ${page.pageNumber}`;

  function openLightbox() {
    if (!loaded || failed) return;
    setZoom(1);
    setLightboxOpen(true);
  }

  return (
    <div className="book-page-viewer">
      <div
        className="book-page-image-wrap book-page-mobile-scroll"
        onClick={openLightbox}
        role="button"
        tabIndex={0}
        aria-label={`تكبير صورة ${altText}`}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") openLightbox();
        }}
      >
        {!loaded && !failed && (
          <div className="book-page-placeholder">
            <Loader2 size={22} className="spin" />
            <span>جاري تحميل الصفحة...</span>
          </div>
        )}
        {failed ? (
          <div className="book-page-placeholder error">
            <CircleAlert size={22} />
            <span>تعذر تحميل صورة هذه الصفحة.</span>
          </div>
        ) : (
          <img
            src={imageSrc}
            alt={altText}
            className="book-page-image"
            loading="lazy"
            style={{ display: loaded ? "block" : "none" }}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className="book-page-caption">صفحة {page.pageNumber}</div>

      {visuals.length > 0 && (
        <div style={{ padding: "0 14px 14px" }}>
          {visuals.map(visual => (
            <div className="book-visual-asset" key={visual.id}>
              <div className="book-page-caption" style={{ textAlign: "right" }}>
                {ASSET_TYPE_LABELS[visual.assetType] ?? visual.assetType}
                {visual.reviewStatus === "needs_review" && (
                  <span style={{ color: "#c8544d" }}> · تحتاج مراجعة</span>
                )}
              </div>
              <p style={{ margin: "4px 0", fontSize: 12, color: "#2e4850" }}>
                {visual.descriptionAr}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: "#8d9895" }}>
                {visual.descriptionEn}
              </p>
            </div>
          ))}
        </div>
      )}

      {showExtractedText && page.extractedText && (
        <div style={{ padding: "0 14px 14px" }}>
          <div className="book-page-caption" style={{ textAlign: "right" }}>
            النص المستخرج
            {onTextSelected && (
              <span style={{ fontWeight: 400, color: "#8d9895" }}>
                {" "}
                · حدّد نصًا لتظليله أو تحويله إلى ملاحظة
              </span>
            )}
          </div>
          <p
            style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#2e4850" }}
            onMouseUp={
              onTextSelected
                ? event => {
                    const selection = window.getSelection();
                    if (!selection || selection.isCollapsed) return;
                    const selectedText = selection.toString();
                    if (!selectedText.trim()) return;
                    const container = event.currentTarget;
                    const range = selection.getRangeAt(0);
                    if (!container.contains(range.commonAncestorContainer)) {
                      return;
                    }
                    const preRange = document.createRange();
                    preRange.selectNodeContents(container);
                    preRange.setEnd(range.startContainer, range.startOffset);
                    const start = preRange.toString().length;
                    onTextSelected({
                      selectedText,
                      start,
                      end: start + selectedText.length,
                    });
                  }
                : undefined
            }
          >
            {renderTextWithHighlights(page.extractedText, highlights)}
          </p>
        </div>
      )}

      {showSummary && summaryNode}
      {showCards && cardsNode}
      {showMcqs && mcqsNode}

      {lightboxOpen && (
        <div
          className="book-page-lightbox-backdrop"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="book-page-lightbox-toolbar"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
              aria-label="تصغير"
            >
              <Minus size={16} />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              aria-label="ملاءمة للشاشة"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom(z => Math.min(3, z + 0.25))}
              aria-label="تكبير"
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              aria-label="إغلاق"
            >
              <X size={16} />
            </button>
          </div>
          <div
            className="book-page-lightbox-scroll"
            onClick={event => event.stopPropagation()}
          >
            <img
              src={imageSrc}
              alt={altText}
              style={{
                width: `${zoom * 100}%`,
                maxWidth: "none",
                objectFit: "contain",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
