import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/verify", () => ({ verifyQStashRequest: vi.fn() }));
vi.mock("@/lib/queue/claim", () => ({ claimBookPageVisual: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({ publishMessage: vi.fn() }));
vi.mock("@/lib/db-books", () => ({
  finalizeBookIfDone: vi.fn(),
  getBookById: vi.fn(),
  getNextPendingBookPage: vi.fn(),
  insertBookVisualAssets: vi.fn(),
  markBookPageVisualFailed: vi.fn(),
  updateBookPageVisualResult: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  storageGetSignedUrl: vi.fn().mockResolvedValue("https://signed.example/pdf"),
  storagePut: vi.fn().mockResolvedValue({ key: "book-pages/b1/1.png" }),
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

import { verifyQStashRequest } from "@/lib/queue/verify";
import { claimBookPageVisual } from "@/lib/queue/claim";
import {
  getBookById,
  getNextPendingBookPage,
  insertBookVisualAssets,
  markBookPageVisualFailed,
  updateBookPageVisualResult,
} from "@/lib/db-books";
import { invokeLLM } from "@/lib/llm";
import { AiCircuitOpenError, AiUpstreamError } from "@/lib/ai/types";
import { publishMessage } from "@/lib/queue/client";
import { POST } from "./route";

const mockVerify = verifyQStashRequest as unknown as ReturnType<typeof vi.fn>;
const mockClaim = claimBookPageVisual as unknown as ReturnType<typeof vi.fn>;
const mockGetBook = getBookById as unknown as ReturnType<typeof vi.fn>;
const mockNextPage = getNextPendingBookPage as unknown as ReturnType<
  typeof vi.fn
>;
const mockUpdateResult = updateBookPageVisualResult as unknown as ReturnType<
  typeof vi.fn
>;
const mockMarkFailed = markBookPageVisualFailed as unknown as ReturnType<
  typeof vi.fn
>;
const mockInsertAssets = insertBookVisualAssets as unknown as ReturnType<
  typeof vi.fn
>;
const mockInvoke = invokeLLM as unknown as ReturnType<typeof vi.fn>;

function request(body: unknown) {
  return new Request("https://app.example.com/api/books/analyze-page-visuals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/books/analyze-page-visuals", () => {
  beforeEach(() => {
    mockVerify.mockReset().mockResolvedValue(true);
    mockClaim.mockReset();
    vi.mocked(publishMessage).mockReset();
    mockGetBook
      .mockReset()
      .mockResolvedValue({ id: "b1", fileKey: "books/b1.pdf" });
    mockNextPage.mockReset();
    mockUpdateResult.mockReset();
    mockMarkFailed.mockReset();
    mockInsertAssets.mockReset();
    mockInvoke.mockReset();
  });

  it("rejects a request with an invalid QStash signature", async () => {
    mockVerify.mockResolvedValue(false);
    const response = await POST(request({ bookId: "b1" }));
    expect(response.status).toBe(401);
    expect(mockGetBook).not.toHaveBeenCalled();
  });

  // Proves no duplicate visual-asset rows on a retried/duplicate QStash
  // delivery: when the atomic claim loses the race (another delivery
  // already claimed this exact page), the route must never call the vision
  // model or write a result for it.
  it("skips a page whose claim is lost to a concurrent delivery, without calling the AI", async () => {
    mockNextPage
      .mockResolvedValueOnce({
        id: "p1",
        bookId: "b1",
        pageNumber: 1,
        chapterId: null,
        extractedText: "text",
      })
      .mockResolvedValueOnce(null); // no more pending after the failed claim
    mockClaim.mockResolvedValueOnce(null); // lost the race

    const response = await POST(request({ bookId: "b1" }));
    const body = await response.json();

    expect(body.status).toBe("done");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockUpdateResult).not.toHaveBeenCalled();
  });

  const page = (n: number) => ({
    id: "p" + n,
    bookId: "b1",
    pageNumber: n,
    chapterId: null,
    extractedText: "text",
  });

  it("stops the batch and waits when the AI service is down, instead of spending the pages' attempts", async () => {
    mockNextPage.mockResolvedValue(page(1));
    mockClaim.mockResolvedValue({ id: "p1", bookId: "b1", attemptCount: 1 });
    mockInvoke.mockRejectedValue(new AiCircuitOpenError("open", 60_000));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ bookId: "b1" }));
    logged.mockRestore();

    expect((await response.json()).status).toBe("processing");
    // One page tried, not twelve.
    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(publishMessage).toHaveBeenCalledWith(
      { type: "analyze_book_page_visuals", bookId: "b1" },
      {
        flowControl: { key: "books-visual-b1", parallelism: 1 },
        delay: 60,
      }
    );
  });

  it("waits longer on a page's later attempts", async () => {
    mockNextPage.mockResolvedValue(page(1));
    mockClaim.mockResolvedValue({ id: "p1", bookId: "b1", attemptCount: 2 });
    mockInvoke.mockRejectedValue(new AiUpstreamError("502"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await POST(request({ bookId: "b1" }));
    logged.mockRestore();

    expect(publishMessage).toHaveBeenCalledWith(
      { type: "analyze_book_page_visuals", bookId: "b1" },
      { flowControl: { key: "books-visual-b1", parallelism: 1 }, delay: 90 }
    );
  });

  it("moves on to the next page, without a wait, when one page fails for its own reasons", async () => {
    mockNextPage
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce(page(2))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockClaim
      .mockResolvedValueOnce({ id: "p1", bookId: "b1", attemptCount: 1 })
      .mockResolvedValueOnce({ id: "p2", bookId: "b1", attemptCount: 1 });
    mockInvoke.mockRejectedValue(new Error("unreadable answer"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ bookId: "b1" }));
    logged.mockRestore();

    expect((await response.json()).status).toBe("done");
    expect(mockClaim).toHaveBeenCalledTimes(2);
    expect(mockMarkFailed).toHaveBeenCalledTimes(2);
  });

  // A page whose text layer is empty (fully scanned/image page) but whose
  // vision analysis found real visual content must still be marked
  // "complete" — never treated as a failure just because extractedText is
  // blank.
  it("marks a page with empty extractedText but real visuals as complete, not failed", async () => {
    mockNextPage
      .mockResolvedValueOnce({
        id: "p1",
        bookId: "b1",
        pageNumber: 1,
        chapterId: "ch1",
        extractedText: "",
      })
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({
      id: "p1",
      bookId: "b1",
      attemptCount: 1,
    });
    mockInvoke.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              extractedText: "",
              visuals: [
                {
                  assetType: "diagram",
                  descriptionAr: "مخطط",
                  descriptionEn: "diagram",
                  confidence: "high",
                  needsReview: false,
                },
              ],
              confidence: "high",
              reviewStatus: "complete",
            }),
          },
        },
      ],
    });

    const response = await POST(request({ bookId: "b1" }));
    expect(response.status).toBe(200);

    expect(mockMarkFailed).not.toHaveBeenCalled();
    expect(mockUpdateResult).toHaveBeenCalledTimes(1);
    const [, update] = mockUpdateResult.mock.calls[0];
    expect(update.visualStatus).toBe("complete");
    expect(update.hasDiagrams).toBe(true);
    expect(mockInsertAssets).toHaveBeenCalledTimes(1);
  });
});
