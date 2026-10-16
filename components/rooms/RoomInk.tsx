"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import {
  Check,
  Eraser,
  Highlighter,
  Lasso,
  PenLine,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { StudyInkPoint } from "@/drizzle/schema";
import {
  boundsOf,
  inLasso,
  INK_COLORS,
  INK_MAX_POINTS,
  INK_WIDTHS,
  simplifyPoints,
  straighten,
  touches,
  type InkTool,
} from "@/lib/study-rooms/ink";
import type { AppRouter } from "@/lib/trpc/router";
import { trpc } from "@/lib/trpc-client";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// 🖊 The room's ink over the shared file: the pen, the highlighter, the
// eraser and the lasso (lib/study-rooms/ink.ts is what the server accepts).
// Everything drawn is everyone's, with its author, like the highlights; the
// server decides who may draw and who may move or rub out what.

export type InkRow = inferRouterOutputs<AppRouter>["rooms"]["ink"][number];
export type InkToolName = InkTool | "eraser" | "lasso";
type Style = { color: string; width: number };

const STYLE_KEY = "nl-room-ink";
// The highlights made before the pen, drawn in their own four colours.
const RECT_COLORS: Record<string, string> = {
  yellow: "#ffd43b",
  green: "#51cf66",
  pink: "#ff8fab",
  blue: "#74c0fc",
};
// How far around the finger the eraser reaches, in page widths.
const ERASER_REACH = 0.012;

const newClientId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const defaultStyles = (): Record<InkTool, Style> => ({
  pen: { color: INK_COLORS.pen[0], width: INK_WIDTHS.pen[1] },
  highlighter: {
    color: INK_COLORS.highlighter[0],
    width: INK_WIDTHS.highlighter[1],
  },
});

// What the student holds: the tool, the look of each pen (remembered on
// the device), what the lasso caught and what they may take back.
export function useInk() {
  const [tool, setTool] = useState<InkToolName | null>(null);
  const [styles, setStyles] = useState(defaultStyles);
  const [selection, setSelection] = useState<{
    page: number;
    ids: string[];
  } | null>(null);
  const [undo, setUndo] = useState<{ page: number; id: string }[]>([]);
  // Said once a tool is taken, until it is first used.
  const [hint, setHint] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STYLE_KEY) ?? "null");
      const valid = (tool: InkTool) =>
        saved?.[tool] &&
        INK_COLORS[tool].includes(saved[tool].color) &&
        INK_WIDTHS[tool].includes(saved[tool].width);
      if (valid("pen") || valid("highlighter")) {
        const fallback = defaultStyles();
        setStyles({
          pen: valid("pen") ? saved.pen : fallback.pen,
          highlighter: valid("highlighter")
            ? saved.highlighter
            : fallback.highlighter,
        });
      }
    } catch {
      // Nothing remembered: the first colours.
    }
  }, []);
  const setStyle = useCallback((tool: InkTool, style: Style) => {
    setStyles(current => {
      const next = { ...current, [tool]: style };
      try {
        localStorage.setItem(STYLE_KEY, JSON.stringify(next));
      } catch {
        // Remembered for this visit only.
      }
      return next;
    });
  }, []);
  const choose = useCallback((next: InkToolName | null) => {
    setTool(next);
    setSelection(null);
    setHint(next !== null);
  }, []);
  return {
    tool,
    choose,
    styles,
    setStyle,
    selection,
    setSelection,
    undo,
    remember: (page: number, id: string) =>
      setUndo(stack => [...stack.slice(-99), { page, id }]),
    forget: (ids: string[]) =>
      setUndo(stack => stack.filter(entry => !ids.includes(entry.id))),
    hint,
    used: () => setHint(false),
  };
}
export type Ink = ReturnType<typeof useInk>;

// The page's ink, read again whenever the room moves on.
export function usePageInk(
  roomId: string,
  page: number,
  roomSeq: number,
  enabled: boolean
) {
  const ink = trpc.rooms.ink.useQuery(
    { roomId, page },
    { enabled, staleTime: Infinity }
  );
  const refetch = ink.refetch;
  useEffect(() => {
    if (enabled) void refetch();
  }, [roomSeq, enabled, refetch]);
  return ink;
}

const n1 = (value: number) => Math.round(value * 10) / 10;

// A smooth line through the points, in the layer's units (1000 across).
function pathOf(points: StudyInkPoint[], height: number): string {
  const p = points.map(([x, y]) => [n1(x * 1000), n1(y * height)] as const);
  if (p.length === 1) return `M${p[0][0]} ${p[0][1]}l0.01 0`;
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = n1((p[i][0] + p[i + 1][0]) / 2);
    const my = n1((p[i][1] + p[i + 1][1]) / 2);
    d += `Q${p[i][0]} ${p[i][1]} ${mx} ${my}`;
  }
  const last = p[p.length - 1];
  return `${d}L${last[0]} ${last[1]}`;
}

function Mark({ mark, height }: { mark: InkRow; height: number }) {
  if (mark.kind === "rect" || !mark.points?.length) {
    return (
      <g className={s.inkSoft}>
        {mark.rects.map((rect, index) => (
          <rect
            key={index}
            x={rect.x * 1000}
            y={rect.y * height}
            width={rect.w * 1000}
            height={rect.h * height}
            rx={3}
            fill={RECT_COLORS[mark.color] ?? RECT_COLORS.yellow}
          />
        ))}
      </g>
    );
  }
  return (
    <path
      className={mark.kind === "highlighter" ? s.inkSoft : undefined}
      d={pathOf(mark.points, height)}
      stroke={mark.color}
      strokeWidth={mark.width ?? 4}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

type Pending = {
  clientId: string;
  kind: InkTool;
  color: string;
  width: number;
  points: StudyInkPoint[];
};

// What is drawn over one page, and — with a tool in hand — the finger
// that draws, rubs out or lassos on it. `aspect` is the page's height over
// its width.
export function PageInk({
  roomId,
  page,
  aspect,
  ink,
  marks,
  myUserId,
  canDeleteAny,
  onError,
}: {
  roomId: string;
  page: number;
  aspect: number;
  ink: Ink;
  marks: InkRow[];
  myUserId: string;
  canDeleteAny: boolean;
  onError: (error: unknown) => void;
}) {
  const utils = trpc.useUtils();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const height = 1000 * aspect;
  const pointers = useRef(new Set<number>());
  const gesture = useRef<"draw" | "erase" | "lasso" | "drag" | null>(null);
  const [draft, setDraft] = useState<StudyInkPoint[] | null>(null);
  const [lasso, setLasso] = useState<StudyInkPoint[] | null>(null);
  const [drag, setDrag] = useState<{
    from: StudyInkPoint;
    dx: number;
    dy: number;
  } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  // The gesture as it happens, read when the finger lifts: the state above
  // only draws it, and may not have caught up with a fast stroke yet.
  const trail = useRef<StudyInkPoint[]>([]);
  const dragging = useRef<{
    from: StudyInkPoint;
    dx: number;
    dy: number;
  } | null>(null);
  const erased = useRef(new Set<string>());
  // Where the eraser last was: a fast swipe is rubbed out all along.
  const rubbed = useRef<StudyInkPoint | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const refresh = () => utils.rooms.ink.invalidate({ roomId, page });

  const add = trpc.rooms.addStroke.useMutation();
  const edit = trpc.rooms.editInk.useMutation();
  const remove = trpc.rooms.deleteInk.useMutation();

  const editable = (mark: InkRow) => mark.userId === myUserId || canDeleteAny;
  const tool = ink.tool;
  const selected =
    ink.selection?.page === page ? new Set(ink.selection.ids) : null;
  const selectedMarks = selected
    ? marks.filter(mark => selected.has(mark.id))
    : [];
  const frame = boundsOf(selectedMarks);

  const pointOf = (event: React.PointerEvent): StudyInkPoint => {
    const box = svgRef.current!.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return [
      clamp((event.clientX - box.left) / box.width),
      clamp((event.clientY - box.top) / box.height),
    ];
  };

  const eraseAt = (point: StudyInkPoint) => {
    const caught = marks.filter(
      mark =>
        editable(mark) &&
        !erased.current.has(mark.id) &&
        touches(mark, point, aspect, ERASER_REACH)
    );
    if (caught.length) {
      for (const mark of caught) erased.current.add(mark.id);
      setHidden(new Set(erased.current));
    }
  };

  const eraseAlong = (point: StudyInkPoint) => {
    const from = rubbed.current ?? point;
    rubbed.current = point;
    const dx = point[0] - from[0];
    const dy = (point[1] - from[1]) * aspect;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.005));
    for (let i = 1; i <= steps; i++) {
      eraseAt([
        from[0] + ((point[0] - from[0]) * i) / steps,
        from[1] + ((point[1] - from[1]) * i) / steps,
      ]);
    }
  };

  const cancel = () => {
    if (gesture.current === "erase") {
      erased.current = new Set();
      setHidden(new Set());
    }
    gesture.current = null;
    trail.current = [];
    dragging.current = null;
    setDraft(null);
    setLasso(null);
    setDrag(null);
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!tool) return;
    pointers.current.add(event.pointerId);
    // A second finger is the page moving, not ink.
    if (pointers.current.size > 1) {
      cancel();
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the stroke still draws.
    }
    ink.used();
    const point = pointOf(event);
    if (tool === "pen" || tool === "highlighter") {
      gesture.current = "draw";
      trail.current = [point];
      setDraft([point]);
    } else if (tool === "eraser") {
      gesture.current = "erase";
      erased.current = new Set();
      rubbed.current = null;
      eraseAlong(point);
    } else if (
      frame &&
      point[0] >= frame.x - 0.02 &&
      point[0] <= frame.x + frame.w + 0.02 &&
      point[1] >= frame.y - 0.02 &&
      point[1] <= frame.y + frame.h + 0.02
    ) {
      gesture.current = "drag";
      dragging.current = { from: point, dx: 0, dy: 0 };
      setDrag(dragging.current);
    } else {
      gesture.current = "lasso";
      ink.setSelection(null);
      trail.current = [point];
      setLasso([point]);
    }
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!gesture.current || pointers.current.size > 1) return;
    const point = pointOf(event);
    if (gesture.current === "draw" || gesture.current === "lasso") {
      const list = trail.current;
      const last = list[list.length - 1];
      if (
        last &&
        Math.hypot(point[0] - last[0], (point[1] - last[1]) * aspect) <= 0.0015
      ) {
        return;
      }
      list.push(point);
      if (gesture.current === "draw") setDraft([...list]);
      else setLasso([...list]);
    } else if (gesture.current === "erase") {
      eraseAlong(point);
    } else if (gesture.current === "drag" && dragging.current) {
      dragging.current = {
        ...dragging.current,
        dx: point[0] - dragging.current.from[0],
        dy: point[1] - dragging.current.from[1],
      };
      setDrag(dragging.current);
    }
  };

  const finishDraw = (points: StudyInkPoint[]) => {
    if (tool !== "pen" && tool !== "highlighter") return;
    let line = simplifyPoints(points, aspect);
    if (tool === "highlighter") line = straighten(line, aspect);
    if (line.length > INK_MAX_POINTS) {
      const step = Math.ceil(line.length / INK_MAX_POINTS);
      line = line.filter(
        (_, index) => index % step === 0 || index === line.length - 1
      );
    }
    const style = ink.styles[tool];
    const stroke: Pending = {
      clientId: newClientId(),
      kind: tool,
      color: style.color,
      width: style.width,
      points: line,
    };
    setPending(list => [...list, stroke]);
    const drop = () =>
      setPending(list =>
        list.filter(item => item.clientId !== stroke.clientId)
      );
    add.mutate(
      {
        roomId,
        page,
        tool,
        color: stroke.color,
        width: stroke.width,
        points: line,
        clientId: stroke.clientId,
      },
      {
        onSuccess: async result => {
          ink.remember(page, result.id);
          await refresh();
          drop();
        },
        onError: error => {
          drop();
          onError(error);
        },
      }
    );
  };

  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    const kind = gesture.current;
    gesture.current = null;
    const points = trail.current;
    trail.current = [];
    const moved = dragging.current;
    dragging.current = null;
    if (kind === "draw" && points.length) {
      setDraft(null);
      finishDraw(points);
    } else if (kind === "erase") {
      const ids = [...erased.current];
      erased.current = new Set();
      if (!ids.length) return;
      remove.mutate(
        { roomId, ids },
        {
          onSuccess: async () => {
            ink.forget(ids);
            await refresh();
            setHidden(new Set());
          },
          onError: error => {
            setHidden(new Set());
            onError(error);
          },
        }
      );
    } else if (kind === "lasso") {
      setLasso(null);
      const ids = marks
        .filter(mark => editable(mark) && inLasso(mark, points))
        .map(mark => mark.id);
      ink.setSelection(ids.length ? { page, ids } : null);
    } else if (kind === "drag" && moved && selected) {
      if (Math.abs(moved.dx) + Math.abs(moved.dy) < 0.002) {
        setDrag(null);
        return;
      }
      edit.mutate(
        { roomId, ids: [...selected], dx: moved.dx, dy: moved.dy },
        {
          onSuccess: async () => {
            await refresh();
            setDrag(null);
          },
          onError: error => {
            setDrag(null);
            onError(error);
          },
        }
      );
    }
  };

  const onPointerCancel = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    cancel();
  };

  // The highlights and the highlighter under the pen's writing.
  const shown = marks
    .filter(mark => !hidden.has(mark.id))
    .sort((a, b) => Number(a.kind === "pen") - Number(b.kind === "pen"));
  const move = drag
    ? `translate(${n1(drag.dx * 1000)} ${n1(drag.dy * height)})`
    : undefined;
  const draftStyle =
    tool === "pen" || tool === "highlighter" ? ink.styles[tool] : null;

  return (
    <svg
      ref={svgRef}
      className={`${s.inkLayer} ${tool ? s.inkLayerOn : ""} ${
        tool === "eraser" ? s.inkErase : ""
      }`}
      viewBox={`0 0 1000 ${n1(height)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {shown
        .filter(mark => !selected?.has(mark.id))
        .map(mark => (
          <Mark key={mark.id} mark={mark} height={height} />
        ))}
      {pending.map(stroke => (
        <Mark
          key={stroke.clientId}
          mark={{ ...(stroke as unknown as InkRow), rects: [] }}
          height={height}
        />
      ))}
      {selectedMarks.length ? (
        <g transform={move}>
          {shown
            .filter(mark => selected?.has(mark.id))
            .map(mark => (
              <Mark key={mark.id} mark={mark} height={height} />
            ))}
          {frame ? (
            <rect
              className={s.inkFrame}
              x={frame.x * 1000 - 6}
              y={frame.y * height - 6}
              width={frame.w * 1000 + 12}
              height={frame.h * height + 12}
              rx={6}
            />
          ) : null}
        </g>
      ) : null}
      {draft && draftStyle ? (
        <path
          className={tool === "highlighter" ? s.inkSoft : undefined}
          d={pathOf(draft, height)}
          stroke={draftStyle.color}
          strokeWidth={draftStyle.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}
      {lasso && lasso.length > 1 ? (
        <path
          className={s.inkLasso}
          d={`${pathOf(lasso, height)}Z`}
          fill="none"
        />
      ) : null}
    </svg>
  );
}

const TOOLS: { name: InkToolName; Icon: typeof PenLine; label: string }[] = [
  { name: "pen", Icon: PenLine, label: "ink.pen" },
  { name: "highlighter", Icon: Highlighter, label: "ink.highlighter" },
  { name: "eraser", Icon: Eraser, label: "ink.eraser" },
  { name: "lasso", Icon: Lasso, label: "ink.lasso" },
];

// 🧰 The writing tools: one small bar at the top of the file. A tool is
// taken with a tap and put down with "done"; the pen's colour and size open
// under it; what the lasso caught gets its own row (look, tool, delete).
export function InkBar({
  roomId,
  ink,
  onError,
}: {
  roomId: string;
  ink: Ink;
  onError: (error: unknown) => void;
}) {
  const { t } = useRooms();
  const utils = trpc.useUtils();
  const [styleOpen, setStyleOpen] = useState(false);
  const selectionPage = ink.selection?.page ?? 0;
  const pageInk = trpc.rooms.ink.useQuery(
    { roomId, page: selectionPage || 1 },
    { enabled: !!ink.selection, staleTime: Infinity }
  );
  const picked = (pageInk.data ?? []).filter(mark =>
    ink.selection?.ids.includes(mark.id)
  );
  const edit = trpc.rooms.editInk.useMutation({ onError });
  const remove = trpc.rooms.deleteInk.useMutation({ onError });
  const refresh = (page: number) =>
    utils.rooms.ink.invalidate({ roomId, page });

  const pen =
    ink.tool === "pen" || ink.tool === "highlighter" ? ink.tool : null;
  const style = pen ? ink.styles[pen] : null;

  const undo = () => {
    const last = ink.undo[ink.undo.length - 1];
    if (!last) return;
    ink.forget([last.id]);
    remove.mutate(
      { roomId, ids: [last.id] },
      { onSuccess: () => refresh(last.page) }
    );
  };

  // The selection's own look: the tool and colours they share, if they do.
  const strokes = picked.filter(mark => mark.kind !== "rect");
  const kinds = new Set(strokes.map(mark => mark.kind as InkTool));
  const shared = kinds.size === 1 ? [...kinds][0] : null;
  const names = new Set(picked.map(mark => mark.name ?? ""));
  const restyle = (change: {
    tool?: InkTool;
    color?: string;
    width?: number;
  }) => {
    if (!ink.selection) return;
    const { page, ids } = ink.selection;
    edit.mutate({ roomId, ids, ...change }, { onSuccess: () => refresh(page) });
  };

  return (
    <div className={s.inkBar} role="toolbar" aria-label={t("ink.tools")}>
      <div className={s.inkRow}>
        {TOOLS.map(({ name, Icon, label }) => (
          <button
            key={name}
            type="button"
            className={`${s.inkBtn} ${ink.tool === name ? s.inkBtnOn : ""}`}
            aria-pressed={ink.tool === name}
            aria-label={t(label as "ink.pen")}
            title={t(label as "ink.pen")}
            onClick={() => {
              setStyleOpen(false);
              ink.choose(ink.tool === name ? null : name);
            }}
          >
            <Icon size={19} aria-hidden="true" />
          </button>
        ))}
        {style ? (
          <button
            type="button"
            className={s.inkBtn}
            aria-expanded={styleOpen}
            aria-label={t("ink.style")}
            title={t("ink.style")}
            onClick={() => setStyleOpen(open => !open)}
          >
            <i
              className={s.inkDot}
              style={{
                background: style.color,
                width: 8 + INK_WIDTHS[pen!].indexOf(style.width) * 5,
                height: 8 + INK_WIDTHS[pen!].indexOf(style.width) * 5,
              }}
              aria-hidden="true"
            />
          </button>
        ) : null}
        {ink.undo.length ? (
          <button
            type="button"
            className={s.inkBtn}
            aria-label={t("ink.undo")}
            title={t("ink.undo")}
            disabled={remove.isPending}
            onClick={undo}
          >
            <Undo2 size={19} aria-hidden="true" />
          </button>
        ) : null}
        {ink.tool ? (
          <button
            type="button"
            className={`${s.inkBtn} ${s.inkDone}`}
            aria-label={t("ink.done")}
            title={t("ink.done")}
            onClick={() => {
              setStyleOpen(false);
              ink.choose(null);
            }}
          >
            <Check size={19} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {style && styleOpen ? (
        <div className={`${s.inkRow} ${s.inkRowWrap}`}>
          {INK_COLORS[pen!].map((color, index) => (
            <button
              key={color}
              type="button"
              className={`${s.inkSwatch} ${
                style.color === color ? s.inkSwatchOn : ""
              }`}
              style={{ background: color }}
              aria-pressed={style.color === color}
              aria-label={t("ink.color", { n: index + 1 })}
              onClick={() => ink.setStyle(pen!, { ...style, color })}
            />
          ))}
          <i className={s.pToolsGap} aria-hidden="true" />
          {INK_WIDTHS[pen!].map((width, index) => (
            <button
              key={width}
              type="button"
              className={`${s.inkBtn} ${
                style.width === width ? s.inkBtnOn : ""
              }`}
              aria-pressed={style.width === width}
              aria-label={t("ink.size", { n: index + 1 })}
              onClick={() => ink.setStyle(pen!, { ...style, width })}
            >
              <i
                className={s.inkDot}
                style={{
                  background: style.color,
                  width: 6 + index * 6,
                  height: 6 + index * 6,
                }}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      ) : null}

      {ink.selection && picked.length ? (
        // Long: it goes on to a second line, the actions first.
        <div className={`${s.inkRow} ${s.inkRowWrap}`}>
          <span className={s.inkCount} dir="auto">
            {names.size === 1 && [...names][0]
              ? t("ink.selectedBy", { n: picked.length, name: [...names][0] })
              : t("ink.selected", { n: picked.length })}
          </span>
          {strokes.length ? (
            <button
              type="button"
              className={s.inkBtn}
              aria-label={
                shared === "pen" ? t("ink.toHighlighter") : t("ink.toPen")
              }
              title={shared === "pen" ? t("ink.toHighlighter") : t("ink.toPen")}
              disabled={edit.isPending}
              onClick={() => {
                const tool = shared === "pen" ? "highlighter" : "pen";
                restyle({ tool, width: INK_WIDTHS[tool][1] });
              }}
            >
              {shared === "pen" ? (
                <Highlighter size={19} aria-hidden="true" />
              ) : (
                <PenLine size={19} aria-hidden="true" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className={s.inkBtn}
            aria-label={t("ink.delete")}
            title={t("ink.delete")}
            disabled={remove.isPending}
            onClick={() => {
              if (!ink.selection) return;
              const { page, ids } = ink.selection;
              remove.mutate(
                { roomId, ids },
                {
                  onSuccess: () => {
                    ink.forget(ids);
                    ink.setSelection(null);
                    void refresh(page);
                  },
                }
              );
            }}
          >
            <Trash2 size={19} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={s.inkBtn}
            aria-label={t("ink.deselect")}
            title={t("ink.deselect")}
            onClick={() => ink.setSelection(null)}
          >
            <X size={19} aria-hidden="true" />
          </button>
          {shared
            ? INK_COLORS[shared].map((color, index) => (
                <button
                  key={color}
                  type="button"
                  className={s.inkSwatch}
                  style={{ background: color }}
                  aria-label={t("ink.color", { n: index + 1 })}
                  disabled={edit.isPending}
                  onClick={() => restyle({ color })}
                />
              ))
            : null}
          {shared
            ? INK_WIDTHS[shared].map((width, index) => (
                <button
                  key={width}
                  type="button"
                  className={s.inkBtn}
                  aria-label={t("ink.size", { n: index + 1 })}
                  disabled={edit.isPending}
                  onClick={() => restyle({ width })}
                >
                  <i
                    className={s.inkDot}
                    style={{
                      background: "currentColor",
                      width: 6 + index * 6,
                      height: 6 + index * 6,
                    }}
                    aria-hidden="true"
                  />
                </button>
              ))
            : null}
        </div>
      ) : null}

      {ink.hint && ink.tool ? (
        <p className={s.inkHint} role="status">
          {ink.tool === "lasso" ? t("ink.lassoHint") : t("ink.hint")}
        </p>
      ) : null}
    </div>
  );
}
