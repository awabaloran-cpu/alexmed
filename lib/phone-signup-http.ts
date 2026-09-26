// Shared bits of the phone sign-up API routes (app/api/phone-verification/*
// and app/api/register): the requester's IP (for per-device limits) and the
// Arabic message for every error the flow can return.
import { NextResponse } from "next/server";

// Railway / most proxies put the client first in X-Forwarded-For.
export function requestIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

const MESSAGES = {
  invalid_phone: "رقم الهاتف غير صحيح. تأكد من الرقم ومن رمز الدولة.",
  invalid_number: "ما قدرنا نرسل لهذا الرقم. تأكد إنه رقم موبايل صحيح.",
  phone_taken: "هذا الرقم مسجّل من قبل. سجّل دخولك بدلاً من إنشاء حساب.",
  cooldown: "استنى شوي قبل ما نرسل كود جديد.",
  too_many: "طلبات كثيرة على هذا الرقم. حاول بعد ساعة.",
  sms_failed: "تعذّر إرسال الرسالة الآن. حاول بعد قليل.",
  sms_not_configured: "التسجيل برقم الهاتف غير متاح حالياً. حاول لاحقاً.",
  wrong_code: "الكود غير صحيح. تأكد منه وحاول مرة ثانية.",
  expired: "انتهت صلاحية الكود. اطلب كوداً جديداً.",
  not_verified: "انتهت مهلة التحقق من الرقم. ابدأ من جديد.",
  bad_request: "بيانات غير صالحة.",
} as const;

export type PhoneSignupError = keyof typeof MESSAGES;

const STATUS: Record<PhoneSignupError, number> = {
  invalid_phone: 400,
  invalid_number: 400,
  phone_taken: 409,
  cooldown: 429,
  too_many: 429,
  sms_failed: 502,
  sms_not_configured: 503,
  wrong_code: 400,
  expired: 410,
  not_verified: 410,
  bad_request: 400,
};

export function phoneSignupError(
  error: PhoneSignupError,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json(
    { error: MESSAGES[error], code: error, ...extra },
    { status: STATUS[error] }
  );
}
