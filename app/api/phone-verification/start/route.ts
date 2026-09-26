import { NextResponse } from "next/server";
import { z } from "zod";
import { startPhoneVerification } from "@/lib/db-phone";
import { parsePhone } from "@/lib/phone";
import { phoneSignupError, requestIp } from "@/lib/phone-signup-http";
import { isSmsConfigured } from "@/lib/sms/vonage";

// Step 1 of phone sign-up: validate the number and send the SMS code.
const schema = z.object({
  phone: z.string().min(1).max(32),
  country: z.string().length(2).optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return phoneSignupError("bad_request");
  const phone = parsePhone(parsed.data.phone, parsed.data.country);
  if (!phone.ok) return phoneSignupError("invalid_phone");
  if (!isSmsConfigured()) return phoneSignupError("sms_not_configured");

  const result = await startPhoneVerification({
    phone: phone.e164,
    ip: requestIp(request),
  });
  if (!result.ok) {
    return phoneSignupError(result.error, {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
  return NextResponse.json({
    verificationId: result.verificationId,
    phone: phone.e164,
    resendAfterSeconds: result.resendAfterSeconds,
  });
}
