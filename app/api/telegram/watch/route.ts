import { NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { runTelegramWatch } from "@/lib/telegram/intake";

// ✈️ Queue worker: reports one Telegram upload's processing status in the
// chat and re-queues itself until the file is ready or has failed
// (lib/telegram/intake.ts). Reads the pipeline's rows; changes none.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  if (!(await verifyQStashRequest(rawBody, signature, request))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let uploadId = "";
  try {
    const body = JSON.parse(rawBody) as { uploadId?: string };
    uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
  } catch {
    // An unreadable payload can never succeed — ack it.
  }
  if (!uploadId) return NextResponse.json({ status: "skipped" });

  try {
    const status = await runTelegramWatch(uploadId);
    return NextResponse.json({ uploadId, status });
  } catch (error) {
    console.error("[Telegram] Watch failed", { uploadId, error });
    return NextResponse.json({ uploadId, status: "retry" }, { status: 500 });
  }
}
