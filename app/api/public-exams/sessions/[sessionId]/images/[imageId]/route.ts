import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPublicExamImage } from "@/lib/db-public-exams";
import { streamStoredObject } from "@/lib/storage-stream";

const NOT_FOUND = () =>
  NextResponse.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "private, no-store" } }
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; imageId: string }> }
) {
  const { sessionId, imageId } = await params;
  if (!UUID.test(sessionId) || !UUID.test(imageId)) return NOT_FOUND();

  const session = await auth();
  const image = await getPublicExamImage({
    sessionId,
    imageId,
    userId: session?.user?.id ?? null,
  });
  if (!image) return NOT_FOUND();

  return streamStoredObject(image.storageKey, request, {
    cacheControl: "private, no-store",
  });
}
