import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  pageMayHoldPicture,
  pageMayHoldVisual,
  readOperators,
  readPageDrawing,
  findRepeatedMarks,
} from "./pdf-page-drawing";

const A4 = 595 * 842;

// Builds an operator list the way pdf.js hands it over.
function ops(...list: [number, unknown?][]) {
  return {
    fnArray: list.map(([fn]) => fn),
    argsArray: list.map(([, args]) => args ?? null),
  };
}
const SAVE = 10;
const RESTORE = 11;
const TRANSFORM = 12;
const FILL = 22;
const STROKE = 20;
const END_PATH = 28;
const IMAGE = 85;
const PATH = 91;

function path4(paint: number, points: number[][], box: number[]) {
  const data = points.flatMap(([x, y], i) => [i === 0 ? 0 : 1, x, y]);
  return [PATH, [paint, [new Float32Array([...data, 4])], box]] as [
    number,
    unknown,
  ];
}

describe("what a PDF page draws", () => {
  it("uses the operator numbers of the pdf.js that reads the files", async () => {
    const require = createRequire(import.meta.url);
    const fromParser = createRequire(require.resolve("pdf-parse"));
    const pdfjs = (await import(
      pathToFileURL(fromParser.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
    )) as { OPS: Record<string, number> };
    expect({
      save: pdfjs.OPS.save,
      restore: pdfjs.OPS.restore,
      transform: pdfjs.OPS.transform,
      endPath: pdfjs.OPS.endPath,
      shadingFill: pdfjs.OPS.shadingFill,
      formBegin: pdfjs.OPS.paintFormXObjectBegin,
      formEnd: pdfjs.OPS.paintFormXObjectEnd,
      imageMask: pdfjs.OPS.paintImageMaskXObject,
      imageMaskGroup: pdfjs.OPS.paintImageMaskXObjectGroup,
      image: pdfjs.OPS.paintImageXObject,
      inlineImage: pdfjs.OPS.paintInlineImageXObject,
      inlineImageGroup: pdfjs.OPS.paintInlineImageXObjectGroup,
      imageRepeat: pdfjs.OPS.paintImageXObjectRepeat,
      imageMaskRepeat: pdfjs.OPS.paintImageMaskXObjectRepeat,
      constructPath: pdfjs.OPS.constructPath,
    }).toEqual({
      save: 10,
      restore: 11,
      transform: 12,
      endPath: 28,
      shadingFill: 62,
      formBegin: 74,
      formEnd: 75,
      imageMask: 83,
      imageMaskGroup: 84,
      image: 85,
      inlineImage: 86,
      inlineImageGroup: 87,
      imageRepeat: 88,
      imageMaskRepeat: 89,
      constructPath: 91,
    });
  });

  it("a page of text, highlights and a clip is text only", () => {
    const reading = readOperators(
      ops(
        // A page-wide clip paints nothing.
        path4(
          END_PATH,
          [
            [0, 0],
            [595, 0],
            [595, 842],
            [0, 842],
          ],
          [0, 0, 595, 842]
        ),
        // A highlight behind an answer.
        path4(
          FILL,
          [
            [80, 700],
            [200, 700],
            [200, 714],
            [80, 714],
          ],
          [80, 700, 200, 714]
        ),
        // A rule between two questions.
        path4(
          STROKE,
          [
            [60, 650],
            [540, 650],
          ],
          [60, 650, 540, 650]
        )
      ),
      A4
    );
    expect(reading).toMatchObject({ images: 0, shapes: 0, rules: 1 });
    expect(pageMayHoldPicture(reading)).toBe(false);
    expect(pageMayHoldVisual(reading)).toBe(false);
  });

  it("a picture on the page is always seen", () => {
    const reading = readOperators(
      ops(
        [SAVE],
        [TRANSFORM, [300, 0, 0, 200, 100, 400]],
        [IMAGE, ["img_p0_1", 1200, 800]],
        [RESTORE]
      ),
      A4
    );
    expect(reading.images).toBe(1);
    expect(reading.pictures[0].pageShare).toBeCloseTo((300 * 200) / A4, 5);
    expect(pageMayHoldPicture(reading)).toBe(true);
  });

  it("the file's small repeated logo is not a figure, a scan is", () => {
    const marks = new Set(["240x90"]);
    const logo = readOperators(
      ops(
        [SAVE],
        [TRANSFORM, [80, 0, 0, 30, 500, 800]],
        [IMAGE, ["img_p0_1", 240, 90]],
        [RESTORE]
      ),
      A4,
      marks
    );
    expect(logo.images).toBe(0);
    expect(pageMayHoldPicture(logo)).toBe(false);

    // The same size on every page but filling it: a scanned page.
    const scan = readOperators(
      ops(
        [SAVE],
        [TRANSFORM, [595, 0, 0, 842, 0, 0]],
        [IMAGE, ["img_p0_1", 240, 90]],
        [RESTORE]
      ),
      A4,
      marks
    );
    expect(scan.images).toBe(1);
  });

  it("curves and slanted lines are a drawing", () => {
    const curve = [
      PATH,
      [
        STROKE,
        [new Float32Array([0, 10, 10, 2, 20, 30, 40, 50, 60, 70])],
        [10, 10, 60, 70],
      ],
    ] as [number, unknown];
    const slanted = path4(
      STROKE,
      [
        [10, 10],
        [90, 60],
      ],
      [10, 10, 90, 60]
    );
    const reading = readOperators(ops(curve, curve, slanted), A4);
    expect(reading.shapes).toBe(3);
    expect(pageMayHoldPicture(reading)).toBe(true);
  });

  it("many ruled lines read as a table for the reader, not as a picture", () => {
    const rule = (y: number) =>
      path4(
        STROKE,
        [
          [60, y],
          [540, y],
        ],
        [60, y, 540, y]
      );
    const reading = readOperators(
      ops(...Array.from({ length: 9 }, (_, i) => rule(100 + i * 30))),
      A4
    );
    expect(pageMayHoldPicture(reading)).toBe(false);
    expect(pageMayHoldVisual(reading)).toBe(true);
  });

  it("anything unreadable is treated as a possible figure", () => {
    expect(pageMayHoldPicture(null)).toBe(true);
    expect(pageMayHoldVisual(null)).toBe(true);
    const odd = readOperators(ops([PATH, [STROKE, null, null]]), A4);
    expect(odd.shapes).toBe(1);
  });

  it("reads a real page through the parser", async () => {
    // Same import order as the workers (the canvas factory first).
    const { CanvasFactory } = await import("pdf-parse/worker");
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({
      data: readFileSync(
        path.join(process.cwd(), "scripts/fixtures/tiny-sample.pdf")
      ),
      CanvasFactory,
    });
    try {
      expect(await findRepeatedMarks(parser)).toEqual(new Set());
      const drawing = await readPageDrawing(parser, 1);
      expect(drawing).toEqual({ images: 0, shapes: 0, rules: 0, shadings: 0 });
      expect(await readPageDrawing(parser, 99)).toBeNull();
    } finally {
      await parser.destroy();
    }
  });
});
