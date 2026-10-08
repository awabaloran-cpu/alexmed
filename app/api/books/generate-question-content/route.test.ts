import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/verify", () => ({ verifyQStashRequest: vi.fn() }));
vi.mock("@/lib/queue/claim", () => ({ claimExtractedQuestion: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({ publishMessage: vi.fn() }));
vi.mock("@/lib/db-question-files", () => ({
  getQuestionFileBookById: vi.fn(),
}));
vi.mock("@/lib/db-question-file-images", () => ({
  getExtractedQuestionImages: vi.fn(),
  getNextPendingExtractedQuestion: vi.fn(),
  markExtractedQuestionAiFailed: vi.fn(),
  saveExtractedQuestionEnrichment: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  storageGetSignedUrl: vi.fn().mockResolvedValue("https://signed.example/img"),
}));
vi.mock("@/lib/llm", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return { ...actual, invokeLLM: vi.fn() };
});

import { verifyQStashRequest } from "@/lib/queue/verify";
import { claimExtractedQuestion } from "@/lib/queue/claim";
import { publishMessage } from "@/lib/queue/client";
import { getQuestionFileBookById } from "@/lib/db-question-files";
import {
  getExtractedQuestionImages,
  getNextPendingExtractedQuestion,
  markExtractedQuestionAiFailed,
  saveExtractedQuestionEnrichment,
} from "@/lib/db-question-file-images";
import { storageGetSignedUrl } from "@/lib/storage";
import { invokeLLM } from "@/lib/llm";
import { POST } from "./route";

const mockVerify = verifyQStashRequest as unknown as ReturnType<typeof vi.fn>;
const mockClaim = claimExtractedQuestion as unknown as ReturnType<typeof vi.fn>;
const mockPublish = publishMessage as unknown as ReturnType<typeof vi.fn>;
const mockGetBook = getQuestionFileBookById as unknown as ReturnType<
  typeof vi.fn
>;
const mockGetImages = getExtractedQuestionImages as unknown as ReturnType<
  typeof vi.fn
>;
const mockNextQuestion =
  getNextPendingExtractedQuestion as unknown as ReturnType<typeof vi.fn>;
const mockMarkFailed = markExtractedQuestionAiFailed as unknown as ReturnType<
  typeof vi.fn
>;
const mockSaveEnrichment =
  saveExtractedQuestionEnrichment as unknown as ReturnType<typeof vi.fn>;
const mockSignedUrl = storageGetSignedUrl as unknown as ReturnType<
  typeof vi.fn
>;
const mockInvoke = invokeLLM as unknown as ReturnType<typeof vi.fn>;

function request(body: unknown) {
  return new Request(
    "https://app.example.com/api/books/generate-question-content",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function enrichmentResponse(inferredAnswerIndex: number | null) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            keywords: ["ecg", "arrhythmia"],
            explanationAr: "شرح Arabic مع English terms.",
            inferredAnswerIndex,
          }),
        },
      },
    ],
  };
}

describe("POST /api/books/generate-question-content", () => {
  beforeEach(() => {
    mockVerify.mockReset().mockResolvedValue(true);
    mockClaim.mockReset();
    mockPublish.mockReset();
    mockGetBook
      .mockReset()
      .mockResolvedValue({ id: "b1", fileKey: "books/b1.pdf" });
    mockGetImages.mockReset().mockResolvedValue([]);
    mockNextQuestion.mockReset();
    mockMarkFailed.mockReset();
    mockSaveEnrichment.mockReset();
    mockSignedUrl.mockReset().mockResolvedValue("https://signed.example/img");
    mockInvoke.mockReset();
  });

  it("rejects a request with an invalid QStash signature", async () => {
    mockVerify.mockResolvedValue(false);
    const response = await POST(request({ bookId: "b1" }));
    expect(response.status).toBe(401);
    expect(mockGetBook).not.toHaveBeenCalled();
  });

  it("skips a question whose claim is lost to a concurrent delivery, without calling the AI", async () => {
    mockNextQuestion
      .mockResolvedValueOnce({ id: "q1", bookId: "b1" })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce(null);

    const response = await POST(request({ bookId: "b1" }));
    const body = await response.json();

    expect(body.status).toBe("done");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockSaveEnrichment).not.toHaveBeenCalled();
  });

  it("enriches a text-only question (no image) without ever requesting a signed url", async () => {
    mockNextQuestion
      .mockResolvedValueOnce({
        id: "q1",
        bookId: "b1",
        questionText: "What is the powerhouse of the cell?",
        options: ["Nucleus", "Mitochondria"],
        extractedAnswerText: "Mitochondria",
        extractedAnswerIndex: 1,
      })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: "q1",
      bookId: "b1",
      attemptCount: 1,
    });
    mockGetImages.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValue(enrichmentResponse(null));

    const response = await POST(request({ bookId: "b1" }));
    expect(response.status).toBe(200);

    expect(mockSignedUrl).not.toHaveBeenCalled();
    expect(mockSaveEnrichment).toHaveBeenCalledWith("q1", {
      keywords: ["ecg", "arrhythmia"],
      aiExplanationAr: "شرح Arabic مع English terms.",
      inferredAnswerIndex: null,
      hasStatedAnswer: true,
      // «اربطها»: the model's answer here has none, so none is stored.
      mnemonicAr: null,
    });
  });

  it("sends a vision message and signs the image url when the question has an associated image", async () => {
    mockNextQuestion
      .mockResolvedValueOnce({
        id: "q2",
        bookId: "b1",
        questionText: "Identify the rhythm.",
        options: null,
        extractedAnswerText: null,
        extractedAnswerIndex: null,
      })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: "q2",
      bookId: "b1",
      attemptCount: 1,
    });
    mockGetImages.mockResolvedValueOnce([
      { id: "img1", pageNumber: 5, storageKey: "question-files/b1/5.png" },
    ]);
    mockInvoke.mockResolvedValue(enrichmentResponse(2));

    await POST(request({ bookId: "b1" }));

    expect(mockSignedUrl).toHaveBeenCalledWith("question-files/b1/5.png");
    const [{ messages }] = mockInvoke.mock.calls[0];
    const userMessage = messages[1];
    expect(Array.isArray(userMessage.content)).toBe(true);
    expect(userMessage.content).toContainEqual({
      type: "image_url",
      image_url: { url: "https://signed.example/img", detail: "high" },
    });
  });

  it("never persists inferredAnswerIndex when the source already stated an answer", async () => {
    mockNextQuestion
      .mockResolvedValueOnce({
        id: "q3",
        bookId: "b1",
        questionText: "Stated-answer question",
        options: ["A", "B"],
        extractedAnswerText: "A",
        extractedAnswerIndex: 0,
      })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: "q3",
      bookId: "b1",
      attemptCount: 1,
    });
    // Even if the model returns a non-null value here, saveExtractedQuestionEnrichment
    // is the one responsible for not overwriting a real answer — this test
    // just proves hasStatedAnswer is passed through correctly.
    mockInvoke.mockResolvedValue(enrichmentResponse(1));

    await POST(request({ bookId: "b1" }));

    const [, update] = mockSaveEnrichment.mock.calls[0];
    expect(update.hasStatedAnswer).toBe(true);
  });

  it("marks a question failed (not thrown) when its own enrichment call errors", async () => {
    mockNextQuestion
      .mockResolvedValueOnce({
        id: "q4",
        bookId: "b1",
        questionText: "x",
        options: null,
        extractedAnswerText: null,
        extractedAnswerIndex: null,
      })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: "q4",
      bookId: "b1",
      attemptCount: 1,
    });
    mockInvoke.mockRejectedValue(new Error("LLM exploded"));

    const response = await POST(request({ bookId: "b1" }));
    expect(response.status).toBe(200);
    expect(mockMarkFailed).toHaveBeenCalledWith("q4", expect.any(String));
  });

  // Self-chaining / TEST E — every call finds a pending question and every
  // claim succeeds, so the batch cap is hit and the post-loop check still
  // finds more, proving the route republishes itself rather than stopping
  // partway through a large question file.
  it("self-chains when questions remain pending after the batch (long-file coverage)", async () => {
    mockNextQuestion.mockResolvedValue({
      id: "q1",
      bookId: "b1",
      questionText: "x",
      options: null,
      extractedAnswerText: null,
      extractedAnswerIndex: null,
    });
    mockClaim.mockResolvedValue({ id: "q1", bookId: "b1", attemptCount: 1 });
    mockInvoke.mockResolvedValue(enrichmentResponse(null));

    const response = await POST(request({ bookId: "b1" }));
    const body = await response.json();

    expect(body.status).toBe("processing");
    expect(mockPublish).toHaveBeenCalledWith(
      { type: "generate_question_file_content", bookId: "b1" },
      { flowControl: { key: "question-file-content-b1", parallelism: 1 } }
    );
    expect(mockClaim).toHaveBeenCalledTimes(15);
  });

  function translatedResponse(questionAr: string, optionsAr: string[]) {
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              keywords: ["cell"],
              explanationAr: "شرح",
              inferredAnswerIndex: null,
              questionAr,
              optionsAr,
            }),
          },
        },
      ],
    };
  }

  function oneQuestion(row: Record<string, unknown>) {
    mockNextQuestion
      .mockResolvedValueOnce({
        id: "qt",
        bookId: "b1",
        extractedAnswerText: "Mitochondria",
        extractedAnswerIndex: 1,
        ...row,
      })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: "qt",
      bookId: "b1",
      attemptCount: 1,
    });
    mockGetImages.mockResolvedValueOnce([]);
  }

  it("machine-translates a question the file gave no Arabic for, in the same call, marked for review", async () => {
    oneQuestion({
      questionText: "What is the powerhouse of the cell?",
      options: ["Nucleus", "Mitochondria"],
      questionTextAr: null,
      optionsAr: null,
    });
    mockInvoke.mockResolvedValue(
      translatedResponse("ما هو مصنع الطاقة في الخلية؟", [
        "النواة",
        "الميتوكوندريا",
      ])
    );

    await POST(request({ bookId: "b1" }));

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const call = mockInvoke.mock.calls[0][0];
    expect(call.response_format.json_schema.name).toBe(
      "extracted_question_enrichment_with_translation"
    );
    expect(JSON.stringify(call.messages)).toContain(
      "translate the question stem"
    );
    expect(mockSaveEnrichment).toHaveBeenCalledWith(
      "qt",
      expect.objectContaining({
        translation: {
          questionTextAr: "ما هو مصنع الطاقة في الخلية؟",
          optionsAr: ["النواة", "الميتوكوندريا"],
        },
      })
    );
  });

  it("never re-translates a question whose Arabic came from the file", async () => {
    oneQuestion({
      questionText: "What is the powerhouse of the cell?",
      options: ["Nucleus", "Mitochondria"],
      questionTextAr: "ما هو مصنع الطاقة؟",
      optionsAr: ["النواة", "الميتوكوندريا"],
    });
    mockInvoke.mockResolvedValue(enrichmentResponse(null));

    await POST(request({ bookId: "b1" }));

    const call = mockInvoke.mock.calls[0][0];
    expect(call.response_format.json_schema.name).toBe(
      "extracted_question_enrichment"
    );
    expect(call.max_tokens).toBe(800);
    expect(mockSaveEnrichment.mock.calls[0][1]).not.toHaveProperty(
      "translation"
    );
  });

  it("fills only the missing options, keeping the file's own Arabic question", async () => {
    oneQuestion({
      questionText: "What is the powerhouse of the cell?",
      options: ["Nucleus", "Mitochondria"],
      questionTextAr: "سؤال من الملف",
      optionsAr: null,
    });
    mockInvoke.mockResolvedValue(
      translatedResponse("ترجمة لن تُستخدم", ["النواة", "الميتوكوندريا"])
    );

    await POST(request({ bookId: "b1" }));

    expect(mockSaveEnrichment.mock.calls[0][1].translation).toEqual({
      optionsAr: ["النواة", "الميتوكوندريا"],
    });
  });

  it("drops a machine translation whose option count doesn't match", async () => {
    oneQuestion({
      questionText: "Q?",
      options: ["a", "b", "c"],
      questionTextAr: null,
      optionsAr: null,
    });
    mockInvoke.mockResolvedValue(translatedResponse("س؟", ["أ", "ب"]));

    await POST(request({ bookId: "b1" }));

    expect(mockSaveEnrichment.mock.calls[0][1].translation).toEqual({
      questionTextAr: "س؟",
    });
  });

  it("an Arabic-only question is never translated", async () => {
    oneQuestion({
      questionText: "ما هي عاصمة الأردن؟",
      options: ["إربد", "عمّان"],
      questionTextAr: null,
      optionsAr: null,
    });
    mockInvoke.mockResolvedValue(enrichmentResponse(null));

    await POST(request({ bookId: "b1" }));

    expect(mockInvoke.mock.calls[0][0].response_format.json_schema.name).toBe(
      "extracted_question_enrichment"
    );
  });

  it("returns done with no publish once no questions remain pending", async () => {
    mockNextQuestion.mockResolvedValue(null);

    const response = await POST(request({ bookId: "b1" }));
    const body = await response.json();

    expect(body.status).toBe("done");
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
