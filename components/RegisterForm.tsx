"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageSquareText, Pencil } from "lucide-react";
import NiroAuthScene from "@/components/niro/NiroAuthScene";
import { GoogleIcon, PasswordInput } from "@/components/AuthFields";
import { niroLine } from "@/lib/niro";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  findCountry,
  formatPhoneForDisplay,
  parsePhone,
} from "@/lib/phone";

const CODE_LENGTH = 6;
type Step = "phone" | "code" | "details";
const STEPS: { id: Step; label: string }[] = [
  { id: "phone", label: "رقم الهاتف" },
  { id: "code", label: "كود التحقق" },
  { id: "details", label: "بياناتك" },
];

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { ok: response.ok, data };
}

// Phone sign-up (a number is mandatory and verified by SMS — server side in
// lib/db-phone.ts): 1) number → 2) 6-digit code → 3) name + password, then
// the student is signed in. Google sign-up stays available on step 1.
export default function RegisterForm({
  googleEnabled,
}: {
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [country, setCountry] = useState(DEFAULT_PHONE_COUNTRY);
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState(""); // E.164, once the code was sent
  const [verificationId, setVerificationId] = useState("");
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Resend countdown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const selected = findCountry(country) ?? PHONE_COUNTRIES[0];

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    setError("");
    const parsed = parsePhone(phoneInput, country);
    if (!parsed.ok) {
      setError(
        parsed.reason === "empty"
          ? "اكتب رقم هاتفك."
          : "رقم الهاتف غير صحيح. تأكد من الرقم ومن الدولة."
      );
      return;
    }
    setLoading(true);
    try {
      const { ok, data } = await postJson("/api/phone-verification/start", {
        phone: phoneInput,
        country,
      });
      if (!ok) {
        setError(String(data.error ?? "تعذّر إرسال الكود."));
        if (typeof data.retryAfterSeconds === "number") {
          setResendIn(data.retryAfterSeconds);
        }
        return;
      }
      setPhone(String(data.phone));
      setVerificationId(String(data.verificationId));
      setResendIn(Number(data.resendAfterSeconds) || 60);
      setCode("");
      setStep("code");
    } catch {
      setError("تعذّر الاتصال. تأكد من الإنترنت وحاول مرة ثانية.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(value: string) {
    if (value.length !== CODE_LENGTH || loading) return;
    setError("");
    setLoading(true);
    try {
      const { ok, data } = await postJson("/api/phone-verification/check", {
        verificationId,
        code: value,
      });
      if (!ok) {
        setError(String(data.error ?? "الكود غير صحيح."));
        setCode("");
        return;
      }
      setStep("details");
    } catch {
      setError("تعذّر الاتصال. تأكد من الإنترنت وحاول مرة ثانية.");
    } finally {
      setLoading(false);
    }
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { ok, data } = await postJson("/api/register", {
        verificationId,
        name,
        password,
      });
      if (!ok) {
        setError(String(data.error ?? "تعذّر إنشاء الحساب."));
        // The verification expired / was used: start over from the number.
        if (data.code === "not_verified" || data.code === "phone_taken") {
          setStep("phone");
        }
        return;
      }
      const result = await signIn("credentials", {
        identifier: phone,
        password,
        redirect: false,
      });
      if (result?.error) {
        router.push("/login");
        return;
      }
      router.push("/subjects");
      router.refresh();
    } catch {
      setError("حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    await signIn("google", { callbackUrl: "/subjects" });
  }

  const stepIndex = STEPS.findIndex(s => s.id === step);

  return (
    <NiroAuthScene
      expression={
        error
          ? "shocked"
          : loading
            ? "explaining"
            : step === "details"
              ? "victory"
              : "normal"
      }
      line={
        error
          ? niroLine("oops")
          : step === "code"
            ? "بعتلك كود على موبايلك 📩 اكتبه هون"
            : step === "details"
              ? "تمام، رقمك مؤكَّد ✅ ضايل اسمك وكلمة السر"
              : niroLine("join")
      }
    >
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-1">إنشاء حساب</h1>
        <p className="text-sm text-muted-foreground mb-4">
          انضم إلى NiroLearn لحفظ مذاكرتك
        </p>

        <ol className="signup-steps" aria-label="خطوات إنشاء الحساب">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className={
                i < stepIndex ? "is-done" : i === stepIndex ? "is-current" : ""
              }
              aria-current={i === stepIndex ? "step" : undefined}
            >
              <span>{i < stepIndex ? "✓" : i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>

        {step === "phone" && (
          <form onSubmit={sendCode} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="phone">رقم الهاتف</Label>
              <div className="signup-phone" dir="ltr">
                <select
                  aria-label="الدولة"
                  value={country}
                  onChange={event => setCountry(event.target.value)}
                >
                  {PHONE_COUNTRIES.map(c => (
                    <option key={c.iso} value={c.iso}>
                      {c.flag} +{c.dial}
                    </option>
                  ))}
                </select>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  required
                  value={phoneInput}
                  onChange={event => setPhoneInput(event.target.value)}
                  placeholder={selected.example}
                  aria-describedby="phone-hint"
                />
              </div>
              <p id="phone-hint" className="text-xs text-muted-foreground">
                رح نبعتلك كود من {CODE_LENGTH} أرقام برسالة SMS للتأكد إنه رقمك.
                الرقم إجباري ولن يظهر لأي شخص.
              </p>
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "جاري الإرسال..." : "أرسل كود التحقق"}
            </Button>
          </form>
        )}

        {step === "code" && (
          <div className="space-y-4">
            <div className="signup-sent">
              <MessageSquareText size={18} aria-hidden="true" />
              <p>
                أرسلنا كوداً إلى{" "}
                <bdi dir="ltr">{formatPhoneForDisplay(phone)}</bdi>
              </p>
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setError("");
                }}
              >
                <Pencil size={14} aria-hidden="true" /> تغيير الرقم
              </button>
            </div>
            <div className="signup-otp" dir="ltr">
              <InputOTP
                maxLength={CODE_LENGTH}
                value={code}
                onChange={value => {
                  const digits = value.replace(/\D/g, "");
                  setCode(digits);
                  if (digits.length === CODE_LENGTH) void verifyCode(digits);
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="^[0-9]*$"
                disabled={loading}
                autoFocus
                aria-label="كود التحقق"
              >
                <InputOTPGroup>
                  {Array.from({ length: CODE_LENGTH }, (_, i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            {error && (
              <p className="text-sm text-destructive text-center" role="alert">
                {error}
              </p>
            )}
            <Button
              type="button"
              className="w-full"
              disabled={loading || code.length !== CODE_LENGTH}
              onClick={() => verifyCode(code)}
            >
              {loading ? "جاري التحقق..." : "تأكيد"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              ما وصلك الكود؟{" "}
              {resendIn > 0 ? (
                <span>
                  أعد الإرسال بعد <bdi dir="ltr">{resendIn}</bdi> ث
                </span>
              ) : (
                <button
                  type="button"
                  className="text-primary underline"
                  disabled={loading}
                  onClick={() => sendCode()}
                >
                  أعد الإرسال
                </button>
              )}
            </p>
          </div>
        )}

        {step === "details" && (
          <form onSubmit={createAccount} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">الاسم</Label>
              <Input
                id="name"
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={event => setName(event.target.value)}
                autoComplete="name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <PasswordInput
                id="password"
                minLength={8}
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                8 أحرف على الأقل. رح تدخل برقم هاتفك وكلمة المرور هذه.
              </p>
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "جاري الإنشاء..." : "إنشاء الحساب"}
            </Button>
          </form>
        )}

        {step === "phone" && googleEnabled && (
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
              {googleLoading ? "جاري التحويل..." : "التسجيل عبر Google"}
            </Button>
          </>
        )}

        <p className="mt-5 text-center text-xs text-muted-foreground leading-6">
          بإنشاء حساب فإنك توافق على{" "}
          <a href="/terms" className="text-primary underline">
            سياسة الاستخدام
          </a>{" "}
          و
          <a href="/privacy" className="text-primary underline">
            سياسة الخصوصية
          </a>
          .
        </p>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          لديك حساب؟{" "}
          <a href="/login" className="text-primary underline">
            سجّل الدخول
          </a>
        </p>
      </div>
    </NiroAuthScene>
  );
}
