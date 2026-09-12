import { describe, expect, it } from "vitest";
import { extractQuestionsFromPages } from "./question-extraction";

describe("extractQuestionsFromPages", () => {
  it("extracts a question with options, a lettered answer, and an explanation", () => {
    const pages = [
      {
        page: 1,
        text: [
          "1. What is the powerhouse of the cell?",
          "A. Nucleus",
          "B. Mitochondria",
          "C. Ribosome",
          "D. Golgi apparatus",
          "Answer: B",
          "Explanation: Mitochondria produce ATP through respiration.",
        ].join("\n"),
      },
    ];

    const result = extractQuestionsFromPages(pages);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      orderIndex: 0,
      questionText: "What is the powerhouse of the cell?",
      options: ["Nucleus", "Mitochondria", "Ribosome", "Golgi apparatus"],
      extractedAnswerIndex: 1,
      extractedAnswerText: "Mitochondria",
      explanationText: "Mitochondria produce ATP through respiration.",
      sourcePage: 1,
    });
  });

  it("leaves the answer null when the source file never states one", () => {
    const pages = [
      {
        page: 3,
        text: "5. What year did WWII end?\nA. 1943\nB. 1945\nC. 1950",
      },
    ];

    const result = extractQuestionsFromPages(pages);

    expect(result).toHaveLength(1);
    expect(result[0].extractedAnswerIndex).toBeNull();
    expect(result[0].extractedAnswerText).toBeNull();
  });

  it("resolves an answer given as full option text, not just a letter", () => {
    const pages = [
      {
        page: 1,
        text: "1. Pick one\nA. Apple\nB. Banana\nCorrect answer: Banana",
      },
    ];

    const result = extractQuestionsFromPages(pages);
    expect(result[0].extractedAnswerIndex).toBe(1);
    expect(result[0].extractedAnswerText).toBe("Banana");
  });

  it("splits multiple questions across pages and numbers them in order", () => {
    const pages = [
      { page: 1, text: "1. First question\nA. X\nB. Y" },
      { page: 2, text: "2. Second question\nA. X\nB. Y" },
    ];

    const result = extractQuestionsFromPages(pages);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ orderIndex: 0, sourcePage: 1 });
    expect(result[1]).toMatchObject({ orderIndex: 1, sourcePage: 2 });
  });

  it("ignores stray text before the first numbered question", () => {
    const pages = [
      {
        page: 1,
        text: "Exam Bank — 2026\nGood luck!\n1. Real question\nA. X\nB. Y",
      },
    ];

    const result = extractQuestionsFromPages(pages);
    expect(result).toHaveLength(1);
    expect(result[0].questionText).toBe("Real question");
  });

  it("returns an empty array for text with no detectable questions", () => {
    expect(
      extractQuestionsFromPages([
        { page: 1, text: "Just prose, no questions here." },
      ])
    ).toEqual([]);
  });

  it("wraps a multi-line question stem into one questionText", () => {
    const pages = [
      {
        page: 1,
        text: "1. A patient presents with\nfever and cough for three days.\nA. Flu\nB. Cold",
      },
    ];
    const result = extractQuestionsFromPages(pages);
    expect(result[0].questionText).toBe(
      "A patient presents with fever and cough for three days."
    );
  });
});
