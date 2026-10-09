// 🩹 Runs lib/question-repair.ts for the held-back questions of one page,
// from inside the page worker (app/api/books/extract-question-images),
// which already has the file open and the page drawn.
//
// Best effort: a question the page does not give back whole simply stays
// held back. Only an AI failure that passes is thrown, so the page worker's
// own waiting and retrying covers the repair too.
import { transientAiRetryDelaySeconds } from "./ai/types";
import {
  listBrokenQuestionsOnPage,
  markQuestionRepairDeclined,
  saveRepairedQuestion,
} from "./db-question-file-images";
import { DEFAULT_VISION_MODEL, invokeLLM } from "./llm";
import { getScreenshotUnderLimit } from "./pdf-screenshot";
import {
  buildQuestionRepairMessages,
  parseQuestionRepair,
  QUESTION_REPAIR_MAX_TOKENS,
  questionRepairResponseSchema,
} from "./question-repair";
import type { PDFParse } from "pdf-parse";

export async function repairBrokenQuestionsOnPage(input: {
  bookId: string;
  pageNumber: number;
  pageCount: number;
  parser: PDFParse;
  // The page, already drawn by the caller (a data: URL).
  pageImage: string;
}): Promise<{ repaired: number; declined: number }> {
  const broken = await listBrokenQuestionsOnPage(
    input.bookId,
    input.pageNumber
  );
  const outcome = { repaired: 0, declined: 0 };
  if (!broken.length) return outcome;

  // A question at the foot of the page finishes on the next one.
  const images = [input.pageImage];
  if (input.pageNumber < input.pageCount) {
    const next = await getScreenshotUnderLimit(
      input.parser,
      input.pageNumber + 1
    ).catch(() => null);
    if (next?.dataUrl) images.push(next.dataUrl);
  }

  for (const question of broken) {
    try {
      const response = await invokeLLM({
        model: DEFAULT_VISION_MODEL,
        max_tokens: QUESTION_REPAIR_MAX_TOKENS,
        messages: buildQuestionRepairMessages(question, images),
        response_format: questionRepairResponseSchema,
      });
      const repaired = parseQuestionRepair(
        response.choices[0]?.message.content,
        question
      );
      if (
        repaired &&
        (await saveRepairedQuestion(input.bookId, question.id, repaired))
      ) {
        outcome.repaired++;
      } else {
        await markQuestionRepairDeclined(question.id);
        outcome.declined++;
      }
    } catch (error) {
      if (transientAiRetryDelaySeconds(error, 1) !== null) throw error;
      console.error(
        `[QuestionFiles] Repair of question ${question.id} failed`,
        error
      );
    }
  }
  if (outcome.repaired || outcome.declined) {
    console.warn(
      JSON.stringify({
        event: "question_file_repair",
        bookId: input.bookId,
        page: input.pageNumber,
        ...outcome,
      })
    );
  }
  return outcome;
}
