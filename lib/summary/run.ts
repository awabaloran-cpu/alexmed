// 📝 One worker run of a summary job (app/api/books/generate-summary).
//
// A run either writes the next pages (a couple of AI calls) and queues the
// next run, or — when every page is written — orders the chapters, writes
// the cover, prints the PDF and sends it. So a long file is never one long
// request, and a run that dies is picked up where the last one saved.
//
// Failures: a run that fails is queued again with a pause, up to
// MAX_ATTEMPTS in a row without progress; then the job is failed (it stops
// counting against the student's day) and the student is told.
import { getBookById } from "../db-books";
import { transientAiRetryDelaySeconds } from "../ai/types";
import { invokeLLM } from "../llm";
import { publishMessage } from "../queue/client";
import { storagePut } from "../storage";
import { findTelegramAccountById } from "../telegram/accounts";
import {
  deleteMessage,
  editMessage,
  isChatGone,
  sendDocument,
  sendMessage,
} from "../telegram/api";
import { inviteLink, shareUrl, sourceLink } from "../telegram/growth";
import { openButton } from "../telegram/links";
import { filePath, LABELS, primary, TEXT } from "../telegram/messages";
import {
  buildSummaryDoc,
  CALLS_PER_RUN,
  HEAD_SYSTEM_PROMPT,
  headUserPrompt,
  mergeByPlan,
  PAGES_PER_CALL,
  PAGES_SYSTEM_PROMPT,
  pagesUserPrompt,
  parseHead,
  PLAN_SYSTEM_PROMPT,
  planUserPrompt,
  sectionsFromAnswer,
  uncoveredPages,
} from "./compose";
import {
  claimSummary,
  completeSummary,
  failSummary,
  saveSummaryProgress,
  type SummaryRow,
} from "./jobs";
import { htmlToPdf } from "./pdf";
import { renderSummary } from "./render";
import { readPdfSource, readSummarySource } from "./source";
import { isSummaryStyle, toSummaryTheme, type SummarySection } from "./types";

const MAX_ATTEMPTS = 4;
const PAGES_MAX_TOKENS = 6000;
// Sections about the same topic are only put together when there are
// enough of them to repeat.
const MIN_SECTIONS_TO_PLAN = 5;

async function ask(system: string, user: string, maxTokens: number) {
  const response = await invokeLLM({
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const content = response.choices[0]?.message.content;
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) throw new Error("The AI returned an empty answer");
  return text;
}

type Chat = {
  chatId: number;
  accountId: string;
  user: Parameters<typeof openButton>[0];
} | null;

async function chatOf(summary: SummaryRow): Promise<Chat> {
  if (!summary.telegramAccountId) return null;
  const found = await findTelegramAccountById(summary.telegramAccountId);
  if (!found || found.account.blockedAt) return null;
  return {
    chatId: Number(found.account.chatId),
    accountId: found.account.id,
    user: found.user,
  };
}

// Telling the student must never fail the job.
async function tell(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (!isChatGone(error)) {
      console.error("[Summary] Could not message the student", error);
    }
  }
}

async function progress(summary: SummaryRow, chat: Chat, text: string) {
  if (!chat) return;
  await tell(async () => {
    if (summary.statusMessageId) {
      await editMessage(chat.chatId, summary.statusMessageId, text);
    } else {
      await sendMessage(chat.chatId, text);
    }
  });
}

export async function runSummary(
  id: string
): Promise<"done" | "requeued" | "skipped" | "failed"> {
  const summary = await claimSummary(id);
  if (!summary) return "skipped";
  const chat = await chatOf(summary);

  try {
    if (!isSummaryStyle(summary.style)) {
      throw new Unrecoverable("The summary's choices are not valid");
    }
    const book = summary.bookId ? await getBookById(summary.bookId) : null;
    if (!book && !summary.sourceKey) {
      throw new Unrecoverable("The summary's file is gone");
    }
    const fileName = book?.fileName ?? summary.sourceName ?? "file.pdf";
    const pages = book
      ? await readSummarySource(book)
      : await readPdfSource(summary.sourceKey!);
    if (!pages.length) throw new Unrecoverable("The file has no text");
    const parts = (summary.parts ?? []) as SummarySection[];
    const choice = {
      style: summary.style,
      theme: toSummaryTheme(summary.theme),
    };

    // ── more pages to write
    if (summary.donePages < pages.length) {
      let done = summary.donePages;
      for (let call = 0; call < CALLS_PER_RUN && done < pages.length; call++) {
        const group = pages.slice(done, done + PAGES_PER_CALL);
        const answer = await ask(
          PAGES_SYSTEM_PROMPT,
          pagesUserPrompt(summary.style, group),
          PAGES_MAX_TOKENS
        );
        parts.push(...sectionsFromAnswer(answer, group));
        done += group.length;
        await saveSummaryProgress(id, parts, done);
      }
      await progress(
        summary,
        chat,
        done < pages.length
          ? TEXT.summaryProgress(choice, done, pages.length)
          : TEXT.summaryPrinting(choice)
      );
      await publishMessage({ type: "generate_file_summary", summaryId: id });
      return "requeued";
    }

    // ── everything is written: chapters, cover, PDF
    if (!parts.length) throw new Error("Nothing was written for this file");
    const missing = uncoveredPages(pages, parts);
    if (missing.length) {
      // Recorded, not hidden: the pages' own run produced no section.
      console.warn("[Summary] Pages without a section", { id, missing });
    }
    const sections =
      parts.length >= MIN_SECTIONS_TO_PLAN
        ? mergeByPlan(
            parts,
            await ask(PLAN_SYSTEM_PROMPT, planUserPrompt(parts), 1200)
          )
        : parts;
    const head = parseHead(
      await ask(HEAD_SYSTEM_PROMPT, headUserPrompt(sections, pages[0]), 1500),
      fileName.replace(/\.pdf$/i, "")
    );
    const link =
      (chat ? await inviteLink(chat.accountId) : null) ??
      sourceLink("summary_pdf") ??
      "https://nirolearn.com";
    const html = renderSummary(
      buildSummaryDoc({
        head,
        sections,
        style: summary.style,
        sourcePages: pages.length,
        fileName,
        date: new Date().toLocaleDateString("ar-EG", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      }),
      { link, theme: toSummaryTheme(summary.theme) }
    );
    const pdf = await htmlToPdf(html);
    const { key } = await storagePut(
      `summaries/${summary.userId}/${id}.pdf`,
      pdf,
      "application/pdf"
    );
    await completeSummary(id, {
      title: head.title,
      fileKey: key,
      parts: sections,
    });

    if (chat) {
      await tell(async () => {
        // The PDF takes the progress message's place.
        if (summary.statusMessageId) {
          await deleteMessage(chat.chatId, summary.statusMessageId);
        }
        const kind = book?.sourceType === "question_file" ? "question_file" : "book";
        await sendDocument(
          chat.chatId,
          pdf,
          `${safeFileName(head.title)}.pdf`,
          TEXT.summaryReady(head.title, {
            pages: pages.length,
            sections: sections.length,
            ms: Date.now() - summary.createdAt.getTime(),
          }),
          {
            inline_keyboard: [
              // The file it was made from, when that is one to study from.
              ...(book
                ? [
                    [
                      primary(
                        await openButton(
                          chat.user,
                          kind === "book"
                            ? LABELS.openBook
                            : LABELS.startQuestions,
                          filePath(kind, book.id)
                        )
                      ),
                    ],
                  ]
                : []),
              [
                {
                  text: LABELS.sendToFriends,
                  url: shareUrl(link, TEXT.summaryShare),
                },
              ],
            ],
          }
        );
      });
    }
    return "done";
  } catch (error) {
    console.error("[Summary] Run failed", { id, error });
    const final =
      error instanceof Unrecoverable || summary.attemptCount >= MAX_ATTEMPTS;
    if (final) {
      await failSummary(id, error instanceof Error ? error.message : "failed");
      await progress(summary, chat, TEXT.summaryFailed);
      return "failed";
    }
    await publishMessage(
      { type: "generate_file_summary", summaryId: id },
      {
        delay:
          transientAiRetryDelaySeconds(error, summary.attemptCount) ??
          30 * summary.attemptCount,
      }
    );
    return "requeued";
  }
}

class Unrecoverable extends Error {}

// A file name Telegram and phones both accept: letters, digits, spaces.
function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned || "Summary";
}
