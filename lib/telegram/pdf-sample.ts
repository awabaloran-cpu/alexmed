// ✈️ Reads the text of a PDF's first pages for lib/telegram/detect.ts, and
// how many pages the file has for the bot's page limit.
// The real extraction (every page, OCR for scanned ones) stays in the
// existing workers; this is a cheap look at the opening pages and never
// fails the upload — an unreadable sample just means "unsure" (and a page
// count of 0, "unknown").
//
// Must be imported before "pdf-parse" — see app/api/books/extract/route.ts.
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { normalizePageText } from "../pdf-cards";

export async function readLeadingPages(
  data: Uint8Array,
  pageCount: number
): Promise<{ pages: { page: number; text: string }[]; total: number }> {
  let parser: PDFParse | undefined;
  try {
    // pdf.js takes ownership of (and detaches) the buffer it is given.
    parser = new PDFParse({ data: data.slice(), CanvasFactory });
    const result = await parser.getText({ first: pageCount });
    return {
      pages: result.pages.map(page => ({
        page: page.num,
        text: normalizePageText(page.text),
      })),
      total: Number(result.total) || 0,
    };
  } catch (error) {
    console.error("[Telegram] Could not sample the PDF's first pages", error);
    return { pages: [], total: 0 };
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
