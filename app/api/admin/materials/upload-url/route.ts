import { auth } from "@/lib/auth";
import { storageGetUploadUrl } from "@/lib/storage";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

const DEFAULT_MAX_MB = 250;

function getMaxUploadBytes() {
  const configured = Number(process.env.UPLOAD_MAX_MB);
  const maxMb =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_MB;
  return { maxMb, maxBytes: maxMb * 1024 * 1024 };
}

// Admin-only counterpart to app/api/pdf/upload-url/route.ts — identical
// direct-to-storage presigned-PUT flow, gated by role instead of plain
// login. Own key prefix ("admin-materials/") so an admin's raw uploads never
// share a storage namespace with مِرآة's.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "الرجاء تسجيل الدخول أولاً." },
      { status: 401 }
    );
  }
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "هذا الإجراء متاح للأدمن فقط." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    fileName?: string;
    fileSize?: number;
    contentType?: string;
  };

  const fileName = typeof body.fileName === "string" ? body.fileName : "";
  const fileSize = typeof body.fileSize === "number" ? body.fileSize : NaN;

  if (!fileName || !fileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "الملف يجب أن يكون بصيغة PDF." },
      { status: 400 }
    );
  }

  const { maxMb, maxBytes } = getMaxUploadBytes();
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ error: "حجم الملف غير صالح." }, { status: 400 });
  }
  if (fileSize > maxBytes) {
    return NextResponse.json(
      { error: `حجم الملف أكبر من ${maxMb}MB في النسخة الحالية.` },
      { status: 413 }
    );
  }

  const key = `admin-materials/${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  // Always PDF: only .pdf names are accepted above, and the type is signed
  // into the upload URL — a client-chosen type (e.g. text/html) would let a
  // file be served back from storage as a web page.
  const contentType = "application/pdf";

  try {
    const uploadUrl = await storageGetUploadUrl(key, contentType);
    return NextResponse.json({ key, uploadUrl });
  } catch (error) {
    console.error("[AdminMaterials] Failed to create upload URL", error);
    return NextResponse.json(
      { error: "تعذر تجهيز رابط الرفع. حاول مرة أخرى." },
      { status: 502 }
    );
  }
}
