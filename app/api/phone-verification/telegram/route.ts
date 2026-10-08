import { NextResponse } from "next/server";
import { z } from "zod";
import { parsePhone } from "@/lib/phone";
import { phoneSignupError, requestIp } from "@/lib/phone-signup-http";
import { startTelegramPhoneVerification } from "@/lib/telegram/phone-verify";

// Step 1 of phone sign-up, the Telegram way (lib/telegram/phone-verify.ts):
// instead of sending a code, answers with a one-time link to the bot, where
// the student shares their own number. Free — no SMS, no WhatsApp message.
const schema = z.object({
  phone: z.string().min(1).max(32),
  country: z.string().length(2).optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return phoneSignupError("bad_request");
  const phone = parsePhone(parsed.data.phone, parsed.data.country);
  if (!phone.ok) return phoneSignupError("invalid_phone");

  const result = await startTelegramPhoneVerification({
    phone: phone.e164,
    ip: requestIp(request),
  });
  if (!result.ok) return phoneSignupError(result.error);
  return NextResponse.json({
    verificationId: result.verificationId,
    phone: phone.e164,
    url: result.url,
  });
}
