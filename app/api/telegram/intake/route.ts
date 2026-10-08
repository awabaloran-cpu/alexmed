import { NextResponse } from "next/server";
import { getQueueMaxAttempts } from "@/lib/queue/types";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { runTelegramIntake } from "@/lib/telegram/intake";

// ✈️ Queue worker: copies one file the bot was sent into storage and starts
// it in the existing pipeline (lib/telegram/intake.ts).
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

  // QStash counts the deliveries it already retried; on the last one a
  // failure is reported to the student instead of thrown.
  const retried = Number(request.headers.get("upstash-retried") ?? 0);
  const finalAttempt = retried >= getQueueMaxAttempts() - 1;

  try {
    const status = await runTelegramIntake(uploadId, { finalAttempt });
    return NextResponse.json({ uploadId, status });
  } catch {
    // Already logged; a 500 asks the queue to deliver again.
    return NextResponse.json({ uploadId, status: "retry" }, { status: 500 });
  }
}
