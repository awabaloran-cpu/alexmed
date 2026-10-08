import { NextResponse } from "next/server";
import { z } from "zod";
import { getPhoneVerificationStatus } from "@/lib/telegram/phone-verify";

// What the sign-up page polls while the student is in Telegram sharing
// their number: "pending" | "verified" | "expired". The verification id is
// a random UUID known only to the browser that started it, and the answer
// says nothing about the number.
const schema = z.object({ verificationId: z.string().uuid() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ status: "expired" }, { status: 400 });
  }
  return NextResponse.json(
    { status: await getPhoneVerificationStatus(parsed.data.verificationId) },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
