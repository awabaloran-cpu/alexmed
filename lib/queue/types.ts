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
  | { type: "retry_book_page_text"; pageId: string }
  | { type: "extract_question_file_job"; bookId: string }
  // Audit Phase 6 — fired once, best-effort, right after a chapter reaches
  // "complete" (see app/api/books/analyze-chapter/route.ts). Deliberately a
  // separate async job rather than an inline call in that same request:
  // analyze-chapter is already tight against Vercel's 60s ceiling (see its
  // own comments on sub-chunking), so a second LLM call there would
  // reintroduce exactly the timeout risk the P0 audit fix just removed.
  | { type: "generate_chapter_mindmap_sections"; chapterId: string }
  // Multimodal question-files pipeline, stages 2 and 3 (see
  // lib/question-file-analysis.ts) — fired once, right after stage 1's
  // extract_question_file_job completes, entirely independent of and never
  // blocking the base text extraction that job already did.
  // `from`/`to`: a span of questions a student has just reached, to be
  // prepared on top of the file's own window (lib/question-file-window.ts).
  | {
      type: "extract_question_file_images";
      bookId: string;
      from?: number;
      to?: number;
    }
  | {
      type: "generate_question_file_content";
      bookId: string;
      from?: number;
      to?: number;
    }
  // Multimodal مِرآة — best-effort, additive background pass alongside
  // batch generation (see app/api/mirror/extract-images/route.ts).
  | { type: "extract_mirror_images"; jobId: string }
  // 🔥 Exam Focus (lib/exam-focus.ts) — one message per unit (a page range
  // of the whole file), then one finalize once every unit is settled.
  | { type: "extract_exam_focus_unit"; unitId: string; deckId: string }
  | { type: "finalize_exam_focus"; deckId: string }
  // On-demand chapter generation (flashcards, MCQs, mind map, notes, visual
  // insights, MCQ validation) — one message per chapter_generation_jobs row
  // (lib/generation-jobs.ts); the worker claims the row atomically before
  // any AI call.
  | { type: "run_chapter_generation"; jobId: string }
  // ✈️ Telegram gateway (lib/telegram/intake.ts): fetch a PDF the bot was
  // sent and hand it to the existing pipelines, then follow that file's
  // status and report it back in the chat. Neither does any AI work.
  | { type: "telegram_intake"; uploadId: string }
  | { type: "telegram_watch"; uploadId: string }
  // 📝 One run of a summary job (lib/summary/run.ts): the next pages, or
  // the finished PDF.
  | { type: "generate_file_summary"; summaryId: string };

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

// 🔥 Exam Focus — how many unit extractions run at once across ALL
// students (one shared Flow Control key), and per student (checked inside
// the worker) so one huge textbook can't take every slot.
export function getExamFocusQueueConcurrency(): number {
  return readIntEnv("EXAM_FOCUS_QUEUE_CONCURRENCY", 6);
}

export function getExamFocusPerUserConcurrency(): number {
  return readIntEnv("EXAM_FOCUS_PER_USER_CONCURRENCY", 3);
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

// Shares one modest budget across both new stages (image capture and
// per-question enrichment) — same reasoning as getBooksVisualQueueConcurrency
// above: a big question file's own background enrichment must never starve
// other students' uploads of OmniRoute capacity.
// How many of one file's questions are explained at once, inside a single
// run of the explanation worker (app/api/books/generate-question-content).
export function getQuestionExplainConcurrency(): number {
  return Math.min(
    8,
    Math.max(1, readIntEnv("QUESTION_FILE_EXPLAIN_CONCURRENCY", 4))
  );
}

export function getQuestionFilesEnrichmentQueueConcurrency(): number {
  return readIntEnv("QUESTION_FILES_ENRICHMENT_QUEUE_CONCURRENCY", 2);
}

// مِرآة's own page-image capture pass — separate, modest budget so a big
// file's image pass never starves other pipelines' share of OmniRoute
// capacity, same reasoning as the other per-pipeline concurrency knobs above.
export function getMirrorImagesQueueConcurrency(): number {
  return readIntEnv("MIRROR_IMAGES_QUEUE_CONCURRENCY", 2);
}

// On-demand chapter generation (lib/generation-jobs.ts): how many run at
// once across ALL students — one shared Flow Control key, so 100 students
// clicking "generate" at once become 100 queued jobs, not 100 simultaneous
// AI calls. The per-student cap is the plan's processing concurrency
// (lib/queue/concurrency.ts), checked inside the worker.
export function getGenerationQueueConcurrency(): number {
  return readIntEnv("GENERATION_QUEUE_CONCURRENCY", 4);
}

// ✈️ How many Telegram files are downloaded into storage at once — each
// one is held in memory while it is copied, so this bounds that memory.
export function getTelegramIntakeConcurrency(): number {
  return readIntEnv("TELEGRAM_INTAKE_CONCURRENCY", 2);
}

export function getJobCreationRateLimitMax(): number {
  return readIntEnv("JOB_CREATION_RATE_LIMIT_MAX", 5);
}

export function getJobCreationRateLimitWindowMinutes(): number {
  return readIntEnv("JOB_CREATION_RATE_LIMIT_WINDOW_MINUTES", 10);
}

// اسألني (chatRouter.ask) — each message is a real LLM call, unlike a plain
// page view, so it gets its own (more generous) limit rather than sharing
// the upload-job one above.
export function getChatRateLimitMax(): number {
  return readIntEnv("CHAT_RATE_LIMIT_MAX", 30);
}

export function getChatRateLimitWindowMinutes(): number {
  return readIntEnv("CHAT_RATE_LIMIT_WINDOW_MINUTES", 10);
}
