import { auth } from "@/lib/auth";
import { isFileKeyAccessibleToUser } from "@/lib/db-file-access";
import { storageGetSignedUrl } from "@/lib/storage";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;
  const relKey = key.join("/");

  if (!relKey) {
    return NextResponse.json({ error: "Missing storage key" }, { status: 400 });
  }

  // Ownership check — a raw key alone proves nothing; verify it belongs to
  // a resource this user may read before ever signing a URL for it. Returns
  // 404 (not 403) so an unauthorized guess can't distinguish "not yours"
  // from "doesn't exist".
  const allowed = await isFileKeyAccessibleToUser(session.user.id, relKey);
  if (!allowed) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const url = await storageGetSignedUrl(relKey);
    return NextResponse.redirect(url, {
      status: 307,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[Files] Failed to sign storage URL:", error);
    return NextResponse.json({ error: "Storage error" }, { status: 502 });
  }
}
