import { NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/queue/verify";
import { runSummary } from "@/lib/summary/run";

// 📝 Queue worker: one run of a summary job (lib/summary/run.ts) — the next
// pages of the file, or the finished PDF sent to the student. The job
// queues its own next run and its own retries, so this always acks.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  if (!(await verifyQStashRequest(rawBody, signature, request))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let summaryId = "";
  try {
    const body = JSON.parse(rawBody) as { summaryId?: string };
    summaryId = typeof body.summaryId === "string" ? body.summaryId : "";
  } catch {
    // An unreadable payload can never succeed — ack it.
  }
  if (!summaryId) return NextResponse.json({ status: "skipped" });

  try {
    const status = await runSummary(summaryId);
    return NextResponse.json({ summaryId, status });
  } catch (error) {
    // Only what runSummary could not handle itself (the database, the
    // queue): let the queue deliver this run again.
    console.error("[Summary] Worker failed", { summaryId, error });
    return NextResponse.json({ summaryId, status: "retry" }, { status: 500 });
  }
}
