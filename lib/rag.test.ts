import { describe, expect, it } from "vitest";
import {
  buildContextBlock,
  buildRagSystemPrompt,
  capChunks,
  type RetrievedChunk,
} from "./rag";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    bookId: "b1",
    bookFileName: "كتاب.pdf",
    chapterId: "c1",
    pageNumber: 1,
    text: "نص الصفحة",
    ...overrides,
  };
}

describe("capChunks", () => {
  it("keeps every chunk when the total is under the budget", () => {
    const chunks = [
      chunk({ text: "a".repeat(100) }),
      chunk({ text: "b".repeat(100) }),
    ];
    expect(capChunks(chunks)).toHaveLength(2);
  });

  it("always keeps at least the first chunk, even if it alone exceeds the budget", () => {
    const chunks = [chunk({ text: "a".repeat(20_000) })];
    expect(capChunks(chunks)).toHaveLength(1);
  });

  it("stops adding further chunks once the running total would exceed the budget", () => {
    const chunks = [
      chunk({ pageNumber: 1, text: "a".repeat(11_000) }),
      chunk({ pageNumber: 2, text: "b".repeat(5_000) }),
      chunk({ pageNumber: 3, text: "c".repeat(100) }),
    ];
    const result = capChunks(chunks);
    // The 2nd chunk alone would push the total over MAX_CONTEXT_CHARS
    // (12,000), so it (and everything after it) is dropped — but never a
    // mid-chunk truncation, always whole chunks.
    expect(result).toHaveLength(1);
    expect(result[0].pageNumber).toBe(1);
  });
});

describe("buildContextBlock", () => {
  it("tags each chunk with its book name and page number", () => {
    const block = buildContextBlock([
      chunk({ bookFileName: "فيزياء.pdf", pageNumber: 5, text: "قانون نيوتن" }),
    ]);
    expect(block).toContain("فيزياء.pdf");
    expect(block).toContain("صفحة 5");
    expect(block).toContain("قانون نيوتن");
  });

  it("keeps multiple chunks clearly separated", () => {
    const block = buildContextBlock([
      chunk({ pageNumber: 1, text: "أولاً" }),
      chunk({ pageNumber: 2, text: "ثانيًا" }),
    ]);
    expect(block.indexOf("أولاً")).toBeLessThan(block.indexOf("ثانيًا"));
  });
});

describe("buildRagSystemPrompt", () => {
  it("names the correct scope for each level and forbids outside knowledge", () => {
    expect(buildRagSystemPrompt("page")).toContain("the current page only");
    expect(buildRagSystemPrompt("chapter")).toContain(
      "the current chapter only"
    );
    expect(buildRagSystemPrompt("book")).toContain("the current book only");
    expect(buildRagSystemPrompt("subject")).toContain(
      "every book in the current subject"
    );
  });

  it("instructs the model to cite pages and never invent facts", () => {
    const prompt = buildRagSystemPrompt("page");
    expect(prompt).toMatch(/cite/i);
    expect(prompt).toMatch(/never invent/i);
  });

  it("instructs the model not to reveal quiz answers immediately", () => {
    expect(buildRagSystemPrompt("page")).toMatch(/do not reveal/i);
  });
});
