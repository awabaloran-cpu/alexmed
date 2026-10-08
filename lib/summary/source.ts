// 📝 The text a summary is written from, page by page.
//   a book          → its pages' own text (book_pages.extractedText)
//   a question file → its extracted questions, grouped by the page each
//                     starts on (the staging page text is cleared once the
//                     questions are saved)
// Must be imported before "pdf-parse" — see app/api/books/extract/route.ts.
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { asc, eq } from "drizzle-orm";
import { bookPages, extractedQuestions } from "../../drizzle/schema";
import { requireDb } from "../db";
import { storageGetSignedUrl } from "../storage";
import type { SourcePage } from "./compose";

// The text layer of a PDF sent only to be summarised. No OCR and no AI:
// a scanned file has no text here, and is refused before any work.
export async function readPdfSource(sourceKey: string): Promise<SourcePage[]> {
  let parser: PDFParse | undefined;
  try {
    parser = new PDFParse({
      url: await storageGetSignedUrl(sourceKey),
      CanvasFactory,
    });
    const result = await parser.getText();
    return result.pages
      .map(page => ({
        n: page.num,
        text: page.text.replace(/[ \t]+\n/g, "\n").trim(),
      }))
      .filter(page => page.text.length > 0);
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

export async function readSummarySource(book: {
  id: string;
  sourceType: string | null;
}): Promise<SourcePage[]> {
  const db = requireDb();
  if (book.sourceType === "question_file") {
    const questions = await db
      .select({
        text: extractedQuestions.questionText,
        options: extractedQuestions.options,
        answer: extractedQuestions.extractedAnswerText,
        explanation: extractedQuestions.explanationText,
        page: extractedQuestions.sourcePage,
      })
      .from(extractedQuestions)
      .where(eq(extractedQuestions.bookId, book.id))
      .orderBy(asc(extractedQuestions.orderIndex));
    const byPage = new Map<number, string[]>();
    for (const question of questions) {
      const lines = [`Q: ${question.text}`];
      (question.options ?? []).forEach((option, i) =>
        lines.push(`${String.fromCharCode(65 + i)}) ${option}`)
      );
      if (question.answer) lines.push(`Answer: ${question.answer}`);
      if (question.explanation)
        lines.push(`Explanation: ${question.explanation}`);
      byPage.set(question.page, [
        ...(byPage.get(question.page) ?? []),
        lines.join("\n"),
      ]);
    }
    return [...byPage.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, items]) => ({ n, text: items.join("\n\n") }));
  }
  const pages = await db
    .select({ n: bookPages.pageNumber, text: bookPages.extractedText })
    .from(bookPages)
    .where(eq(bookPages.bookId, book.id))
    .orderBy(asc(bookPages.pageNumber));
  return pages
    .map(page => ({ n: page.n, text: (page.text ?? "").trim() }))
    .filter(page => page.text.length > 0);
}
