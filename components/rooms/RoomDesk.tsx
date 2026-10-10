"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Users,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { trpc } from "@/lib/trpc-client";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

const ZOOMS = [0.75, 1, 1.25, 1.5, 2];

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

  const pageCount = doc?.numPages ?? file.data?.pageCount ?? 0;
  const roomPage = pending ?? sharedPage;
  const page = Math.min(Math.max(1, ownPage ?? roomPage), pageCount || 1);
  const away = ownPage !== null && ownPage !== roomPage;

  useEffect(() => {
    onPage(page);
  }, [page, onPage]);

  // The page is drawn to the width it has.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
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
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [doc, page, width, zoom]);

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
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen?.().catch(() => undefined);
  };

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

  const zoomIndex = ZOOMS.indexOf(zoom);

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

      <div ref={stageRef} className={s.stage}>
        {doc ? (
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={t("desk.pageOf", { page, total: pageCount })}
          />
        ) : (
          <p className={s.stageNote} role="status">
            {percent === null
              ? t("file.opening")
              : t("file.openingPercent", { percent })}
          </p>
        )}
      </div>

      {away ? (
        <button
          type="button"
          className={s.rejoin}
          onClick={() => setOwnPage(null)}
        >
          <Users size={16} aria-hidden="true" />
          {t("desk.backToRoom", { page: roomPage })}
        </button>
      ) : null}

      <div className={s.readerTools}>
        <div className={s.pager}>
          <button
            type="button"
            className={s.iconBtn}
            aria-label={t("desk.prev")}
            disabled={!mayMove || !doc || page <= 1}
            onClick={() => go(page - 1)}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          <span className={s.pageNo} aria-live="polite">
            {t("desk.pageOf", { page, total: pageCount || "…" })}
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
        </div>
        <div className={s.pager}>
          <button
            type="button"
            className={s.iconBtn}
            aria-label={t("desk.zoomOut")}
            disabled={zoomIndex <= 0}
            onClick={() => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)])}
          >
            <Minus size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={s.iconBtn}
            aria-label={t("desk.zoomIn")}
            disabled={zoomIndex >= ZOOMS.length - 1}
            onClick={() =>
              setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)])
            }
          >
            <Plus size={18} aria-hidden="true" />
          </button>
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
      {setPage.error ? (
        <p className={s.errorNote} role="alert">
          {tError(setPage.error)}
        </p>
      ) : null}
    </div>
  );
}
