import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";
import { googleEnabled } from "@/lib/auth";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm googleEnabled={googleEnabled} />
    </Suspense>
  );
}
