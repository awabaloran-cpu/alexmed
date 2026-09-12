import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/verify", () => ({ verifyQStashRequest: vi.fn() }));
vi.mock("@/lib/queue/concurrency", () => ({
  isUserConcurrencyExceeded: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/queue/claim", () => ({ claimBookChapter: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({
  publishMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db-books", () => ({
  getChapterById: vi.fn(),
  completeChapterAnalysis: vi.fn(),
  finalizeBookIfDone: vi.fn(),
  markBookChapterFailedTerminal: vi.fn(),
  markBookChapterRetrying: vi.fn(),
  saveChapterSubChunkProgress: vi.fn(),
}));
vi.mock("@/lib/llm", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return { ...actual, invokeLLM: vi.fn() };
});

import { verifyQStashRequest } from "@/lib/queue/verify";
import { claimBookChapter } from "@/lib/queue/claim";
import { publishMessage } from "@/lib/queue/client";
import {
  completeChapterAnalysis,
  getChapterById,
  saveChapterSubChunkProgress,
} from "@/lib/db-books";
import { invokeLLM } from "@/lib/llm";
import { POST } from "./route";

const mockVerify = verifyQStashRequest as unknown as ReturnType<typeof vi.fn>;
const mockGetChapter = getChapterById as unknown as ReturnType<typeof vi.fn>;
const mockClaim = claimBookChapter as unknown as ReturnType<typeof vi.fn>;
const mockComplete = completeChapterAnalysis as unknown as ReturnType<
  typeof vi.fn
>;
const mockInvoke = invokeLLM as unknown as ReturnType<typeof vi.fn>;
const mockSaveProgress = saveChapterSubChunkProgress as unknown as ReturnType<
  typeof vi.fn
>;
const mockPublish = publishMessage as unknown as ReturnType<typeof vi.fn>;

function request(body: unknown) {
  return new Request("https://app.example.com/api/books/analyze-chapter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function chapterAnalysisContent(overrides?: {
  flashcards?: unknown[];
  mcqs?: unknown[];
}) {
  return JSON.stringify({
    explanationAr: "شرح",
    explanationEn: "explanation",
    keyPoints: [],
    medicalTerms: [],
    flashcards: overrides?.flashcards ?? [],
    mcqs: overrides?.mcqs ?? [],
    chapterSummary: "summary",
  });
}

describe("POST /api/books/analyze-chapter", () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockGetChapter.mockReset();
    mockClaim.mockReset();
    mockComplete.mockReset();
    mockInvoke.mockReset();
    mockSaveProgress.mockReset();
    mockPublish.mockReset().mockResolvedValue(undefined);
  });

  it("rejects a request with an invalid QStash signature", async () => {
    mockVerify.mockResolvedValue(false);
    const response = await POST(request({ chapterId: "c1" }));
    expect(response.status).toBe(401);
    // No DB work should ever happen for an unsigned/invalid request.
    expect(mockGetChapter).not.toHaveBeenCalled();
  });

  // Same data-integrity guard مِرآة (generate-batch) and مكتبة الأدمن already
  // have, now added to كتبي too: a card/MCQ whose sourcePage the model
  // hallucinated outside this chapter's own page range must be dropped, not
  // silently kept.
  it("rejects (does not coerce) a card/MCQ whose sourcePage is outside the chapter's page range", async () => {
    mockVerify.mockResolvedValue(true);
    mockGetChapter.mockResolvedValue({
      id: "c1",
      bookId: "b1",
      userId: "u1",
      title: "Chapter 1",
      startPage: 1,
      endPage: 1,
      pageTexts: [{ page: 1, text: "some chapter text" }],
    });
    mockClaim.mockResolvedValue({ id: "c1", bookId: "b1", attemptCount: 0 });
    mockInvoke.mockResolvedValue({
      choices: [
        {
          message: {
            content: chapterAnalysisContent({
              flashcards: [
                {
                  questionAr: "س1",
                  questionEn: "Q1",
                  answerAr: "ج1",
                  answerEn: "A1",
                  relatedTermEn: "term",
                  sourcePage: 1, // in range
                },
                {
                  questionAr: "س2",
                  questionEn: "Q2",
                  answerAr: "ج2",
                  answerEn: "A2",
                  relatedTermEn: "term",
                  sourcePage: 99, // out of range — must be dropped
                },
              ],
              mcqs: [
                {
                  questionEn: "MCQ in range",
                  choices: ["a", "b", "c", "d"],
                  correctIndex: 0,
                  explanationEn: "why",
                  sourcePage: 1,
                },
                {
                  questionEn: "MCQ out of range",
                  choices: ["a", "b", "c", "d"],
                  correctIndex: 0,
                  explanationEn: "why",
                  sourcePage: 42,
                },
              ],
            }),
          },
        },
      ],
    });

    const response = await POST(request({ chapterId: "c1" }));
    expect(response.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [, , result] = mockComplete.mock.calls[0];
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].sourcePage).toBe(1);
    expect(result.mcqs).toHaveLength(1);
    expect(result.mcqs[0].sourcePage).toBe(1);
  });

  // P0 audit fix: a chapter split into multiple sub-chunks (>8 pages) must
  // resume from chapter.subChunkResults instead of re-invoking the LLM for
  // sub-chunks that already completed on a prior (timed-out/retried) run.
  it("resumes from a previously-saved sub-chunk instead of redoing it", async () => {
    mockVerify.mockResolvedValue(true);
    // 9 pages -> chunkChapterPages (default 8 pages/chunk) splits this into
    // exactly two sub-chunks: pages 1-8, then page 9.
    const pageTexts = Array.from({ length: 9 }, (_, i) => ({
      page: i + 1,
      text: `page ${i + 1} content`,
    }));
    const alreadySavedSubChunk = {
      explanationAr: "شرح محفوظ مسبقاً",
      explanationEn: "already saved",
      keyPoints: ["old point"],
      medicalTerms: [],
      flashcards: [
        {
          questionAr: "س",
          questionEn: "old Q",
          answerAr: "ج",
          answerEn: "old A",
          relatedTermEn: "",
          sourcePage: 1,
        },
      ],
      mcqs: [],
      chapterSummary: "old summary",
    };
    mockGetChapter.mockResolvedValue({
      id: "c1",
      bookId: "b1",
      userId: "u1",
      title: "Chapter 1",
      startPage: 1,
      endPage: 9,
      pageTexts,
      subChunkResults: [alreadySavedSubChunk],
    });
    mockClaim.mockResolvedValue({ id: "c1", bookId: "b1", attemptCount: 0 });
    // First call = the remaining sub-chunk's own analysis. Second call =
    // merging its summary with the already-saved sub-chunk's summary (there
    // are now 2 summaries total, which is what triggers the merge call).
    mockInvoke
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: chapterAnalysisContent({
                flashcards: [
                  {
                    questionAr: "س2",
                    questionEn: "new Q",
                    answerAr: "ج2",
                    answerEn: "new A",
                    relatedTermEn: "",
                    sourcePage: 9,
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: { content: JSON.stringify({ chapterSummary: "merged" }) },
          },
        ],
      });

    const response = await POST(request({ chapterId: "c1" }));
    expect(response.status).toBe(200);

    // Exactly TWO LLM calls: one for the remaining (second) sub-chunk, one
    // for the summary merge. The already-saved first sub-chunk must NOT
    // trigger its own LLM call — only 2, not 3.
    expect(mockInvoke).toHaveBeenCalledTimes(2);

    // Audit Phase 6 — the automatic mind-map-section trigger fires once the
    // chapter is durably complete.
    expect(mockPublish).toHaveBeenCalledWith({
      type: "generate_chapter_mindmap_sections",
      chapterId: "c1",
    });

    // Progress is persisted with BOTH results (old + newly generated).
    expect(mockSaveProgress).toHaveBeenCalledTimes(1);
    expect(mockSaveProgress).toHaveBeenCalledWith("c1", [
      alreadySavedSubChunk,
      expect.objectContaining({ chapterSummary: "summary" }),
    ]);

    // The final merged result includes cards from both sub-chunks.
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [, , result] = mockComplete.mock.calls[0];
    expect(
      result.cards.map((card: { sourcePage: number }) => card.sourcePage)
    ).toEqual([1, 9]);
  });
});
