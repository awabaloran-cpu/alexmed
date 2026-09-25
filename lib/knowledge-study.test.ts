// Knowledge-based Flashcards / Questions (lib/knowledge-study.ts) — the real
// pipeline with a deterministic stand-in model that can only write from the
// Knowledge Items actually sent to it. Proves: every item is covered,
// counts follow density/importance (not a fixed number), every output
// traces back to its knowledgeItemId + sourcePages, the Quality Gates reject
// malformed / duplicate / leaked items, failed verification is dropped and
// retried, and coverage is judged per Knowledge Item.
import { describe, expect, it } from "vitest";
import type { InvokeParams, InvokeResult } from "./llm";
import {
  cardTargetFor,
  checkCard,
  checkMcq,
  generateKnowledgeFlashcards,
  generateKnowledgeMcqs,
  itemsForPageRange,
  placeCorrectAnswer,
  questionTargetFor,
  type KnowledgeItem,
} from "./knowledge-study";

const CATEGORIES = [
  "must_know",
  "definition",
  "drug_dose",
  "clinical_clue",
  "comparison",
  "exam_trap",
  "numbers",
  "treatment",
];

// 113 facts over a 20-page file — the size the user reported.
function makeKnowledge(total = 113): KnowledgeItem[] {
  return Array.from({ length: total }, (_, i) => {
    const page = 1 + Math.floor((i * 20) / total);
    const lines = 1 + (i % 5);
    return {
      id: `item-${i + 1}`,
      category: CATEGORIES[i % CATEGORIES.length],
      topic: `Topic ${Math.floor(i / 6) + 1}`,
      title: `Entity${i + 1} fact`,
      points: Array.from(
        { length: lines },
        (_, j) => `Entity${i + 1} detail${j + 1} value${(i + 1) * 10 + j}`
      ),
      highlightLabel: "",
      highlightText: "",
      sourcePages: i % 7 === 0 ? [page, Math.min(20, page + 1)] : [page],
    };
  });
}

type Requested = { ref: string; n: number; title: string };

function requestedItems(
  params: InvokeParams,
  key: "cards" | "questions"
): Requested[] {
  const user = String(params.messages[params.messages.length - 1].content);
  const re = new RegExp(
    `^### (K\\d+) \\[[^\\]]+\\] (.+?) \\(pages [^)]*\\) — ${key}: (\\d+)`,
    "gm"
  );
  return [...user.matchAll(re)].map(m => ({
    ref: m[1],
    title: m[2],
    n: Number(m[3]),
  }));
}

function reply(json: unknown): InvokeResult {
  return {
    id: "fake",
    created: 0,
    model: "fake",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(json) },
        finish_reason: "stop",
      },
    ],
  };
}

function schemaName(params: InvokeParams): string {
  const format = params.response_format as
    | { json_schema?: { name?: string } }
    | undefined;
  return format?.json_schema?.name ?? "";
}

describe("knowledge-based flashcards", () => {
  it("covers every Knowledge Item with focused, traceable, de-duplicated cards", async () => {
    const knowledge = makeKnowledge();
    const calls: InvokeParams[] = [];
    const llm = async (params: InvokeParams) => {
      calls.push(params);
      const cards = requestedItems(params, "cards").flatMap(item => {
        const entity = item.title.replace(" fact", "");
        const good = Array.from({ length: item.n }, (_, j) => ({
          knowledgeRef: item.ref,
          cardType: j === 0 ? "definition" : "number_dose",
          questionEn: `What is ${entity} angle${j + 1}?`,
          answerEn: `${entity} answer${j + 1}`,
          questionAr: `ما هو ${entity}؟`,
          answerAr: `جواب ${j + 1}`,
          relatedTermEn: entity,
        }));
        // Noise the gate must remove: a verbatim duplicate, an answer
        // leaked into its front, and a card for an item that doesn't exist.
        return item.ref === "K3"
          ? [
              ...good,
              { ...good[0] },
              { ...good[0], questionEn: `Is ${entity} answer1 correct?` },
              { ...good[0], knowledgeRef: "K999" },
            ]
          : good;
      });
      return reply({ cards });
    };

    const result = await generateKnowledgeFlashcards("Lecture", knowledge, llm);

    // Every fact has ≥1 card → the Coverage Matrix is complete.
    expect(result.coverage.totalItems).toBe(113);
    expect(result.coverage.coveredItems).toBe(113);
    expect(result.coverage.status).toBe("COMPLETE");
    // Proportional, not 1:1 and not a small fixed number.
    const expected = knowledge.reduce(
      (sum, item) => sum + cardTargetFor(item),
      0
    );
    expect(result.items.length).toBe(expected);
    expect(result.items.length).toBeGreaterThan(113);
    // Traceability: knowledgeItemId + the fact's pages.
    for (const card of result.items) {
      const item = knowledge.find(k => k.id === card.knowledgeItemId)!;
      expect(item).toBeTruthy();
      expect(card.sourcePages).toEqual(item.sourcePages);
      expect(card.sourcePage).toBe(Math.min(...item.sourcePages));
    }
    expect(result.coverage.gate.duplicate).toBe(1);
    expect(result.coverage.gate.answer_in_front).toBe(1);
    expect(result.coverage.gate.unknown_item).toBe(1);
    // Batched: never one giant call, never one call per fact.
    expect(calls.length).toBe(Math.ceil(113 / 10));
  });

  it("retries only the items left without a card", async () => {
    const knowledge = makeKnowledge(12);
    const seen: string[][] = [];
    const llm = async (params: InvokeParams) => {
      const items = requestedItems(params, "cards");
      seen.push(items.map(item => item.ref));
      const first = seen.length <= 2;
      return reply({
        cards: items
          // The first pass silently skips K2 and K11.
          .filter(item => !first || (item.ref !== "K2" && item.ref !== "K11"))
          .map(item => ({
            knowledgeRef: item.ref,
            cardType: "recall",
            questionEn: `Recall ${item.title}?`,
            answerEn: `Answer for ${item.ref}`,
            questionAr: "",
            answerAr: "",
            relatedTermEn: "",
          })),
      });
    };
    const result = await generateKnowledgeFlashcards("L", knowledge, llm);
    expect(seen.at(-1)).toEqual(["K2", "K11"]);
    expect(result.coverage.coveredItems).toBe(12);
    // Arabic falls back to English rather than an empty side.
    expect(result.items[0].questionAr).toBe(result.items[0].questionEn);
  });
});

describe("cross-fact dedupe", () => {
  it("drops a near-identical card repeated under another fact, keeps template-alike ones", async () => {
    const knowledge = makeKnowledge(3);
    const llm = async (params: InvokeParams) =>
      reply({
        cards: requestedItems(params, "cards").flatMap(item => [
          // Same wording under every fact → a real duplicate of the first.
          {
            knowledgeRef: item.ref,
            cardType: "recall",
            questionEn:
              "What is the first-line treatment of acute angle closure?",
            answerEn: "IV acetazolamide plus topical pilocarpine",
            questionAr: "",
            answerAr: "",
            relatedTermEn: "",
          },
          // Same template, different entity → must be kept.
          {
            knowledgeRef: item.ref,
            cardType: "recall",
            questionEn: `What is the first-line treatment of ${item.title}?`,
            answerEn: `Drug for ${item.title} ${item.ref}`,
            questionAr: "",
            answerAr: "",
            relatedTermEn: "",
          },
        ]),
      });
    const result = await generateKnowledgeFlashcards("L", knowledge, llm);
    const repeated = result.items.filter(card =>
      card.answerEn.startsWith("IV acetazolamide")
    );
    expect(repeated).toHaveLength(1);
    expect(result.coverage.coveredItems).toBe(3);
    expect(result.coverage.gate.duplicate).toBeGreaterThanOrEqual(2);
  });
});

describe("knowledge-based questions", () => {
  it("writes verified application questions for every item, with types and pages", async () => {
    const knowledge = makeKnowledge(40);
    let rejectedK5 = false;
    const llm = async (params: InvokeParams) => {
      if (schemaName(params) === "knowledge_mcq_verification") {
        const user = String(params.messages[1].content);
        const qids = [...user.matchAll(/^### (Q\d+) \(item (K\d+)/gm)];
        return reply({
          results: qids.map(([, qid, ref]) => {
            // The reviewer rejects K5's first question (wrong key) once.
            const reject = ref === "K5" && !rejectedK5;
            if (reject) rejectedK5 = true;
            return {
              qid,
              valid: !reject,
              problem: reject ? "marked answer is wrong" : "",
            };
          }),
        });
      }
      const questions = requestedItems(params, "questions").flatMap(item => {
        const entity = item.title.replace(" fact", "");
        const good = Array.from({ length: item.n }, (_, j) => ({
          knowledgeRef: item.ref,
          relatedRefs: item.ref === "K8" ? ["K9"] : [],
          questionType: j === 0 ? "clinical_vignette" : "next_best_step",
          questionEn: `A 30-year-old presents with sign${j} of ${entity}. What is the best step (${j})?`,
          choices: [
            `${entity} option right${j}`,
            `Distractor alpha ${entity}`,
            `Distractor beta ${entity}`,
            `Distractor gamma ${entity}`,
          ],
          correctIndex: 0,
          explanationEn: "Because the fact says so.",
        }));
        if (item.ref !== "K4") return good;
        return [
          ...good,
          {
            ...good[0],
            questionEn: "Which is true?",
            choices: ["A x", "B y", "C z", "All of the above"],
          },
          {
            ...good[0],
            questionEn: "Dup options?",
            choices: ["same", "same", "c", "d"],
          },
        ];
      });
      return reply({ questions });
    };

    const result = await generateKnowledgeMcqs("Lecture", knowledge, llm);

    expect(result.coverage.coveredItems).toBe(40);
    expect(result.coverage.status).toBe("COMPLETE");
    expect(result.coverage.gate.banned_option).toBe(1);
    expect(result.coverage.gate.duplicate_options).toBe(1);
    expect(result.coverage.gate.failed_verification).toBe(1);
    // K5 lost its question to verification and got it back on the retry.
    expect(result.items.some(q => q.knowledgeItemId === "item-5")).toBe(true);
    for (const q of result.items) {
      expect(q.validationStatus).toBe("valid");
      expect(["clinical_vignette", "next_best_step"]).toContain(q.questionType);
      expect(q.choices[q.correctIndex]).toMatch(/option right/);
    }
    // Differentiation link: K8's question also tests K9, pages merged.
    const linked = result.items.find(q => q.knowledgeItemId === "item-8")!;
    expect(linked.relatedKnowledgeItemIds).toEqual(["item-9"]);
    expect(linked.sourcePages).toEqual(
      [
        ...new Set([...knowledge[7].sourcePages, ...knowledge[8].sourcePages]),
      ].sort((a, b) => a - b)
    );
    // Correct answers are spread over A–D, not always A.
    expect(new Set(result.items.map(q => q.correctIndex)).size).toBeGreaterThan(
      1
    );
  });

  it("keeps questions as pending when the review call itself fails", async () => {
    const knowledge = makeKnowledge(3);
    const llm = async (params: InvokeParams) => {
      if (schemaName(params) === "knowledge_mcq_verification") {
        throw new Error("provider down");
      }
      return reply({
        questions: requestedItems(params, "questions").map(item => ({
          knowledgeRef: item.ref,
          relatedRefs: [],
          questionType: "recall",
          questionEn: `Which value belongs to ${item.title}?`,
          choices: ["v1 right", "v2 wrong", "v3 wrong", "v4 wrong"],
          correctIndex: 0,
          explanationEn: "",
        })),
      });
    };
    const result = await generateKnowledgeMcqs("L", knowledge, llm);
    expect(result.items.length).toBeGreaterThanOrEqual(3);
    expect(result.items.every(q => q.validationStatus === "pending")).toBe(
      true
    );
    expect(result.errors.some(e => e.includes("provider down"))).toBe(true);
  });
});

describe("gates and helpers", () => {
  const cardBase = {
    knowledgeRef: "K1",
    cardType: "recall",
    questionAr: "",
    answerAr: "",
    relatedTermEn: "",
  };
  const mcqBase = {
    knowledgeRef: "K1",
    relatedRefs: [],
    questionType: "recall",
    explanationEn: "",
  };

  it("rejects unfocused or leaking flashcards", () => {
    expect(
      checkCard({ ...cardBase, questionEn: "What is X?", answerEn: "Y" })
    ).toBeNull();
    expect(checkCard({ ...cardBase, questionEn: "", answerEn: "Y" })).toBe(
      "empty"
    );
    expect(
      checkCard({
        ...cardBase,
        questionEn: "Q?",
        answerEn: Array(60).fill("w").join(" "),
      })
    ).toBe("back_too_long");
    expect(
      checkCard({
        ...cardBase,
        questionEn: "Is metformin first line the drug?",
        answerEn: "Metformin first line",
      })
    ).toBe("answer_in_front");
  });

  it("rejects malformed questions", () => {
    expect(
      checkMcq({
        ...mcqBase,
        questionEn: "Q?",
        choices: ["a", "b", "c"],
        correctIndex: 0,
      })
    ).toBe("bad_options");
    expect(
      checkMcq({
        ...mcqBase,
        questionEn: "Q?",
        choices: ["a", "b", "c", "d"],
        correctIndex: 4,
      })
    ).toBe("bad_options");
    expect(
      checkMcq({
        ...mcqBase,
        questionEn: "Patient has acute angle closure glaucoma. Diagnosis?",
        choices: ["acute angle closure glaucoma", "b", "c", "d"],
        correctIndex: 0,
      })
    ).toBe("answer_in_stem");
    expect(
      checkMcq({
        ...mcqBase,
        questionEn: "Q?",
        choices: ["a", "b", "c", "None of the above"],
        correctIndex: 0,
      })
    ).toBe("banned_option");
  });

  it("moves the key deterministically without losing it", () => {
    const mcq = {
      questionEn: "Some stem",
      choices: ["right", "b", "c", "d"],
      correctIndex: 0,
    };
    const placed = placeCorrectAnswer(mcq);
    expect(placed.choices[placed.correctIndex]).toBe("right");
    expect(placeCorrectAnswer(mcq)).toEqual(placed);
  });

  it("assigns each fact to exactly one chapter by its first page", () => {
    const items = makeKnowledge();
    const assigned = [
      [1, 8],
      [9, 16],
      [17, 20],
    ].flatMap(([start, end]) => itemsForPageRange(items, start, end));
    expect(assigned).toHaveLength(items.length);
    expect(new Set(assigned.map(item => item.id)).size).toBe(items.length);
  });

  it("scales cards and questions with density and importance", () => {
    const item = (category: string, lines: number): KnowledgeItem => ({
      id: "x",
      category,
      topic: "",
      title: "t",
      points: Array(lines).fill("p"),
      highlightLabel: "",
      highlightText: "",
      sourcePages: [1],
    });
    expect(cardTargetFor(item("definition", 1))).toBe(1);
    expect(cardTargetFor(item("definition", 3))).toBe(2);
    expect(cardTargetFor(item("classification", 5))).toBe(3);
    expect(cardTargetFor(item("drug_dose", 2))).toBe(2);
    expect(questionTargetFor(item("definition", 5))).toBe(1);
    expect(questionTargetFor(item("must_know", 3))).toBe(2);
  });
});
