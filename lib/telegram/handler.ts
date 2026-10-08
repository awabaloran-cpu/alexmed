// ✈️ What the bot does with one Telegram update. Called by the webhook
// route after it verified the secret; everything here is quick (a few
// database rows and Bot API calls) — downloads and processing are queued.
//
// Order of the checks on a file, cheapest and most decisive first:
//   PDF? → size → already sent? → guest's free file used? → burst →
//   daily ceiling → record the upload (idempotent on Telegram's update id) →
//   queue the intake.
// Plan quotas and the job-creation limit are applied later by the intake
// worker, through the same guard the web upload uses.
import { publishMessage } from "../queue/client";
import {
  ensureTelegramAccount,
  linkTelegramToAccount,
  setPendingKind,
  type AccountContext,
} from "./accounts";
import { answerCallback, sendMessage, type InlineButton } from "./api";
import {
  guestFreeUploads,
  telegramAccountBurstLimit,
  telegramDailyUploadCap,
  telegramMaxFileBytes,
} from "./config";
import { isDocumentKind, type DocumentKind } from "./detect";
import { retryTelegramUpload } from "./intake";
import { connectLink, openLink } from "./links";
import {
  BUTTONS,
  filePath,
  LABELS,
  MAIN_KEYBOARD,
  parseCallback,
  TEXT,
  urlButton,
} from "./messages";
import {
  countAcceptedUploads,
  countRecentUploads,
  countUploadsLastDay,
  createUpload,
  findDuplicateUpload,
  getUploadForAccount,
  listRecentFiles,
  markUploadFailed,
  resolveUploadKind,
  setUploadStatusMessage,
} from "./uploads";

type TelegramUser = { id: number; is_bot?: boolean; language_code?: string };
type TelegramChat = { id: number; type: string };
type TelegramDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};
type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  document?: TelegramDocument;
};
export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    data?: string;
    message?: { message_id: number; chat: TelegramChat };
  };
};

const LINK_PREFIX = "link_";

async function openSiteButton(
  context: AccountContext,
  label: string,
  path: string
) {
  return urlButton(label, await openLink(context.user, path));
}

function isPdf(document: TelegramDocument): boolean {
  return (
    document.mime_type === "application/pdf" ||
    !!document.file_name?.toLowerCase().endsWith(".pdf")
  );
}

// A storage-safe, recognisable name; the pipelines require ".pdf".
function pdfFileName(document: TelegramDocument): string {
  const name = (document.file_name ?? "telegram.pdf").trim().slice(0, 180);
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
}

async function handleDocument(
  context: AccountContext,
  chatId: number,
  updateId: number,
  document: TelegramDocument
): Promise<void> {
  if (!isPdf(document)) {
    await sendMessage(chatId, TEXT.notPdf);
    return;
  }

  const limit = telegramMaxFileBytes();
  if (!document.file_size || document.file_size > limit) {
    await sendMessage(
      chatId,
      TEXT.tooLarge(limit),
      await openSiteButton(context, LABELS.uploadFromSite, "/books/upload")
    );
    return;
  }

  const { account, user } = context;

  // A file they already sent is answered with that file, whatever limits
  // would apply to a new one.
  const duplicate = await findDuplicateUpload(
    account.id,
    document.file_unique_id
  );
  if (duplicate) {
    if (duplicate.bookId && isDocumentKind(duplicate.kind)) {
      await sendMessage(
        chatId,
        duplicate.status === "complete"
          ? TEXT.duplicateReady
          : TEXT.duplicateProcessing,
        await openSiteButton(
          context,
          duplicate.kind === "book" ? LABELS.openBook : LABELS.startQuestions,
          filePath(duplicate.kind, duplicate.bookId)
        )
      );
    } else {
      await sendMessage(chatId, TEXT.duplicateProcessing);
    }
    return;
  }

  if (
    user.isGuest &&
    (await countAcceptedUploads(account.id)) >= guestFreeUploads()
  ) {
    await sendMessage(
      chatId,
      TEXT.guestLimit,
      urlButton(LABELS.connectAccount, await connectLink(user))
    );
    return;
  }
  if ((await countRecentUploads(account.id)) >= telegramAccountBurstLimit()) {
    await sendMessage(chatId, TEXT.slowDown);
    return;
  }
  if ((await countUploadsLastDay()) >= telegramDailyUploadCap()) {
    await sendMessage(chatId, TEXT.busy);
    return;
  }

  const requestedKind = isDocumentKind(account.pendingKind)
    ? account.pendingKind
    : null;
  const upload = await createUpload({
    telegramAccountId: account.id,
    updateId,
    fileId: document.file_id,
    fileUniqueId: document.file_unique_id,
    fileName: pdfFileName(document),
    fileSize: document.file_size,
    requestedKind,
  });
  // Telegram delivered this update before: it is already being handled.
  if (!upload) return;
  if (requestedKind) await setPendingKind(account.id, null);

  const statusMessageId = await sendMessage(chatId, TEXT.received);
  await setUploadStatusMessage(upload.id, statusMessageId);

  try {
    await publishMessage({ type: "telegram_intake", uploadId: upload.id });
  } catch (error) {
    console.error("[Telegram] Failed to queue the intake", error);
    await markUploadFailed(upload.id, "queue_unavailable");
    await sendMessage(chatId, TEXT.downloadFailed);
  }
}

async function handleFilesList(context: AccountContext, chatId: number) {
  const files = await listRecentFiles(context.account.id);
  if (!files.length) {
    await sendMessage(chatId, TEXT.noFiles);
    return;
  }
  const rows: InlineButton[][] = [];
  for (const file of files) {
    const kind: DocumentKind =
      file.sourceType === "question_file" ? "question_file" : "book";
    rows.push([
      {
        text: `${kind === "book" ? "📚" : "📄"} ${file.fileName}`.slice(0, 60),
        url: await openLink(context.user, filePath(kind, file.bookId)),
      },
    ]);
  }
  await sendMessage(chatId, TEXT.filesHeader, { inline_keyboard: rows });
}

async function handleLink(
  token: string,
  message: TelegramMessage,
  from: TelegramUser
) {
  const chatId = message.chat.id;
  const outcome = await linkTelegramToAccount(token, {
    telegramUserId: from.id,
    chatId,
    languageCode: from.language_code,
  });
  if (outcome.ok) {
    await sendMessage(chatId, TEXT.linked, MAIN_KEYBOARD);
    return;
  }
  await sendMessage(
    chatId,
    outcome.reason === "already_linked_elsewhere"
      ? TEXT.linkElsewhere
      : outcome.reason === "account_has_other_telegram"
        ? TEXT.linkAccountBusy
        : TEXT.linkInvalid
  );
}

async function handleMessage(updateId: number, message: TelegramMessage) {
  const from = message.from;
  // Private chats with real people only — the bot does nothing in groups.
  if (!from || from.is_bot || message.chat.type !== "private") return;
  const chatId = message.chat.id;
  const text = message.text?.trim() ?? "";

  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/i.exec(text);
  if (start?.[1]?.startsWith(LINK_PREFIX)) {
    await handleLink(start[1].slice(LINK_PREFIX.length), message, from);
    return;
  }

  const context = await ensureTelegramAccount({
    telegramUserId: from.id,
    chatId,
    languageCode: from.language_code,
  });
  if (context.user.suspended) {
    await sendMessage(chatId, TEXT.suspended);
    return;
  }

  if (message.document) {
    await handleDocument(context, chatId, updateId, message.document);
    return;
  }

  if (start) {
    await sendMessage(chatId, TEXT.welcome, MAIN_KEYBOARD);
    // A guest is shown, once per /start, how to keep their files.
    if (context.user.isGuest) {
      await sendMessage(
        chatId,
        TEXT.guestConnectHint,
        urlButton(LABELS.connectAccount, await connectLink(context.user))
      );
    }
  } else if (text === BUTTONS.uploadQuestions) {
    await setPendingKind(context.account.id, "question_file");
    await sendMessage(chatId, TEXT.askForFile("question_file"));
  } else if (text === BUTTONS.uploadBook) {
    await setPendingKind(context.account.id, "book");
    await sendMessage(chatId, TEXT.askForFile("book"));
  } else if (text === BUTTONS.myFiles || /^\/files\b/i.test(text)) {
    await handleFilesList(context, chatId);
  } else if (text === BUTTONS.howItWorks || /^\/help\b/i.test(text)) {
    await sendMessage(chatId, TEXT.howItWorks, MAIN_KEYBOARD);
  } else if (text === BUTTONS.openSite) {
    await sendMessage(
      chatId,
      TEXT.openSite,
      await openSiteButton(context, LABELS.openSite, "/subjects")
    );
  } else {
    await sendMessage(chatId, TEXT.unknownMessage, MAIN_KEYBOARD);
  }
}

async function handleCallback(
  query: NonNullable<TelegramUpdate["callback_query"]>
) {
  const chat = query.message?.chat;
  const parsed = parseCallback(query.data ?? "");
  if (!chat || chat.type !== "private" || query.from.is_bot || !parsed) {
    await answerCallback(query.id);
    return;
  }
  const context = await ensureTelegramAccount({
    telegramUserId: query.from.id,
    chatId: chat.id,
    languageCode: query.from.language_code,
  });
  // The upload must belong to whoever pressed the button.
  const upload = await getUploadForAccount(parsed.uploadId, context.account.id);
  if (!upload || context.user.suspended) {
    await answerCallback(query.id, TEXT.retryUnavailable);
    return;
  }

  if (parsed.action === "kind") {
    // Only the first press moves the upload on; a second finds nothing.
    if (await resolveUploadKind(upload.id, parsed.kind)) {
      await publishMessage({ type: "telegram_intake", uploadId: upload.id });
    }
    await answerCallback(query.id);
    return;
  }

  const retried = await retryTelegramUpload(upload.id);
  await answerCallback(
    query.id,
    retried ? TEXT.retryStarted : TEXT.retryUnavailable
  );
}

export async function handleTelegramUpdate(
  update: TelegramUpdate
): Promise<void> {
  if (update.message) {
    await handleMessage(update.update_id, update.message);
  } else if (update.callback_query) {
    await handleCallback(update.callback_query);
  }
}
