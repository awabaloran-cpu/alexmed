import { NextResponse } from "next/server";
import { z } from "zod";
import { GoogleTokenError, verifyGoogleIdToken } from "@/lib/google-id-token";
import { signInWithGoogle } from "@/lib/mobile-google";
import { issueMobileSession } from "@/lib/mobile-session";

// Native app Google sign-in (docs/mobile/MOBILE_ARCHITECTURE_BLUEPRINT.md §9,
// gap G2): the app sends the Google ID token it got from Google Sign-In; the
// server verifies it (Google's keys, issuer, audience = a web client,
// authorised party = the app's Android client) and signs in with the same
// account rules as the web's Google button (lib/mobile-google.ts). Returns
// the same session as /api/mobile/auth/login. The web's Google OAuth
// configuration is not touched.

// The app's OAuth clients live in their own Google Cloud project, apart from
// the site's: the Android client (package com.nirolearn.app) and the web
// client the app names as serverClientId, which becomes the token's audience.
// Google's `sub` is the same for an account in every project, so accounts
// match the ones the web's Google button links. Client IDs are public;
// GOOGLE_MOBILE_CLIENT_IDS (comma-separated) can add more (iOS).
const ANDROID_CLIENT_ID =
  "342475897969-e9m19r0t8u47r07nnpslqn0tp5artnmb.apps.googleusercontent.com";
const APP_WEB_CLIENT_ID =
  "342475897969-tcogc9hjlfe5nlgqdkhm1opsk126j2ed.apps.googleusercontent.com";

function mobileClientIds(): string[] {
  const extra = (process.env.GOOGLE_MOBILE_CLIENT_IDS ?? "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);
  return [ANDROID_CLIENT_ID, ...extra];
}

const bodySchema = z.object({ idToken: z.string().min(20).max(8192) });
const NO_STORE = { "Cache-Control": "no-store" };

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ error, code }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const webClientId = process.env.GOOGLE_CLIENT_ID;
  if (!webClientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return fail(
      503,
      "google_unavailable",
      "الدخول بحساب Google غير متاح حاليًا."
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      400,
      "bad_request",
      "تعذّر الدخول بحساب Google. حاول مرة أخرى."
    );
  }

  let claims;
  try {
    claims = await verifyGoogleIdToken(parsed.data.idToken, {
      audiences: [APP_WEB_CLIENT_ID, webClientId],
      authorizedParties: mobileClientIds(),
    });
  } catch (error) {
    if (error instanceof GoogleTokenError) {
      return fail(
        401,
        "invalid_google_token",
        "تعذّر التحقق من حساب Google. حاول مرة أخرى."
      );
    }
    console.error("[MobileGoogle] Token verification failed", error);
    return fail(
      502,
      "google_unavailable",
      "تعذّر الوصول إلى Google الآن. حاول بعد قليل."
    );
  }

  const result = await signInWithGoogle(claims);
  if (!result.ok) {
    switch (result.reason) {
      case "suspended":
        return fail(
          403,
          "account_suspended",
          "حسابك معلّق حاليًا. تواصل مع الدعم إذا كنت تظن أن هذا خطأ."
        );
      case "not_linked":
        return fail(
          409,
          "account_not_linked",
          "يوجد حساب بهذا البريد. سجّل الدخول برقم الهاتف أو البريد وكلمة المرور."
        );
      default:
        return fail(
          403,
          "unverified_email",
          "بريد حساب Google هذا غير موثّق. وثّقه في Google ثم حاول مجددًا."
        );
    }
  }

  const session = await issueMobileSession(result.user, request.url);
  return NextResponse.json(
    {
      ...session,
      created: result.created,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
      },
    },
    { headers: NO_STORE }
  );
}
