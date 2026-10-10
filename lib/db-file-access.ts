import { and, eq, inArray } from "drizzle-orm";
import {
  adminMaterials,
  bookShares,
  books,
  decks,
  mirrorJobs,
} from "../drizzle/schema";
import { getBookAccess } from "./book-access";
import { getDb } from "./db";
import { isRoomFileKey } from "./study-rooms/live";

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

  // 📤 A study book's PDF is also readable by a student holding an ACCEPTED
  // share of it (lib/book-access.ts's rule) — pending/revoked/removed
  // shares grant nothing, so revoking immediately stops new signed URLs.
  // Study books only, matching lib/book-access.ts: sharing never applies to
  // a question file, so a share row must never open one's PDF either.
  const [sharedBook] = await db
    .select({ id: books.id })
    .from(books)
    .innerJoin(bookShares, eq(bookShares.bookId, books.id))
    .where(
      and(
        eq(books.fileKey, fileKey),
        eq(books.sourceType, "study_book"),
        eq(bookShares.recipientId, userId),
        eq(bookShares.status, "accepted")
      )
    )
    .limit(1);
  if (sharedBook) return true;

  // 👥 The file of a study room the user is IN right now (reading only;
  // lib/study-rooms/live.ts). Asked only while the feature is on.
  if (await isRoomFileKey(userId, fileKey)) return true;

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

  // Derived per-page images (extracted from the original PDF, not the PDF
  // itself) never equal any fileKey column above — they live under their own
  // prefix keyed by the owning job/book's id, produced by
  // app/api/mirror/extract-images/route.ts ("mirror-pages/{jobId}/...") and
  // app/api/books/extract-question-images/route.ts
  // ("question-files/{bookId}/..."). Missing these two cases meant every
  // such image 404'd here regardless of real ownership — caught live via a
  // broken-image icon on an otherwise-correct card.
  const mirrorPageMatch = fileKey.match(/^mirror-pages\/([^/]+)\//);
  if (mirrorPageMatch) {
    const [ownedMirrorJob] = await db
      .select({ id: mirrorJobs.id })
      .from(mirrorJobs)
      .where(
        and(
          eq(mirrorJobs.id, mirrorPageMatch[1]),
          eq(mirrorJobs.userId, userId)
        )
      )
      .limit(1);
    if (ownedMirrorJob) return true;
  }

  const questionFileMatch = fileKey.match(/^question-files\/([^/]+)\//);
  if (questionFileMatch) {
    const [ownedQuestionFileBook] = await db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.id, questionFileMatch[1]), eq(books.userId, userId)))
      .limit(1);
    if (ownedQuestionFileBook) return true;
  }

  // Rendered study-book pages ("book-pages/{bookId}/{n}.png", produced by
  // app/api/books/analyze-page-visuals/route.ts): owner or accepted share.
  const bookPageMatch = fileKey.match(/^book-pages\/([0-9a-f-]{36})\//i);
  if (bookPageMatch && (await getBookAccess(userId, bookPageMatch[1]))) {
    return true;
  }

  return false;
}

// Storage keys from a just-deleted book/account that are still referenced
// by some remaining row are removed from the list before the objects are
// deleted. Uploaded-file keys are client input, so a row can point at a
// file another user uploaded (rows created before keys were bound to their
// uploader — lib/upload-keys.ts); deleting that row must never delete the
// other user's file. Call AFTER the database delete.
export async function withoutKeysStillReferenced(
  keys: string[]
): Promise<string[]> {
  if (!keys.length) return keys;
  const db = getDb();
  if (!db) return [];
  const rows = await Promise.all([
    db
      .select({ k: books.fileKey })
      .from(books)
      .where(inArray(books.fileKey, keys)),
    db
      .select({ k: decks.fileKey })
      .from(decks)
      .where(inArray(decks.fileKey, keys)),
    db
      .select({ k: mirrorJobs.fileKey })
      .from(mirrorJobs)
      .where(inArray(mirrorJobs.fileKey, keys)),
    db
      .select({ k: adminMaterials.fileKey })
      .from(adminMaterials)
      .where(inArray(adminMaterials.fileKey, keys)),
  ]);
  const referenced = new Set(rows.flat().map(row => row.k));
  return keys.filter(key => !referenced.has(key));
}
