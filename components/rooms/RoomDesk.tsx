"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  MoveHorizontal,
  Plus,
  Users,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { trpc } from "@/lib/trpc-client";
import { InkBar, PageInk, useInk, usePageInk, type Ink } from "./RoomInk";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// 1 is "fit to width": the page as wide as the place it has.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const clampZoom = (value: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
// The space between two pages, and above the first (the writing tools'
// bar sits there).
const PAGE_GAP = 8;
const TOP_WITH_TOOLS = 60;
const TOP_PLAIN = 8;
// The page "on the screen" is the one under this line (a share of the
// screen's height from its top).
const READ_LINE = 0.3;
// A scroll is over when nothing has moved for this long.
const SETTLE_MS = 160;
// Pages drawn around the one on the screen; the others are blank sheets
// of the right size until the reader comes near.
const NEAR = 2;

export type DeskInfo = { page: number; pageCount: number; away: boolean };

// The room's controls over the file, held by the room's page so that the
// header, the dock and these tools step aside and come back together: a
// tap on the page shows / hides them all.
export type DeskChrome = {
  shown: boolean;
  wake: () => void;
  onStagePointerDown: (event: React.PointerEvent) => void;
  onStagePointerUp: (event: React.PointerEvent) => void;
  // Something is being chosen or went wrong: everything stays in sight.
  onBusy: (busy: boolean) => void;
};

// One page of the file: drawn when the reader is near, a blank sheet of
// its size otherwise, and the room's ink over it.
function PageSlot({
  doc,
  n,
  width,
  aspect,
  near,
  onAspect,
  label,
  roomId,
  roomSeq,
  ink,
  myUserId,
  canDeleteAny,
  onError,
}: {
  doc: PDFDocumentProxy;
  n: number;
  width: number;
  aspect: number;
  near: boolean;
  onAspect: (page: number, aspect: number) => void;
  label: string;
  roomId: string;
  roomSeq: number;
  ink: Ink;
  myUserId: string;
  canDeleteAny: boolean;
  onError: (error: unknown) => void;
}) {
  const { t } = useRooms();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const marks = usePageInk(roomId, n, roomSeq, near);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas || !width) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    setFailed(false);
    const fail = () => {
      if (!cancelled) setFailed(true);
    };
    void doc.getPage(n).then(pdfPage => {
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const real = base.height / base.width;
      // A page of another shape than guessed takes its own height.
      if (Math.abs(real - aspect) > 0.002) onAspect(n, real);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({
        scale: (width / base.width) * ratio,
      });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) return;
      task = pdfPage.render({ canvasContext: context, viewport, canvas });
      // A cancelled drawing (the reader moved on, another zoom) is not a
      // failure.
      task.promise.catch((error: { name?: string }) => {
        if (error?.name !== "RenderingCancelledException") fail();
      });
    }, fail);
    return () => {
      cancelled = true;
      task?.cancel();
    };
    // `aspect` changing is this effect's own doing: no second drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, n, width, near, attempt]);

  return (
    <div
      className={s.pageSlot}
      style={{ width, height: Math.round(width * aspect) }}
      data-page={n}
    >
      {near ? (
        <>
          <canvas ref={canvasRef} role="img" aria-label={label} />
          <PageInk
            roomId={roomId}
            page={n}
            aspect={aspect}
            ink={ink}
            marks={marks.data ?? []}
            myUserId={myUserId}
            canDeleteAny={canDeleteAny}
            onError={onError}
          />
        </>
      ) : null}
      {failed ? (
        <div className={s.pageFailed} role="alert" dir="auto">
          <p>{t("present.pageFailed")}</p>
          <button
            type="button"
            className={s.btn}
            onClick={() => setAttempt(value => value + 1)}
          >
            {t("rooms.retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// 📄 The room's desk: the shared file, its pages one under the other, and
// the page everyone follows.
//
// `sharedPage` comes from the room's own state, read every few seconds
// (LiveRoom), so a member who joins late, reconnects or opens a second tab
// lands on the page the room is on — there is nothing to replay. Whoever
// leads the page moves everyone, by scrolling or by the arrows; a member
// allowed to move on their own keeps their place until they press "back to
// the room's page"; a member who follows is brought back to the room's page
// when they scroll away from it. The page "on the screen" is the one under
// the reading line, so the next page's top fills the screen below a short
// page instead of an empty space.
//
// The file is read for display only, through the same checked route every
// file goes through, and only while the student is in the room (the server
// stops answering the moment they leave — lib/study-rooms/live.ts).
//
// The page takes the whole of its place, edge to edge; the writing tools
// sit in a small bar above the first page, and the page's tools float over
// it and step aside while reading.
export default function RoomDesk({
  roomId,
  bookId,
  sharedPage,
  canLead,
  canMoveFreely,
  onPage,
  jump,
  roomSeq,
  myUserId,
  canMark,
  canDeleteAnyMark,
  onInfo,
  chrome,
}: {
  roomId: string;
  bookId: string | null;
  sharedPage: number;
  canLead: boolean;
  canMoveFreely: boolean;
  // The page this member is looking at (for a chat message's page).
  onPage: (page: number) => void;
  // "Go to this page" from outside (a chat message): a new object each time.
  jump: { page: number } | null;
  // The room's ink.
  roomSeq: number;
  myUserId: string;
  canMark: boolean;
  canDeleteAnyMark: boolean;
  // Where this member is, for the presentation's header.
  onInfo?: (info: DeskInfo) => void;
  chrome?: DeskChrome;
}) {
  const { t, tError } = useRooms();
  const utils = trpc.useUtils();
  const file = trpc.rooms.file.useQuery(
    { roomId },
    { enabled: !!bookId, staleTime: Infinity, retry: 1 }
  );
  // A different file: ask for it afresh.
  useEffect(() => {
    void utils.rooms.file.invalidate({ roomId });
  }, [bookId, roomId, utils]);

  const setPage = trpc.rooms.setPage.useMutation({
    onSuccess: () => utils.rooms.state.invalidate({ roomId }),
  });

  const [pdfjs, setPdfjs] = useState<typeof import("pdfjs-dist") | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  // null = with the room; a number = this member's own place.
  const [ownPage, setOwnPage] = useState<number | null>(null);
  // What the leader just asked for, shown at once while the server answers.
  const [pending, setPending] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [stageWidth, setStageWidth] = useState(0);
  // The first page's shape, taken for every page until one is drawn and
  // shows its own.
  const [firstAspect, setFirstAspect] = useState(1.414);
  const [aspects, setAspects] = useState<Record<number, number>>({});
  const [visible, setVisible] = useState(1);
  const [inkError, setInkError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const ink = useInk();
  const showInk = canMark;

  useEffect(() => {
    let cancelled = false;
    void import("pdfjs-dist/legacy/build/pdf.mjs").then(mod => {
      if (cancelled) return;
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.legacy.min.mjs";
      setPdfjs(mod as unknown as typeof import("pdfjs-dist"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const url = file.data?.url;
  useEffect(() => {
    if (!pdfjs || !url) return;
    let cancelled = false;
    setDoc(null);
    setLoadError(false);
    setPercent(null);
    setAspects({});
    opened.current = false;
    anchor.current = null;
    // Same options as the book reader (components/PdfViewer.tsx): the
    // route streams the file itself, so pdf.js asks for ranges from it.
    const task = pdfjs.getDocument({
      url,
      standardFontDataUrl: "/standard_fonts/",
      cMapUrl: "/cmaps/",
      cMapPacked: true,
      disableStream: true,
      disableAutoFetch: true,
      rangeChunkSize: 512 * 1024,
    });
    task.onProgress = ({
      loaded,
      total,
    }: {
      loaded: number;
      total?: number;
    }) => {
      if (cancelled || !total) return;
      setPercent(Math.min(99, Math.round((loaded / total) * 100)));
    };
    task.promise.then(
      loaded => {
        if (cancelled) {
          void loaded.loadingTask.destroy();
          return;
        }
        void loaded.getPage(1).then(
          first => {
            if (cancelled) return;
            const base = first.getViewport({ scale: 1 });
            setFirstAspect(base.height / base.width);
            setDoc(loaded);
          },
          () => !cancelled && setLoadError(true)
        );
      },
      () => {
        if (!cancelled) setLoadError(true);
      }
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [pdfjs, url]);

  // A new file starts everyone with the room.
  useEffect(() => {
    setOwnPage(null);
    setPending(null);
    ink.setSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);
  // The server has caught up with what the leader asked for.
  useEffect(() => {
    if (pending !== null && pending === sharedPage) setPending(null);
  }, [pending, sharedPage]);

  const pageCount = doc?.numPages ?? file.data?.pageCount ?? 0;
  const roomPage = pending ?? sharedPage;
  const page = Math.min(Math.max(1, ownPage ?? roomPage), pageCount || 1);
  const away = ownPage !== null && ownPage !== roomPage;

  useEffect(() => {
    onPage(page);
  }, [page, onPage]);
  useEffect(() => {
    onInfo?.({ page, pageCount, away });
  }, [page, pageCount, away, onInfo]);

  // ── The pages' places ────────────────────────────────────────────────
  const top = showInk ? TOP_WITH_TOOLS : TOP_PLAIN;
  const width = Math.max(0, Math.floor(stageWidth * zoom));
  const aspectOf = useCallback(
    (n: number) => aspects[n] ?? firstAspect,
    [aspects, firstAspect]
  );
  // Where each page starts in the scrolled column (index 0 = page 1), and
  // where the column ends.
  const tops = useMemo(() => {
    const list: number[] = [];
    let y = top;
    for (let n = 1; n <= (doc ? pageCount : 0); n++) {
      list.push(y);
      y += Math.round(width * aspectOf(n)) + PAGE_GAP;
    }
    list.push(y);
    return list;
  }, [doc, pageCount, width, aspectOf, top]);
  const pageAt = useCallback(
    (y: number) => {
      // The last page whose top is above y.
      let low = 0;
      let high = Math.max(0, tops.length - 2);
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (tops[mid] <= y) low = mid;
        else high = mid - 1;
      }
      return low + 1;
    },
    [tops]
  );
  const onAspect = useCallback((n: number, aspect: number) => {
    setAspects(current =>
      current[n] === aspect ? current : { ...current, [n]: aspect }
    );
  }, []);

  // The width there is, watched.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setStageWidth(Math.floor(stage.clientWidth));
    const observer = new ResizeObserver(entries => {
      setStageWidth(Math.floor(entries[0].contentRect.width));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [doc]);

  // ── Scrolling and the room's page ────────────────────────────────────
  // `auto` is a scroll this desk made itself (to the room's page, or to
  // keep the place after a zoom): it moves nobody when it ends.
  const auto = useRef(false);
  const settleTimer = useRef<number | null>(null);
  // The reading line's place, as a page and a share of it, kept so a new
  // width or a page of another shape does not move the reader.
  const anchor = useRef<{ page: number; share: number } | null>(null);
  const visibleRef = useRef(1);
  const opened = useRef(false);
  // The page last brought to the screen: a new layout alone moves nobody.
  const handled = useRef<number | null>(null);

  const scrollToPage = useCallback(
    (n: number, smooth: boolean) => {
      const stage = stageRef.current;
      if (!stage || tops.length < 2) return;
      // The page's top just under the writing tools, as the first page's.
      const target = Math.max(0, tops[n - 1] - top);
      if (Math.abs(stage.scrollTop - target) < 2) return;
      auto.current = true;
      stage.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" });
    },
    [tops, top]
  );

  const pageRef = useRef(page);
  pageRef.current = page;
  const settle = useRef<() => void>(() => {});
  settle.current = () => {
    if (auto.current) {
      auto.current = false;
      return;
    }
    const seen = visibleRef.current;
    if (seen === pageRef.current) return;
    if (canLead && ownPage === null) {
      setPending(seen);
      setPage.mutate(
        { roomId, page: seen },
        { onError: () => setPending(null) }
      );
    } else if (canMoveFreely || canLead) {
      setOwnPage(seen === roomPage ? null : seen);
    } else {
      // Following the room: back to its page.
      scrollToPage(pageRef.current, true);
    }
  };

  // Which page is under the reading line, and where in it.
  const measure = () => {
    const stage = stageRef.current;
    if (!stage || tops.length < 2) return;
    const line = stage.scrollTop + stage.clientHeight * READ_LINE;
    const n = pageAt(line);
    const height = tops[n] - tops[n - 1] - PAGE_GAP;
    anchor.current = {
      page: n,
      share: height > 0 ? (line - tops[n - 1]) / height : 0,
    };
    if (n !== visibleRef.current) {
      visibleRef.current = n;
      setVisible(n);
    }
  };
  const onScroll = () => {
    measure();
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => settle.current(), SETTLE_MS);
  };
  useEffect(
    () => () => {
      if (settleTimer.current !== null)
        window.clearTimeout(settleTimer.current);
    },
    []
  );

  // A new layout (zoom, width, a page's real shape) keeps the reader where
  // they were.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const kept = anchor.current;
    if (!stage || !kept || tops.length < 2 || kept.page > tops.length - 1) {
      return;
    }
    const height = tops[kept.page] - tops[kept.page - 1] - PAGE_GAP;
    const target =
      tops[kept.page - 1] +
      kept.share * height -
      stage.clientHeight * READ_LINE;
    // Not "auto": the same page stays under the line, so nobody moves.
    if (Math.abs(stage.scrollTop - target) > 1) stage.scrollTop = target;
  }, [tops]);

  // The page this member should be on, when it is not the one on the
  // screen: the room moved on, an arrow, "go to page", the first opening.
  useEffect(() => {
    if (!doc || !width) return;
    if (opened.current && handled.current === page) return;
    handled.current = page;
    if (page !== visibleRef.current || !opened.current) {
      const smooth = opened.current && Math.abs(page - visibleRef.current) <= 3;
      opened.current = true;
      scrollToPage(page, smooth);
      visibleRef.current = page;
      setVisible(page);
      // A jump is where it lands at once; a smooth one is measured as it
      // scrolls.
      if (!smooth) measure();
    }
    // `measure` reads the same pages' places as `scrollToPage`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, doc, width, scrollToPage]);

  const go = useCallback(
    (next: number) => {
      const target = Math.min(Math.max(1, next), pageCount || 1);
      if (canLead && ownPage === null) {
        if (target === roomPage) return;
        setPending(target);
        setPage.mutate(
          { roomId, page: target },
          { onError: () => setPending(null) }
        );
      } else if (canMoveFreely || canLead) {
        setOwnPage(target === roomPage ? null : target);
      }
    },
    [canLead, canMoveFreely, ownPage, pageCount, roomPage, roomId, setPage]
  );
  const mayMove = canLead || canMoveFreely;

  useEffect(() => {
    if (jump) go(jump.page);
    // Only a new request moves the page; `go` changes with every page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  // Page Up / Page Down turn the page.
  useEffect(() => {
    if (!mayMove || !doc) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (event.key === "PageDown") {
        event.preventDefault();
        go(page + 1);
      } else if (event.key === "PageUp") {
        event.preventDefault();
        go(page - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mayMove, doc, go, page]);

  // ── Two fingers ──────────────────────────────────────────────────────
  // They zoom the pages: the column follows the fingers at once and is
  // drawn sharp at the new size when they lift. With a writing tool in hand
  // one finger writes, so two fingers also move the pages.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const toolRef = useRef(ink.tool);
  toolRef.current = ink.tool;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !doc) return;
    let start: {
      distance: number;
      zoom: number;
      x: number;
      y: number;
    } | null = null;
    let ratio = 1;
    const distance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
    const middle = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    });
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      start = {
        distance: distance(event.touches),
        zoom: zoomRef.current,
        ...middle(event.touches),
      };
      ratio = 1;
    };
    const onMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 2) return;
      event.preventDefault();
      if (toolRef.current) {
        const now = middle(event.touches);
        stage.scrollLeft -= now.x - start.x;
        stage.scrollTop -= now.y - start.y;
        start.x = now.x;
        start.y = now.y;
      }
      const wanted = clampZoom(
        (start.zoom * distance(event.touches)) / start.distance
      );
      ratio = wanted / start.zoom;
      const column = columnRef.current;
      if (column) {
        const box = column.getBoundingClientRect();
        column.style.transformOrigin = `${start.x - box.left}px ${
          start.y - box.top
        }px`;
        column.style.transform = ratio === 1 ? "" : `scale(${ratio})`;
      }
    };
    const onEnd = () => {
      if (!start) return;
      const next = clampZoom(start.zoom * ratio);
      start = null;
      if (columnRef.current) columnRef.current.style.transform = "";
      if (next !== zoomRef.current) setZoom(next);
    };
    stage.addEventListener("touchstart", onStart, { passive: true });
    stage.addEventListener("touchmove", onMove, { passive: false });
    stage.addEventListener("touchend", onEnd);
    stage.addEventListener("touchcancel", onEnd);
    return () => {
      stage.removeEventListener("touchstart", onStart);
      stage.removeEventListener("touchmove", onMove);
      stage.removeEventListener("touchend", onEnd);
      stage.removeEventListener("touchcancel", onEnd);
    };
  }, [doc]);

  // ── The room's chrome ────────────────────────────────────────────────
  // Choosing what the lasso caught, or a problem the tools explain: the
  // room keeps every control in sight.
  const onBusy = chrome?.onBusy;
  const busy = !!ink.selection || !!inkError || setPage.error !== null;
  useEffect(() => {
    onBusy?.(busy);
  }, [onBusy, busy]);
  useEffect(() => () => onBusy?.(false), [onBusy]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  // The presentation goes full screen whole — header, sheets and all (the
  // rooms' root holds them).
  const toggleFull = () => {
    const frame = frameRef.current;
    const target =
      frame?.closest<HTMLElement>("[data-rooms-root]") ?? frame ?? null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void target?.requestFullscreen?.().catch(() => undefined);
  };
  // iPhone has no full screen for a page's own element: no button there.
  const [canFull, setCanFull] = useState(false);
  useEffect(() => setCanFull(!!document.fullscreenEnabled), []);

  if (!bookId) return null;

  if (file.error || loadError) {
    return (
      <div className={s.desk} role="alert">
        <p>{file.error ? tError(file.error) : t("file.openFailed")}</p>
        <button
          type="button"
          className={s.btn}
          onClick={() => {
            setLoadError(false);
            void file.refetch();
          }}
        >
          {t("rooms.retry")}
        </button>
      </div>
    );
  }

  const empty = !!doc && pageCount === 0;
  const inkOn = !!ink.tool;
  const onInkError = (error: unknown) => setInkError(tError(error));

  const stage = (
    // Left-to-right whatever the page around it: a canvas that inherits
    // right-to-left draws every letter of the PDF apart, and the page
    // would open scrolled to its far edge.
    <div
      key="stage"
      ref={stageRef}
      className={`${s.pStage} ${inkOn ? s.pStageInk : ""}`}
      dir="ltr"
      onScroll={onScroll}
      // With a tool in hand a touch on the page is ink, not "show the
      // controls".
      onPointerDown={inkOn ? undefined : chrome?.onStagePointerDown}
      onPointerUp={inkOn ? undefined : chrome?.onStagePointerUp}
      onPointerMove={event => {
        // A mouse moving is a reader reaching for the tools; a finger
        // moving is a reader reading.
        if (event.pointerType === "mouse") chrome?.wake();
      }}
    >
      {empty ? (
        <p className={s.stageNote} role="status" dir="auto">
          {t("present.emptyFile")}
        </p>
      ) : doc && width ? (
        <div ref={columnRef} className={s.pColumn} style={{ paddingTop: top }}>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map(n => (
            <PageSlot
              key={n}
              doc={doc}
              n={n}
              width={width}
              aspect={aspectOf(n)}
              near={Math.abs(n - visible) <= NEAR}
              onAspect={onAspect}
              label={t("desk.pageOf", { page: n, total: pageCount })}
              roomId={roomId}
              roomSeq={roomSeq}
              ink={ink}
              myUserId={myUserId}
              canDeleteAny={canDeleteAnyMark}
              onError={onInkError}
            />
          ))}
        </div>
      ) : (
        <p className={s.stageNote} role="status" dir="auto">
          <Loader2 size={22} className="spin" aria-hidden="true" />
          {percent === null
            ? t("file.opening")
            : t("file.openingPercent", { percent })}
        </p>
      )}
    </div>
  );

  // The tools stay while what the lasso caught is chosen, and while
  // something went wrong that they explain.
  const shown = (chrome ? chrome.shown : true) || busy;
  const touch = chrome?.wake ?? (() => {});
  return (
    <div ref={frameRef} className={s.pReader}>
      {stage}
      {showInk && doc && !empty ? (
        <InkBar roomId={roomId} ink={ink} onError={onInkError} />
      ) : null}
      {away ? (
        <button
          type="button"
          className={`${s.rejoin} ${s.pRejoin} ${showInk ? s.pRejoinLow : ""}`}
          onClick={() => setOwnPage(null)}
        >
          <Users size={16} aria-hidden="true" />
          {t("desk.backToRoom", { page: roomPage })}
        </button>
      ) : null}
      <div
        className={`${s.pTools} ${chrome ? s.pToolsDocked : ""} ${
          shown ? "" : s.pToolsHidden
        }`}
        // Hidden tools are out of the way of the finger and the keyboard.
        inert={!shown}
        onPointerDown={touch}
        onPointerMove={touch}
        onFocus={touch}
      >
        {inkError ? (
          <p className={s.errorNote} role="alert">
            {inkError}{" "}
            <button
              type="button"
              className={s.msgRetry}
              onClick={() => setInkError(null)}
            >
              {t("ink.done")}
            </button>
          </p>
        ) : null}
        {setPage.error ? (
          <p className={s.errorNote} role="alert">
            {tError(setPage.error)}
          </p>
        ) : null}
        <div className={s.pToolsRow}>
          <button
            type="button"
            className={s.iconBtn}
            aria-label={t("desk.prev")}
            disabled={!mayMove || !doc || page <= 1}
            onClick={() => go(page - 1)}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          <span className={s.pageNo} dir="ltr" aria-live="polite">
            {page} / {pageCount || "…"}
          </span>
          <button
            type="button"
            className={s.iconBtn}
            aria-label={t("desk.next")}
            disabled={!mayMove || !doc || page >= pageCount}
            onClick={() => go(page + 1)}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <i className={s.pToolsGap} aria-hidden="true" />
          <button
            type="button"
            className={s.iconBtn}
            aria-label={t("desk.zoomOut")}
            disabled={!doc || zoom <= ZOOM_MIN}
            onClick={() => setZoom(clampZoom(zoom - ZOOM_STEP))}
          >
            <Minus size={18} aria-hidden="true" />
          </button>
          <span className={s.zoomNo} aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className={s.iconBtn}
            aria-label={t("desk.zoomIn")}
            disabled={!doc || zoom >= ZOOM_MAX}
            onClick={() => setZoom(clampZoom(zoom + ZOOM_STEP))}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={s.iconBtn}
            aria-label={t("present.fit")}
            title={t("present.fit")}
            disabled={!doc || zoom === 1}
            onClick={() => setZoom(1)}
          >
            <MoveHorizontal size={18} aria-hidden="true" />
          </button>
          {canFull ? (
            <button
              type="button"
              className={s.iconBtn}
              aria-label={full ? t("desk.exitFull") : t("desk.full")}
              onClick={toggleFull}
            >
              {full ? (
                <Minimize2 size={18} aria-hidden="true" />
              ) : (
                <Maximize2 size={18} aria-hidden="true" />
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
