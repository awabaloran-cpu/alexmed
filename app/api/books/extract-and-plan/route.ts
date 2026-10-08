import { auth } from "@/lib/auth";
import type { Book } from "@/drizzle/schema";
import { getSubjectForUser } from "@/lib/db-subjects";
import { admitAndStartStudentFile } from "@/lib/file-intake";
import {
  assertJobCreationAllowed,
  RateLimitedError,
} from "@/lib/queue/rateLimit";
import { NextResponse } from "next/server";

const VALID_PROFILES = new Set([
  "general",
  "medical",
  "english",
  "mathematics",
  "aptitude",
  "programming",
  "custom",
]);

// Step 1 of the book pipeline: the browser already PUT the raw file straight
// to storage via /api/books/upload-url. This route now only creates a bare
// book row (status "extracting") and publishes a single extract_book_job
// message — it never touches the PDF itself, so it always responds in well
// under a second regardless of file size. The actual text-extraction + OCR
// runs in the background (app/api/books/extract/route.ts) — see that file's
// مِرآة counterpart (app/api/mirror/extract/route.ts) for why this moved out
// of this route: synchronous OCR here could exceed Vercel's 60s function
// limit on scanned books with several image-only pages.
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
    profile?: string;
    subjectId?: string;
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

  const profile =
    typeof body.profile === "string" && VALID_PROFILES.has(body.profile)
      ? (body.profile as Book["profile"])
      : undefined;

  // Mandatory-folder-on-upload — every new book must be filed under a
  // subject/folder the student actually owns, chosen at upload time.
  const subjectId = typeof body.subjectId === "string" ? body.subjectId : "";
  if (!subjectId) {
    return NextResponse.json(
      { error: "اختر مجلدًا لهذا الملف أولًا." },
      { status: 400 }
    );
  }
  const owned = await getSubjectForUser(session.user.id, subjectId);
  if (!owned) {
    return NextResponse.json({ error: "المادة غير موجودة." }, { status: 400 });
  }

  // 💳 Plan checks, the book row and the extraction job (lib/file-intake.ts).
  const started = await admitAndStartStudentFile(session.user.id, {
    kind: "book",
    key,
    fileName,
    profile,
    subjectId,
  });
  if (started instanceof NextResponse) return started;

  return NextResponse.json({ bookId: started.bookId });
}
