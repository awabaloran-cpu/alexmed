import { auth } from "@/lib/auth";
import { getSubjectForUser } from "@/lib/db-subjects";
import { admitAndStartStudentFile } from "@/lib/file-intake";
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
    subjectId?: string;
  };
  const key = typeof body.key === "string" ? body.key : "";
  const fileName = typeof body.fileName === "string" ? body.fileName : "";
  const subjectId = typeof body.subjectId === "string" ? body.subjectId : "";

  if (!key) {
    return NextResponse.json({ error: "ارفع ملف PDF أولًا." }, { status: 400 });
  }
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "الملف يجب أن يكون بصيغة PDF." },
      { status: 400 }
    );
  }
  if (!subjectId) {
    return NextResponse.json(
      { error: "اختر مجلدًا لهذا الملف أولًا." },
      { status: 400 }
    );
  }
  const owned = await getSubjectForUser(session.user.id, subjectId);
  if (!owned) {
    return NextResponse.json({ error: "المجلد غير موجود." }, { status: 400 });
  }

  // 💳 Plan checks, the file row and the extraction job (lib/file-intake.ts).
  const started = await admitAndStartStudentFile(session.user.id, {
    kind: "question_file",
    key,
    fileName,
    subjectId,
  });
  if (started instanceof NextResponse) return started;

  return NextResponse.json({ bookId: started.bookId });
}
