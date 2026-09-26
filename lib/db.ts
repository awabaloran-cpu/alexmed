import { and, count, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  cards,
  decks,
  mirrorBatches,
  mirrorJobs,
  mirrorPageImages,
  users,
} from "../drizzle/schema";
import { storageGet } from "./storage";
import type { GeneratedCard } from "./pdf-cards";
import {
  buildDeckSections,
  pickDeckJob,
  sectionIdForCard,
  sortCardsBySection,
  totalFailedBatches,
  type DeckJobInfo,
} from "./deck-sections";
import { associateImagesWithQuestions } from "./question-file-analysis";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
// `max`/`connect_timeout` are connection-pool hygiene per serverless
// instance, not the real concurrency lever — the actual cap on how many
// batches/chapters process at once is QUEUE_GLOBAL_CONCURRENCY (see
// lib/queue/types.ts), enforced via QStash Flow Control and a DB backstop.
export function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    const client = postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: 5,
      connect_timeout: 10,
    });
    _db = drizzle(client);
  }
  return _db;
}

// @auth/drizzle-adapter needs the raw drizzle instance (it runs its own
// queries against the tables we hand it in lib/auth.ts) — getDb() already
// throws/returns null when DATABASE_URL is unset, which is fine since Auth.js
// itself would have nothing to authenticate against in that case either.
export function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}

export async function getUserByEmail(email: string) {
  const db = getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Phone login — `phone` must already be E.164 (lib/phone.ts's parsePhone).
export async function getUserByPhone(phone: string) {
  const db = getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: string) {
  const db = getDb();
  if (!db) return undefined;

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function touchLastSignedIn(id: string) {
  const db = getDb();
  if (!db) return;
  await db
    .update(users)
    .set({ lastSignedIn: new Date() })
    .where(eq(users.id, id));
}

// PR18 — safe fields only (never passwordHash) for the account page's own
// profile view; getUserById returns the full row and stays worker/auth-only.
export async function getUserProfileForAccount(userId: string) {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      phone: users.phone,
      name: users.name,
      plan: users.plan,
      planExpiresAt: users.planExpiresAt,
      academicYear: users.academicYear,
      specialty: users.specialty,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function updateUserProfile(
  userId: string,
  input: { academicYear?: string | null; specialty?: string | null }
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(users)
    .set({
      ...(input.academicYear !== undefined
        ? { academicYear: input.academicYear }
        : {}),
      ...(input.specialty !== undefined ? { specialty: input.specialty } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function createDeckWithCards(
  userId: string,
  input: {
    fileName: string;
    fileKey?: string | null;
    pageCount: number;
    depth: string;
    cards: GeneratedCard[];
  }
) {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const [deck] = await db
    .insert(decks)
    .values({
      userId,
      fileName: input.fileName,
      fileKey: input.fileKey ?? null,
      pageCount: input.pageCount,
      depth: input.depth,
    })
    .returning();

  if (input.cards.length) {
    await db.insert(cards).values(
      input.cards.map(card => ({
        deckId: deck.id,
        question: card.question,
        questionArabic: card.questionArabic,
        answer: card.answer,
        answerArabic: card.answerArabic,
        explanation: card.explanation,
        explanationArabic: card.explanationArabic,
        keyIdea: card.keyIdea,
        keyIdeaArabic: card.keyIdeaArabic,
        keyword: card.keyword,
        keywordArabic: card.keywordArabic,
        sourcePage: card.sourcePage,
        status: card.status,
        confidence: card.confidence,
      }))
    );
  }

  return deck;
}

export async function listDecksForUser(userId: string) {
  const db = getDb();
  if (!db) return [];

  return db
    .select({
      id: decks.id,
      subjectId: decks.subjectId,
      fileName: decks.fileName,
      pageCount: decks.pageCount,
      depth: decks.depth,
      createdAt: decks.createdAt,
      cardCount: count(cards.id),
    })
    .from(decks)
    .leftJoin(cards, eq(cards.deckId, decks.id))
    .where(eq(decks.userId, userId))
    .groupBy(decks.id)
    .orderBy(desc(decks.createdAt));
}

// `job` is non-null only for a deck created by مِرآة's background pipeline
// (see finalizeMirrorJobExtraction in lib/db-mirror.ts, which creates the
// deck immediately and sets mirrorJobs.deckId before any batch has generated
// a card) — it's what lets the review UI (components/Home.tsx) know whether
// to keep polling for more cards and whether to surface a failed-batch
// notice. A deck created any other way (e.g. decksRouter.create) has no
// associated job, so `job` is null and the UI behaves exactly as before —
// one static fetch, no polling.
export async function getDeckWithCards(userId: string, deckId: string) {
  const db = getDb();
  if (!db) return null;

  const [deck] = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);
  if (!deck) return null;

  const deckCards = await db
    .select()
    .from(cards)
    .where(eq(cards.deckId, deckId))
    .orderBy(cards.sourcePage);

  // A deck can have several jobs: its original upload plus any later
  // pasted-text additions (see lib/deck-sections.ts). Each card is grouped
  // under the job that made it.
  const jobRows = await db
    .select({
      id: mirrorJobs.id,
      status: mirrorJobs.status,
      fileName: mirrorJobs.fileName,
      sourceType: mirrorJobs.sourceType,
      createdAt: mirrorJobs.createdAt,
    })
    .from(mirrorJobs)
    .where(eq(mirrorJobs.deckId, deckId))
    .orderBy(mirrorJobs.createdAt);

  const failedRows = jobRows.length
    ? await db
        .select({ jobId: mirrorBatches.jobId, c: count() })
        .from(mirrorBatches)
        .where(
          and(
            inArray(
              mirrorBatches.jobId,
              jobRows.map(row => row.id)
            ),
            eq(mirrorBatches.status, "failed")
          )
        )
        .groupBy(mirrorBatches.jobId)
    : [];
  const failedByJob = new Map(
    failedRows.map(row => [row.jobId, Number(row.c)])
  );
  const jobs: DeckJobInfo[] = jobRows.map(row => ({
    ...row,
    failedBatchCount: failedByJob.get(row.id) ?? 0,
  }));

  const sections = buildDeckSections(jobs, deckCards);
  const sectionedCards = deckCards.map(card => ({
    ...card,
    sectionId: sectionIdForCard(card, jobs),
  }));

  // Multimodal مِرآة — computed live from mirrorPageImages rather than a
  // persisted card<->image join, since cards arrive progressively across
  // many separately-timed batches (see drizzle/schema.ts's mirrorPageImages
  // comment for the full rationale). Only an uploaded-PDF job has page
  // images, and they may only attach to that job's OWN cards: a pasted-text
  // addition's cards use chunk numbers as sourcePage, which would otherwise
  // collide with the PDF's real page numbers.
  const imageByCardId = new Map<string, string>();
  for (const job of jobs.filter(job => job.sourceType !== "text")) {
    const pageImages = await db
      .select({
        id: mirrorPageImages.id,
        pageNumber: mirrorPageImages.pageNumber,
        storageKey: mirrorPageImages.storageKey,
        isAtPageEnd: mirrorPageImages.isAtPageEnd,
      })
      .from(mirrorPageImages)
      .where(eq(mirrorPageImages.jobId, job.id))
      .orderBy(mirrorPageImages.pageNumber);

    if (pageImages.length) {
      const urlByImageId = new Map(
        await Promise.all(
          pageImages.map(
            async image =>
              [image.id, (await storageGet(image.storageKey)).url] as const
          )
        )
      );
      // Shared with كتبي's identical question-files pipeline — see
      // lib/question-file-analysis.ts's associateImagesWithQuestions for the
      // isAtPageEnd rationale (a figure at the bottom of a page with no
      // question text after it belongs to the next page's questions).
      const relations = associateImagesWithQuestions(
        pageImages,
        sectionedCards
          .filter(card => card.sectionId === job.id)
          .map(card => ({ id: card.id, sourcePage: card.sourcePage }))
      );
      for (const relation of relations) {
        const url = urlByImageId.get(relation.imageId);
        if (url) imageByCardId.set(relation.questionId, url);
      }
    }
  }

  // The job the review UI polls and reports on — see pickDeckJob. Its
  // failedBatchCount is the deck-wide total so the warning banner reflects
  // every section, not only the job that happens to be picked.
  const activeJob = pickDeckJob(jobs);

  return {
    deck,
    cards: sortCardsBySection(
      sectionedCards.map(card => ({
        ...card,
        imageUrl: imageByCardId.get(card.id) ?? null,
      })),
      sections
    ),
    sections,
    job: activeJob
      ? {
          id: activeJob.id,
          status: activeJob.status,
          failedBatchCount: totalFailedBatches(jobs),
        }
      : null,
  };
}

export async function deleteDeck(userId: string, deckId: string) {
  const db = getDb();
  if (!db) throw new Error("Database not available");

  const deleted = await db
    .delete(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .returning({ id: decks.id });
  return deleted.length > 0;
}
