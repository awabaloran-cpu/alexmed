// What a PDF page DRAWS, read from the page itself with no AI call: the
// pictures it paints and its line work. A page that paints no picture of
// its own and no drawing is text only — its words are already in the text
// layer, so sending its screenshot to a vision model can only cost money,
// never add anything.
//
// The answer is used to SKIP work, so every doubt goes the other way: a page
// that could not be read, or draws anything this file does not recognise as
// plain layout, is reported as possibly holding a figure and takes the same
// path as before.
import type { PDFParse } from "pdf-parse";

export type PageDrawing = {
  // Pictures painted on the page. A page-wide scan counts; the mark every
  // page of the file carries (a logo, a watermark stamp) does not — see
  // findRepeatedMarks.
  images: number;
  // Paths that are not plain layout: curves, slanted lines, anything this
  // file cannot read as a box or a rule. A diagram or a chart is made of them.
  shapes: number;
  // Thin straight lines actually painted: table borders, underlines.
  rules: number;
  // Gradient fills — only ever part of a drawing.
  shadings: number;
};

// pdf.js operator numbers (OPS). The same in every pdf.js release this repo
// has used (checked against 5.4.296 and 6.3.289); lib/pdf-page-drawing.test.ts
// reads real pages so a renumbering cannot pass unnoticed.
const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_END_PATH = 28;
const OP_SHADING_FILL = 62;
const OP_FORM_BEGIN = 74;
const OP_FORM_END = 75;
const OP_PAINT_IMAGE_MASK = 83;
const OP_PAINT_IMAGE_MASK_GROUP = 84;
const OP_PAINT_IMAGE = 85;
const OP_PAINT_INLINE_IMAGE = 86;
const OP_PAINT_INLINE_IMAGE_GROUP = 87;
const OP_PAINT_IMAGE_REPEAT = 88;
const OP_PAINT_IMAGE_MASK_REPEAT = 89;
const OP_CONSTRUCT_PATH = 91;

// A line or bar this thin (PDF points) is a rule, not a box.
const RULE_MAX_THICKNESS = 3;
// A page may carry this many odd shapes (a bullet, a tick) and still be text.
export const TEXT_PAGE_MAX_SHAPES = 2;
// More painted rules than this reads as a ruled table.
export const TEXT_PAGE_MAX_RULES = 6;
// A repeated mark is never bigger than this share of the page.
const MARK_MAX_PAGE_SHARE = 0.1;
// How a file's repeated marks are found: this many pages are looked at, and
// a picture on at least this share of them is a mark.
const MARK_SAMPLE_PAGES = 10;
const MARK_MIN_SAMPLE = 5;
const MARK_MIN_SHARE = 0.6;

type Matrix = [number, number, number, number, number, number];
type OperatorList = { fnArray: number[]; argsArray: unknown[] };
type PdfPage = {
  view: number[];
  getOperatorList: () => Promise<OperatorList>;
};
type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function asMatrix(value: unknown): Matrix | null {
  if (!value || typeof value !== "object") return null;
  const list = Array.from(value as ArrayLike<number>).map(Number);
  return list.length === 6 && list.every(Number.isFinite)
    ? (list as Matrix)
    : null;
}

// A path's data is a run of steps: 0 x y (move), 1 x y (line), 2 … (curve),
// and a closing step with no numbers. "box" = straight sides only, each
// level or upright; anything else — a curve, a slanted side, a step this
// function does not know — is a shape.
function isBoxPath(data: ArrayLike<number>): boolean {
  let i = 0;
  let x = 0;
  let y = 0;
  let points = 0;
  while (i < data.length) {
    const step = data[i];
    if (step === 0 || step === 1) {
      const nx = Number(data[i + 1]);
      const ny = Number(data[i + 2]);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
      if (step === 1) {
        const level = Math.abs(ny - y) < 0.5;
        const upright = Math.abs(nx - x) < 0.5;
        if (!level && !upright) return false;
      }
      x = nx;
      y = ny;
      points++;
      i += 3;
      continue;
    }
    // The closing step, only where a path may end.
    if ((step === 3 || step === 4) && i === data.length - 1) return points > 0;
    return false;
  }
  return points > 0;
}

export type PagePicture = { key: string; pageShare: number };

type PageReading = PageDrawing & { pictures: PagePicture[] };

// Exported for tests.
export function readOperators(
  ops: OperatorList,
  pageArea: number,
  repeatedMarks: ReadonlySet<string> = new Set()
): PageReading {
  const reading: PageReading = {
    images: 0,
    shapes: 0,
    rules: 0,
    shadings: 0,
    pictures: [],
  };
  let matrix: Matrix = IDENTITY;
  const stack: Matrix[] = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[] | null;
    switch (fn) {
      case OP_SAVE:
        stack.push(matrix);
        break;
      case OP_RESTORE:
        matrix = stack.pop() ?? matrix;
        break;
      case OP_TRANSFORM: {
        const next = asMatrix(args);
        if (next) matrix = multiply(matrix, next);
        break;
      }
      case OP_FORM_BEGIN: {
        stack.push(matrix);
        const next = asMatrix(args?.[0]);
        if (next) matrix = multiply(matrix, next);
        break;
      }
      case OP_FORM_END:
        matrix = stack.pop() ?? matrix;
        break;
      case OP_PAINT_IMAGE:
      case OP_PAINT_IMAGE_REPEAT: {
        // [objectId, width, height]; the picture fills the unit square of
        // the current matrix.
        const key = `${Number(args?.[1])}x${Number(args?.[2])}`;
        const placed = Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]);
        const pageShare = pageArea > 0 ? placed / pageArea : 1;
        reading.pictures.push({ key, pageShare });
        const mark = repeatedMarks.has(key) && pageShare <= MARK_MAX_PAGE_SHARE;
        if (!mark) reading.images++;
        break;
      }
      case OP_PAINT_INLINE_IMAGE:
      case OP_PAINT_INLINE_IMAGE_GROUP:
      case OP_PAINT_IMAGE_MASK:
      case OP_PAINT_IMAGE_MASK_GROUP:
      case OP_PAINT_IMAGE_MASK_REPEAT:
        reading.images++;
        break;
      case OP_SHADING_FILL:
        reading.shadings++;
        break;
      case OP_CONSTRUCT_PATH: {
        // [paint operator, [path data], [minX, minY, maxX, maxY]]
        // A path that is only a clip paints nothing.
        if (args?.[0] === OP_END_PATH) break;
        const data = (args?.[1] as unknown[] | undefined)?.[0] as
          | ArrayLike<number>
          | undefined;
        const box = args?.[2] as ArrayLike<number> | undefined;
        if (!data || !box || typeof data.length !== "number") {
          reading.shapes++;
          break;
        }
        if (!isBoxPath(data)) {
          reading.shapes++;
          break;
        }
        const width = Math.abs(Number(box[2]) - Number(box[0]));
        const height = Math.abs(Number(box[3]) - Number(box[1]));
        if (Math.min(width, height) <= RULE_MAX_THICKNESS) reading.rules++;
        break;
      }
    }
  }
  return reading;
}

async function openDocument(parser: PDFParse): Promise<PdfDocument | null> {
  const holder = parser as unknown as { doc?: PdfDocument };
  // The document is opened by the parser's first call.
  if (!holder.doc) await parser.getInfo();
  return holder.doc ?? null;
}

async function readPage(
  doc: PdfDocument,
  pageNumber: number,
  repeatedMarks?: ReadonlySet<string>
): Promise<PageReading | null> {
  if (pageNumber < 1 || pageNumber > doc.numPages) return null;
  const page = await doc.getPage(pageNumber);
  const ops = await page.getOperatorList();
  if (!Array.isArray(ops?.fnArray) || !Array.isArray(ops?.argsArray)) {
    return null;
  }
  const [x0, y0, x1, y1] = page.view.map(Number);
  return readOperators(ops, Math.abs((x1 - x0) * (y1 - y0)), repeatedMarks);
}

// The pictures a file repeats on most of its pages at a small size — its
// logo or stamp. Read once per file from a spread of pages; a file too
// short to judge has none.
export async function findRepeatedMarks(
  parser: PDFParse
): Promise<Set<string>> {
  const marks = new Set<string>();
  try {
    const doc = await openDocument(parser);
    if (!doc || doc.numPages < MARK_MIN_SAMPLE) return marks;
    const sample = Math.min(MARK_SAMPLE_PAGES, doc.numPages);
    const seenOn = new Map<string, number>();
    let read = 0;
    for (let i = 0; i < sample; i++) {
      const pageNumber =
        1 + Math.floor((i * (doc.numPages - 1)) / Math.max(1, sample - 1));
      const reading = await readPage(doc, pageNumber);
      if (!reading) continue;
      read++;
      const small = new Set(
        reading.pictures
          .filter(picture => picture.pageShare <= MARK_MAX_PAGE_SHARE)
          .map(picture => picture.key)
      );
      for (const key of small) seenOn.set(key, (seenOn.get(key) ?? 0) + 1);
    }
    if (read < MARK_MIN_SAMPLE) return marks;
    for (const [key, count] of seenOn) {
      if (count / read >= MARK_MIN_SHARE) marks.add(key);
    }
  } catch (error) {
    console.warn("[PDF] Repeated marks could not be read", error);
  }
  return marks;
}

// null = the page could not be read (the caller then assumes a figure).
export async function readPageDrawing(
  parser: PDFParse,
  pageNumber: number,
  repeatedMarks?: ReadonlySet<string>
): Promise<PageDrawing | null> {
  try {
    const doc = await openDocument(parser);
    if (!doc) return null;
    const reading = await readPage(doc, pageNumber, repeatedMarks);
    if (!reading) return null;
    const { images, shapes, rules, shadings } = reading;
    return { images, shapes, rules, shadings };
  } catch (error) {
    console.warn(`[PDF] Page ${pageNumber} drawing could not be read`, error);
    return null;
  }
}

// A picture or a drawing a question could be about. False only for a page
// that certainly paints neither.
export function pageMayHoldPicture(drawing: PageDrawing | null): boolean {
  if (!drawing) return true;
  return (
    drawing.images > 0 ||
    drawing.shadings > 0 ||
    drawing.shapes > TEXT_PAGE_MAX_SHAPES
  );
}

// The same, plus a ruled table — for the reader's page analysis, which
// describes tables too.
export function pageMayHoldVisual(drawing: PageDrawing | null): boolean {
  if (!drawing) return true;
  return pageMayHoldPicture(drawing) || drawing.rules > TEXT_PAGE_MAX_RULES;
}
