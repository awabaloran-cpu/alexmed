// 🖊 The room's ink: what the pen and the highlighter draw over the shared
// file, read by the server (what it accepts) and by the page (what it
// draws, rubs out and catches in a lasso) alike. Pure — no database here.
//
// Everything is in fractions of the page (0–1 of its width, 0–1 of its
// height), like the highlights' rectangles, so a stroke sits in the same
// place at any zoom and on any screen. A stroke's width is in thousandths
// of the page's width.
import type { StudyInkPoint, StudyMarkRect } from "../../drizzle/schema";

export type InkTool = "pen" | "highlighter";
export const INK_TOOLS: readonly InkTool[] = ["pen", "highlighter"];

// The palette: a colour outside it is refused (it reaches every member's
// screen, so it is a value from this list, never free text).
export const INK_COLORS: Record<InkTool, readonly string[]> = {
  pen: ["#1b2340", "#3355ff", "#dc3f46", "#0e9f6e", "#f08c00", "#7c3aed"],
  highlighter: ["#ffd43b", "#69db7c", "#f783ac", "#74c0fc", "#ffa94d"],
};
// Three sizes for each, offered by the page; the server takes any width in
// the range.
export const INK_WIDTHS: Record<InkTool, readonly number[]> = {
  pen: [2, 4, 7],
  highlighter: [14, 22, 32],
};
export const INK_WIDTH_MIN = 1;
export const INK_WIDTH_MAX = 40;

export const INK_MAX_POINTS = 1500;
// Strokes one member may leave in a room, on one page, and in a minute —
// handwriting is many strokes, so far more than highlights.
export const INK_PER_MEMBER = 1500;
export const INK_PER_PAGE = 800;
export const INK_PER_MINUTE = 240;
// Strokes changed or rubbed out in one go.
export const INK_EDIT_MAX = 200;

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const inUnit = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

// Points inside the page; anything else is refused whole.
export function cleanPoints(points: unknown): StudyInkPoint[] | null {
  if (
    !Array.isArray(points) ||
    !points.length ||
    points.length > INK_MAX_POINTS
  ) {
    return null;
  }
  const cleaned: StudyInkPoint[] = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2) return null;
    const [x, y] = point as unknown[];
    if (!inUnit(x) || !inUnit(y)) return null;
    cleaned.push([round(x), round(y)]);
  }
  return cleaned;
}

export const isInkColor = (tool: InkTool, color: string) =>
  INK_COLORS[tool].includes(color);

export const isInkWidth = (width: number) =>
  Number.isFinite(width) && width >= INK_WIDTH_MIN && width <= INK_WIDTH_MAX;

// ── Moving ───────────────────────────────────────────────────────────────
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// A stroke moved by (dx, dy), kept on the page.
export const movePoints = (
  points: StudyInkPoint[],
  dx: number,
  dy: number
): StudyInkPoint[] =>
  points.map(([x, y]) => [round(clamp01(x + dx)), round(clamp01(y + dy))]);

// A highlight's rectangles moved by (dx, dy), each kept whole on the page.
export const moveRects = (
  rects: StudyMarkRect[],
  dx: number,
  dy: number
): StudyMarkRect[] =>
  rects.map(rect => ({
    ...rect,
    x: round(Math.min(1 - rect.w, Math.max(0, rect.x + dx))),
    y: round(Math.min(1 - rect.h, Math.max(0, rect.y + dy))),
  }));

// ── Drawing ──────────────────────────────────────────────────────────────
// The geometry below works in page units where x and y are the same length
// (y scaled by the page's height / width), so a circle stays a circle.
type P = { x: number; y: number };

function segmentDistance(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)
        );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const toP = ([x, y]: StudyInkPoint, aspect: number): P => ({
  x,
  y: y * aspect,
});

// Fewer points for the same line (Ramer–Douglas–Peucker), `tolerance` in
// page widths. The first and the last point always stay.
export function simplifyPoints(
  points: StudyInkPoint[],
  aspect: number,
  tolerance = 0.0012
): StudyInkPoint[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = toP(points[first], aspect);
    const b = toP(points[last], aspect);
    let far = -1;
    let farthest = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(toP(points[i], aspect), a, b);
      if (d > farthest) {
        farthest = d;
        far = i;
      }
    }
    if (far !== -1) {
      keep[far] = 1;
      stack.push([first, far], [far, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// A highlighter stroke drawn along a line of text comes out straight: when
// every point stays within `band` of the line from the first to the last,
// the stroke is that line.
export function straighten(
  points: StudyInkPoint[],
  aspect: number,
  band = 0.012
): StudyInkPoint[] {
  if (points.length < 3) return points;
  const a = toP(points[0], aspect);
  const b = toP(points[points.length - 1], aspect);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 0.04) return points;
  const straight = points.every(
    point => segmentDistance(toP(point, aspect), a, b) <= band
  );
  return straight ? [points[0], points[points.length - 1]] : points;
}

// ── Finding marks under a finger or in a lasso ──────────────────────────
export type InkMark = {
  id: string;
  kind: string;
  rects: StudyMarkRect[];
  points: StudyInkPoint[] | null;
  width: number | null;
};

// Whether the point (fractions of the page) touches the mark, `reach` in
// page widths around the finger.
export function touches(
  mark: InkMark,
  [x, y]: StudyInkPoint,
  aspect: number,
  reach: number
): boolean {
  const p = { x, y: y * aspect };
  if (mark.kind === "rect" || !mark.points?.length) {
    return mark.rects.some(
      rect =>
        p.x >= rect.x - reach &&
        p.x <= rect.x + rect.w + reach &&
        p.y >= rect.y * aspect - reach &&
        p.y <= (rect.y + rect.h) * aspect + reach
    );
  }
  const halfWidth = (mark.width ?? 0) / 2000;
  const points = mark.points.map(point => toP(point, aspect));
  if (points.length === 1) {
    return (
      Math.hypot(p.x - points[0].x, p.y - points[0].y) <= reach + halfWidth
    );
  }
  for (let i = 1; i < points.length; i++) {
    if (segmentDistance(p, points[i - 1], points[i]) <= reach + halfWidth) {
      return true;
    }
  }
  return false;
}

function inPolygon([x, y]: StudyInkPoint, polygon: StudyInkPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// The marks a lasso caught: a stroke when most of its points are inside,
// a highlight when the middle of one of its rectangles is.
export function inLasso(mark: InkMark, lasso: StudyInkPoint[]): boolean {
  if (lasso.length < 3) return false;
  if (mark.kind === "rect" || !mark.points?.length) {
    return mark.rects.some(rect =>
      inPolygon([rect.x + rect.w / 2, rect.y + rect.h / 2], lasso)
    );
  }
  const inside = mark.points.filter(point => inPolygon(point, lasso)).length;
  return inside / mark.points.length >= 0.6;
}

// The box around marks, for the selection's frame.
export function boundsOf(marks: InkMark[]): StudyMarkRect | null {
  let left = 1;
  let top = 1;
  let right = 0;
  let bottom = 0;
  for (const mark of marks) {
    const pad = (mark.width ?? 0) / 2000;
    for (const [x, y] of mark.points ?? []) {
      left = Math.min(left, x - pad);
      right = Math.max(right, x + pad);
      top = Math.min(top, y - pad);
      bottom = Math.max(bottom, y + pad);
    }
    for (const rect of mark.kind === "rect" ? mark.rects : []) {
      left = Math.min(left, rect.x);
      right = Math.max(right, rect.x + rect.w);
      top = Math.min(top, rect.y);
      bottom = Math.max(bottom, rect.y + rect.h);
    }
  }
  if (right <= left || bottom <= top) return null;
  return {
    x: Math.max(0, left),
    y: Math.max(0, top),
    w: Math.min(1, right) - Math.max(0, left),
    h: Math.min(1, bottom) - Math.max(0, top),
  };
}
