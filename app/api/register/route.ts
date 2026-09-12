import { createUser, getUserByEmail } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { email, password, name } = parsed.data;

  // Wrapping the existence check too (not just createUser below) — a
  // transient DB error here previously propagated as an unhandled
  // exception, which Next.js turns into a bodyless 500 the client's
  // `response.json()` can't parse, surfacing as a generic "unexpected
  // error" instead of a real, actionable message.
  try {
    const existing = await getUserByEmail(email.toLowerCase().trim());
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const user = await createUser({ email, password, name });
    return NextResponse.json(
      { id: user.id, email: user.email },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Register] Failed to create user:", error);
    return NextResponse.json(
      { error: "Could not create account." },
      { status: 500 }
    );
  }
}
