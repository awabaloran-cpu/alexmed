// Thin wrapper around @upstash/qstash's Client — the only place in the app
// that knows how to turn a QueueMessage into a published QStash request.
// Destination URLs are resolved from APP_BASE_URL so the same code works in
// local dev (with a tunnel), preview deployments, and production.
import { Client, type FlowControl } from "@upstash/qstash";
import type { QueueMessage } from "./types";
import {
  getAdminMaterialsQueueConcurrency,
  getBooksVisualQueueConcurrency,
  getExamFocusQueueConcurrency,
  getGenerationQueueConcurrency,
  getMirrorImagesQueueConcurrency,
  getQuestionFilesEnrichmentQueueConcurrency,
  getQueueGlobalConcurrency,
  getQueueMaxAttempts,
  getTelegramIntakeConcurrency,
} from "./types";

let _client: Client | null = null;

function getClient(): Client {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error("QSTASH_TOKEN is not configured");
  }
  if (!_client) {
    _client = new Client({ token });
  }
  return _client;
}

function getBaseUrl(): string {
  const base = process.env.APP_BASE_URL;
  if (!base) {
    throw new Error("APP_BASE_URL is not configured");
  }
  return base.replace(/\/$/, "");
}

// Maps each message type to the worker route that handles it.
function resolveDestination(message: QueueMessage): string {
  const base = getBaseUrl();
  switch (message.type) {
    case "extract_mirror_job":
      return `${base}/api/mirror/extract`;
    case "generate_mirror_batch":
      return `${base}/api/mirror/generate-batch`;
    case "finalize_mirror_job":
      return `${base}/api/mirror/finalize`;
    case "extract_book_job":
      return `${base}/api/books/extract`;
    case "analyze_book_chapter":
      return `${base}/api/books/analyze-chapter`;
    case "finalize_book":
      return `${base}/api/books/finalize`;
    case "extract_admin_material":
      return `${base}/api/admin/materials/extract`;
    case "generate_admin_material_batch":
      return `${base}/api/admin/materials/generate-batch`;
    case "finalize_admin_material":
      return `${base}/api/admin/materials/finalize`;
    case "analyze_book_page_visuals":
      return `${base}/api/books/analyze-page-visuals`;
    case "retry_book_page_text":
      return `${base}/api/books/retry-page-text`;
    case "extract_question_file_job":
      return `${base}/api/books/extract-questions`;
    case "generate_chapter_mindmap_sections":
      return `${base}/api/books/generate-mindmap-sections`;
    case "extract_question_file_images":
      return `${base}/api/books/extract-question-images`;
    case "generate_question_file_content":
      return `${base}/api/books/generate-question-content`;
    case "extract_mirror_images":
      return `${base}/api/mirror/extract-images`;
    case "extract_exam_focus_unit":
      return `${base}/api/books/exam-focus/extract-unit`;
    case "finalize_exam_focus":
      return `${base}/api/books/exam-focus/finalize`;
    case "run_chapter_generation":
      return `${base}/api/books/generation-job`;
    case "telegram_intake":
      return `${base}/api/telegram/intake`;
    case "telegram_watch":
      return `${base}/api/telegram/watch`;
  }
}

// QStash's own retry schedule: immediate, then 10s, 30s, 90s (10 * 3^attempt)
// — matches the exact backoff the product spec asked for, expressed as a
// QStash `retryDelay` formula rather than an in-app sleep loop.
const RETRY_DELAY_FORMULA = "10 * pow(3, retried)";

// QStash Flow Control caps how many deliveries for a given key are ever
// "in flight" concurrently — a single shared key per pipeline (not per user)
// is the global concurrency cap; per-user limiting is enforced separately
// inside each worker (see lib/queue/concurrency.ts's isUserConcurrencyExceeded),
// since a single publish can only carry one Flow Control key and the global
// cap is the more important protection against flooding the AI provider.
function defaultFlowControl(message: QueueMessage): FlowControl {
  switch (message.type) {
    case "generate_mirror_batch":
    case "finalize_mirror_job":
    case "extract_mirror_job":
      return {
        key: "mirror-pipeline",
        parallelism: getQueueGlobalConcurrency(),
      };
    case "extract_book_job":
    case "analyze_book_chapter":
    case "finalize_book":
      return {
        key: "books-pipeline",
        parallelism: getQueueGlobalConcurrency(),
      };
    case "extract_admin_material":
    case "generate_admin_material_batch":
    case "finalize_admin_material":
      return {
        key: "admin-materials-pipeline",
        parallelism: getAdminMaterialsQueueConcurrency(),
      };
    case "analyze_book_page_visuals":
      return {
        key: "books-visual-pipeline",
        parallelism: getBooksVisualQueueConcurrency(),
      };
    // One-off, student-triggered retries — keyed per page (not the shared
    // "books-pipeline" key) so a page retry never has to wait behind that
    // book's own bulk extraction/analysis traffic.
    case "retry_book_page_text":
      return { key: `books-page-text-retry-${message.pageId}`, parallelism: 1 };
    case "extract_question_file_job":
      return {
        key: "question-files-pipeline",
        parallelism: getQueueGlobalConcurrency(),
      };
    // Cheap, idempotent, one-per-chapter — shares the same global budget as
    // the rest of the books text pipeline rather than a whole new env var.
    case "generate_chapter_mindmap_sections":
      return {
        key: "books-pipeline",
        parallelism: getQueueGlobalConcurrency(),
      };
    // Entry-point flow control only — each route's own self-chained publish
    // overrides this with a per-book key/parallelism-1, same two-tier
    // pattern as analyze_book_page_visuals above.
    case "extract_question_file_images":
    case "generate_question_file_content":
      return {
        key: "question-files-enrichment-pipeline",
        parallelism: getQuestionFilesEnrichmentQueueConcurrency(),
      };
    // Entry-point flow control only — the route's own self-chained publish
    // overrides this with a per-job key/parallelism-1, same two-tier
    // pattern as analyze_book_page_visuals above.
    case "extract_mirror_images":
      return {
        key: "mirror-images-pipeline",
        parallelism: getMirrorImagesQueueConcurrency(),
      };
    // One shared key across every student's Exam Focus units — caps the
    // total AI calls this feature makes at once, however many students
    // start at the same time.
    case "extract_exam_focus_unit":
      return {
        key: "exam-focus-pipeline",
        parallelism: getExamFocusQueueConcurrency(),
      };
    // No AI call (pure dedupe/order/validate) — per-deck so two finalize
    // deliveries for the same deck never overlap.
    case "finalize_exam_focus":
      return { key: `exam-focus-finalize-${message.deckId}`, parallelism: 1 };
    // One shared key for every student's on-demand generation — the global
    // cap on how many of these AI jobs run at once.
    case "run_chapter_generation":
      return {
        key: "chapter-generation-pipeline",
        parallelism: getGenerationQueueConcurrency(),
      };
    case "telegram_intake":
      return {
        key: "telegram-intake",
        parallelism: getTelegramIntakeConcurrency(),
      };
    case "telegram_watch":
      return { key: `telegram-watch-${message.uploadId}`, parallelism: 1 };
  }
}

export async function publishMessage(
  message: QueueMessage,
  options?: { retries?: number; flowControl?: FlowControl; delay?: number }
): Promise<void> {
  const client = getClient();
  await client.publishJSON({
    url: resolveDestination(message),
    body: message,
    retries: options?.retries ?? getQueueMaxAttempts() - 1,
    retryDelay: RETRY_DELAY_FORMULA,
    flowControl: options?.flowControl ?? defaultFlowControl(message),
    ...(options?.delay !== undefined ? { delay: options.delay } : {}),
  });
}
