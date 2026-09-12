import { and, eq } from "drizzle-orm";
import { adminMaterials, books, decks, mirrorJobs } from "../drizzle/schema";
import { getDb } from "./db";

// Authorization for app/api/files/[...key]/route.ts — the one generic
// "serve me a signed URL for this storage key" endpoint. A raw storage key
// carries no owner info by itself, so this checks the key against every
// table that can hand one out, using each table's own already-established
// access rule (owner-only for books/decks/mirrorJobs; "published" for
// adminMaterials, matching studentMaterialsRouter.ts) rather than inventing
// a new one. Returns true only if this exact user is allowed to read this
// exact key right now.
export async function isFileKeyAccessibleToUser(
  userId: string,
  fileKey: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const [ownedBook] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.fileKey, fileKey), eq(books.userId, userId)))
    .limit(1);
  if (ownedBook) return true;

  const [ownedDeck] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.fileKey, fileKey), eq(decks.userId, userId)))
    .limit(1);
  if (ownedDeck) return true;

  const [ownedJob] = await db
    .select({ id: mirrorJobs.id })
    .from(mirrorJobs)
    .where(and(eq(mirrorJobs.fileKey, fileKey), eq(mirrorJobs.userId, userId)))
    .limit(1);
  if (ownedJob) return true;

  const [publishedMaterial] = await db
    .select({ id: adminMaterials.id })
    .from(adminMaterials)
    .where(
      and(
        eq(adminMaterials.fileKey, fileKey),
        eq(adminMaterials.status, "published")
      )
    )
    .limit(1);
  if (publishedMaterial) return true;

  return false;
}
