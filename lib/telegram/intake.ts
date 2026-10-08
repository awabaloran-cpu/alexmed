// ✈️ The two background steps of a Telegram upload, run by the queue
// (app/api/telegram/intake, app/api/telegram/watch) so the webhook itself
// never waits on a download or on processing:
//
//   runTelegramIntake  bot file → storage → which kind? → the SAME start
//                      every web upload uses (lib/file-intake.ts)
//   runTelegramWatch   reads the file's status from the existing pipeline's
//                      own rows and reports it in the chat, re-queuing
//                      itself until the file is ready or has failed
//
// Neither touches the pipelines: no extraction, OCR or AI happens here.
import { NextResponse } from "next/server";
import {
  deleteBook,
  getBookById,
  resetBookExtractionForRetry,
} from "../db-books";
import {
  countAnswerableQuestions,
  getQuestionFileCoverage,
} from "../db-question-file-images";
import { looksLikeNotes } from "../question-file-quality";
import { retryQuestionFileExtraction } from "../db-question-files";
import { admitAndStartStudentFile } from "../file-intake";
import { publishMessage } from "../queue/client";
import { assertJobCreationAllowed, RateLimitedError } from "../queue/rateLimit";
import { deleteObject, storageGetUploadUrl } from "../storage";
import { newUploadKey } from "../upload-keys";
import {
  ensureTelegramSubject,
  findTelegramAccountById,
  markAccountBlocked,
} from "./accounts";
import {
  editMessage,
  getFileDownloadUrl,
  isChatGone,
  sendMessage,
  type InlineButton,
} from "./api";
import { telegramMaxFileBytes, telegramMaxPages } from "./config";
import {
  DETECTION_SAMPLE_PAGES,
  detectDocumentKind,
  isDocumentKind,
  resolveDocumentKind,
  type DocumentKind,
} from "./detect";
import { refundBonusUpload, rewardInviterOf, spendBonusUpload } from "./growth";
import { openButton as linkButton } from "./links";
import { CALLBACK, filePath, LABELS, TEXT } from "./messages";
import { readLeadingPages } from "./pdf-sample";
import {
  bumpWatchCount,
  claimUploadForIntake,
  getUploadContext,
  markUploadAwaitingKind,
  markUploadComplete,
  markUploadFailed,
  markUploadProcessing,
  markUploadRejected,
  recordUploadStage,
  releaseUploadClaim,
  reopenUploadForRetry,
} from "./uploads";

type UploadContext = NonNullable<Awaited<ReturnType<typeof getUploadContext>>>;

// ── Talking to the chat ─────────────────────────────────────────────────
// A chat that is gone (the student blocked the bot) must never fail a
// worker: the file still finishes and waits for them on the site.

async function say(
  context: UploadContext,
  text: string,
  buttons?: InlineButton[][]
): Promise<void> {
  try {
    await sendMessage(
      context.chatId,
      text,
      buttons ? { inline_keyboard: buttons } : undefined
    );
  } catch (error) {
    if (isChatGone(error)) return void (await markAccountBlocked(context.accountId));
    console.error("[Telegram] sendMessage failed", error);
  }
}

// Rewrites the upload's progress message; falls back to a new message when
// there is none (or it can no longer be edited).
async function progress(
  context: UploadContext,
  text: string,
  buttons?: InlineButton[][]
): Promise<void> {
  const messageId = context.upload.statusMessageId;
  if (messageId) {
    try {
      const edited = await editMessage(
        context.chatId,
        messageId,
        text,
        buttons ? { inline_keyboard: buttons } : undefined
      );
      if (edited) return;
    } catch (error) {
      if (isChatGone(error)) {
        return void (await markAccountBlocked(context.accountId));
      }
      console.error("[Telegram] editMessageText failed", error);
    }
  }
  await say(context, text, buttons);
}

async function userFor(context: UploadContext) {
  const account = await findTelegramAccountById(context.accountId);
  if (!account) throw new Error("Telegram account disappeared");
  return account.user;
}

async function openButton(
  context: UploadContext,
  label: string,
  path: string
): Promise<InlineButton[][]> {
  return [[await linkButton(await userFor(context), label, path)]];
}

// "📤 شارك الملف مع زملائك" under a ready file (handled in handler.ts).
const shareRow = (uploadId: string): InlineButton[] => [
  { text: LABELS.shareFile, callback_data: CALLBACK.share(uploadId) },
];

// "📝 اعمل ملخّص PDF" under a ready file (handled in handler.ts).
const summaryRow = (uploadId: string): InlineButton[] => [
  { text: LABELS.makeSummary, callback_data: CALLBACK.summary(uploadId) },
];

// "📚 حوّله إلى كتاب" under a question file that is not one (handler.ts).
const convertRow = (uploadId: string): InlineButton[] => [
  { text: LABELS.convertToBook, callback_data: CALLBACK.convert(uploadId) },
];

// ── Intake ──────────────────────────────────────────────────────────────

class RefusedFile extends Error {}
// Over the bot's page limit: the site would start the same work, so the
// refusal does not send the student there.
class TooLong extends RefusedFile {}

const PDF_MAGIC = "%PDF-";

// Downloads the file the bot was sent, never trusting the size Telegram
// reported: the read stops as soon as it passes the limit.
async function downloadTelegramFile(
  fileId: string,
  maxBytes: number
): Promise<Uint8Array> {
  const response = await fetch(await getFileDownloadUrl(fileId), {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Telegram file download failed (${response.status})`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RefusedFile(TEXT.tooLarge(maxBytes));
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // A PDF's header sits within its first kilobyte; anything else is not a
  // PDF whatever its name says.
  const head = Buffer.from(data.subarray(0, 1024)).toString("latin1");
  if (!head.includes(PDF_MAGIC)) throw new RefusedFile(TEXT.notPdf);
  return data;
}

// Stores the file under a key issued to its owner — the same
// "book-pdfs/<userId>/…" shape the web upload uses, through the same
// presigned PUT, so the plan guard's ownership and real-size checks apply
// to it unchanged.
async function storeUploadedPdf(
  userId: string,
  fileName: string,
  data: Uint8Array
): Promise<string> {
  const key = newUploadKey("book-pdfs", userId, fileName);
  const response = await fetch(
    await storageGetUploadUrl(key, "application/pdf"),
    {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: data as unknown as BodyInit,
      signal: AbortSignal.timeout(120_000),
    }
  );
  if (!response.ok) {
    throw new Error(`Storage upload failed (${response.status})`);
  }
  return key;
}

// True for the plan guard's "you have used today's / this month's files".
async function isPlanLimit(response: NextResponse): Promise<boolean> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { code?: string } | null;
  return (
    body?.code === "PLAN_LIMIT_REACHED" || body?.code === "MONTHLY_LIMIT_REACHED"
  );
}

// An invited student's first file just entered processing: their inviter
// earns a file and is told. Never allowed to fail the upload itself.
async function thankInviter(accountId: string): Promise<void> {
  try {
    const reward = await rewardInviterOf(accountId);
    if (!reward) return;
    await sendMessage(reward.chatId, TEXT.inviteEarned(reward.bonusLeft));
  } catch (error) {
    if (!isChatGone(error)) {
      console.error("[Telegram] Could not reward the inviter", error);
    }
  }
}

async function refusalText(response: NextResponse): Promise<string> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: string } | null;
  return body?.error || "تعذّر بدء معالجة الملف.";
}

async function discard(key: string | null) {
  if (key) await deleteObject(key).catch(() => undefined);
}

// Best effort, each step on its own: mark the upload failed and say so.
async function abandonUpload(uploadId: string) {
  try {
    const context = await getUploadContext(uploadId);
    await markUploadFailed(uploadId, "download_failed");
    if (context) await progress(context, TEXT.downloadFailed);
  } catch (error) {
    console.error("[Telegram] Could not report a failed intake", error);
  }
}

// `finalAttempt`: the queue will not deliver this message again, so a
// failure now must be told to the student instead of retried.
export async function runTelegramIntake(
  uploadId: string,
  options: { finalAttempt?: boolean } = {}
): Promise<"done" | "skipped"> {
  let context: UploadContext | null;
  try {
    const claimed = await claimUploadForIntake(uploadId);
    if (!claimed) return "skipped";
    context = await getUploadContext(uploadId);
  } catch (error) {
    // Even the first step failed (the database, usually). The student must
    // still hear about it once the queue has given up — never a progress
    // message left saying "receiving…" forever.
    console.error("[Telegram] Intake could not start", { uploadId, error });
    if (options.finalAttempt) {
      await abandonUpload(uploadId);
      return "done";
    }
    throw error;
  }
  if (!context) return "skipped";
  const { upload, userId } = context;

  let key = upload.fileKey;
  // "حوّله إلى كتاب" (reopenUploadAsBook): the stored file of a question
  // file is being started again as a book. That question file still uses
  // the stored PDF, so nothing here may delete it.
  const convertingFrom =
    key && upload.kind === "book" && upload.bookId ? upload.bookId : null;
  try {
    let kind: DocumentKind | "ask";
    if (key && isDocumentKind(upload.kind)) {
      // The student already answered "which kind?" — the file is stored.
      kind = upload.kind;
    } else {
      const data = await downloadTelegramFile(
        upload.fileId,
        telegramMaxFileBytes()
      );
      const sample = await readLeadingPages(data, DETECTION_SAMPLE_PAGES);
      // Refused before anything is stored or counted against the plan. A
      // file whose pages could not be counted goes on to the real reader.
      const maxPages = telegramMaxPages();
      if (sample.total > maxPages) {
        throw new TooLong(TEXT.tooManyPages(sample.total, maxPages));
      }
      key = await storeUploadedPdf(userId, upload.fileName, data);
      const requested = isDocumentKind(upload.requestedKind)
        ? upload.requestedKind
        : null;
      kind = resolveDocumentKind(requested, detectDocumentKind(sample.pages));
    }

    if (kind === "ask") {
      await markUploadAwaitingKind(uploadId, key);
      await progress(context, TEXT.askKind, [
        [
          {
            text: LABELS.asQuestions,
            callback_data: CALLBACK.kind(uploadId, "question_file"),
          },
          { text: LABELS.asBook, callback_data: CALLBACK.kind(uploadId, "book") },
        ],
      ]);
      return "done";
    }

    try {
      await assertJobCreationAllowed(userId, "books");
    } catch (error) {
      if (error instanceof RateLimitedError) throw new RefusedFile(error.message);
      throw error;
    }

    const file = {
      kind,
      key,
      fileName: upload.fileName,
      subjectId: await ensureTelegramSubject(userId),
    };
    // A conversion is the same file the student already paid for.
    let started = await admitAndStartStudentFile(userId, {
      ...file,
      skipQuota: Boolean(convertingFrom),
    });
    // The plan's daily / monthly count is used up: a file earned by
    // inviting (lib/telegram/growth.ts) pays for this one instead.
    if (
      started instanceof NextResponse &&
      (await isPlanLimit(started)) &&
      (await spendBonusUpload(context.accountId))
    ) {
      started = await admitAndStartStudentFile(userId, {
        ...file,
        skipQuota: true,
      });
      if (started instanceof NextResponse) {
        await refundBonusUpload(context.accountId);
      } else {
        await say(context, TEXT.bonusUsed);
      }
    }
    if (started instanceof NextResponse) {
      throw new RefusedFile(await refusalText(started));
    }

    // From here the file is an ordinary book in the pipeline; the storage
    // object belongs to it.
    await markUploadProcessing(uploadId, {
      bookId: started.bookId,
      kind,
      fileKey: key,
    });
    if (convertingFrom) {
      // The question file it replaces goes; the PDF stays, the new book
      // references it (deleteBook keeps keys still in use).
      await deleteBook(userId, convertingFrom).catch(error =>
        console.error("[Telegram] Could not remove the converted file", error)
      );
    }
    await recordUploadStage(uploadId, "reading");
    await progress(context, TEXT.reading);
    await thankInviter(context.accountId);
    await publishMessage({ type: "telegram_watch", uploadId }, { delay: 6 });
    return "done";
  } catch (error) {
    if (error instanceof RefusedFile) {
      if (!convertingFrom) await discard(key);
      await markUploadRejected(uploadId, error.message);
      await progress(
        context,
        error instanceof TooLong ? error.message : TEXT.refused(error.message),
        error instanceof TooLong
          ? []
          : await openButton(context, LABELS.uploadFromSite, "/books/upload")
      );
      return "done";
    }
    console.error("[Telegram] Intake failed", { uploadId, error });
    if (options.finalAttempt) {
      if (!convertingFrom) await discard(key);
      await markUploadFailed(uploadId, "download_failed");
      await progress(context, TEXT.downloadFailed);
      return "done";
    }
    // Hand the upload back so the queue's retry can claim it again.
    if (key && !upload.fileKey) await discard(key);
    await releaseUploadClaim(uploadId);
    throw error;
  }
}

// ── Watch ───────────────────────────────────────────────────────────────

// ~1.5 hours of polling at the delays below; a file still running after
// that is reported as "still working" and left to finish on its own.
const MAX_WATCH_ROUNDS = 200;

function nextWatchDelaySeconds(round: number): number {
  return Math.min(30, 5 + round * 2);
}

async function finish(
  context: UploadContext,
  text: string,
  buttons?: InlineButton[][]
) {
  await markUploadComplete(context.upload.id);
  // The progress line is closed, and the result arrives as a NEW message —
  // an edit would not notify the student.
  await progress(context, TEXT.finished);
  await say(context, text, buttons);
}

export async function runTelegramWatch(
  uploadId: string
): Promise<"done" | "requeued" | "skipped"> {
  const context = await getUploadContext(uploadId);
  if (!context || context.upload.status !== "processing") return "skipped";
  const { upload } = context;
  const kind = isDocumentKind(upload.kind) ? upload.kind : null;
  const book = upload.bookId ? await getBookById(upload.bookId) : null;

  if (!book || !kind) {
    await markUploadFailed(uploadId, "file_missing");
    return "done";
  }

  if (book.status === "failed") {
    const reason =
      book.extractionError ||
      (kind === "book"
        ? "تعذّرت قراءة هذا الكتاب."
        : "تعذّر استخراج الأسئلة من هذا الملف.");
    await markUploadFailed(uploadId, reason);
    await progress(context, TEXT.failed(reason), [
      [{ text: LABELS.retry, callback_data: CALLBACK.retry(uploadId) }],
      ...(kind === "question_file" ? [convertRow(uploadId)] : []),
      ...(await openButton(context, LABELS.openSite, filePath(kind, book.id))),
    ]);
    return "done";
  }

  const round = await bumpWatchCount(uploadId);
  const timedOut = round > MAX_WATCH_ROUNDS;

  if (book.status !== "extracting") {
    if (kind === "book") {
      await finish(
        context,
        TEXT.bookReady(book.pageCount),
        [
          ...(await openButton(
            context,
            LABELS.openBookToStart,
            filePath(kind, book.id)
          )),
          summaryRow(uploadId),
          shareRow(uploadId),
        ]
      );
      return "done";
    }

    const coverage = await getQuestionFileCoverage(book.id);
    if (coverage.questionsTotal === 0) {
      await finish(context, TEXT.noQuestions, [convertRow(uploadId)]);
      return "done";
    }
    // Notes, a summary or an OSCE file read as "questions": say so and
    // offer the book pipeline instead of announcing questions that are not.
    const answerable = await countAnswerableQuestions(book.id);
    if (
      looksLikeNotes({
        total: coverage.questionsTotal,
        answerable,
        pageCount: book.pageCount,
      })
    ) {
      await finish(context, TEXT.looksLikeNotes(answerable, book.pageCount), [
        convertRow(uploadId),
        ...(await openButton(
          context,
          LABELS.openAnyway,
          filePath(kind, book.id)
        )),
      ]);
      return "done";
    }
    // The questions can be studied the moment they are extracted (seconds):
    // the student is told NOW, not after the per-question explanations —
    // those take minutes for a long file (measured on the live bot: ~8s a
    // question) and the question page already fills them in as they arrive.
    await finish(
      context,
      coverage.done
        ? TEXT.questionsReady(coverage.questionsTotal)
        : TEXT.questionsReadyPartial(coverage.questionsTotal),
      [
        ...(await openButton(
          context,
          LABELS.startQuestions,
          filePath(kind, book.id)
        )),
        summaryRow(uploadId),
        shareRow(uploadId),
      ]
    );
    return "done";
  } else if (timedOut) {
    await say(context, TEXT.stillWorking);
    return "done";
  } else if (await recordUploadStage(uploadId, "reading")) {
    await progress(context, TEXT.reading);
  }

  await publishMessage(
    { type: "telegram_watch", uploadId },
    { delay: nextWatchDelaySeconds(round) }
  );
  return "requeued";
}

// ── Retry (the "🔄 إعادة المحاولة" button) ──────────────────────────────

// Restarts the SAME book through the pipeline's own retry — the file is
// neither re-sent nor counted against the quota again.
export async function retryTelegramUpload(uploadId: string): Promise<boolean> {
  const context = await getUploadContext(uploadId);
  if (!context || context.upload.status !== "failed") return false;
  const { upload, userId } = context;
  if (!upload.bookId || !isDocumentKind(upload.kind)) return false;

  if (upload.kind === "question_file") {
    if (!(await retryQuestionFileExtraction(userId, upload.bookId))) {
      return false;
    }
    await publishMessage({
      type: "extract_question_file_job",
      bookId: upload.bookId,
    });
  } else {
    const book = await getBookById(upload.bookId);
    if (!book || book.userId !== userId || book.status !== "failed") {
      return false;
    }
    await resetBookExtractionForRetry(upload.bookId);
    await publishMessage(
      { type: "extract_book_job", bookId: upload.bookId },
      { flowControl: { key: `books-extract-${upload.bookId}`, parallelism: 1 } }
    );
  }

  await reopenUploadForRetry(uploadId);
  await publishMessage({ type: "telegram_watch", uploadId }, { delay: 6 });
  return true;
}
