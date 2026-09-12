import { auth } from "@/lib/auth";
import { createQuestionFileShell } from "@/lib/db-question-files";
import { publishMessage } from "@/lib/queue/client";
import {
  assertJobCreationAllowed,
  RateLimitedError,
} from "@/lib/queue/rateLimit";
import { NextResponse } from "next/server";

// Question-file counterpart to app/api/books/extract-and-plan/route.ts — same
// "create a bare row, publish one job, respond immediately" shape, but for
// PR16's separate question-file pipeline (no subject/profile, no chapters).
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "الرجاء تسجيل الدخول أولاً." },
      { status: 401 }
    );
  }

  try {
    await assertJobCreationAllowed(session.user.id, "books");
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }

  const body = (await request.json().catch(() => ({}))) as {
    key?: string;
    fileName?: string;
  };
  const key = typeof body.key === "string" ? body.key : "";
  const fileName = typeof body.fileName === "string" ? body.fileName : "";

  if (!key) {
    return NextResponse.json({ error: "ارفع ملف PDF أولًا." }, { status: 400 });
  }
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "الملف يجب أن يكون بصيغة PDF." },
      { status: 400 }
    );
  }

  const book = await createQuestionFileShell(session.user.id, {
    fileName,
    fileKey: key,
  });

  try {
    await publishMessage({
      type: "extract_question_file_job",
      bookId: book.id,
    });
  } catch (publishError) {
    console.error("[QuestionFiles] Failed to enqueue extraction", publishError);
    return NextResponse.json(
      {
        error: "تم إنشاء الملف لكن تعذر بدء الاستخراج. حاول إعادة رفع الملف.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ bookId: book.id });
}
