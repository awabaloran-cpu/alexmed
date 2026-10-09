import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/verify", () => ({ verifyQStashRequest: vi.fn() }));
vi.mock("@/lib/queue/claim", () => ({ claimQuestionFilePage: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({ publishMessage: vi.fn() }));
vi.mock("@/lib/db-question-files", () => ({
  getQuestionFileBookById: vi.fn(),
}));
vi.mock("@/lib/db-question-file-images", () => ({
  ensureQuestionFilePages: vi.fn(),
  getNextPendingQuestionFilePage: vi.fn(),
  insertExtractedQuestionImage: vi.fn(),
  markQuestionFilePageComplete: vi.fn(),
  markQuestionFilePageFailed: vi.fn(),
  saveImageOwnerDecision: vi.fn(),
  // One question per page 1–5; they cover every page these tests use.
  listQuestionsForImageOwnership: vi.fn().mockResolvedValue(
    [1, 2, 3, 4, 5].map((page, i) => ({
      id: `q${page}`,
      sourcePage: page,
      orderIndex: i,
      questionText: `Question on page ${page}?`,
    }))
  ),
  getQuestionFilePageRange: vi.fn().mockResolvedValue({ first: 1, last: 999 }),
}));
vi.mock("@/lib/storage", () => ({
  storageGetSignedUrl: vi.fn().mockResolvedValue("https://signed.example/pdf"),
  storagePut: vi.fn().mockResolvedValue({ key: "question-files/b1/1.png" }),
}));
vi.mock("@/lib/llm", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return { ...actual, invokeLLM: vi.fn() };
});
// pdf-parse actually opens the (fake) signed URL — stub the whole module so
// no real PDF parsing/network happens in these unit tests.
vi.mock("pdf-parse", () => ({
  PDFParse: vi.fn().mockImplementation(() => ({
    getScreenshot: vi.fn().mockResolvedValue({
      pages: [
        {
          dataUrl: "data:image/png;base64,AAAA",
          data: new Uint8Array([1, 2, 3]),
          width: 1800,
          height: 2400,
        },
      ],
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("pdf-parse/worker", () => ({ CanvasFactory: {} }));
// The repair of held-back questions has its own tests
// (lib/question-repair.test.ts); here the page has none.
vi.mock("@/lib/question-repair-run", () => ({
  repairBrokenQuestionsOnPage: vi
    .fn()
    .mockResolvedValue({ repaired: 0, declined: 0 }),
}));

import { verifyQStashRequest } from "@/lib/queue/verify";
import { claimQuestionFilePage } from "@/lib/queue/claim";
import { publishMessage } from "@/lib/queue/client";
import { getQuestionFileBookById } from "@/lib/db-question-files";
import {
  ensureQuestionFilePages,
  getNextPendingQuestionFilePage,
  insertExtractedQuestionImage,
  markQuestionFilePageComplete,
  markQuestionFilePageFailed,
  saveImageOwnerDecision,
} from "@/lib/db-question-file-images";
import { invokeLLM } from "@/lib/llm";
import { AiCircuitOpenError } from "@/lib/ai/types";
import { POST } from "./route";

const mockVerify = verifyQStashRequest as unknown as ReturnType<typeof vi.fn>;
const mockClaim = claimQuestionFilePage as unknown as ReturnType<typeof vi.fn>;
const mockPublish = publishMessage as unknown as ReturnType<typeof vi.fn>;
const mockGetBook = getQuestionFileBookById as unknown as ReturnType<
  typeof vi.fn
>;
const mockEnsurePages = ensureQuestionFilePages as unknown as ReturnType<
  typeof vi.fn
>;
const mockNextPage = getNextPendingQuestionFilePage as unknown as ReturnType<
  typeof vi.fn
>;
const mockInsertImage = insertExtractedQuestionImage as unknown as ReturnType<
  typeof vi.fn
>;
const mockMarkComplete = markQuestionFilePageComplete as unknown as ReturnType<
  typeof vi.fn
>;
const mockMarkFailed = markQuestionFilePageFailed as unknown as ReturnType<
  typeof vi.fn
>;
const mockSaveDecision = saveImageOwnerDecision as unknown as ReturnType<
  typeof vi.fn
>;
const mockInvoke = invokeLLM as unknown as ReturnType<typeof vi.fn>;

function request(body: unknown) {
  return new Request(
    "https://app.example.com/api/books/extract-question-images",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function classificationResponse(hasImage: boolean, isAtPageEnd = false) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            hasImage,
            captionEn: hasImage ? "a figure" : "",
            isAtPageEnd,
          }),
        },
      },
    ],
  };
}

describe("POST /api/books/extract-question-images", () => {
  beforeEach(() => {
    mockVerify.mockReset().mockResolvedValue(true);
    mockClaim.mockReset();
    mockPublish.mockReset();
    mockGetBook
      .mockReset()
      .mockResolvedValue({ id: "b1", fileKey: "books/b1.pdf", pageCount: 20 });
    mockEnsurePages.mockReset();
    mockNextPage.mockReset();
    mockInsertImage.mockReset().mockResolvedValue({ id: "img1" });
    mockMarkComplete.mockReset();
    mockMarkFailed.mockReset();
    mockSaveDecision.mockReset();
    mockInvoke.mockReset();
  });

  it("rejects a request with an invalid QStash signature", async () => {
    mockVerify.mockResolvedValue(false);
    const response = await POST(request({ bookId: "b1" }));
    expect(response.status).toBe(401);
    expect(mockGetBook).not.toHaveBeenCalled();
  });

  it("skips a page whose claim is lost to a concurrent delivery, without calling the AI", async () => {
    mockNextPage
      .mockResolvedValueOnce({ id: "p1", bookId: "b1", pageNumber: 1 })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce(null);

    const response = await POST(request({ bookId: "b1" }));
    const body = await response.json();

    expect(body.status).toBe("images_done");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockMarkComplete).not.toHaveBeenCalled();
  });

  it("stores an image and marks the page complete when the page is classified as having one", async () => {
    mockNextPage
      .mockResolvedValueOnce({ id: "p1", bookId: "b1", pageNumber: 1 })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: "p1",
      bookId: "b1",
      pageNumber: 1,
      attemptCount: 1,
    });
    mockInvoke.mockResolvedValue(classificationResponse(true));

    const response = await POST(request({ bookId: "b1" }));
    expect(response.status).toBe(200);

    expect(mockInsertImage).toHaveBeenCalledWith(
      "b1",
      1,
      "question-files/b1/1.png",
      false
    );
    expect(mockMarkComplete).toHaveBeenCalledWith("p1");
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it("passes through isAtPageEnd:true when the model says no question follows the figure", async () => {
    mockNextPage
      .mockResolvedValueOnce({ id: "p1", bookId: "b1", pageNumber: 1 })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: "p1",
      bookId: "b1",
      pageNumber: 1,
      attemptCount: 1,
    });
    mockInvoke.mockResolvedValue(classificationResponse(true, true));

    await POST(request({ bookId: "b1" }));

    expect(mockInsertImage).toHaveBeenCalledWith(
      "b1",
      1,
      "question-files/b1/1.png",
      true
    );
  });

  it("marks the page complete without storing an image when classified as text-only", async () => {
    mockNextPage
      .mockResolvedValueOnce({ id: "p1", bookId: "b1", pageNumber: 2 })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: "p1",
      bookId: "b1",
      pageNumber: 2,
      attemptCount: 1,
    });
    mockInvoke.mockResolvedValue(classificationResponse(false));

    await POST(request({ bookId: "b1" }));

    expect(mockInsertImage).not.toHaveBeenCalled();
    expect(mockMarkComplete).toHaveBeenCalledWith("p1");
  });

  it("F: never classifies a page outside the questions' pages (cover, front matter, answer key)", async () => {
    const { getQuestionFilePageRange } = await import(
      "@/lib/db-question-file-images"
    );
    (
      getQuestionFilePageRange as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({ first: 4, last: 9 });
    mockNextPage
      .mockResolvedValueOnce({ id: "cover", bookId: "b1", pageNumber: 1 })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: "cover",
      bookId: "b1",
      pageNumber: 1,
      attemptCount: 1,
    });

    await POST(request({ bookId: "b1" }));

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockInsertImage).not.toHaveBeenCalled();
    expect(mockMarkComplete).toHaveBeenCalledWith("cover");
  });

  it("marks a page failed (not thrown) when its own classification call errors", async () => {
    mockNextPage
      .mockResolvedValueOnce({ id: "p1", bookId: "b1", pageNumber: 3 })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: "p1",
      bookId: "b1",
      pageNumber: 3,
      attemptCount: 1,
    });
    mockInvoke.mockRejectedValue(new Error("LLM exploded"));

    const response = await POST(request({ bookId: "b1" }));
    expect(response.status).toBe(200);
    expect(mockMarkFailed).toHaveBeenCalledWith("p1", expect.any(String));
  });

  it("stops the batch and waits when the AI service is down, instead of spending the pages' attempts", async () => {
    mockNextPage.mockResolvedValue({ id: "p1", bookId: "b1", pageNumber: 1 });
    mockClaim.mockResolvedValue({
      id: "p1",
      bookId: "b1",
      pageNumber: 1,
      attemptCount: 1,
    });
    mockInvoke.mockRejectedValue(new AiCircuitOpenError("open", 60_000));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ bookId: "b1" }));
    logged.mockRestore();

    expect((await response.json()).status).toBe("processing");
    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(
      { type: "extract_question_file_images", bookId: "b1" },
      {
        flowControl: { key: "question-file-images-b1", parallelism: 1 },
        delay: 60,
      }
    );
  });

  // Self-chaining / TEST E — simulates a queue that never runs dry within
  // one invocation's PAGES_PER_INVOCATION batch cap (a long PDF): every call
  // finds a pending page and every claim succeeds, so the loop consumes its
  // full batch and the post-loop "remaining" check still finds more,
  // proving the route republishes itself with a per-book, parallelism-1
  // Flow Control key instead of stopping early.
  it("self-chains when pages remain pending after the batch (long-PDF coverage)", async () => {
    mockNextPage.mockResolvedValue({ id: "p1", bookId: "b1", pageNumber: 1 });
    mockClaim.mockResolvedValue({
      id: "p1",
      bookId: "b1",
      pageNumber: 1,
      attemptCount: 1,
    });
    mockInvoke.mockResolvedValue(classificationResponse(false));

    const response = await POST(request({ bookId: "b1" }));
    const body = await response.json();

    expect(body.status).toBe("processing");
    expect(mockPublish).toHaveBeenCalledWith(
      { type: "extract_question_file_images", bookId: "b1" },
      { flowControl: { key: "question-file-images-b1", parallelism: 1 } }
    );
    // Explanations start for the questions behind the page front — the
    // student does not wait for every page of a long file.
    expect(mockPublish).toHaveBeenCalledWith(
      { type: "generate_question_file_content", bookId: "b1" },
      { flowControl: { key: "question-file-content-b1", parallelism: 1 } }
    );
    // Text-only pages: no image, so no ownership decision to save.
    expect(mockSaveDecision).not.toHaveBeenCalled();
    // Exactly PAGES_PER_INVOCATION (12) claims per invocation, never more —
    // the batch cap is what makes self-chaining necessary in the first
    // place, and what keeps one invocation's AI-call volume bounded.
    expect(mockClaim).toHaveBeenCalledTimes(12);
  });

  it("keeps walking the pages when starting the explanations fails", async () => {
    mockNextPage.mockResolvedValue({ id: "p1", bookId: "b1", pageNumber: 1 });
    mockClaim.mockResolvedValue({
      id: "p1",
      bookId: "b1",
      pageNumber: 1,
      attemptCount: 1,
    });
    mockInvoke.mockResolvedValue(classificationResponse(false));
    mockPublish.mockImplementation(async (message: { type: string }) => {
      if (message.type === "generate_question_file_content") {
        throw new Error("queue down");
      }
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ bookId: "b1" }));
    const body = await response.json();
    logged.mockRestore();

    expect(body.status).toBe("processing");
    expect(mockPublish).toHaveBeenCalledWith(
      { type: "extract_question_file_images", bookId: "b1" },
      { flowControl: { key: "question-file-images-b1", parallelism: 1 } }
    );
  });

  it("hands off to stage 3 once no pages remain pending", async () => {
    mockNextPage.mockResolvedValue(null); // nothing pending from the start

    const response = await POST(request({ bookId: "b1" }));
    const body = await response.json();

    expect(body.status).toBe("images_done");
    expect(mockPublish).toHaveBeenCalledWith({
      type: "generate_question_file_content",
      bookId: "b1",
    });
  });

  function onPage(page: number, verdict: Record<string, unknown>) {
    mockNextPage
      .mockResolvedValueOnce({ id: `p${page}`, bookId: "b1", pageNumber: page })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: `p${page}`,
      bookId: "b1",
      pageNumber: page,
      attemptCount: 1,
    });
    mockInvoke.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              hasImage: true,
              captionEn: "a figure",
              isAtPageEnd: false,
              owner: "UNCLEAR",
              confidence: "low",
              ...verdict,
            }),
          },
        },
      ],
    });
  }

  it("links a page's figure to that page's ONE question, asking the model with the page's questions", async () => {
    onPage(2, {});
    await POST(request({ bookId: "b1" }));
    const call = mockInvoke.mock.calls[0][0];
    expect(call.response_format.json_schema.name).toBe(
      "question_file_page_image_owner"
    );
    expect(JSON.stringify(call.messages)).toContain("Question on page 2?");
    expect(mockSaveDecision).toHaveBeenCalledWith("img1", 2, {
      kind: "question",
      questionId: "q2",
    });
  });

  it("an ambiguous figure (bottom of page, unclear owner) is stored unlinked and flagged", async () => {
    onPage(2, { isAtPageEnd: true });
    await POST(request({ bookId: "b1" }));
    expect(mockSaveDecision).toHaveBeenCalledWith("img1", 2, {
      kind: "review",
      questionIds: ["q2", "q3"],
    });
  });

  it("cover art / decoration on a question page is not even stored", async () => {
    onPage(2, { owner: "NONE", confidence: "high" });
    await POST(request({ bookId: "b1" }));
    expect(mockInsertImage).not.toHaveBeenCalled();
    expect(mockSaveDecision).not.toHaveBeenCalled();
  });
});
