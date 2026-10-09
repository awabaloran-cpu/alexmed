import { describe, expect, it } from "vitest";
import { analyzeQuestionDocument } from "./question-document";

// A scanned file of 180 questions (2026-10-09) gave 118: the scan read
// "119." as "1-9", so question 120 was not "the next number" after 118 and
// was kept as a numbered list item of 118's note — and so was every
// question after it, 23 pages of them, in one 42,000-character note.
// The layout below is that file's: question, options, "Answer: D.",
// "Note: …", three to a page.
const block = (number: number | string, stem: string, answer = "D") => [
  `${number}${typeof number === "number" ? "." : ""} ${stem}`,
  "A. 5 months",
  "B. 7 months",
  "C. 9 months",
  "D. 10 months",
  "E. 12 months",
  `Answer: ${answer}.`,
  `Note: The median age for ${stem.toLowerCase()} is 10 months.`,
];

const pages = (lines: string[][]) =>
  lines.map((text, i) => ({ page: i + 1, text: text.join("\n") }));

describe("a question whose number the scan could not read", () => {
  const analysis = analyzeQuestionDocument(
    pages([
      [
        ...block(117, "What is the median age for copying a circle?"),
        ...block(
          118,
          "What is the median age for a child to achieve mature pincer grip?"
        ),
        // "119." as the scan read it.
        ...block(
          "1-9moth-moh--old",
          "baby girl presents with a urinary tract infection. Which organism is most likely?"
        ),
        ...block(
          120,
          "Which of the following drug classes is among the preventer therapy for bronchial asthma?",
          "C"
        ),
        "- Inhaled steroids",
        "- Methylxanthines / - Oral steroids",
      ],
      [
        ...block(
          121,
          "What is the most probable mode of inheritance of the child's illness?",
          "C"
        ),
        ...block(
          122,
          "Which of these investigations would you choose to initially undertake?",
          "C"
        ),
        ...block(123, "What is the most likely diagnosis?", "A"),
      ],
    ])
  );
  const numbers = analysis.all.map(q => q.questionText.slice(0, 40));

  it("does not lose the questions that follow it", () => {
    expect(analysis.all).toHaveLength(6);
    expect(numbers[2]).toContain("Which of the following drug classes");
    expect(numbers[5]).toContain("What is the most likely diagnosis?");
    const q120 = analysis.all[2];
    expect(q120.options).toHaveLength(5);
    expect(q120.extractedAnswerIndex).toBe(2);
    expect(q120.sourcePage).toBe(1);
    expect(analysis.all[3].sourcePage).toBe(2);
  });

  it("keeps every later question's note with its own question", () => {
    for (const question of analysis.all.slice(2)) {
      expect(question.explanationText?.length ?? 0).toBeLessThan(200);
    }
    expect(analysis.all[2].explanationText).toContain("- Inhaled steroids");
  });
});

describe("a numbered list inside a note is still part of the note", () => {
  it("keeps list items that have no options of their own", () => {
    const analysis = analyzeQuestionDocument(
      pages([
        [
          ...block(7, "Which drug is first line?"),
          "Note: Causes of this condition include:",
          "9. Viral infection of the airway",
          "12. Bacterial infection, less often",
          ...block(8, "Which test confirms the diagnosis?", "B"),
        ],
      ])
    );
    expect(analysis.all).toHaveLength(2);
    expect(analysis.all[0].explanationText).toContain("9. Viral infection");
    expect(analysis.all[0].explanationText).toContain("12. Bacterial");
    expect(analysis.all[1].questionText).toContain("Which test confirms");
  });
});
