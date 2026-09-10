// Read-only aggregation for the admin-only Jobs monitoring page/endpoint
// (app/admin/jobs, lib/trpc/adminJobsRouter.ts — gated by adminProcedure,
// i.e. userRoleEnum === "admin"). Deliberately its OWN file, separate from
// lib/db-books.ts/lib/db-mirror.ts/lib/db-admin-materials.ts, so every query
// an admin can see is reviewable in one place against the constraints this
// page must respect:
//   - never select fileKey/storageKey/previewKey (no S3 links, signed or not)
//   - never select pageTexts/extractedText/explanationAr/explanationEn/etc.
//     (no full book/card text)
//   - error messages are truncated before leaving this module
// fileName/title ARE selected — they're identifiers an admin needs to find a
// job, not secrets or content.
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  adminMaterialBatches,
  adminMaterials,
  bookChapters,
  bookPages,
  books,
  mirrorBatches,
  mirrorJobs,
} from "../drizzle/schema";
import { getDb } from "./db";

const ERROR_MESSAGE_MAX_LENGTH = 200;
const DEFAULT_JOB_LIST_LIMIT = 50;

function truncateError(message: string | null | undefined): string | null {
  if (!message) return null;
  return message.length > ERROR_MESSAGE_MAX_LENGTH
    ? `${message.slice(0, ERROR_MESSAGE_MAX_LENGTH)}…`
    : message;
}

export type AdminBookJob = {
  id: string;
  fileName: string;
  status: string;
  pageCount: number;
  extractionAttemptCount: number;
  extractionError: string | null;
  createdAt: Date;
  updatedAt: Date;
  chapters: { total: number; complete: number; failed: number };
  pages: { total: number; complete: number; failed: number };
};

export async function listBookJobsForAdmin(
  limit = DEFAULT_JOB_LIST_LIMIT
): Promise<AdminBookJob[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: books.id,
      fileName: books.fileName,
      status: books.status,
      pageCount: books.pageCount,
      extractionAttemptCount: books.extractionAttemptCount,
      extractionError: books.extractionError,
      createdAt: books.createdAt,
      updatedAt: books.updatedAt,
      chapterTotal: count(bookChapters.id),
      chapterComplete: count(
        sql`case when ${bookChapters.status} = 'complete' then 1 end`
      ),
      chapterFailed: count(
        sql`case when ${bookChapters.status} = 'failed' then 1 end`
      ),
    })
    .from(books)
    .leftJoin(bookChapters, eq(bookChapters.bookId, books.id))
    .groupBy(books.id)
    .orderBy(desc(books.updatedAt))
    .limit(limit);

  const bookIds = rows.map(row => row.id);
  const pageStats = bookIds.length
    ? await db
        .select({
          bookId: bookPages.bookId,
          total: count(),
          complete: count(
            sql`case when ${bookPages.textStatus} = 'complete' then 1 end`
          ),
          failed: count(
            sql`case when ${bookPages.textStatus} = 'failed' then 1 end`
          ),
        })
        .from(bookPages)
        .where(inArray(bookPages.bookId, bookIds))
        .groupBy(bookPages.bookId)
    : [];
  const pageStatsByBook = new Map(pageStats.map(row => [row.bookId, row]));

  return rows.map(row => {
    const pages = pageStatsByBook.get(row.id);
    return {
      id: row.id,
      fileName: row.fileName,
      status: row.status,
      pageCount: row.pageCount,
      extractionAttemptCount: row.extractionAttemptCount,
      extractionError: truncateError(row.extractionError),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      chapters: {
        total: Number(row.chapterTotal),
        complete: Number(row.chapterComplete),
        failed: Number(row.chapterFailed),
      },
      pages: {
        total: Number(pages?.total ?? 0),
        complete: Number(pages?.complete ?? 0),
        failed: Number(pages?.failed ?? 0),
      },
    };
  });
}

export type AdminMirrorJob = {
  id: string;
  fileName: string;
  status: string;
  pageCount: number;
  extractionAttemptCount: number;
  extractionError: string | null;
  createdAt: Date;
  updatedAt: Date;
  batches: { total: number; complete: number; failed: number };
};

export async function listMirrorJobsForAdmin(
  limit = DEFAULT_JOB_LIST_LIMIT
): Promise<AdminMirrorJob[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: mirrorJobs.id,
      fileName: mirrorJobs.fileName,
      status: mirrorJobs.status,
      pageCount: mirrorJobs.pageCount,
      extractionAttemptCount: mirrorJobs.extractionAttemptCount,
      extractionError: mirrorJobs.extractionError,
      createdAt: mirrorJobs.createdAt,
      updatedAt: mirrorJobs.updatedAt,
      batchTotal: count(mirrorBatches.id),
      batchComplete: count(
        sql`case when ${mirrorBatches.status} = 'complete' then 1 end`
      ),
      batchFailed: count(
        sql`case when ${mirrorBatches.status} = 'failed' then 1 end`
      ),
    })
    .from(mirrorJobs)
    .leftJoin(mirrorBatches, eq(mirrorBatches.jobId, mirrorJobs.id))
    .groupBy(mirrorJobs.id)
    .orderBy(desc(mirrorJobs.updatedAt))
    .limit(limit);

  return rows.map(row => ({
    id: row.id,
    fileName: row.fileName,
    status: row.status,
    pageCount: row.pageCount,
    extractionAttemptCount: row.extractionAttemptCount,
    extractionError: truncateError(row.extractionError),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    batches: {
      total: Number(row.batchTotal),
      complete: Number(row.batchComplete),
      failed: Number(row.batchFailed),
    },
  }));
}

export type AdminMaterialJob = {
  id: string;
  title: string;
  status: string;
  pageCount: number;
  extractionAttemptCount: number;
  extractionError: string | null;
  createdAt: Date;
  updatedAt: Date;
  batches: { total: number; complete: number; failed: number };
};

export async function listAdminMaterialJobsForAdmin(
  limit = DEFAULT_JOB_LIST_LIMIT
): Promise<AdminMaterialJob[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: adminMaterials.id,
      title: adminMaterials.title,
      status: adminMaterials.status,
      pageCount: adminMaterials.pageCount,
      extractionAttemptCount: adminMaterials.extractionAttemptCount,
      extractionError: adminMaterials.extractionError,
      createdAt: adminMaterials.createdAt,
      updatedAt: adminMaterials.updatedAt,
      batchTotal: count(adminMaterialBatches.id),
      batchComplete: count(
        sql`case when ${adminMaterialBatches.status} = 'complete' then 1 end`
      ),
      batchFailed: count(
        sql`case when ${adminMaterialBatches.status} = 'failed' then 1 end`
      ),
    })
    .from(adminMaterials)
    .leftJoin(
      adminMaterialBatches,
      eq(adminMaterialBatches.materialId, adminMaterials.id)
    )
    .groupBy(adminMaterials.id)
    .orderBy(desc(adminMaterials.updatedAt))
    .limit(limit);

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    status: row.status,
    pageCount: row.pageCount,
    extractionAttemptCount: row.extractionAttemptCount,
    extractionError: truncateError(row.extractionError),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    batches: {
      total: Number(row.batchTotal),
      complete: Number(row.batchComplete),
      failed: Number(row.batchFailed),
    },
  }));
}
