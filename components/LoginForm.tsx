"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import NiroAuthScene from "@/components/niro/NiroAuthScene";
import { GoogleIcon, PasswordInput } from "@/components/AuthFields";
import { niroLine } from "@/lib/niro";

const SUSPENDED_MESSAGE_AR =
  "حسابك معلّق حاليًا. تواصل مع الدعم إذا كنت تظن أن هذا خطأ.";
const TOO_MANY_ATTEMPTS_MESSAGE_AR =
  "محاولات دخول كثيرة على هذا البريد. حاول بعد شوي.";

export default function LoginForm({
  googleEnabled,
}: {
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Phone number (phone sign-up accounts) or email (older / email accounts).
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  // The Google OAuth path (unlike Credentials' redirect:false) does a full
  // redirect back here with ?error=... on failure — e.g. after
  // lib/auth.ts's signIn callback rejects a suspended account.
  const [error, setError] = useState(
    searchParams.get("error") === "account_suspended"
      ? SUSPENDED_MESSAGE_AR
      : ""
  );
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      identifier,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      // next-auth puts a custom CredentialsSignin subclass's `code` in its
      // own field — `result.error` itself stays the generic
      // "CredentialsSignin" regardless (verified against the actual
      // /api/auth/callback/credentials response, not just the type decl).
      setError(
        result.code === "account_suspended"
          ? SUSPENDED_MESSAGE_AR
          : result.code === "too_many_attempts"
            ? TOO_MANY_ATTEMPTS_MESSAGE_AR
            : "رقم الهاتف (أو البريد) أو كلمة المرور غير صحيحة."
      );
      return;
    }

    router.push("/subjects");
    router.refresh();
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    await signIn("google", { callbackUrl: "/subjects" });
  }

  return (
    <NiroAuthScene
      expression={error ? "shocked" : loading ? "explaining" : "normal"}
      line={error ? niroLine("oops") : niroLine("welcomeBack")}
    >
      <h1 className="text-2xl font-bold text-foreground mb-1">تسجيل الدخول</h1>
      <p className="text-sm text-muted-foreground mb-6">
        مرحبًا بعودتك إلى NiroLearn
      </p>
      {searchParams.get("deleted") === "1" && (
        <p
          className="mb-5 rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
          role="status"
        >
          تم حذف حسابك وكل بياناتك نهائيًا. نتمنى لك التوفيق 🌱
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="identifier">رقم الهاتف أو البريد الإلكتروني</Label>
          <Input
            id="identifier"
            type="text"
            inputMode="email"
            required
            dir="ltr"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            autoComplete="username"
            placeholder="07X XXX XXXX"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">كلمة المرور</Label>
          <PasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "جاري الدخول..." : "دخول"}
        </Button>
      </form>

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">أو</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full niro-auth-google"
            disabled={googleLoading}
            onClick={handleGoogle}
          >
            <GoogleIcon />
            {googleLoading ? "جاري التحويل..." : "تسجيل الدخول عبر Google"}
          </Button>
        </>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        ليس لديك حساب؟{" "}
        <a href="/register" className="text-primary underline">
          أنشئ حسابًا
        </a>
      </p>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        <a href="/privacy" className="underline">
          سياسة الخصوصية
        </a>{" "}
        ·{" "}
        <a href="/terms" className="underline">
          سياسة الاستخدام
        </a>
      </p>
    </NiroAuthScene>
  );
}
