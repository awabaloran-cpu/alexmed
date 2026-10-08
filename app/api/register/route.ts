import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  createAccountWithVerifiedPhone,
  upgradeGuestWithVerifiedPhone,
} from "@/lib/db-phone";
import { phoneSignupError } from "@/lib/phone-signup-http";
import { isTelegramGuest } from "@/lib/telegram/accounts";
import { revokeLinkTokens } from "@/lib/telegram/tokens";

// Step 3 of phone sign-up (RegisterForm): creates the account from a phone
// number whose SMS code was already confirmed (verificationId). There is
// no other way to create a password account — a number is mandatory and
// verified; Google sign-in (lib/auth.ts) stays as it is.
const registerSchema = z.object({
  verificationId: z.string().uuid(),
  // bcrypt only uses the first 72 bytes; the caps stop megabyte-long
  // passwords/names from being hashed or stored at all.
  password: z
    .string()
    .min(8, "كلمة المرور لازم تكون 8 أحرف على الأقل.")
    .max(128, "كلمة المرور طويلة جداً."),
  name: z
    .string()
    .trim()
    .min(2, "اكتب اسمك (حرفين على الأقل).")
    .max(100, "الاسم طويل جداً."),
});

async function currentTelegramGuestId(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  return userId && (await isTelegramGuest(userId)) ? userId : null;
}

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة." },
      { status: 400 }
    );
  }

  try {
    // ✈️ A Telegram guest registering keeps their account: the guest row is
    // completed in place, so the files they already uploaded stay theirs.
    // Everyone else gets a new account, exactly as before.
    const guestId = await currentTelegramGuestId();
    const result = guestId
      ? await upgradeGuestWithVerifiedPhone({ ...parsed.data, userId: guestId })
      : await createAccountWithVerifiedPhone(parsed.data);
    if (!result.ok) {
      return phoneSignupError(
        result.error === "not_guest" ? "not_verified" : result.error
      );
    }
    // A registered account is never entered by a Telegram link again.
    if (guestId) await revokeLinkTokens(guestId, "web_login");
    return NextResponse.json(
      { id: result.userId, phone: result.phone },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Register] Failed to create user:", error);
    return NextResponse.json(
      { error: "تعذّر إنشاء الحساب. حاول مرة ثانية." },
      { status: 500 }
    );
  }
}
