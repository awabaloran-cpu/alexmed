"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Highlighter,
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
import {
  MarkLayer,
  MarkTools,
  useRoomMarks,
  type MarkColor,
} from "./RoomMarks";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// 1 is "fit to width": the page as wide as the place it has.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const clampZoom = (value: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
// The floating tools of the presentation step aside this long after the
// last touch.
const TOOLS_HIDE_MS = 2800;

export type DeskInfo = { page: number; pageCount: number; away: boolean };

// The room's controls over the file, held by the room's page so that the
// header, the dock and these tools step aside and come back together: a
// tap on the page shows / hides them all.
export type DeskChrome = {
  shown: boolean;
  wake: () => void;
  onStagePointerDown: (event: React.PointerEvent) => void;
  onStagePointerUp: (event: React.PointerEvent) => void;
  // A highlight is being drawn or chosen: everything stays in sight.
  onBusy: (busy: boolean) => void;
};

// 📄 The room's desk: the shared file, one page at a time, and the page
// everyone follows.
//
// `sharedPage` comes from the room's own state, read every few seconds
// (LiveRoom), so a member who joins late, reconnects or opens a second tab
// lands on the page the room is on — there is nothing to replay. Whoever
// leads the page moves everyone; a member allowed to move on their own
// keeps their place until they press "back to the room's page".
//
// The file is read for display only, through the same checked route every
// file goes through, and only while the student is in the room (the server
// stops answering the moment they leave — lib/study-rooms/live.ts).
//
// `present` is the presentation: the page takes the whole of its place,
// edge to edge, and the tools float over it and step aside while reading
// (LiveRoom puts the small header above). Without it this is the card
// inside the room's page.
export default function RoomDesk({
  roomId,
  bookId,
  sharedPage,
  canLead,
  canMoveFreely,
  canChoose,
  onChoose,
  onPage,
  jump,
  roomSeq,
  myUserId,
  canMark,
  canDeleteAnyMark,
  present = false,
  onInfo,
  chrome,
}: {
  roomId: string;
  bookId: string | null;
  sharedPage: number;
  canLead: boolean;
  canMoveFreely: boolean;
  canChoose: boolean;
  onChoose: () => void;
  // The page this member is looking at (for a chat message's page).
  onPage: (page: number) => void;
  // "Go to this page" from outside (a chat message): a new object each time.
  jump: { page: number } | null;
  // Shared highlights.
  roomSeq: number;
  myUserId: string;
  canMark: boolean;
  canDeleteAnyMark: boolean;
  present?: boolean;
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
  const [width, setWidth] = useState(0);
  // A page that would not draw, and "try again" (a new number each time).
  const [pageError, setPageError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [toolsShown, setToolsShown] = useState(true);
  const hideTimer = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const taskRef = useRef<RenderTask | null>(null);

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
        if (cancelled) void loaded.loadingTask.destroy();
        else setDoc(loaded);
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
  }, [bookId]);
  // The server has caught up with what the leader asked for.
  useEffect(() => {
    if (pending !== null && pending === sharedPage) setPending(null);
  }, [pending, sharedPage]);

  const [drawing, setDrawing] = useState(false);
  const [markColor, setMarkColor] = useState<MarkColor>("yellow");
  const [selectedMark, setSelectedMark] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);

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
  const marks = useRoomMarks(roomId, page, roomSeq, !!bookId && !!doc);
  // A highlight chosen on one page says nothing about the next.
  useEffect(() => {
    setSelectedMark(null);
  }, [page, bookId]);

  // The page is drawn to the width it has.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // Measured at once, then watched: the first page is drawn without
    // waiting for the observer's first report.
    setWidth(Math.floor(stage.clientWidth));
    const observer = new ResizeObserver(entries => {
      setWidth(Math.floor(entries[0].contentRect.width));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [doc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas || !width) return;
    let cancelled = false;
    setPageError(false);
    const failed = () => {
      if (!cancelled) setPageError(true);
    };
    void doc.getPage(page).then(pdfPage => {
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = (width / base.width) * zoom;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: scale * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
      canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      taskRef.current?.cancel();
      const task = pdfPage.render({ canvasContext: context, viewport, canvas });
      taskRef.current = task;
      // A cancelled drawing (the next page, another zoom) is not a failure.
      task.promise.catch((error: { name?: string }) => {
        if (error?.name !== "RenderingCancelledException") failed();
      });
    }, failed);
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [doc, page, width, zoom, attempt]);

  // The tools come back at a touch and step aside again while reading.
  const wake = useCallback(() => {
    setToolsShown(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(
      () => setToolsShown(false),
      TOOLS_HIDE_MS
    );
  }, []);
  useEffect(() => {
    // The room's page holds them when it shares them (`chrome`).
    if (present && !chrome) wake();
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [present, wake, page, chrome]);
  // Drawing or choosing a highlight, or a problem the tools explain: the
  // room keeps every control in sight.
  const onBusy = chrome?.onBusy;
  const busy =
    drawing || !!selectedMark || !!markError || setPage.error !== null;
  useEffect(() => {
    onBusy?.(busy);
  }, [onBusy, busy]);
  useEffect(() => () => onBusy?.(false), [onBusy]);

  // Two fingers zoom the page: it follows the fingers at once, and is
  // drawn sharp at the new size when they lift. One finger scrolls (pans),
  // which the browser does itself.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !doc) return;
    let start: { distance: number; zoom: number } | null = null;
    let ratio = 1;
    const distance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      start = { distance: distance(event.touches), zoom: zoomRef.current };
      ratio = 1;
    };
    const onMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 2) return;
      event.preventDefault();
      const wanted = clampZoom(
        (start.zoom * distance(event.touches)) / start.distance
      );
      ratio = wanted / start.zoom;
      if (sheetRef.current) {
        sheetRef.current.style.transformOrigin = "0 0";
        sheetRef.current.style.transform = `scale(${ratio})`;
      }
    };
    const onEnd = () => {
      if (!start) return;
      const next = clampZoom(start.zoom * ratio);
      start = null;
      if (sheetRef.current) sheetRef.current.style.transform = "";
      setZoom(next);
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
      if (event.key === "PageDown") go(page + 1);
      else if (event.key === "PageUp") go(page - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mayMove, doc, go, page]);

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
      (present ? frame?.closest<HTMLElement>("[data-rooms-root]") : null) ??
      frame;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void target?.requestFullscreen?.().catch(() => undefined);
  };
  // iPhone has no full screen for a page's own element: no button there.
  const [canFull, setCanFull] = useState(false);
  useEffect(() => setCanFull(!!document.fullscreenEnabled), []);

  if (!bookId) {
    return (
      <div className={s.desk}>
        <FileText size={26} aria-hidden="true" />
        <p>{canChoose ? t("live.noFileHost") : t("live.noFile")}</p>
        {canChoose ? (
          <button
            type="button"
            className={`${s.btn} ${s.primary}`}
            onClick={onChoose}
          >
            {t("file.choose")}
          </button>
        ) : null}
      </div>
    );
  }

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

  const markProps = {
    roomId,
    marks,
    selectedId: selectedMark,
    onSelect: setSelectedMark,
    onError: (error: unknown) => setMarkError(tError(error)),
  };

  const empty = !!doc && pageCount === 0;
  const stage = (
    // Left-to-right whatever the page around it: a canvas that inherits
    // right-to-left draws every letter of the PDF apart, and the page
    // would open scrolled to its far edge.
    <div
      key="stage"
      ref={stageRef}
      className={present ? s.pStage : s.stage}
      dir="ltr"
      onPointerDown={
        present ? (chrome ? chrome.onStagePointerDown : wake) : undefined
      }
      onPointerUp={present && chrome ? chrome.onStagePointerUp : undefined}
      onPointerMove={
        present
          ? event => {
              // A mouse moving is a reader reaching for the tools; a finger
              // moving is a reader reading.
              if (event.pointerType === "mouse") (chrome?.wake ?? wake)();
            }
          : undefined
      }
    >
      {empty ? (
        <p className={s.stageNote} role="status" dir="auto">
          {t("present.emptyFile")}
        </p>
      ) : doc ? (
        <div ref={sheetRef} className={s.sheetOfPage}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={t("desk.pageOf", { page, total: pageCount })}
          />
          <MarkLayer
            {...markProps}
            page={page}
            drawing={drawing && canMark}
            color={markColor}
          />
          {pageError ? (
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

  const rejoinButton = away ? (
    <button
      type="button"
      className={`${s.rejoin} ${present ? s.pRejoin : ""}`}
      onClick={() => setOwnPage(null)}
    >
      <Users size={16} aria-hidden="true" />
      {t("desk.backToRoom", { page: roomPage })}
    </button>
  ) : null;

  const markTools = (
    <MarkTools
      {...markProps}
      canMark={canMark && !!doc && !empty}
      canDeleteAny={canDeleteAnyMark}
      myUserId={myUserId}
      drawing={drawing}
      onDrawing={on => {
        setMarkError(null);
        setDrawing(on);
      }}
      color={markColor}
      onColor={setMarkColor}
    />
  );

  const prevButton = (
    <button
      type="button"
      className={s.iconBtn}
      aria-label={t("desk.prev")}
      disabled={!mayMove || !doc || page <= 1}
      onClick={() => go(page - 1)}
    >
      <ChevronRight size={20} aria-hidden="true" />
    </button>
  );
  const nextButton = (
    <button
      type="button"
      className={s.iconBtn}
      aria-label={t("desk.next")}
      disabled={!mayMove || !doc || page >= pageCount}
      onClick={() => go(page + 1)}
    >
      <ChevronLeft size={20} aria-hidden="true" />
    </button>
  );
  const zoomOutButton = (
    <button
      type="button"
      className={s.iconBtn}
      aria-label={t("desk.zoomOut")}
      disabled={!doc || zoom <= ZOOM_MIN}
      onClick={() => setZoom(clampZoom(zoom - ZOOM_STEP))}
    >
      <Minus size={18} aria-hidden="true" />
    </button>
  );
  const zoomInButton = (
    <button
      type="button"
      className={s.iconBtn}
      aria-label={t("desk.zoomIn")}
      disabled={!doc || zoom >= ZOOM_MAX}
      onClick={() => setZoom(clampZoom(zoom + ZOOM_STEP))}
    >
      <Plus size={18} aria-hidden="true" />
    </button>
  );
  const fitButton = (
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
  );
  const fullButton = canFull ? (
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
  ) : null;
  const zoomPercent = (
    <span className={s.zoomNo} aria-live="polite">
      {Math.round(zoom * 100)}%
    </span>
  );
  const errors = (
    <>
      {markError ? (
        <p className={s.errorNote} role="alert">
          {markError}
        </p>
      ) : null}
      {setPage.error ? (
        <p className={s.errorNote} role="alert">
          {tError(setPage.error)}
        </p>
      ) : null}
    </>
  );

  if (present) {
    // The tools stay while a highlight is being drawn or one is chosen,
    // and while something went wrong that they explain.
    const shown =
      (chrome ? chrome.shown : toolsShown) ||
      drawing ||
      !!selectedMark ||
      !!markError ||
      !!setPage.error;
    const touch = chrome?.wake ?? wake;
    return (
      <div ref={frameRef} className={s.pReader}>
        {stage}
        {rejoinButton}
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
          {errors}
          {drawing || selectedMark ? (
            <div className={s.pToolsRow}>{markTools}</div>
          ) : null}
          <div className={s.pToolsRow}>
            {prevButton}
            <span className={s.pageNo} dir="ltr" aria-live="polite">
              {page} / {pageCount || "…"}
            </span>
            {nextButton}
            <i className={s.pToolsGap} aria-hidden="true" />
            {zoomOutButton}
            {zoomPercent}
            {zoomInButton}
            {fitButton}
            {fullButton}
            {canMark && doc && !empty && !drawing ? (
              <button
                type="button"
                className={s.iconBtn}
                aria-label={t("mark.start")}
                title={t("mark.start")}
                onClick={() => {
                  setMarkError(null);
                  setDrawing(true);
                }}
              >
                <Highlighter size={18} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={frameRef} className={`${s.reader} ${full ? s.readerFull : ""}`}>
      <div className={s.readerBar}>
        <span className={s.readerName} dir="auto" title={file.data?.fileName}>
          {file.data?.fileName ?? ""}
        </span>
        {canChoose ? (
          <button type="button" className={s.readerLink} onClick={onChoose}>
            {t("file.change")}
          </button>
        ) : null}
      </div>

      {stage}
      {rejoinButton}
      {markTools}

      <div className={s.readerTools}>
        <div className={s.pager}>
          {prevButton}
          <span className={s.pageNo} aria-live="polite">
            {t("desk.pageOf", { page, total: pageCount || "…" })}
          </span>
          {nextButton}
        </div>
        <div className={s.pager}>
          {zoomOutButton}
          {zoomPercent}
          {zoomInButton}
          {fitButton}
          {fullButton}
        </div>
      </div>

      <p className={s.meta}>
        {canLead
          ? ownPage === null
            ? t("desk.youLead")
            : t("desk.youAway")
          : canMoveFreely
            ? t("desk.freeNav")
            : t("desk.following")}
      </p>
      {errors}
    </div>
  );
}
