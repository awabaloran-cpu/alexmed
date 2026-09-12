import { getChapterById } from "@/lib/db-books";
import { generateAndSaveMindMapSections } from "@/lib/book-enrichment";
import { isUserConcurrencyExceeded } from "@/lib/queue/concurrency";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { NextResponse } from "next/server";

export const maxDuration = 60;

// Audit Phase 6 — automatic trigger for a chapter's hierarchical mind-map
// sections, published (best-effort, fire-and-forget) right after
// app/api/books/analyze-chapter/route.ts marks a chapter "complete". No
// atomic "claim" here (unlike the bulk pipelines' claim*() helpers) — the
// underlying generateAndSaveMindMapSections is already idempotent (returns
// the cached sections if already generated), so an occasional duplicate
// QStash delivery, or a race with a student's own manual click on the same
// chapter (lib/trpc/booksRouter.ts's generateMindMapSections), just means
// reading the same cached result twice — never a duplicate LLM call, never
// conflicting writes.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  const verified = await verifyQStashRequest(rawBody, signature, request);
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let chapterId: string;
  try {
    const body = JSON.parse(rawBody) as { chapterId?: string };
    chapterId = typeof body.chapterId === "string" ? body.chapterId : "";
    if (!chapterId) {
      return NextResponse.json({ error: "معرف الفصل مفقود." }, { status: 200 });
    }
  } catch (error) {
    console.error("[Books] generate-mindmap-sections body parse failed", error);
    return NextResponse.json({ error: "تعذر قراءة الطلب." }, { status: 502 });
  }

  const chapter = await getChapterById(chapterId);
  if (!chapter) {
    return NextResponse.json({ chapterId, status: "skipped" });
  }

  // Same per-user concurrency backstop as analyze-chapter — this is a real
  // LLM call, so it counts against the student's own budget too.
  if (await isUserConcurrencyExceeded(chapter.userId, "books")) {
    return NextResponse.json(
      { chapterId, status: "throttled" },
      { status: 429 }
    );
  }

  try {
    const sections = await generateAndSaveMindMapSections(chapterId);
    return NextResponse.json({
      chapterId,
      status: sections === null ? "skipped" : "complete",
    });
  } catch (error) {
    console.error("[Books] generate-mindmap-sections failed", error);
    // Best-effort only (see header comment) — a failure here never blocks
    // or retries against the chapter's own completion; the student's
    // manual "بناء الخريطة الهرمية" button remains available as a fallback.
    return NextResponse.json({ chapterId, status: "failed" });
  }
}
