// The room's ink without a database: what the server accepts, and what
// the page catches under a finger or in a lasso.
import { describe, expect, it } from "vitest";
import {
  boundsOf,
  cleanPoints,
  inLasso,
  INK_MAX_POINTS,
  isInkColor,
  movePoints,
  moveRects,
  simplifyPoints,
  straighten,
  touches,
  type InkMark,
} from "./ink";

const stroke = (points: [number, number][], width = 4, id = "s1"): InkMark => ({
  id,
  kind: "pen",
  rects: [],
  points,
  width,
});

describe("what the server accepts", () => {
  it("points inside the page, rounded; anything else refused whole", () => {
    expect(cleanPoints([[0.123456, 0.5]])).toEqual([[0.1235, 0.5]]);
    expect(cleanPoints([])).toBeNull();
    expect(cleanPoints([[1.1, 0.5]])).toBeNull();
    expect(cleanPoints([[Number.NaN, 0.5]])).toBeNull();
    expect(cleanPoints([[0.5]])).toBeNull();
    expect(cleanPoints("x")).toBeNull();
    expect(
      cleanPoints(Array.from({ length: INK_MAX_POINTS + 1 }, () => [0.5, 0.5]))
    ).toBeNull();
  });

  it("each tool has its own colours", () => {
    expect(isInkColor("pen", "#1b2340")).toBe(true);
    expect(isInkColor("highlighter", "#1b2340")).toBe(false);
    expect(isInkColor("pen", "red")).toBe(false);
  });

  it("a move keeps every point and rectangle on the page", () => {
    expect(
      movePoints(
        [
          [0.9, 0.1],
          [0.5, 0.5],
        ],
        0.2,
        -0.2
      )
    ).toEqual([
      [1, 0],
      [0.7, 0.3],
    ]);
    expect(moveRects([{ x: 0.7, y: 0.1, w: 0.2, h: 0.1 }], 0.3, -0.5)).toEqual([
      { x: 0.8, y: 0, w: 0.2, h: 0.1 },
    ]);
  });
});

describe("drawing", () => {
  it("a straight line needs only its ends", () => {
    const line = Array.from(
      { length: 50 },
      (_, i) => [0.1 + i * 0.01, 0.3] as [number, number]
    );
    expect(simplifyPoints(line, 1.3)).toEqual([line[0], line[49]]);
  });

  it("a corner is kept", () => {
    const corner: [number, number][] = [
      [0.1, 0.1],
      [0.3, 0.1],
      [0.5, 0.1],
      [0.5, 0.3],
      [0.5, 0.5],
    ];
    expect(simplifyPoints(corner, 1)).toEqual([
      [0.1, 0.1],
      [0.5, 0.1],
      [0.5, 0.5],
    ]);
  });

  it("a highlighter along a line of text comes out straight; a curve does not", () => {
    const wobbly: [number, number][] = [
      [0.1, 0.3],
      [0.2, 0.303],
      [0.3, 0.298],
      [0.4, 0.301],
    ];
    expect(straighten(wobbly, 1.3)).toEqual([wobbly[0], wobbly[3]]);
    const curve: [number, number][] = [
      [0.1, 0.3],
      [0.2, 0.36],
      [0.3, 0.3],
    ];
    expect(straighten(curve, 1.3)).toEqual(curve);
  });
});

describe("under a finger, in a lasso", () => {
  const line = stroke([
    [0.2, 0.2],
    [0.6, 0.2],
  ]);

  it("the eraser touches a stroke near its line, not far from it", () => {
    expect(touches(line, [0.4, 0.205], 1, 0.01)).toBe(true);
    expect(touches(line, [0.4, 0.3], 1, 0.01)).toBe(false);
    const box: InkMark = {
      id: "r1",
      kind: "rect",
      rects: [{ x: 0.1, y: 0.5, w: 0.3, h: 0.05 }],
      points: null,
      width: null,
    };
    expect(touches(box, [0.2, 0.52], 1, 0)).toBe(true);
    expect(touches(box, [0.2, 0.7], 1, 0)).toBe(false);
  });

  it("a lasso catches a stroke mostly inside it", () => {
    const lasso: [number, number][] = [
      [0.1, 0.1],
      [0.7, 0.1],
      [0.7, 0.3],
      [0.1, 0.3],
    ];
    expect(inLasso(line, lasso)).toBe(true);
    expect(
      inLasso(
        stroke([
          [0.5, 0.2],
          [0.9, 0.2],
          [0.95, 0.2],
        ]),
        lasso
      )
    ).toBe(false);
    expect(inLasso(line, lasso.slice(0, 2))).toBe(false);
  });

  it("the selection's frame holds the strokes and their width", () => {
    expect(boundsOf([line])).toEqual({
      x: 0.198,
      y: 0.198,
      w: expect.closeTo(0.404, 6),
      h: expect.closeTo(0.004, 6),
    });
    expect(boundsOf([])).toBeNull();
  });
});
