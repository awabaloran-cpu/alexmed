import {
  getQuestionFileBookById,
  markQuestionFileComplete,
  markQuestionFileFailed,
  saveExtractedQuestions,
} from "@/lib/db-question-files";
import { normalizePageText } from "@/lib/pdf-cards";
import { extractQuestionsFromPages } from "@/lib/question-extraction";
import { storageGetSignedUrl } from "@/lib/storage";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { NextResponse } from "next/server";
// Must be imported before "pdf-parse" — see app/api/pdf/extract/route.ts.
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

// PR16's question-file worker. Deliberately simpler than
// app/api/books/extract/route.ts's resumable, OCR-batched design: question
// banks are typically far shorter than full textbooks, so this reads
// embedded PDF text in one pass and never calls an OCR/vision model — this
// pipeline's whole point is extracting what the file already states, never
// generating anything. A scanned/image-only question file (no embedded
// text at all) is a real, honestly-reported failure here, not silently
// "0 questions found" — the student can retry once OCR support for this
// pipeline exists, or upload a text-based copy.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  const verified = await verifyQStashRequest(rawBody, signature, request);
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let bookId: string;
  try {
    const body = JSON.parse(rawBody) as { bookId?: string };
    bookId = typeof body.bookId === "string" ? body.bookId : "";
    if (!bookId) {
      return NextResponse.json({ error: "معرف الملف مفقود." }, { status: 200 });
    }
  } catch (error) {
    console.error("[QuestionFiles] Invalid job payload", error);
    return NextResponse.json({ error: "طلب غير صالح." }, { status: 200 });
  }

  const book = await getQuestionFileBookById(bookId);
  if (!book) {
    return NextResponse.json({ bookId, status: "skipped" });
  }
  if (book.status !== "extracting") {
    return NextResponse.json({ bookId, status: "already_done" });
  }

  let parser: PDFParse | undefined;
  try {
    const signedGetUrl = await storageGetSignedUrl(book.fileKey ?? "");
    parser = new PDFParse({ url: signedGetUrl, CanvasFactory });

    const result = await parser.getText();
    const pages = result.pages
      .map(page => ({ page: page.num, text: normalizePageText(page.text) }))
      .filter(page => page.text.length > 0);

    if (!pages.length) {
      await markQuestionFileFailed(
        bookId,
        "لم يتم العثور على نص في هذا الملف — قد يكون ممسوحًا ضوئيًا كصور. جرّب رفع نسخة نصية."
      );
      return NextResponse.json({ bookId, status: "failed" });
    }

    const questions = extractQuestionsFromPages(pages);
    if (!questions.length) {
      await markQuestionFileFailed(
        bookId,
        "تعذر التعرف على أي أسئلة بالتنسيق المتوقع (رقم السؤال، ثم الخيارات). جرّب ملفًا آخر أو تواصل معنا."
      );
      return NextResponse.json({ bookId, status: "failed" });
    }

    await saveExtractedQuestions(bookId, questions);
    await markQuestionFileComplete(bookId, result.total);

    return NextResponse.json({
      bookId,
      status: "complete",
      questionCount: questions.length,
    });
  } catch (error) {
    console.error("[QuestionFiles] Extraction failed", error);
    await markQuestionFileFailed(
      bookId,
      "تعذرت قراءة هذا الملف. حاول إعادة المعالجة."
    );
    return NextResponse.json(
      { error: "تعذر استخراج الأسئلة من هذا الملف." },
      { status: 502 }
    );
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
