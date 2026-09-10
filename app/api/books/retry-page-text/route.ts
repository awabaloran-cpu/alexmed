import {
  finalizeBookIfDone,
  getBookById,
  getBookPageById,
  upsertBookPageText,
} from "@/lib/db-books";
import { ocrPages } from "@/lib/pdf-ocr";
import { storageGetSignedUrl } from "@/lib/storage";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { NextResponse } from "next/server";
// Must be imported before "pdf-parse" — see app/api/pdf/extract/route.ts for why.
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

export const maxDuration = 60;

// Student-triggered retry for ONE page whose text extraction permanently
// failed during the book's original extraction pass (see
// app/api/books/extract/route.ts and lib/trpc/booksRouter.ts's
// retryPageText mutation, which resets textStatus to "pending" and
// publishes this). Deliberately its own small worker rather than reusing
// the bulk extract route — that route only runs while book.status is
// "extracting", but a page can still be individually retried long after the
// book itself has finalized (status "complete"/"partial_failed").
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  const verified = await verifyQStashRequest(rawBody, signature, request);
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let pageId: string;
  try {
    const body = JSON.parse(rawBody) as { pageId?: string };
    pageId = typeof body.pageId === "string" ? body.pageId : "";
    if (!pageId) {
      return NextResponse.json(
        { error: "معرف الصفحة مفقود." },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error("[Books] Retry-page-text body parse failed", error);
    return NextResponse.json({ error: "تعذر قراءة الطلب." }, { status: 502 });
  }

  const page = await getBookPageById(pageId);
  if (!page) {
    return NextResponse.json({ pageId, status: "skipped" });
  }
  // No atomic "claim" here (unlike the bulk pipelines' claim*() helpers) —
  // this is a low-frequency, single-page, user-initiated action, not a
  // bulk worker loop, so an occasional duplicate QStash delivery just means
  // running OCR twice on the same page; both writes converge to the same
  // final upserted row, no corruption. If it's already resolved, skip.
  if (page.textStatus !== "pending") {
    return NextResponse.json({ pageId, status: "already_resolved" });
  }

  const book = await getBookById(page.bookId);
  if (!book?.fileKey) {
    return NextResponse.json({ pageId, status: "skipped" });
  }

  let parser: PDFParse | undefined;
  try {
    const signedGetUrl = await storageGetSignedUrl(book.fileKey);
    parser = new PDFParse({ url: signedGetUrl, CanvasFactory });

    const { pages: results, failedPages } = await ocrPages(parser, [
      page.pageNumber,
    ]);
    const result = results[0];

    if (!result || failedPages.length || !result.hasText) {
      await upsertBookPageText(page.bookId, {
        page: page.pageNumber,
        text: "",
        textStatus: "failed",
        errorMessage: "ما زالت هذه الصفحة يتعذّر قراءتها ضوئيًا.",
        chapterId: page.chapterId,
      });
      return NextResponse.json({ pageId, status: "failed" });
    }

    await upsertBookPageText(page.bookId, {
      page: page.pageNumber,
      text: result.text,
      textStatus: "complete",
      chapterId: page.chapterId,
    });
    // May flip the book from "partial_failed" back to "complete" if this
    // was the last outstanding failure.
    await finalizeBookIfDone(page.bookId);
    return NextResponse.json({ pageId, status: "complete" });
  } catch (error) {
    console.error("[Books] Retry-page-text failed", error);
    await upsertBookPageText(page.bookId, {
      page: page.pageNumber,
      text: "",
      textStatus: "failed",
      errorMessage: "تعذّرت إعادة محاولة هذه الصفحة.",
      chapterId: page.chapterId,
    });
    return NextResponse.json({ pageId, status: "failed" });
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
