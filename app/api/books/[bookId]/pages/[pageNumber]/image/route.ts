import { auth } from "@/lib/auth";
import { getBookPageForUser } from "@/lib/db-books";
import { storageGetSignedUrl } from "@/lib/storage";
import { NextResponse } from "next/server";

// The one REST route this feature needs (everything else goes through tRPC)
// — binary image data can't ride a JSON response, so this redirects to a
// short-lived signed URL instead. This route enforces REAL per-book
// ownership: getBookPageForUser joins through books.userId, so a
// bookId/pageNumber for a book the caller doesn't own returns null
// regardless of whether the ids themselves are valid — never leaks whether
// the resource even exists to an unauthorized caller. (PR13 closed the same
// gap for app/api/files/[...key]/route.ts too, via lib/db-file-access.ts.)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookId: string; pageNumber: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "الرجاء تسجيل الدخول أولاً." },
      { status: 401 }
    );
  }

  const { bookId, pageNumber: pageNumberRaw } = await params;
  const pageNumber = Number(pageNumberRaw);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return NextResponse.json({ error: "رقم صفحة غير صالح." }, { status: 400 });
  }

  const result = await getBookPageForUser(session.user.id, bookId, pageNumber);
  if (!result || !result.page.storageKey) {
    return NextResponse.json(
      { error: "لم يتم العثور على هذه الصفحة." },
      { status: 404 }
    );
  }

  try {
    const url = await storageGetSignedUrl(result.page.storageKey);
    return NextResponse.redirect(url, {
      status: 307,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[Books] Failed to sign page image URL", error);
    return NextResponse.json(
      { error: "تعذر تحميل صورة هذه الصفحة." },
      { status: 502 }
    );
  }
}
