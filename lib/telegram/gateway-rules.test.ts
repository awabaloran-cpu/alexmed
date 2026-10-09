// The gateway's pure rules: which kind a file is, when an ad break falls
// and who sees one, and how the question viewer resumes and pauses.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import QuestionList, {
  breakAfterIndex,
  firstUnansweredIndex,
  restoredAnswers,
  type QuestionListItem,
} from "@/components/questions/QuestionList";
import {
  isBreakAfter,
  planShowsAds,
  readAdConfig,
  resolveAdBreakPolicy,
  type AdConfig,
} from "../ads/policy";
import { detectDocumentKind, resolveDocumentKind } from "./detect";
import { CALLBACK, parseCallback } from "./messages";

const question = (n: number) =>
  `${n}. Which of the following is the most likely diagnosis in this child?\n` +
  "A. Epiglottitis\nB. Croup\nC. Bronchiolitis\nD. Asthma\n";
const QUESTION_PAGE = [1, 2, 3, 4, 5, 6].map(question).join("\n");
const PROSE =
  "The respiratory system of the child differs from that of the adult in several important ways. " +
  "The airways are narrower and more compliant, which increases resistance to airflow during illness. " +
  "This chapter reviews the anatomy and physiology that underlie common paediatric presentations.";

describe("detectDocumentKind", () => {
  it("recognises a question file from its opening pages", () => {
    expect(
      detectDocumentKind([
        { page: 1, text: QUESTION_PAGE },
        { page: 2, text: [7, 8, 9, 10, 11].map(question).join("\n") },
      ])
    ).toBe("question_file");
  });

  it("recognises a book: plenty of text, no question blocks", () => {
    expect(
      detectDocumentKind([1, 2, 3, 4, 5].map(page => ({ page, text: PROSE })))
    ).toBe("book");
  });

  it("is unsure about a scanned file (no text to read yet)", () => {
    expect(detectDocumentKind([])).toBe("unsure");
    expect(detectDocumentKind([{ page: 1, text: "  " }, { page: 2, text: "3" }])).toBe("unsure");
  });

  it("is unsure about a book with a few review questions rather than guessing", () => {
    expect(
      detectDocumentKind([
        { page: 1, text: PROSE },
        { page: 2, text: PROSE },
        { page: 3, text: PROSE + "\n" + question(1) + question(2) },
      ])
    ).toBe("unsure");
  });
});

describe("resolveDocumentKind", () => {
  it("follows the file when nothing was said, and the student when the file is unclear", () => {
    expect(resolveDocumentKind(null, "question_file")).toBe("question_file");
    expect(resolveDocumentKind(null, "book")).toBe("book");
    expect(resolveDocumentKind("book", "unsure")).toBe("book");
    expect(resolveDocumentKind("question_file", "question_file")).toBe("question_file");
  });

  it("asks when nobody knows, or when the file contradicts the student", () => {
    expect(resolveDocumentKind(null, "unsure")).toBe("ask");
    expect(resolveDocumentKind("book", "question_file")).toBe("ask");
    expect(resolveDocumentKind("question_file", "book")).toBe("ask");
  });
});

describe("bot callback data", () => {
  const id = "0b0e0e6e-5a53-4c53-9a3e-3a0a8f3f6f10";
  it("round-trips, within Telegram's 64-byte limit", () => {
    expect(parseCallback(CALLBACK.kind(id, "book"))).toEqual({ action: "kind", uploadId: id, kind: "book" });
    expect(parseCallback(CALLBACK.retry(id))).toEqual({ action: "retry", uploadId: id });
    expect(CALLBACK.kind(id, "question_file").length).toBeLessThanOrEqual(64);
  });
  it("rejects anything else", () => {
    for (const data of ["", "k:x:" + id, "r:not-a-uuid", "delete:" + id]) {
      expect(parseCallback(data)).toBeNull();
    }
  });
});

const free = { priceMonthlyCents: 0, features: {} };
const pro = { priceMonthlyCents: 1000, features: {} };
const on: AdConfig = {
  enabled: true,
  scope: "telegram",
  questionsPerBreak: 10,
  adsenseClient: "ca-pub-1234567890123456",
  adsenseSlot: "1234567890",
  adsgramBlockId: null,
};

describe("ad policy", () => {
  it("a break falls after every 10th question, never after the last", () => {
    const breaks = Array.from({ length: 30 }, (_, i) => i + 1).filter(n => isBreakAfter(n, 30, 10));
    expect(breaks).toEqual([10, 20]);
    expect(isBreakAfter(10, 10, 10)).toBe(false);
    expect(isBreakAfter(10, 80, 0)).toBe(false);
  });

  it("free students see ads; paid plans and NO_ADS plans never do", () => {
    expect(planShowsAds(free)).toBe(true);
    expect(planShowsAds(pro)).toBe(false);
    expect(planShowsAds({ priceMonthlyCents: 0, features: { NO_ADS: true } })).toBe(false);
    expect(resolveAdBreakPolicy({ plan: pro, source: "telegram", config: on })).toEqual({ enabled: false });
  });

  it("nothing is shown while ads are switched off", () => {
    expect(
      resolveAdBreakPolicy({ plan: free, source: "telegram", config: { ...on, enabled: false } })
    ).toEqual({ enabled: false });
  });

  it("with the scope narrowed to Telegram, only files that came through the bot carry ads", () => {
    expect(resolveAdBreakPolicy({ plan: free, source: "web", config: on })).toEqual({ enabled: false });
    expect(resolveAdBreakPolicy({ plan: free, source: "web", config: { ...on, scope: "all" } }).enabled).toBe(true);
  });

  it("uses Google's unit when both ids are set, NiroLearn's own card otherwise", () => {
    expect(resolveAdBreakPolicy({ plan: free, source: "telegram", config: on })).toEqual({
      enabled: true,
      questionsPerBreak: 10,
      provider: "adsense",
      adsense: { client: "ca-pub-1234567890123456", slot: "1234567890" },
    });
    expect(
      resolveAdBreakPolicy({ plan: free, source: "telegram", config: { ...on, adsenseSlot: null } })
    ).toEqual({ enabled: true, questionsPerBreak: 10, provider: "house" });
  });

  it("with an AdsGram block the policy carries the rewarded ad next to the ordinary break", () => {
    const withBlock = { ...on, adsenseSlot: null, adsgramBlockId: "53005" };
    expect(resolveAdBreakPolicy({ plan: free, source: "telegram", config: withBlock })).toEqual({
      enabled: true,
      questionsPerBreak: 10,
      provider: "house",
      adsgram: { blockId: "53005" },
    });
    // Still nobody on a paid plan, and nothing while ads are off.
    expect(resolveAdBreakPolicy({ plan: pro, source: "telegram", config: withBlock })).toEqual({ enabled: false });
    expect(
      resolveAdBreakPolicy({ plan: free, source: "telegram", config: { ...withBlock, enabled: false } })
    ).toEqual({ enabled: false });
    expect(readAdConfig({ ADSGRAM_BLOCK_ID: " 53005 " }).adsgramBlockId).toBe("53005");
    expect(readAdConfig({ ADSGRAM_BLOCK_ID: "int-53005" }).adsgramBlockId).toBe("int-53005");
    expect(readAdConfig({ ADSGRAM_BLOCK_ID: "53005<script>" }).adsgramBlockId).toBeNull();
    expect(readAdConfig({}).adsgramBlockId).toBeNull();
  });

  it("reads its configuration strictly", () => {
    expect(readAdConfig({})).toMatchObject({ enabled: false, scope: "all", questionsPerBreak: 10 });
    expect(readAdConfig({ ADS_SCOPE: "telegram" }).scope).toBe("telegram");
    const config = readAdConfig({
      ADS_ENABLED: "true",
      ADS_SCOPE: "all",
      ADSENSE_CLIENT_ID: "ca-pub-1234567890123456",
      ADSENSE_SLOT_QUESTION_BREAK: "<script>",
    });
    expect(config).toMatchObject({ enabled: true, scope: "all", adsenseClient: "ca-pub-1234567890123456", adsenseSlot: null });
  });
});

const item = (id: string, extra: Partial<QuestionListItem> = {}): QuestionListItem => ({
  id,
  questionText: `Question ${id}?`,
  options: ["A", "B", "C", "D"],
  extractedAnswerIndex: 1,
  aiInferredAnswerIndex: null,
  explanationText: null,
  sourcePage: 1,
  keywords: null,
  aiExplanationAr: null,
  imageUrl: null,
  ...extra,
});

describe("question viewer: saved answers and pauses", () => {
  const questions = ["a", "b", "c"].map(id => item(id));

  it("restores saved answers as answered, revealed cards", () => {
    expect(restoredAnswers({ a: 2 })).toEqual({ a: { selected: 2, revealed: true } });
    expect(restoredAnswers(undefined)).toEqual({});
  });

  it("resumes at the first question not answered yet", () => {
    expect(firstUnansweredIndex(questions, undefined)).toBe(0);
    expect(firstUnansweredIndex(questions, { a: 1, b: 0 })).toBe(2);
    expect(firstUnansweredIndex(questions, { a: 1, b: 0, c: 3 })).toBe(0);
  });

  it("pauses after each full group when moving forward", () => {
    const pauses = Array.from({ length: 30 }, (_, i) => i).filter(i => breakAfterIndex(i, 30, 10));
    expect(pauses).toEqual([9, 19]);
    expect(breakAfterIndex(9, 80, undefined)).toBe(false);
  });

  it("opens on the resumed question with its saved answer shown", () => {
    const html = renderToStaticMarkup(
      createElement(QuestionList, { questions, initialAnswers: { a: 1 } })
    );
    expect(html).toContain("Question b?");
    expect(html).not.toContain("Question a?");
    expect(html).toContain("أجبت 1 · صحيح 1");
  });

  it("shows the «اربطها» line once the question is answered, and only if there is one", () => {
    const withHook = [item("a", { mnemonicAr: "Barking cough → Croup 🐕" }), item("b")];
    const answered = renderToStaticMarkup(
      createElement(QuestionList, { questions: withHook, revealAll: true, layout: "list" })
    );
    expect(answered).toContain("اربطها");
    expect(answered).toContain("Barking cough → Croup");
    expect(answered.match(/اربطها/g)).toHaveLength(1);

    const unanswered = renderToStaticMarkup(createElement(QuestionList, { questions: withHook }));
    expect(unanswered).not.toContain("اربطها");
  });
});
