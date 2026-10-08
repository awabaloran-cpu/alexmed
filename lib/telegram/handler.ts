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
  findTelegramAccountByUserId,
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
import { parsePhone } from "../phone";
import {
  getOrCreateShareLink,
  joinByShareLink,
  listSharedFilesForUser,
  parseShareCode,
  shareLinkOwnerId,
  shareLinkUrl,
} from "../share-links";
import {
  findInviterId,
  inviteLink,
  SHARE_SOURCE,
  inviteStats,
  parseStartOrigin,
  refundBonusUpload,
  shareUrl,
  spendBonusUpload,
} from "./growth";
import { connectLink, openButton } from "./links";
import {
  claimTelegramPhoneVerification,
  completeTelegramPhoneVerification,
} from "./phone-verify";
import {
  BUTTONS,
  filePath,
  LABELS,
  mainKeyboard,
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
  reopenUploadAsBook,
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
type TelegramContact = { phone_number: string; user_id?: number };
type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  document?: TelegramDocument;
  contact?: TelegramContact;
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
const VERIFY_PREFIX = "verify_";

async function openSiteButton(
  context: AccountContext,
  label: string,
  path: string
) {
  return { inline_keyboard: [[await openButton(context.user, label, path)]] };
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

  if ((await countRecentUploads(account.id)) >= telegramAccountBurstLimit()) {
    await sendMessage(chatId, TEXT.slowDown);
    return;
  }
  if ((await countUploadsLastDay()) >= telegramDailyUploadCap()) {
    await sendMessage(chatId, TEXT.busy);
    return;
  }
  // A guest past their free file: a file earned by inviting pays for this
  // one; otherwise they are shown the two ways to get more. Checked last,
  // so an earned file is only spent on an upload that will be recorded.
  let bonusSpent = false;
  if (
    user.isGuest &&
    (await countAcceptedUploads(account.id)) >= guestFreeUploads()
  ) {
    bonusSpent = await spendBonusUpload(account.id);
    if (!bonusSpent) {
      const invite = await inviteLink(account.id);
      await sendMessage(chatId, TEXT.guestLimit, {
        inline_keyboard: [
          [{ text: LABELS.connectAccount, url: await connectLink(user) }],
          ...(invite
            ? [[{ text: LABELS.inviteFriend, url: shareUrl(invite, TEXT.inviteShare) }]]
            : []),
        ],
      });
      return;
    }
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
  if (!upload) {
    if (bonusSpent) await refundBonusUpload(account.id);
    return;
  }
  if (requestedKind) await setPendingKind(account.id, null);

  const statusMessageId = await sendMessage(
    chatId,
    bonusSpent ? `${TEXT.bonusUsed}\n\n${TEXT.received}` : TEXT.received
  );
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
  const [own, shared] = await Promise.all([
    listRecentFiles(context.account.id),
    listSharedFilesForUser(context.user.id),
  ]);
  if (!own.length && !shared.length) {
    await sendMessage(chatId, TEXT.noFiles);
    return;
  }
  const rows: InlineButton[][] = [];
  const add = async (
    file: { bookId: string; fileName: string; sourceType: string },
    sharedWithMe: boolean
  ) => {
    const kind: DocumentKind =
      file.sourceType === "question_file" ? "question_file" : "book";
    rows.push([
      await openButton(
        context.user,
        // 👥 marks a file a classmate shared.
        `${sharedWithMe ? "👥 " : ""}${kind === "book" ? "📚" : "📄"} ${file.fileName}`.slice(
          0,
          60
        ),
        filePath(kind, file.bookId)
      ),
    ]);
  };
  for (const file of own) await add(file, false);
  for (const file of shared) await add(file, true);
  await sendMessage(chatId, TEXT.filesHeader, { inline_keyboard: rows });
}

// Someone opened a share link: give them the file (once) and a button to
// open it. A dead link and a student the owner removed get the same answer.
async function handleSharedFile(
  context: AccountContext,
  chatId: number,
  code: string
) {
  const joined = await joinByShareLink(code, context.user.id);
  if (!joined.ok) {
    await sendMessage(chatId, TEXT.sharedInvalid, mainKeyboard());
    return;
  }
  const isBook = joined.kind === "book";
  await sendMessage(
    chatId,
    joined.role === "own"
      ? TEXT.sharedOwn
      : isBook
        ? TEXT.sharedBook(joined.title, joined.ownerName)
        : TEXT.sharedQuestions(joined.title, joined.ownerName),
    {
      inline_keyboard: [
        [
          await openButton(
            context.user,
            isBook ? LABELS.openBook : LABELS.startQuestions,
            filePath(joined.kind, joined.bookId)
          ),
        ],
      ],
    }
  );
}

// "📤 شارك الملف": the file's share link and a button that opens Telegram's
// share sheet with it.
async function handleShareRequest(
  context: AccountContext,
  chatId: number,
  bookId: string,
  title: string
): Promise<boolean> {
  const link = await getOrCreateShareLink(context.user.id, bookId);
  const url = link.ok ? shareLinkUrl(link.code) : null;
  if (!link.ok || !url) return false;
  await sendMessage(
    chatId,
    `${TEXT.shareLinkReady(title, link.joinCount)}\n\n🔗 ${url}`,
    {
      inline_keyboard: [
        [{ text: LABELS.sendToFriends, url: shareUrl(url, TEXT.fileShare) }],
      ],
    }
  );
  return true;
}

// "🎁 ادعُ زميلًا": the student's own link, what it earned so far, and a
// button that opens Telegram's share sheet with the invitation ready.
async function handleInvite(context: AccountContext, chatId: number) {
  const link = await inviteLink(context.account.id);
  if (!link) {
    await sendMessage(chatId, TEXT.unknownMessage, mainKeyboard());
    return;
  }
  const stats = await inviteStats(context.account.id);
  await sendMessage(chatId, `${TEXT.invite(stats)}\n\n🔗 ${link}`, {
    inline_keyboard: [
      [{ text: LABELS.shareInvite, url: shareUrl(link, TEXT.inviteShare) }],
    ],
  });
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
    await sendMessage(chatId, TEXT.linked, mainKeyboard());
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

async function handleContact(
  chatId: number,
  from: TelegramUser,
  contact: TelegramContact
) {
  // Telegram fills user_id with the contact's owner: only the sender's own
  // contact proves anything.
  if (contact.user_id !== from.id) {
    await sendMessage(chatId, TEXT.verifyNotOwn);
    return;
  }
  const phone = parsePhone(`+${contact.phone_number.replace(/\D/g, "")}`);
  const outcome = phone.ok
    ? await completeTelegramPhoneVerification(from.id, phone.e164)
    : "mismatch";
  await sendMessage(
    chatId,
    outcome === "verified"
      ? TEXT.verifyDone
      : outcome === "mismatch"
        ? TEXT.verifyMismatch
        : TEXT.verifyNoRequest,
    mainKeyboard()
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

  // 📱 Sign-up phone verification (lib/telegram/phone-verify.ts). Handled
  // before any account is made for this Telegram user: verifying a number
  // for the sign-up page neither needs nor creates a Telegram account here,
  // and does not connect this Telegram user to the account being created —
  // that stays an explicit step (حسابي → Telegram), so a verification link
  // sent to someone else can never route their files into another account.
  if (start?.[1]?.startsWith(VERIFY_PREFIX)) {
    const claimed = await claimTelegramPhoneVerification(
      start[1].slice(VERIFY_PREFIX.length),
      from.id
    );
    await sendMessage(
      chatId,
      claimed ? TEXT.verifyAsk : TEXT.verifyInvalid,
      claimed
        ? {
            keyboard: [[{ text: LABELS.shareContact, request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          }
        : mainKeyboard()
    );
    return;
  }
  if (message.contact) {
    await handleContact(chatId, from, message.contact);
    return;
  }

  // 📈 Where a NEW student came from: a campaign label, a classmate's
  // invite (lib/telegram/growth.ts) or a file a classmate shared — which
  // credits that classmate like an invite. Ignored for an existing account.
  const shareCode = parseShareCode(start?.[1]);
  const origin = parseStartOrigin(start?.[1]);
  const sharer = shareCode ? await shareLinkOwnerId(shareCode) : null;
  const context = await ensureTelegramAccount(
    { telegramUserId: from.id, chatId, languageCode: from.language_code },
    shareCode
      ? {
          source: SHARE_SOURCE,
          referredById: sharer
            ? ((await findTelegramAccountByUserId(sharer))?.account.id ?? null)
            : null,
        }
      : {
          source: origin.source,
          referredById: origin.referralCode
            ? await findInviterId(origin.referralCode)
            : null,
        }
  );
  if (context.user.suspended) {
    await sendMessage(chatId, TEXT.suspended);
    return;
  }

  // 🔗 A file a classmate shared (lib/share-links.ts).
  if (shareCode) {
    await handleSharedFile(context, chatId, shareCode);
    return;
  }

  if (message.document) {
    await handleDocument(context, chatId, updateId, message.document);
    return;
  }

  if (start) {
    await sendMessage(chatId, TEXT.welcome, mainKeyboard());
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
  } else if (text === BUTTONS.invite || /^\/invite\b/i.test(text)) {
    await handleInvite(context, chatId);
  } else if (text === BUTTONS.myFiles || /^\/files\b/i.test(text)) {
    await handleFilesList(context, chatId);
  } else if (text === BUTTONS.howItWorks || /^\/help\b/i.test(text)) {
    await sendMessage(chatId, TEXT.howItWorks, mainKeyboard());
  } else if (text === BUTTONS.openSite) {
    await sendMessage(
      chatId,
      TEXT.openSite,
      await openSiteButton(context, LABELS.openSite, "/subjects")
    );
  } else {
    await sendMessage(chatId, TEXT.unknownMessage, mainKeyboard());
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

  if (parsed.action === "convert") {
    // Only the first press moves the upload on; a second finds nothing.
    const reopened = await reopenUploadAsBook(upload.id);
    if (reopened) {
      await publishMessage({ type: "telegram_intake", uploadId: upload.id });
    }
    await answerCallback(
      query.id,
      reopened ? TEXT.convertStarted : TEXT.retryUnavailable
    );
    return;
  }

  if (parsed.action === "share") {
    const shared = upload.bookId
      ? await handleShareRequest(
          context,
          chat.id,
          upload.bookId,
          upload.fileName
        )
      : false;
    await answerCallback(query.id, shared ? undefined : TEXT.shareUnavailable);
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
