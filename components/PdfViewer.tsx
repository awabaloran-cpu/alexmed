"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  Maximize,
  Minimize,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

// Real client-side PDF.js viewer of the ORIGINAL uploaded file (PR13) — the
// existing extract/OCR pipeline (lib/pdf-ocr.ts, page screenshots) is
// completely untouched and keeps serving AI/analysis; this component is a
// separate, additive way to actually read the real PDF, never a replacement
// of the extracted-text reading experience in the chapter reader.
//
// Rendering strategy: pages are laid out as placeholder blocks up front
// (their exact size becomes known once each page's own viewport is fetched,
// lazily, right before it's shown) and only rendered to a <canvas> once an
// IntersectionObserver says they're near the viewport — a book can be up to
// 250MB/hundreds of pages, so rendering every page eagerly would be real
// jank, not a simplification.
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.15;

type PageState = {
  proxy: import("pdfjs-dist").PDFPageProxy | null;
  baseViewportWidth: number;
  baseViewportHeight: number;
  rendered: boolean;
  rendering: boolean;
};

type SearchMatch = { page: number; snippet: string };

export default function PdfViewer({
  src,
  fileName,
}: {
  src: string;
  fileName?: string;
}) {
  const [pdfjs, setPdfjs] = useState<typeof import("pdfjs-dist") | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1);
  const [fitWidthScale, setFitWidthScale] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  // Distinct from searchQuery so the "no results" message only shows for a
  // query that was actually searched, not for every keystroke typed after.
  const [lastSearchedQuery, setLastSearchedQuery] = useState<string | null>(
    null
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageStatesRef = useRef<Map<number, PageState>>(new Map());
  const canvasElsRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const wrapperElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderTasksRef = useRef<Map<number, RenderTask>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // pdfjs-dist touches DOM/worker APIs that don't exist during SSR — loaded
  // once, client-side only, worker wired to the static copy in public/
  // (see public/pdf.worker.min.mjs) rather than a webpack asset URL, since
  // that's the one wiring approach that behaves the same across bundlers.
  useEffect(() => {
    let cancelled = false;
    import("pdfjs-dist").then(mod => {
      if (cancelled) return;
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      setPdfjs(mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pdfjs) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setDoc(null);
    setNumPages(0);
    pageStatesRef.current.clear();
    canvasElsRef.current.clear();
    wrapperElsRef.current.clear();

    // standardFontDataUrl/cMapUrl are required for correct text extraction
    // and rendering on real-world PDFs that don't embed their own font —
    // without them, pdf.js silently mis-renders/truncates text using
    // non-embedded standard fonts (verified against a real test file).
    const loadingTask = pdfjs.getDocument({
      url: src,
      standardFontDataUrl: "/standard_fonts/",
      cMapUrl: "/cmaps/",
      cMapPacked: true,
    });
    loadingTask.promise.then(
      pdf => {
        if (cancelled) return;
        setDoc(pdf);
        setNumPages(pdf.numPages);
        setCurrentPage(1);
        setPageInput("1");
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        setError("تعذر تحميل ملف PDF. تحقق من اتصالك وحاول مرة أخرى.");
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfjs, src]);

  // "Fit width" base scale — recomputed from the first page whenever the
  // container resizes, so mobile/desktop both get a readable default.
  useEffect(() => {
    if (!doc || !containerRef.current) return;
    let cancelled = false;
    const el = containerRef.current;

    async function computeFitWidth() {
      const page = await doc!.getPage(1);
      if (cancelled) return;
      const unscaledWidth = page.getViewport({ scale: 1 }).width;
      const available = el.clientWidth - 24;
      const next = Math.max(0.4, available / unscaledWidth);
      setFitWidthScale(next);
      setScale(current => (current === 1 ? next : current));
    }
    computeFitWidth();

    const resizeObserver = new ResizeObserver(() => computeFitWidth());
    resizeObserver.observe(el);
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
    };
  }, [doc]);

  const renderPage = useCallback(
    async (pageNumber: number, renderScale: number) => {
      if (!doc) return;
      const canvas = canvasElsRef.current.get(pageNumber);
      if (!canvas) return;

      let state = pageStatesRef.current.get(pageNumber);
      if (!state) {
        state = {
          proxy: null,
          baseViewportWidth: 0,
          baseViewportHeight: 0,
          rendered: false,
          rendering: false,
        };
        pageStatesRef.current.set(pageNumber, state);
      }
      if (state.rendering) return;
      state.rendering = true;

      try {
        const page = state.proxy ?? (await doc.getPage(pageNumber));
        state.proxy = page;

        renderTasksRef.current.get(pageNumber)?.cancel();

        const devicePixelRatio =
          typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const viewport = page.getViewport({ scale: renderScale });
        canvas.width = Math.floor(viewport.width * devicePixelRatio);
        canvas.height = Math.floor(viewport.height * devicePixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

        const task = page.render({ canvasContext: context, viewport, canvas });
        renderTasksRef.current.set(pageNumber, task);
        await task.promise;
        state.rendered = true;
      } catch {
        // A cancelled render (scale changed mid-flight) throws — expected,
        // the next renderPage call for this page supersedes it.
      } finally {
        state.rendering = false;
      }
    },
    [doc]
  );

  // Re-render every page that's already on screen whenever the zoom level
  // changes (pages never observed yet just pick up the new scale on first
  // render instead).
  useEffect(() => {
    if (!doc) return;
    for (const [pageNumber, state] of pageStatesRef.current.entries()) {
      if (state.rendered) renderPage(pageNumber, scale);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, doc]);

  const setWrapperRef = useCallback(
    (pageNumber: number) => (el: HTMLDivElement | null) => {
      if (!el) {
        wrapperElsRef.current.delete(pageNumber);
        return;
      }
      wrapperElsRef.current.set(pageNumber, el);
      observerRef.current?.observe(el);
    },
    []
  );

  const setCanvasRef = useCallback(
    (pageNumber: number) => (el: HTMLCanvasElement | null) => {
      if (!el) {
        canvasElsRef.current.delete(pageNumber);
        return;
      }
      canvasElsRef.current.set(pageNumber, el);
    },
    []
  );

  useEffect(() => {
    if (!doc || !scrollRef.current) return;
    const observer = new IntersectionObserver(
      entries => {
        let bestPage = currentPage;
        let bestRatio = 0;
        for (const entry of entries) {
          const pageNumber = Number(
            (entry.target as HTMLElement).dataset.pageNumber
          );
          if (entry.isIntersecting) {
            renderPage(pageNumber, scale);
            if (entry.intersectionRatio > bestRatio) {
              bestRatio = entry.intersectionRatio;
              bestPage = pageNumber;
            }
          }
        }
        if (bestRatio > 0) {
          setCurrentPage(bestPage);
          setPageInput(String(bestPage));
        }
      },
      {
        root: scrollRef.current,
        rootMargin: "600px 0px 600px 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );
    observerRef.current = observer;
    wrapperElsRef.current.forEach(el => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, scale]);

  function scrollToPage(pageNumber: number) {
    const el = wrapperElsRef.current.get(pageNumber);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goToPageInput() {
    const n = Number(pageInput);
    if (!Number.isInteger(n) || n < 1 || n > numPages) {
      setPageInput(String(currentPage));
      return;
    }
    scrollToPage(n);
  }

  function zoomBy(delta: number) {
    setScale(current =>
      Math.min(MAX_SCALE, Math.max(MIN_SCALE, current + delta))
    );
  }

  async function runSearch() {
    const query = searchQuery.trim().toLocaleLowerCase("ar");
    if (!doc || !query) {
      setSearchMatches([]);
      return;
    }
    setSearching(true);
    const matches: SearchMatch[] = [];
    for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
      try {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .map(item => ("str" in item ? item.str : ""))
          .join(" ");
        const lower = text.toLocaleLowerCase("ar");
        const at = lower.indexOf(query);
        if (at !== -1) {
          const start = Math.max(0, at - 30);
          const snippet =
            (start > 0 ? "…" : "") +
            text.slice(start, at + query.length + 30) +
            "…";
          matches.push({ page: pageNumber, snippet });
        }
      } catch {
        // A single page's text extraction failing shouldn't abort the whole
        // search — just skip it, same as any other page-level failure mode
        // elsewhere in this codebase.
      }
    }
    setSearchMatches(matches);
    setSearchMatchIndex(0);
    setSearching(false);
    setLastSearchedQuery(searchQuery.trim());
    if (matches.length) scrollToPage(matches[0].page);
  }

  function goToMatch(direction: number) {
    if (!searchMatches.length) return;
    const next =
      (searchMatchIndex + direction + searchMatches.length) %
      searchMatches.length;
    setSearchMatchIndex(next);
    scrollToPage(searchMatches[next].page);
  }

  async function toggleFullscreen() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }

  useEffect(() => {
    function handleChange() {
      setFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  const zoomPercent = useMemo(
    () => Math.round((scale / fitWidthScale) * 100),
    [scale, fitWidthScale]
  );

  return (
    <div ref={containerRef} className="pdf-viewer">
      <div className="pdf-viewer-toolbar">
        <div className="pdf-viewer-toolbar-group">
          <button
            type="button"
            className="pdf-viewer-btn"
            disabled={currentPage <= 1}
            onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
            aria-label="الصفحة السابقة"
          >
            <ChevronRight size={16} />
          </button>
          <span className="pdf-viewer-page-indicator">
            <input
              value={pageInput}
              onChange={event => setPageInput(event.target.value)}
              onBlur={goToPageInput}
              onKeyDown={event => {
                if (event.key === "Enter") goToPageInput();
              }}
              inputMode="numeric"
              aria-label="رقم الصفحة"
            />
            <span> / {numPages || "—"}</span>
          </span>
          <button
            type="button"
            className="pdf-viewer-btn"
            disabled={currentPage >= numPages}
            onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))}
            aria-label="الصفحة التالية"
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        <div className="pdf-viewer-toolbar-group">
          <button
            type="button"
            className="pdf-viewer-btn"
            onClick={() => zoomBy(-SCALE_STEP)}
            aria-label="تصغير"
          >
            <Minus size={16} />
          </button>
          <span className="pdf-viewer-zoom-indicator">{zoomPercent}%</span>
          <button
            type="button"
            className="pdf-viewer-btn"
            onClick={() => zoomBy(SCALE_STEP)}
            aria-label="تكبير"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="pdf-viewer-toolbar-group">
          <button
            type="button"
            className={searchOpen ? "pdf-viewer-btn active" : "pdf-viewer-btn"}
            onClick={() => setSearchOpen(open => !open)}
            aria-label="البحث في الملف"
            aria-pressed={searchOpen}
          >
            <Search size={16} />
          </button>
          <button
            type="button"
            className="pdf-viewer-btn"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "إنهاء ملء الشاشة" : "ملء الشاشة"}
          >
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="pdf-viewer-search">
          <form
            onSubmit={event => {
              event.preventDefault();
              runSearch();
            }}
          >
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="ابحث داخل الملف..."
              autoFocus
            />
            <button type="submit" disabled={searching}>
              {searching ? <Loader2 size={14} className="spin" /> : "بحث"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setSearchMatches([]);
                setSearchQuery("");
                setLastSearchedQuery(null);
              }}
              aria-label="إغلاق البحث"
            >
              <X size={14} />
            </button>
          </form>
          {!searching &&
            lastSearchedQuery === searchQuery.trim() &&
            !!lastSearchedQuery && (
              <div className="pdf-viewer-search-results">
                {searchMatches.length ? (
                  <>
                    <div className="pdf-viewer-search-nav">
                      <button type="button" onClick={() => goToMatch(-1)}>
                        <ChevronRight size={14} />
                      </button>
                      <span>
                        {searchMatchIndex + 1} / {searchMatches.length}
                      </span>
                      <button type="button" onClick={() => goToMatch(1)}>
                        <ChevronLeft size={14} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="pdf-viewer-search-match"
                      onClick={() =>
                        scrollToPage(searchMatches[searchMatchIndex].page)
                      }
                    >
                      <strong>
                        صفحة {searchMatches[searchMatchIndex].page}
                      </strong>
                      <span>{searchMatches[searchMatchIndex].snippet}</span>
                    </button>
                  </>
                ) : (
                  <p>لا نتائج مطابقة.</p>
                )}
              </div>
            )}
        </div>
      )}

      {error ? (
        <div className="empty-state">
          <CircleAlert size={28} />
          <h3>{error}</h3>
        </div>
      ) : loading ? (
        <div className="empty-state">
          <Loader2 size={28} className="spin" />
          <h3>جاري تحميل {fileName || "الملف"}...</h3>
        </div>
      ) : (
        <div ref={scrollRef} className="pdf-viewer-pages">
          {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNumber => (
            <div
              key={pageNumber}
              ref={setWrapperRef(pageNumber)}
              data-page-number={pageNumber}
              className="pdf-viewer-page"
            >
              <canvas ref={setCanvasRef(pageNumber)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
