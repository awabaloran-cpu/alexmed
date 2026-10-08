// ✈️ Thin client for the Telegram Bot API — the only file that talks to
// Telegram. Plain fetch; no bot framework, since the gateway uses a handful
// of methods and is driven by webhooks + the existing queue.
import { telegramApiBase, telegramBotToken } from "./config";

export class TelegramApiError extends Error {
  constructor(
    public method: string,
    public status: number,
    description: string
  ) {
    super(`Telegram ${method} failed (${status}): ${description}`);
    this.name = "TelegramApiError";
  }
}

export type InlineButton =
  | { text: string; url: string }
  // Opens the page inside Telegram as a Mini App (private chats only).
  | { text: string; web_app: { url: string } }
  | { text: string; callback_data: string };

export type ReplyMarkup =
  | { inline_keyboard: InlineButton[][] }
  | {
      // A plain button sends its text as a message; a web_app button opens
      // the page inside Telegram instead.
      keyboard: {
        text: string;
        web_app?: { url: string };
        // Sends the user's own phone number to the bot when pressed.
        request_contact?: boolean;
      }[][];
      resize_keyboard?: boolean;
      is_persistent?: boolean;
      one_time_keyboard?: boolean;
    };

const REQUEST_TIMEOUT_MS = 15_000;

async function call<T>(method: string, body: Record<string, unknown>) {
  const response = await fetch(
    `${telegramApiBase()}/bot${telegramBotToken()}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    result?: T;
    description?: string;
  } | null;
  if (!response.ok || !payload?.ok) {
    throw new TelegramApiError(
      method,
      response.status,
      payload?.description ?? "no description"
    );
  }
  return payload.result as T;
}

// Plain text on purpose (no parse_mode): file names and error texts go into
// messages, and unescaped Markdown / HTML in them would make Telegram
// reject the whole message.
export async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: ReplyMarkup
): Promise<number> {
  const message = await call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
  return message.message_id;
}

// Edits the bot's own progress message. "message is not modified" (the same
// text again) and a message the student deleted are not failures.
export async function editMessage(
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: { inline_keyboard: InlineButton[][] }
): Promise<boolean> {
  try {
    await call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    return true;
  } catch (error) {
    if (
      error instanceof TelegramApiError &&
      error.status === 400 &&
      /not modified|message to edit not found|can't be edited/i.test(
        error.message
      )
    ) {
      return /not modified/i.test(error.message);
    }
    throw error;
  }
}

export async function answerCallback(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  }).catch(error => {
    // Only stops the button's spinner; an expired query is not worth failing.
    console.error("[Telegram] answerCallbackQuery failed", error);
  });
}

// The download URL for a file the bot was sent. Contains the bot token, so
// it is fetched server-side only and never stored or shown.
export async function getFileDownloadUrl(fileId: string): Promise<string> {
  const file = await call<{ file_path?: string }>("getFile", {
    file_id: fileId,
  });
  if (!file.file_path) {
    throw new TelegramApiError("getFile", 200, "no file_path returned");
  }
  return `${telegramApiBase()}/file/bot${telegramBotToken()}/${file.file_path}`;
}

// True when Telegram says the user blocked the bot or deleted the chat —
// nothing further can be delivered there.
export function isChatGone(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    (error.status === 403 ||
      /chat not found|bot was blocked|user is deactivated/i.test(error.message))
  );
}
