import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDb,
  insertQuestionFile,
  insertUser,
  type TestDb,
} from "./test-fixtures/pglite-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  getDb: () => holder.db,
  requireDb: () => holder.db,
}));
vi.mock("./llm", async importOriginal => {
  const actual = await importOriginal<typeof import("./llm")>();
  return { ...actual, invokeLLM: vi.fn() };
});
vi.mock("./pdf-screenshot", () => ({
  getScreenshotUnderLimit: vi
    .fn()
    .mockResolvedValue({ dataUrl: "data:image/png;base64,NEXT" }),
}));

import { AiUpstreamError } from "./ai/types";
import { invokeLLM } from "./llm";
import {
  buildQuestionRepairMessages,
  parseQuestionRepair,
  type BrokenQuestion,
} from "./question-repair";
import { repairBrokenQuestionsOnPage } from "./question-repair-run";
import type { PDFParse } from "pdf-parse";

const mockInvoke = invokeLLM as unknown as ReturnType<typeof vi.fn>;

// A block as the parser stored it (a real one, 2026-10-09): the scan lost
// four of the five option letters, so one "option" swallowed the rest.
const broken: BrokenQuestion = {
  questionText:
    "A couple brought their second male child to the immunologist because he suffers from a primary immune disorder. What is the most probable mode of inheritance of the child's illness?",
  options: ["Autosomal recessive B X-linked recessive C Autosomal dominant"],
  extractedAnswerText: null,
  explanationText: null,
};
const page = {
  found: true,
  questionText:
    "121. A couple brought their second male child to the immunologist because he suffers from a primary immune disorder. What is the most probable mode of inheritance of the child's illness?",
  options: [
    "A. Autosomal recessive",
    "X-linked recessive",
    "Autosomal dominant",
    "X-linked dominant",
    "Y-linked",
  ],
  answerLetter: "C",
  explanation:
    "Note: Autosomal dominant inheritance is the most common mode of Mendelian inheritance.",
};
const answer = (value: unknown) => ({
  choices: [{ message: { content: JSON.stringify(value) } }],
});

describe("parseQuestionRepair", () => {
  it("takes a complete question read from the page, without its number and letters", () => {
    const repaired = parseQuestionRepair(JSON.stringify(page), broken);
    expect(repaired).toEqual({
      questionText: page.questionText.replace("121. ", ""),
      options: [
        "Autosomal recessive",
        "X-linked recessive",
        "Autosomal dominant",
        "X-linked dominant",
        "Y-linked",
      ],
      extractedAnswerIndex: 2,
      extractedAnswerText: "Autosomal dominant",
      explanationText: page.explanation,
    });
  });

  it("keeps the page's silence about the answer: none is made up", () => {
    const repaired = parseQuestionRepair(
      JSON.stringify({ ...page, answerLetter: null, explanation: null }),
      broken
    );
    expect(repaired?.extractedAnswerIndex).toBeNull();
    expect(repaired?.extractedAnswerText).toBeNull();
    expect(repaired?.explanationText).toBeNull();
    // A letter the question has no option for is no answer either.
    expect(
      parseQuestionRepair(
        JSON.stringify({ ...page, answerLetter: "H" }),
        broken
      )?.extractedAnswerIndex
    ).toBeNull();
  });

  it("refuses what is not a whole question", () => {
    const refuse = (change: Record<string, unknown>) =>
      expect(
        parseQuestionRepair(JSON.stringify({ ...page, ...change }), broken)
      ).toBeNull();
    refuse({ found: false });
    refuse({ options: ["Autosomal recessive"] });
    refuse({ options: ["Same", "same", "Other"] });
    refuse({ options: ["Autosomal recessive", "Answer: C"] });
    refuse({ questionText: "Which?" });
    expect(parseQuestionRepair("not json", broken)).toBeNull();
    expect(parseQuestionRepair(null, broken)).toBeNull();
  });

  it("refuses a neighbour on the page read in place of the question asked for", () => {
    expect(
      parseQuestionRepair(
        JSON.stringify({
          ...page,
          questionText:
            "Clarissa, a cheerful 20-month-old girl, is referred to the child development clinic because she is not yet walking. Which investigation would you choose first?",
          options: ["Cranial ultrasound scan", "EEG", "CT or MRI scan"],
        }),
        broken
      )
    ).toBeNull();
  });
});

describe("buildQuestionRepairMessages", () => {
  it("sends the page and the next one, and the parser's attempt as data", () => {
    const [system, user] = buildQuestionRepairMessages(broken, ["P1", "P2"]);
    const parts = user.content as { type: string; text?: string }[];
    expect(parts.filter(part => part.type === "image_url")).toHaveLength(2);
    expect(parts[0].text).toContain("Autosomal recessive B X-linked");
    expect(String(system.content)).toContain("second is the next page");
    expect(String(system.content)).not.toContain("immunologist");
    // A last page has no next one.
    const [alone] = buildQuestionRepairMessages(broken, ["P1"]);
    expect(String(alone.content)).toContain("Only one page is given");
  });
});

describe("repairBrokenQuestionsOnPage", () => {
  const OWNER = "11111111-1111-4111-8111-111111111111";
  const BOOK = "55555555-5555-4555-8555-555555555555";
  let test: TestDb;
  const parser = {} as PDFParse;
  const run = (pageNumber = 46) =>
    repairBrokenQuestionsOnPage({
      bookId: BOOK,
      pageNumber,
      pageCount: 68,
      parser,
      pageImage: "data:image/png;base64,PAGE",
    });
  const rows = async () =>
    (
      await test.client.query<{
        orderIndex: number;
        questionText: string;
        options: string[];
        reviewStatus: string | null;
        reviewReason: string | null;
        aiStatus: string;
        extractedAnswerIndex: number | null;
      }>(
        `SELECT "orderIndex", "questionText", options, "reviewStatus", "reviewReason", "aiStatus", "extractedAnswerIndex"
         FROM extracted_questions WHERE "bookId" = $1 ORDER BY "orderIndex"`,
        [BOOK]
      )
    ).rows;

  beforeAll(async () => {
    test = await createTestDb();
    holder.db = test.db;
    await insertUser(test.client, { id: OWNER });
    await insertQuestionFile(test.client, { id: BOOK, userId: OWNER });
  }, 60_000);

  beforeEach(async () => {
    mockInvoke.mockReset();
    await test.client.query(`DELETE FROM question_sets WHERE "bookId" = $1`, [
      BOOK,
    ]);
    await test.client.query(
      `DELETE FROM extracted_questions WHERE "bookId" = $1`,
      [BOOK]
    );
    // A visible question, then the held-back one, both on page 46.
    await test.client.query(
      `INSERT INTO extracted_questions ("bookId", "orderIndex", "questionText", options, "sourcePage", "aiStatus")
       VALUES ($1, 0, 'A visible question about something else entirely?', '["Yes","No"]'::jsonb, 46, 'complete')`,
      [BOOK]
    );
    await test.client.query(
      `INSERT INTO extracted_questions ("bookId", "orderIndex", "questionText", options, "sourcePage", "aiStatus", "reviewStatus", "reviewReason")
       VALUES ($1, 1, $2, $3::jsonb, 46, 'complete', 'needs_review', 'single_option,options_out_of_order')`,
      [BOOK, broken.questionText, JSON.stringify(broken.options)]
    );
  });

  it("repairs the held-back question and hands it on for its explanation", async () => {
    mockInvoke.mockResolvedValue(answer(page));
    expect(await run()).toEqual({ repaired: 1, declined: 0 });

    const [, fixed] = await rows();
    expect(fixed.options).toHaveLength(5);
    expect(fixed.extractedAnswerIndex).toBe(2);
    // Visible to students now, and waiting for stage 3.
    expect(fixed.reviewStatus).toBeNull();
    expect(fixed.reviewReason).toBe("repaired_from_page");
    expect(fixed.aiStatus).toBe("pending");
    // Both pictures went with the request.
    const sent = mockInvoke.mock.calls[0][0].messages[1].content as {
      type: string;
    }[];
    expect(sent.filter(part => part.type === "image_url")).toHaveLength(2);

    // Nothing is held back on the page any more: no second request.
    expect(await run()).toEqual({ repaired: 0, declined: 0 });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("leaves it held back when the page does not give it back whole, and does not ask again", async () => {
    mockInvoke.mockResolvedValue(answer({ ...page, found: false }));
    expect(await run()).toEqual({ repaired: 0, declined: 1 });
    const [, still] = await rows();
    expect(still.reviewStatus).toBe("needs_review");
    expect(still.reviewReason).toBe(
      "single_option,options_out_of_order,repair_declined"
    );
    expect(still.options).toHaveLength(1);

    expect(await run()).toEqual({ repaired: 0, declined: 0 });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("never stores a second copy of a question the file already shows", async () => {
    await test.client.query(
      `UPDATE extracted_questions SET "questionText" = $2 WHERE "bookId" = $1 AND "orderIndex" = 0`,
      [BOOK, page.questionText.replace("121. ", "").toUpperCase()]
    );
    mockInvoke.mockResolvedValue(answer(page));
    expect(await run()).toEqual({ repaired: 0, declined: 1 });
    expect((await rows())[1].reviewStatus).toBe("needs_review");
  });

  it("touches nothing in a doctor's protected set", async () => {
    await test.client.query(
      `INSERT INTO question_sets ("bookId", "ownerId", title) VALUES ($1, $2, 'Set')`,
      [BOOK, OWNER]
    );
    expect(await run()).toEqual({ repaired: 0, declined: 0 });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("passes on an AI outage, so the page is tried again later", async () => {
    mockInvoke.mockRejectedValue(new AiUpstreamError("busy"));
    await expect(run()).rejects.toThrow("busy");
    const [, untouched] = await rows();
    expect(untouched.reviewReason).toBe("single_option,options_out_of_order");
  });

  it("asks nothing for a page with no held-back question", async () => {
    expect(await run(12)).toEqual({ repaired: 0, declined: 0 });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
