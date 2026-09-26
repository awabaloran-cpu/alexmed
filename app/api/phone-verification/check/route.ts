import { NextResponse } from "next/server";
import { z } from "zod";
import { checkPhoneVerification } from "@/lib/db-phone";
import { phoneSignupError } from "@/lib/phone-signup-http";
import { isSmsConfigured, SMS_CODE_LENGTH } from "@/lib/sms/vonage";

// Step 2 of phone sign-up: check the SMS code.
const schema = z.object({
  verificationId: z.string().uuid(),
  code: z
    .string()
    .regex(/^\d+$/)
    .length(SMS_CODE_LENGTH),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return phoneSignupError("wrong_code");
  if (!isSmsConfigured()) return phoneSignupError("sms_not_configured");

  const result = await checkPhoneVerification(parsed.data);
  if (!result.ok) return phoneSignupError(result.error);
  return NextResponse.json({ ok: true });
}
