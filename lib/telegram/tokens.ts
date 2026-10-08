// ✈️ Single-purpose link tokens (access_link_tokens).
//
// A token is 32 random bytes, shown once inside a link; the database keeps
// only its SHA-256. So a database read never yields a working link, and a
// token cannot be guessed or enumerated. Every lookup also checks purpose,
// expiry and revocation.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { accessLinkTokens } from "../../drizzle/schema";
import { requireDb } from "../db";

export type LinkPurpose = "web_login" | "telegram_link";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// A destination inside this site only: one leading slash, no scheme, no
// protocol-relative or backslash form a browser could read as another host.
export function safeInternalPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/")) return "/subjects";
  if (path.startsWith("//") || path.includes("\\") || /[\r\n]/.test(path)) {
    return "/subjects";
  }
  return path;
}

export async function createLinkToken(input: {
  userId: string;
  purpose: LinkPurpose;
  path?: string | null;
  ttlMinutes: number;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await requireDb()
    .insert(accessLinkTokens)
    .values({
      tokenHash: hashToken(token),
      purpose: input.purpose,
      userId: input.userId,
      path: input.path ? safeInternalPath(input.path) : null,
      expiresAt: new Date(Date.now() + input.ttlMinutes * 60_000),
    });
  return token;
}

export type LinkTokenRow = {
  id: string;
  userId: string;
  path: string | null;
};

// The live row for `token`, or null — wrong shape, unknown, wrong purpose,
// expired and revoked all look the same to the caller.
export async function findLinkToken(
  token: string,
  purpose: LinkPurpose
): Promise<LinkTokenRow | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await requireDb()
    .select({
      id: accessLinkTokens.id,
      userId: accessLinkTokens.userId,
      path: accessLinkTokens.path,
    })
    .from(accessLinkTokens)
    .where(
      and(
        eq(accessLinkTokens.tokenHash, hashToken(token)),
        eq(accessLinkTokens.purpose, purpose),
        isNull(accessLinkTokens.revokedAt),
        gt(accessLinkTokens.expiresAt, new Date())
      )
    )
    .limit(1);
  return row ?? null;
}

// One-time use: the UPDATE only matches a live, unused row, so two
// simultaneous attempts cannot both succeed.
export async function consumeLinkToken(
  token: string,
  purpose: LinkPurpose
): Promise<LinkTokenRow | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await requireDb()
    .update(accessLinkTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(accessLinkTokens.tokenHash, hashToken(token)),
        eq(accessLinkTokens.purpose, purpose),
        isNull(accessLinkTokens.revokedAt),
        isNull(accessLinkTokens.usedAt),
        gt(accessLinkTokens.expiresAt, new Date())
      )
    )
    .returning({
      id: accessLinkTokens.id,
      userId: accessLinkTokens.userId,
      path: accessLinkTokens.path,
    });
  return row ?? null;
}

export async function markLinkTokenUsed(id: string): Promise<void> {
  await requireDb()
    .update(accessLinkTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(accessLinkTokens.id, id), isNull(accessLinkTokens.usedAt)));
}

// Every live link of a user stops working (the account was registered, or
// Telegram was unlinked).
export async function revokeLinkTokens(
  userId: string,
  purpose?: LinkPurpose
): Promise<void> {
  await requireDb()
    .update(accessLinkTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(accessLinkTokens.userId, userId),
        isNull(accessLinkTokens.revokedAt),
        purpose ? eq(accessLinkTokens.purpose, purpose) : undefined
      )
    );
}
