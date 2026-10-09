import { describe, expect, it } from "vitest";
import {
  associateImagesWithQuestions,
  buildExtractedQuestionEnrichmentMessages,
  decideImageOwner,
  pageQuestionCandidates,
  questionPageRange,
  parseExtractedQuestionEnrichment,
  parsePageImageClassification,
} from "./question-file-analysis";

// TEST A-D exactly as specified in the approved plan
// (C:\Users\user\.claude\plans\imperative-brewing-river.md).
describe("associateImagesWithQuestions", () => {
  it("TEST A: one image before three questions, no next image — all three get it", () => {
    const images = [{ id: "imgA", pageNumber: 5 }];
    const questions = [
      { id: "q1", sourcePage: 5 },
      { id: "q2", sourcePage: 6 },
      { id: "q3", sourcePage: 6 },
    ];
    const relations = associateImagesWithQuestions(images, questions);
    expect(relations).toEqual([
      { questionId: "q1", imageId: "imgA" },
      { questionId: "q2", imageId: "imgA" },
      { questionId: "q3", imageId: "imgA" },
    ]);
  });

  it("TEST B: image A then Q1,Q2, image B then Q3 — B interrupts A's ownership", () => {
    const images = [
      { id: "imgA", pageNumber: 5 },
      { id: "imgB", pageNumber: 8 },
    ];
    const questions = [
      { id: "q1", sourcePage: 5 },
      { id: "q2", sourcePage: 7 },
      { id: "q3", sourcePage: 8 },
    ];
    const relations = associateImagesWithQuestions(images, questions);
    expect(relations).toEqual([
      { questionId: "q1", imageId: "imgA" },
      { questionId: "q2", imageId: "imgA" },
      { questionId: "q3", imageId: "imgB" },
    ]);
  });

  it("TEST C: no images at all — no question gets one", () => {
    const questions = [
      { id: "q1", sourcePage: 1 },
      { id: "q2", sourcePage: 2 },
      { id: "q3", sourcePage: 3 },
    ];
    expect(associateImagesWithQuestions([], questions)).toEqual([]);
  });

  it("TEST D: three images, four groups — each question falls in exactly one range", () => {
    const images = [
      { id: "imgA", pageNumber: 1 },
      { id: "imgB", pageNumber: 4 },
      { id: "imgC", pageNumber: 8 },
    ];
    const questions = [
      { id: "q1", sourcePage: 1 },
      { id: "q2", sourcePage: 2 },
      { id: "q3", sourcePage: 3 },
      { id: "q4", sourcePage: 4 },
      { id: "q5", sourcePage: 5 },
      { id: "q6", sourcePage: 6 },
      { id: "q7", sourcePage: 7 },
      { id: "q8", sourcePage: 8 },
    ];
    const relations = associateImagesWithQuestions(images, questions);
    expect(relations).toEqual([
      { questionId: "q1", imageId: "imgA" },
      { questionId: "q2", imageId: "imgA" },
      { questionId: "q3", imageId: "imgA" },
      { questionId: "q4", imageId: "imgB" },
      { questionId: "q5", imageId: "imgB" },
      { questionId: "q6", imageId: "imgB" },
      { questionId: "q7", imageId: "imgB" },
      { questionId: "q8", imageId: "imgC" },
    ]);
  });

  it("a question on a page before any image gets no image", () => {
    const images = [{ id: "imgA", pageNumber: 5 }];
    const questions = [{ id: "q1", sourcePage: 3 }];
    expect(associateImagesWithQuestions(images, questions)).toEqual([]);
  });

  it("does not assume input order is already sorted by pageNumber", () => {
    const images = [
      { id: "imgB", pageNumber: 8 },
      { id: "imgA", pageNumber: 5 },
    ];
    const questions = [{ id: "q1", sourcePage: 6 }];
    expect(associateImagesWithQuestions(images, questions)).toEqual([
      { questionId: "q1", imageId: "imgA" },
    ]);
  });

  // TEST E: live-reproduced 2026-09-19 against a real question file (مِرآة
  // job 4e088149) — pages 17/18/19 exactly, confirmed by manually reading the
  // scanned PDF. Page 17's figure is immediately followed by Q34's stem on
  // the SAME page (isAtPageEnd: false) and Q35 continues onto page 18 with
  // no figure of its own; page 18's figure (a twin ultrasound) has nothing
  // after it on its own page (isAtPageEnd: true) and is really answered by
  // Q36/Q37, whose stems start fresh on page 19; page 19's own figure is
  // likewise at its page's end and belongs to Q38-40 on page 20. Before this
  // fix, Q35/Q36/Q38 all got the wrong figure (whichever page they were
  // physically extracted onto), one page off from what they actually needed.
  it("TEST E: a figure at a page's end belongs to the NEXT page's questions, not its own page's", () => {
    const images = [
      { id: "img17", pageNumber: 17, isAtPageEnd: false },
      { id: "img18", pageNumber: 18, isAtPageEnd: true },
      { id: "img19", pageNumber: 19, isAtPageEnd: true },
    ];
    const questions = [
      { id: "q34", sourcePage: 17 },
      { id: "q35", sourcePage: 18 },
      { id: "q36", sourcePage: 19 },
      { id: "q37", sourcePage: 19 },
      { id: "q38", sourcePage: 20 },
      { id: "q39", sourcePage: 20 },
      { id: "q40", sourcePage: 20 },
    ];
    expect(associateImagesWithQuestions(images, questions)).toEqual([
      { questionId: "q34", imageId: "img17" },
      { questionId: "q35", imageId: "img17" },
      { questionId: "q36", imageId: "img18" },
      { questionId: "q37", imageId: "img18" },
      { questionId: "q38", imageId: "img19" },
      { questionId: "q39", imageId: "img19" },
      { questionId: "q40", imageId: "img19" },
    ]);
  });

  it("TEST E continued: two consecutive page-end images each still own exactly their own shifted range", () => {
    const images = [
      { id: "imgA", pageNumber: 4, isAtPageEnd: true }, // shifts to 5
      { id: "imgB", pageNumber: 5, isAtPageEnd: true }, // shifts to 6 — narrows imgA's range to just [5,6)
    ];
    const questions = [
      { id: "q1", sourcePage: 5 },
      { id: "q2", sourcePage: 6 },
    ];
    expect(associateImagesWithQuestions(images, questions)).toEqual([
      { questionId: "q1", imageId: "imgA" },
      { questionId: "q2", imageId: "imgB" },
    ]);
  });

  it("treats a missing isAtPageEnd exactly like false (backward compatible with TEST A-D's fixtures)", () => {
    const images = [{ id: "imgA", pageNumber: 5 }];
    const questions = [{ id: "q1", sourcePage: 5 }];
    expect(associateImagesWithQuestions(images, questions)).toEqual([
      { questionId: "q1", imageId: "imgA" },
    ]);
  });
});

describe("parsePageImageClassification", () => {
  it("parses a fenced JSON response", () => {
    const content =
      '```json\n{"hasImage": true, "captionEn": "A Karman cannula set"}\n```';
    expect(parsePageImageClassification(content)).toEqual({
      hasImage: true,
      captionEn: "A Karman cannula set",
    });
  });
});

describe("parseExtractedQuestionEnrichment", () => {
  it("parses keywords/explanation/inferredAnswerIndex", () => {
    const content = JSON.stringify({
      keywords: ["ECG", "arrhythmia"],
      explanationAr:
        "التشخيص هو Atrial Fibrillation بسبب عدم انتظام R-R interval.",
      inferredAnswerIndex: 2,
    });
    expect(parseExtractedQuestionEnrichment(content)).toEqual({
      keywords: ["ECG", "arrhythmia"],
      explanationAr:
        "التشخيص هو Atrial Fibrillation بسبب عدم انتظام R-R interval.",
      inferredAnswerIndex: 2,
    });
  });

  it("parses a null inferredAnswerIndex when the source already stated an answer", () => {
    const content = JSON.stringify({
      keywords: ["mitochondria"],
      explanationAr:
        "الإجابة الصحيحة هي Mitochondria لأنها المسؤولة عن إنتاج ATP.",
      inferredAnswerIndex: null,
    });
    expect(
      parseExtractedQuestionEnrichment(content).inferredAnswerIndex
    ).toBeNull();
  });
});

describe("buildExtractedQuestionEnrichmentMessages — the file's own explanation", () => {
  const question = {
    questionText: "Which nerve supplies the deltoid?",
    options: ["Radial", "Axillary"],
    extractedAnswerText: "Axillary",
  };
  const text = (content: unknown) =>
    typeof content === "string"
      ? content
      : (content as { type: string; text?: string }[])
          .map(part => part.text ?? "")
          .join("");

  it("hands the explanation to the model with the question, and tells it to build on it", () => {
    const [system, user] = buildExtractedQuestionEnrichmentMessages(
      { ...question, explanationText: "  Axillary nerve (C5–C6).  " },
      null
    );
    expect(text(user.content)).toContain(
      "Source explanation:\nAxillary nerve (C5–C6)."
    );
    expect(text(system.content)).toContain("Build explanationAr on it");
    // Text of the file stays out of the instructions.
    expect(text(system.content)).not.toContain("C5–C6");
  });

  it("goes with the picture too", () => {
    const [, user] = buildExtractedQuestionEnrichmentMessages(
      { ...question, explanationText: "Axillary nerve (C5–C6)." },
      "https://example.test/figure.png"
    );
    expect(text(user.content)).toContain("Source explanation:");
    expect(user.content).toContainEqual(
      expect.objectContaining({ type: "image_url" })
    );
  });

  it("changes nothing for a question the file does not explain", () => {
    for (const explanationText of [undefined, null, "   "]) {
      const [system, user] = buildExtractedQuestionEnrichmentMessages(
        { ...question, explanationText },
        null
      );
      expect(user.content).toBe(
        "Question: Which nerve supplies the deltoid?\nOptions:\nA. Radial\nB. Axillary"
      );
      expect(text(system.content)).not.toContain("Source explanation");
    }
  });

  it("cuts a very long explanation", () => {
    const [, user] = buildExtractedQuestionEnrichmentMessages(
      { ...question, explanationText: "x".repeat(5000) },
      null
    );
    expect(text(user.content).match(/x+/g)?.at(-1)).toHaveLength(2000);
  });
});

// Question files (and doctor sets): a figure belongs to ONE question, and
// only when the page structure or a confident layout verdict says so —
// otherwise to none, with the candidates flagged for review.
describe("decideImageOwner", () => {
  const q = (id: string, sourcePage: number, orderIndex: number) => ({
    id,
    sourcePage,
    orderIndex,
  });

  const bank = (pages: number[]) =>
    pages.map((sourcePage, orderIndex) => ({
      ...q(`q${orderIndex + 1}`, sourcePage, orderIndex),
      questionText: `Question ${orderIndex + 1}?`,
    }));
  const decide = (
    pages: number[],
    page: number,
    verdict: Partial<{
      owner: string;
      confidence: "high" | "medium" | "low";
      isAtPageEnd: boolean;
    }> = {}
  ) =>
    decideImageOwner(pageQuestionCandidates(bank(pages), page), {
      owner: "UNCLEAR",
      confidence: "low",
      isAtPageEnd: false,
      ...verdict,
    });

  // Questions: q1 p4 · q2 p5 · q3 p6 · q4 p6 · q5 p8 (q4 runs through p7).
  const PAGES = [4, 5, 6, 6, 8];

  it("cover image → zero question links (and cover art is dropped, not flagged)", () => {
    // The cover page is outside the questions' pages: nothing on it.
    expect(decide(PAGES, 1)).toEqual({ kind: "none" });
    // Even on a question page, art the model calls NONE is never attached.
    expect(decide(PAGES, 4, { owner: "NONE", confidence: "high" })).toEqual({
      kind: "none",
    });
  });

  it("introduction image → zero question links", () => {
    expect(decide(PAGES, 3)).toEqual({ kind: "none" });
    expect(decide(PAGES, 2, { owner: "Q1", confidence: "high" })).toEqual({
      kind: "none",
    });
  });

  it("a question with its own image → only that question", () => {
    expect(decide(PAGES, 5)).toEqual({ kind: "question", questionId: "q2" });
    expect(decide(PAGES, 5, { owner: "Q1", confidence: "high" })).toEqual({
      kind: "question",
      questionId: "q2",
    });
  });

  it("a page inside a question that continues over it → that question", () => {
    expect(decide(PAGES, 7)).toEqual({ kind: "question", questionId: "q4" });
  });

  it("several questions on the page → only a CONFIDENT layout verdict picks one", () => {
    expect(decide(PAGES, 6, { owner: "Q2", confidence: "high" })).toEqual({
      kind: "question",
      questionId: "q4",
    });
    // Never both, never guessed.
    for (const verdict of [
      { owner: "Q2", confidence: "medium" as const },
      { owner: "UNCLEAR", confidence: "high" as const },
      { owner: "Q9", confidence: "high" as const },
    ]) {
      expect(decide(PAGES, 6, verdict)).toEqual({
        kind: "review",
        questionIds: ["q3", "q4"],
      });
    }
  });

  it("a figure at the page bottom is NOT automatically the next page's question", () => {
    // Not confident → no image, both candidates flagged.
    expect(decide(PAGES, 5, { isAtPageEnd: true, owner: "UNCLEAR" })).toEqual({
      kind: "review",
      questionIds: ["q2", "q3"],
    });
    expect(
      decide(PAGES, 5, {
        isAtPageEnd: true,
        owner: "NEXT",
        confidence: "medium",
      })
    ).toEqual({ kind: "review", questionIds: ["q2", "q3"] });
    // Only a confident layout verdict links it forward.
    expect(
      decide(PAGES, 5, { isAtPageEnd: true, owner: "NEXT", confidence: "high" })
    ).toEqual({ kind: "question", questionId: "q3" });
  });

  it("text continuing from the previous page (PREV) only with confidence", () => {
    expect(decide(PAGES, 6, { owner: "PREV", confidence: "high" })).toEqual({
      kind: "question",
      questionId: "q2",
    });
    expect(decide(PAGES, 6, { owner: "PREV", confidence: "low" })).toEqual({
      kind: "review",
      questionIds: ["q2", "q3", "q4"],
    });
  });

  it("a question without an image → no image (nothing is attached without a figure)", () => {
    // Pages with no figure never reach decideImageOwner; and a figure on
    // q2's page is never given to q1 or q3.
    const decision = decide(PAGES, 5);
    expect(decision).toEqual({ kind: "question", questionId: "q2" });
  });

  it("the production failure: an introduction figure never becomes every question's image", () => {
    const pages = [4, 4, 5, 5, 6, 6, 7, 7];
    expect(decide(pages, 3)).toEqual({ kind: "none" });
    // Two questions per page and an unclear layout → no image at all.
    expect(decide(pages, 5)).toEqual({
      kind: "review",
      questionIds: ["q3", "q4"],
    });
  });

  it("questionPageRange: first question page to one page past the last", () => {
    expect(questionPageRange([4, 5, 5, 8])).toEqual({ first: 4, last: 9 });
    expect(questionPageRange([])).toBeNull();
  });
});
