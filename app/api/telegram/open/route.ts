import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { safeCallbackUrl } from "@/lib/safe-redirect";

// ✈️ Where a REGISTERED student's bot button lands (lib/telegram/links.ts):
// straight to the page when they are signed in on this browser, otherwise
// to the normal login and then on to the page. Nothing is signed in here.
export async function GET(request: Request) {
  const to = safeCallbackUrl(new URL(request.url).searchParams.get("to"));
  const session = await auth();
  // A relative Location keeps the browser on the host it is already on.
  return new NextResponse(null, {
    status: 303,
    headers: {
      "Cache-Control": "private, no-store",
      Location: session?.user
        ? to
        : `/login?callbackUrl=${encodeURIComponent(to)}`,
    },
  });
}
