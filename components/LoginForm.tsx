"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const SUSPENDED_MESSAGE_AR =
  "حسابك معلّق حاليًا. تواصل مع الدعم إذا كنت تظن أن هذا خطأ.";

export default function LoginForm({
  googleEnabled,
}: {
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
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
      email,
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
          : "البريد الإلكتروني أو كلمة المرور غير صحيحة."
      );
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    await signIn("google", { callbackUrl: "/" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-foreground mb-1">
          تسجيل الدخول
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          مرحبًا بعودتك إلى مِرآة
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">كلمة المرور</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
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
              className="w-full"
              disabled={googleLoading}
              onClick={handleGoogle}
            >
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
      </div>
    </div>
  );
}
