import { describe, expect, it } from "vitest";
import { computeWeakPoints, type WeakPointAttemptRow } from "./db-books";

function row(
  overrides: Partial<WeakPointAttemptRow> = {}
): WeakPointAttemptRow {
  return {
    mcqId: "mcq-1",
    questionEn: "What is the powerhouse of the cell?",
    choices: ["Nucleus", "Mitochondria", "Ribosome", "Golgi"],
    correctIndex: 1,
    explanationEn: "Mitochondria produce ATP.",
    sourcePage: 4,
    chapterId: "chapter-1",
    chapterTitle: "الخلية",
    bookId: "book-1",
    bookFileName: "biology.pdf",
    lastSelectedIndex: 1,
    lastAttemptedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("computeWeakPoints", () => {
  it("excludes a question whose most recent attempt was correct", () => {
    const result = computeWeakPoints([
      row({ mcqId: "mcq-1", lastSelectedIndex: 1, correctIndex: 1 }),
    ]);
    expect(result.questions).toHaveLength(0);
    expect(result.chapters).toHaveLength(0);
  });

  it("includes a question whose most recent attempt was wrong", () => {
    const result = computeWeakPoints([
      row({ mcqId: "mcq-1", lastSelectedIndex: 0, correctIndex: 1 }),
    ]);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].mcqId).toBe("mcq-1");
  });

  it("groups wrong questions by chapter with a wrong count", () => {
    const result = computeWeakPoints([
      row({
        mcqId: "mcq-1",
        chapterId: "chapter-1",
        chapterTitle: "الخلية",
        lastSelectedIndex: 0,
        correctIndex: 1,
      }),
      row({
        mcqId: "mcq-2",
        chapterId: "chapter-1",
        chapterTitle: "الخلية",
        lastSelectedIndex: 2,
        correctIndex: 1,
      }),
      row({
        mcqId: "mcq-3",
        chapterId: "chapter-2",
        chapterTitle: "الوراثة",
        lastSelectedIndex: 3,
        correctIndex: 1,
      }),
    ]);
    expect(result.chapters).toHaveLength(2);
    const cell = result.chapters.find(c => c.chapterId === "chapter-1");
    expect(cell?.wrongCount).toBe(2);
    // Sorted with the weakest chapter (most wrong answers) first.
    expect(result.chapters[0].chapterId).toBe("chapter-1");
  });

  it("orders questions by most recently attempted first", () => {
    const result = computeWeakPoints([
      row({
        mcqId: "mcq-old",
        lastSelectedIndex: 0,
        correctIndex: 1,
        lastAttemptedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      row({
        mcqId: "mcq-new",
        lastSelectedIndex: 0,
        correctIndex: 1,
        lastAttemptedAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ]);
    expect(result.questions.map(q => q.mcqId)).toEqual(["mcq-new", "mcq-old"]);
  });

  it("never treats an unattempted-in-this-set question as weak (only rows given in are considered)", () => {
    expect(computeWeakPoints([])).toEqual({ chapters: [], questions: [] });
  });
});
