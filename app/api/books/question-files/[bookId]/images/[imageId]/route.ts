import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { extractedQuestionImages } from "@/drizzle/schema";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getQuestionFileAccess } from "@/lib/question-file-access";
import { streamStoredObject } from "@/lib/storage-stream";

// 🔗 The images of a question file, for whoever may read that file — its
// owner or a classmate it was shared with (lib/question-file-access.ts).
// Authorized per request and streamed through the server, like a protected
// set's images: no storage key and no signed URL reach the browser, and
// nothing is cacheable, so stopping a share takes effect on the next
// request. Every refusal is the same 404.
const NOT_FOUND = () =>
  NextResponse.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "private, no-store" } }
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookId: string; imageId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  const { bookId, imageId } = await params;
  if (!UUID.test(bookId) || !UUID.test(imageId)) return NOT_FOUND();

  const access = await getQuestionFileAccess(session.user.id, bookId);
  if (!access) return NOT_FOUND();

  // The image must belong to THIS file — a file the viewer may read can't
  // be paired with another file's image id.
  const db = getDb();
  if (!db) return NOT_FOUND();
  const [image] = await db
    .select({ storageKey: extractedQuestionImages.storageKey })
    .from(extractedQuestionImages)
    .where(
      and(
        eq(extractedQuestionImages.id, imageId),
        eq(extractedQuestionImages.bookId, access.bookId)
      )
    )
    .limit(1);
  if (!image) return NOT_FOUND();

  return streamStoredObject(image.storageKey, request, {
    cacheControl: "private, no-store",
  });
}
