// A file laid out as cards: "Question N" on a line of its own, the
// options, "Correct answer" on a line with the answer under it, an
// "Explanation" (or "Added explanation") heading, and a rule drawn under
// each card. Seen in production (2026-10-11): the titles were taken for a
// running header and dropped, so every card ran into the next — a last
// option that swallowed the answer, the explanation and the next stem, no
// answer read for any question, and a stem cut in two at a page break.
import { describe, expect, it } from "vitest";
import { analyzeQuestionDocument } from "./question-document";

const RULE = "—————————————————————————————————————————————";

const card = (
  n: number,
  stem: string[],
  options: string[],
  answer: number,
  explanation: string,
  heading = "Explanation"
) =>
  [
    `Question ${n}`,
    ...stem,
    ...options.map((text, i) => `${"ABCDE"[i]}. ${text}`),
    "Correct answer",
    `${"ABCDE"[answer]}. ${options[answer]}`,
    heading,
    explanation,
    RULE,
  ].join("\n");

const footer = (page: number) => `Paediatrics — Organized MCQs | ${page}`;

// Ten pages, two cards a page, so the title recurs on every page the way
// a running header would. Each card is about something of its own: text
// that only differs by a number would itself read as a running header.
const TOPICS = [
  "asthma",
  "anaemia",
  "croup",
  "measles",
  "rickets",
  "scabies",
  "sepsis",
  "tetanus",
  "typhoid",
  "malaria",
  "mumps",
  "rubella",
  "polio",
  "eczema",
  "colic",
  "reflux",
  "jaundice",
  "epilepsy",
  "diabetes",
  "obesity",
];
const CARDS = TOPICS.map((topic, i) => ({
  n: i + 1,
  stem: [
    `Which statement about ${topic} in children is the`,
    `most accurate for ${topic}?`,
  ],
  options: [
    `First fact on ${topic}`,
    `Second fact on ${topic}`,
    `Third fact on ${topic}`,
    `Fourth fact on ${topic}`,
  ],
  answer: i % 4,
  explanation: `The reason lies in how ${topic} behaves.`,
}));

function pagesOf() {
  const pages: { page: number; text: string }[] = [];
  for (let p = 0; p < 10; p++) {
    const [a, b] = [CARDS[p * 2], CARDS[p * 2 + 1]];
    pages.push({
      page: p + 1,
      text: [
        ...(p === 0
          ? [
              "1. Organized Questions",
              "The correct option is highlighted in blue. Explanations marked",
              "“Added explanation” were not present in the source archive.",
            ]
          : []),
        card(a.n, a.stem, a.options, a.answer, a.explanation),
        card(
          b.n,
          b.stem,
          b.options,
          b.answer,
          b.explanation,
          // A few cards title it differently.
          b.n % 6 === 0 ? "Added explanation" : "Explanation"
        ),
        ...(p === 9
          ? [
              "2. Notes on Source Completeness",
              "The archive begins directly with Question 1. Questions 6 and 12",
              "contained a duplicated card; their explanations are marked.",
            ]
          : []),
        footer(p + 1),
      ].join("\n"),
    });
  }
  return pages;
}

describe("a file of titled question cards", () => {
  const analysis = analyzeQuestionDocument(pagesOf(), {
    acceptIncompleteOptions: true,
  });
  const questions = analysis.questions;

  it("is its twenty cards, and nothing else", () => {
    expect(questions.length).toBe(20);
    expect(analysis.needsReview).toEqual([]);
    // Neither the preface nor the closing notes is a question.
    for (const question of questions) {
      expect(question.questionText).not.toMatch(/Organized|Notes on Source/);
    }
  });

  it("each card keeps its own stem, options, answer and explanation", () => {
    for (const [index, question] of questions.entries()) {
      const source = CARDS[index];
      expect(question.questionText).toBe(source.stem.join(" "));
      expect(question.options).toEqual(source.options);
      expect(question.extractedAnswerIndex).toBe(source.answer);
      expect(question.explanationText).toBe(source.explanation);
    }
  });

  it("nothing of the page's furniture is left inside a card", () => {
    const text = JSON.stringify(questions);
    expect(text).not.toMatch(
      /Correct answer|Added explanation|—————|Question \d/
    );
    expect(text).not.toContain("Organized MCQs");
  });

  it("a stem that starts at the foot of one page continues on the next", () => {
    const pages = pagesOf();
    const long = [
      "Question 21",
      "A child presents with a three-day history of cough and fever. Examination",
      "reveals a pale",
      footer(10),
    ].join("\n");
    pages[9] = {
      page: 10,
      text: pages[9].text
        .replace(/2\. Notes on Source[\s\S]*$/, "")
        .concat(long),
    };
    pages.push({
      page: 11,
      text: [
        "infant with nasal flaring. Which is the most appropriate first step?",
        "A. Nebulizer",
        "B. Fluids",
        "C. Oxygen",
        "D. Steroids",
        "Correct answer",
        "C. Oxygen",
        "Explanation",
        "Hypoxaemia comes first.",
        RULE,
        footer(11),
      ].join("\n"),
    });
    const last = analyzeQuestionDocument(pages, {
      acceptIncompleteOptions: true,
    }).questions.at(-1)!;
    expect(last.questionText).toBe(
      "A child presents with a three-day history of cough and fever. Examination reveals a pale infant with nasal flaring. Which is the most appropriate first step?"
    );
    expect(last.options).toEqual(["Nebulizer", "Fluids", "Oxygen", "Steroids"]);
    expect(last.extractedAnswerIndex).toBe(2);
    expect(last.sourcePage).toBe(10);
  });

  it("a file numbered the usual way still reads as before", () => {
    const usual = analyzeQuestionDocument(
      [
        {
          page: 1,
          text: [
            "1. Which planet is closest to the Sun?",
            "A. Venus",
            "B. Mercury",
            "C. Mars",
            "D. Earth",
            "Answer: B",
            "Explanation: It orbits nearest.",
            "2. Which gas do plants take in?",
            "A. Oxygen",
            "B. Nitrogen",
            "C. Carbon dioxide",
            "D. Helium",
            "Answer: C",
          ].join("\n"),
        },
      ],
      { acceptIncompleteOptions: true }
    ).questions;
    expect(usual.map(q => q.extractedAnswerIndex)).toEqual([1, 2]);
    expect(usual[0].explanationText).toBe("It orbits nearest.");
  });
});
