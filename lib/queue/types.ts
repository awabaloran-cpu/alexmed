// Message shapes published to Upstash QStash — IDs only, never PDF text or
// OCR results, so the queue payload stays tiny regardless of file size. Each
// worker route re-fetches whatever content it needs from Postgres using the
// id(s) in the message.
export type QueueMessage =
  | { type: "extract_mirror_job"; jobId: string }
  | { type: "generate_mirror_batch"; batchId: string; jobId: string }
  | { type: "finalize_mirror_job"; jobId: string }
  | { type: "extract_book_job"; bookId: string }
  | { type: "analyze_book_chapter"; chapterId: string; bookId: string }
  | { type: "finalize_book"; bookId: string }
  | { type: "extract_admin_material"; materialId: string }
  | {
      type: "generate_admin_material_batch";
      batchId: string;
      materialId: string;
    }
  | { type: "finalize_admin_material"; materialId: string }
  | { type: "analyze_book_page_visuals"; bookId: string }
  | { type: "retry_book_page_text"; pageId: string };

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Read lazily (not at module-load time) so tests can set process.env before
// calling these, and so a missing var falls back rather than crashing import.
export function getQueueMaxAttempts(): number {
  return readIntEnv("QUEUE_MAX_ATTEMPTS", 4);
}

export function getQueueGlobalConcurrency(): number {
  return readIntEnv("QUEUE_GLOBAL_CONCURRENCY", 5);
}

export function getQueuePerUserConcurrency(): number {
  return readIntEnv("QUEUE_PER_USER_CONCURRENCY", 2);
}

// مكتبة الأدمن gets its own, separate concurrency budget/Flow Control key
// (see lib/queue/client.ts) rather than sharing مِرآة's QUEUE_GLOBAL_CONCURRENCY
// — admin uploads are rare compared to student مِرآة uploads, and this keeps
// either one from starving the other's share of OmniRoute's own limited
// capacity.
export function getAdminMaterialsQueueConcurrency(): number {
  return readIntEnv("ADMIN_MATERIALS_QUEUE_CONCURRENCY", 2);
}

// كتبي page-visual analysis runs on every page always (per product
// decision) — separate, modest budget from "books-pipeline" (text
// extraction/chapter analysis) so a big scanned book's visual pass never
// starves other كتبي uploads' text/chapter processing.
export function getBooksVisualQueueConcurrency(): number {
  return readIntEnv("BOOKS_VISUAL_QUEUE_CONCURRENCY", 2);
}

export function getJobCreationRateLimitMax(): number {
  return readIntEnv("JOB_CREATION_RATE_LIMIT_MAX", 5);
}

export function getJobCreationRateLimitWindowMinutes(): number {
  return readIntEnv("JOB_CREATION_RATE_LIMIT_WINDOW_MINUTES", 10);
}
