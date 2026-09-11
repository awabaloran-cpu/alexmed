import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/verify", () => ({ verifyQStashRequest: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  storageGetSignedUrl: vi
    .fn()
    .mockResolvedValue("https://signed.example/file.pdf"),
}));
vi.mock("@/lib/queue/client", () => ({ publishMessage: vi.fn() }));
vi.mock("@/lib/pdf-ocr", () => ({ ocrPages: vi.fn() }));
vi.mock("@/lib/db-books", () => ({
  getBookById: vi.fn(),
  markBookExtractionFailed: vi.fn(),
  updateBookExtractionProgress: vi.fn(),
  upsertBookPagesText: vi.fn(),
  finalizeBookExtraction: vi.fn().mockResolvedValue({ chapters: [] }),
}));
vi.mock("pdf-parse/worker", () => ({ CanvasFactory: class {} }));
vi.mock("pdf-parse", () => ({
  PDFParse: vi.fn().mockImplementation(() => ({
    getText: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { verifyQStashRequest } from "@/lib/queue/verify";
import { publishMessage } from "@/lib/queue/client";
import { ocrPages } from "@/lib/pdf-ocr";
import {
  finalizeBookExtraction,
  getBookById,
  markBookExtractionFailed,
  updateBookExtractionProgress,
  upsertBookPagesText,
} from "@/lib/db-books";
import { POST } from "./route";

const mockVerify = verifyQStashRequest as unknown as ReturnType<typeof vi.fn>;
const mockPublish = publishMessage as unknown as ReturnType<typeof vi.fn>;
const mockOcrPages = ocrPages as unknown as ReturnType<typeof vi.fn>;
const mockGetBook = getBookById as unknown as ReturnType<typeof vi.fn>;
const mockMarkFailed = markBookExtractionFailed as unknown as ReturnType<
  typeof vi.fn
>;
const mockUpdateProgress =
  updateBookExtractionProgress as unknown as ReturnType<typeof vi.fn>;
const mockUpsertPages = upsertBookPagesText as unknown as ReturnType<
  typeof vi.fn
>;
const mockFinalize = finalizeBookExtraction as unknown as ReturnType<
  typeof vi.fn
>;

function request(body: unknown) {
  return new Request("https://app.example.com/api/books/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/books/extract", () => {
  beforeEach(() => {
    process.env.QUEUE_MAX_ATTEMPTS = "2";
    mockVerify.mockReset().mockResolvedValue(true);
    mockPublish.mockReset().mockResolvedValue(undefined);
    mockOcrPages.mockReset();
    mockGetBook.mockReset();
    mockMarkFailed.mockReset();
    mockUpdateProgress.mockReset().mockResolvedValue(undefined);
    mockUpsertPages.mockReset().mockResolvedValue(undefined);
    mockFinalize.mockReset().mockResolvedValue({ chapters: [] });
  });

  afterEach(() => {
    delete process.env.QUEUE_MAX_ATTEMPTS;
  });

  it("rejects a request with an invalid QStash signature", async () => {
    mockVerify.mockResolvedValue(false);
    const response = await POST(request({ bookId: "b1" }));
    expect(response.status).toBe(401);
    expect(mockGetBook).not.toHaveBeenCalled();
  });

  // Core acceptance criterion: a book with some pages still needing OCR
  // retries them (never a whole-book failure) up to QUEUE_MAX_ATTEMPTS
  // *per page*, not per worker invocation.
  it("keeps retrying a page under its retry budget instead of giving up or failing the book", async () => {
    mockGetBook.mockResolvedValue({
      id: "b1",
      fileKey: "books/b1.pdf",
      status: "extracting",
      pageTexts: [
        { page: 1, text: "already has text", hasText: true },
        { page: 7, text: "", hasText: false },
      ],
      pagesNeedingOcr: [7],
      ocrFailedPages: [],
      ocrAttemptCounts: {}, // page 7 hasn't failed yet
      pageCount: 7,
    });
    mockOcrPages.mockResolvedValue({
      pages: [{ page: 7, text: "", hasText: false, ocr: true }],
      failedPages: [7],
    });

    const response = await POST(request({ bookId: "b1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("extracting");
    // Not exhausted (1 attempt < max of 2) — must self-chain, never finalize
    // or fail the whole book.
    expect(mockFinalize).not.toHaveBeenCalled();
    expect(mockMarkFailed).not.toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledWith(
      { type: "extract_book_job", bookId: "b1" },
      expect.objectContaining({ delay: expect.any(Number) })
    );
    const progressCall = mockUpdateProgress.mock.calls[0][1];
    expect(progressCall.ocrAttemptCounts).toEqual({ "7": 1 });
    expect(progressCall.pagesNeedingOcr).toEqual([7]);
  });

  // Once a specific page's retry budget IS exhausted, it becomes
  // permanently failed and individually retryable — but the rest of the
  // book (here, page 1) still finalizes normally. The book is never marked
  // "failed" outright for this.
  it("finalizes a book with one permanently-failed page as partial, not as a whole-book failure", async () => {
    mockGetBook.mockResolvedValue({
      id: "b1",
      fileKey: "books/b1.pdf",
      status: "extracting",
      pageTexts: [
        { page: 1, text: "already has text", hasText: true },
        { page: 7, text: "", hasText: false },
      ],
      pagesNeedingOcr: [7],
      ocrFailedPages: [],
      // Already failed once — QUEUE_MAX_ATTEMPTS=2, so one more failure
      // exhausts this page's budget this round.
      ocrAttemptCounts: { "7": 1 },
      pageCount: 7,
    });
    mockOcrPages.mockResolvedValue({
      pages: [{ page: 7, text: "", hasText: false, ocr: true }],
      failedPages: [7],
    });

    const response = await POST(request({ bookId: "b1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("extracted");
    expect(mockMarkFailed).not.toHaveBeenCalled();
    // Page 7 gets persisted as failed immediately (retryable on its own)...
    expect(mockUpsertPages).toHaveBeenCalledWith(
      "b1",
      expect.arrayContaining([
        expect.objectContaining({ page: 7, textStatus: "failed" }),
      ])
    );
    // ...and finalizeBookExtraction still runs with BOTH pages — page 1
    // complete, page 7 failed — never skipping the book entirely.
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    const [, finalizedPages] = mockFinalize.mock.calls[0];
    expect(finalizedPages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ page: 1, textStatus: "complete" }),
        expect.objectContaining({ page: 7, textStatus: "failed" }),
      ])
    );
  });

  // Resumability: a worker resuming from a book that already has
  // book.pageTexts staged must never re-run PDF text extraction — it should
  // only process the pages still listed in pagesNeedingOcr.
  it("resumes from staged pageTexts without re-extracting already-succeeded pages", async () => {
    mockGetBook.mockResolvedValue({
      id: "b1",
      fileKey: "books/b1.pdf",
      status: "extracting",
      pageTexts: [
        ...Array.from({ length: 40 }, (_, i) => ({
          page: i + 1,
          text: `page ${i + 1} text`,
          hasText: true,
        })),
        { page: 41, text: "", hasText: false },
      ],
      pagesNeedingOcr: [41],
      ocrFailedPages: [],
      ocrAttemptCounts: {},
      pageCount: 41,
    });
    mockOcrPages.mockResolvedValue({
      pages: [{ page: 41, text: "recovered text", hasText: true, ocr: true }],
      failedPages: [],
    });

    const response = await POST(request({ bookId: "b1" }));
    expect(response.status).toBe(200);
    // Only page 41 (the one that actually needed OCR) is upserted here —
    // the 40 already-successful pages are never re-processed or re-upserted
    // by this call.
    expect(mockUpsertPages).toHaveBeenCalledWith("b1", [
      expect.objectContaining({ page: 41, textStatus: "complete" }),
    ]);
    expect(mockOcrPages).toHaveBeenCalledWith(expect.anything(), [41]);
  });
});
