import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/verify", () => ({ verifyQStashRequest: vi.fn() }));
vi.mock("@/lib/queue/concurrency", () => ({
  isUserConcurrencyExceeded: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/db-books", () => ({ getChapterById: vi.fn() }));
vi.mock("@/lib/book-enrichment", () => ({
  generateAndSaveMindMapSections: vi.fn(),
}));

import { verifyQStashRequest } from "@/lib/queue/verify";
import { isUserConcurrencyExceeded } from "@/lib/queue/concurrency";
import { getChapterById } from "@/lib/db-books";
import { generateAndSaveMindMapSections } from "@/lib/book-enrichment";
import { POST } from "./route";

const mockVerify = verifyQStashRequest as unknown as ReturnType<typeof vi.fn>;
const mockConcurrency = isUserConcurrencyExceeded as unknown as ReturnType<
  typeof vi.fn
>;
const mockGetChapter = getChapterById as unknown as ReturnType<typeof vi.fn>;
const mockGenerate = generateAndSaveMindMapSections as unknown as ReturnType<
  typeof vi.fn
>;

function request(body: unknown) {
  return new Request(
    "https://app.example.com/api/books/generate-mindmap-sections",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/books/generate-mindmap-sections", () => {
  beforeEach(() => {
    mockVerify.mockReset().mockResolvedValue(true);
    mockConcurrency.mockReset().mockResolvedValue(false);
    mockGetChapter.mockReset();
    mockGenerate.mockReset();
  });

  it("rejects a request with an invalid QStash signature", async () => {
    mockVerify.mockResolvedValue(false);
    const response = await POST(request({ chapterId: "c1" }));
    expect(response.status).toBe(401);
    expect(mockGetChapter).not.toHaveBeenCalled();
  });

  it("skips when the chapter no longer exists", async () => {
    mockGetChapter.mockResolvedValue(null);
    const response = await POST(request({ chapterId: "c1" }));
    const body = await response.json();
    expect(body.status).toBe("skipped");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("throttles when the student's own concurrency budget is exceeded, without generating", async () => {
    mockGetChapter.mockResolvedValue({ id: "c1", userId: "u1" });
    mockConcurrency.mockResolvedValue(true);
    const response = await POST(request({ chapterId: "c1" }));
    expect(response.status).toBe(429);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("generates sections and reports complete on success", async () => {
    mockGetChapter.mockResolvedValue({ id: "c1", userId: "u1" });
    mockGenerate.mockResolvedValue([
      { title: "S1", explanationAr: "شرح", sourcePages: [1], concepts: [] },
    ]);
    const response = await POST(request({ chapterId: "c1" }));
    const body = await response.json();
    expect(body.status).toBe("complete");
    expect(mockGenerate).toHaveBeenCalledWith("c1");
  });

  // Idempotency guard (audit Phase 6): the chapter analysis route also
  // fires this trigger, and QStash itself is at-least-once — a chapter
  // that isn't actually ready yet (already handled inside
  // generateAndSaveMindMapSections, which returns null for a non-"complete"
  // chapter) must report "skipped", not error.
  it("reports skipped (not an error) when generation has nothing to do", async () => {
    mockGetChapter.mockResolvedValue({ id: "c1", userId: "u1" });
    mockGenerate.mockResolvedValue(null);
    const response = await POST(request({ chapterId: "c1" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("skipped");
  });

  // Best-effort only (see route's own header comment) — a failure here must
  // never bubble up as an unhandled error; the chapter itself is already
  // durably complete regardless of this enrichment's outcome.
  it("reports failed (still HTTP 200) instead of throwing when generation errors", async () => {
    mockGetChapter.mockResolvedValue({ id: "c1", userId: "u1" });
    mockGenerate.mockRejectedValue(new Error("LLM exploded"));
    const response = await POST(request({ chapterId: "c1" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("failed");
  });
});
