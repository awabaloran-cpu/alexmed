import "@/app/globals.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import RegisterForm from "@/components/RegisterForm";
import { googleEnabled } from "@/lib/auth";
import { BASE_OPEN_GRAPH } from "@/lib/site";

export const metadata: Metadata = {
  title: "إنشاء حساب مجاني | NiroLearn",
  description:
    "أنشئ حسابك المجاني في NiroLearn برقم هاتفك، وارفع أول ملف لتحوّله إلى ملخص وبطاقات واختبارات.",
  alternates: { canonical: "/register" },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: "/register",
    title: "إنشاء حساب مجاني | NiroLearn",
    description:
      "أنشئ حسابك المجاني في NiroLearn برقم هاتفك، وارفع أول ملف لتحوّله إلى ملخص وبطاقات واختبارات.",
  },
};

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm googleEnabled={googleEnabled} />
    </Suspense>
  );
}
