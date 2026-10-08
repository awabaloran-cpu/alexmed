import { describe, expect, it } from "vitest";
import {
  buildSummaryDoc,
  mergeByPlan,
  parseHead,
  sectionsFromAnswer,
  uncoveredPages,
} from "./compose";
import { decideSummary } from "./jobs";
import { parseSummaryMarkup } from "./markup";
import { renderSummary } from "./render";
import type { SummarySection } from "./types";

const ANSWER = `# Urinary tract infection
@pages 3, 4
## Features
Bacterial infection of the urinary tract.
- **Infants:** fever and poor feeding
- Older children: dysuria
1. Take a sample
2. Send culture
Cystitis :: infection of the bladder
Pyelonephritis :: infection reaching the kidney
> WARN: a bag sample is not proof
$$ \\Delta = b^2 - 4ac $$
NOTE: the discriminant
| Feature | Cystitis | Pyelonephritis |
|---|---|---|
| Fever | rare | common |
AR: التهاب البول قد يصل للكلى.
EXAMPLE: Solve $x^2 = 4$
1. Take the root
ANSWER: $x = \\pm 2$

# Stones
@pages 5
Colicky loin pain.`;

describe("parseSummaryMarkup", () => {
  const sections = parseSummaryMarkup(ANSWER);

  it("reads sections with the source pages each covers", () => {
    expect(sections.map(s => [s.title, s.pages])).toEqual([
      ["Urinary tract infection", [3, 4]],
      ["Stones", [5]],
    ]);
  });

  it("reads every kind of block, in order", () => {
    expect(sections[0].blocks).toEqual([
      { t: "h", text: "Features" },
      { t: "p", text: "Bacterial infection of the urinary tract." },
      {
        t: "list",
        ordered: false,
        items: [
          "**Infants:** fever and poor feeding",
          "Older children: dysuria",
        ],
      },
      { t: "list", ordered: true, items: ["Take a sample", "Send culture"] },
      {
        t: "kv",
        items: [
          ["Cystitis", "infection of the bladder"],
          ["Pyelonephritis", "infection reaching the kidney"],
        ],
      },
      { t: "callout", kind: "warn", text: "a bag sample is not proof" },
      { t: "formula", tex: "\\Delta = b^2 - 4ac", note: "the discriminant" },
      {
        t: "table",
        head: ["Feature", "Cystitis", "Pyelonephritis"],
        rows: [["Fever", "rare", "common"]],
      },
      { t: "ar", text: "التهاب البول قد يصل للكلى." },
      {
        t: "example",
        title: "Solve $x^2 = 4$",
        steps: ["Take the root"],
        answer: "$x = \\pm 2$",
      },
    ]);
  });

  it("drops what came out empty and text before any section title", () => {
    expect(
      parseSummaryMarkup("stray line\n# A\n| only | head |\nEXAMPLE: x")
    ).toEqual([]);
    expect(parseSummaryMarkup("")).toEqual([]);
  });
});

describe("sectionsFromAnswer", () => {
  const group = [
    { n: 3, text: "a" },
    { n: 4, text: "b" },
  ];

  it("keeps only the pages that were given, and gives a section that names none the whole group", () => {
    const [first, second] = sectionsFromAnswer(
      "# A\n@pages 3, 9\ntext\n# B\nmore",
      group
    );
    expect(first.pages).toEqual([3]);
    expect(second.pages).toEqual([3, 4]);
  });
});

const section = (title: string, pages: number[], extra = ""): SummarySection =>
  parseSummaryMarkup(
    `# ${title}\n@pages ${pages.join(",")}\n${title} text\n${extra}`
  )[0];

describe("mergeByPlan", () => {
  const parts = [
    section("Growth", [1], "AR: نمو."),
    section("Infection", [2]),
    section("Growth again", [6], "AR: تغذية."),
  ];

  it("puts the parts of a topic together, joins their Arabic strips and their pages", () => {
    const merged = mergeByPlan(
      parts,
      "TOPIC: Growth\nPARTS: 1, 3\nTOPIC: Infection\nPARTS: 2"
    );
    expect(merged.map(s => [s.title, s.pages])).toEqual([
      ["Growth", [1, 6]],
      ["Infection", [2]],
    ]);
    expect(merged[0].blocks.at(-1)).toEqual({ t: "ar", text: "نمو. تغذية." });
  });

  it("never drops a part the plan forgot, repeated or invented", () => {
    const merged = mergeByPlan(parts, "TOPIC: Growth\nPARTS: 1, 1, 9");
    expect(merged.map(s => s.title)).toEqual([
      "Growth",
      "Infection",
      "Growth again",
    ]);
    expect(mergeByPlan(parts, "nonsense").map(s => s.title)).toEqual([
      "Growth",
      "Infection",
      "Growth again",
    ]);
  });

  it("keeps at most two callouts of a kind in a chapter", () => {
    const many = [1, 2, 3].map(n => section(`P${n}`, [n], `> KEY: idea ${n}`));
    const [chapter] = mergeByPlan(many, "TOPIC: All\nPARTS: 1,2,3");
    expect(chapter.blocks.filter(b => b.t === "callout")).toHaveLength(2);
  });
});

describe("parseHead and uncoveredPages", () => {
  it("reads the cover fields and the checklist, with a fallback title", () => {
    const head = parseHead(
      "TITLE: Paediatrics Review\nSUBTITLE: Covers growth.\nSUBJECT: Paediatrics\nLANG: en\n- Q one?\n- Q two?",
      "file"
    );
    expect(head).toEqual({
      title: "Paediatrics Review",
      subtitle: "Covers growth.",
      subject: "Paediatrics",
      lang: "en",
      checklist: ["Q one?", "Q two?"],
    });
    expect(parseHead("LANG: ar", "ملفي").title).toBe("ملفي");
    expect(parseHead("LANG: ar", "ملفي").lang).toBe("ar");
  });

  it("names the pages with real text that no section covers", () => {
    const long = "x".repeat(200);
    const pages = [
      { n: 1, text: long },
      { n: 2, text: long },
      { n: 3, text: "short" },
    ];
    expect(uncoveredPages(pages, [section("A", [1])])).toEqual([2]);
  });
});

describe("decideSummary — who may have a summary", () => {
  const ok = {
    guest: false,
    planId: "free",
    pages: 20,
    madeToday: 0,
    inProgress: false,
  };

  it("lets a registered student on the free plan make one a day, from up to 40 pages", () => {
    expect(decideSummary(ok)).toBeNull();
    expect(decideSummary({ ...ok, pages: 40 })).toBeNull();
    expect(decideSummary({ ...ok, pages: 41 })).toEqual({
      reason: "too_long",
      pages: 41,
      limit: 40,
      paid: false,
    });
    expect(decideSummary({ ...ok, madeToday: 1 })).toEqual({
      reason: "daily_limit",
      limit: 1,
      paid: false,
    });
  });

  it("asks a guest to create an account before anything else", () => {
    expect(
      decideSummary({ ...ok, guest: true, pages: 500, madeToday: 9 })
    ).toEqual({
      reason: "guest",
    });
  });

  it("gives a paid plan more summaries and longer files", () => {
    expect(
      decideSummary({ ...ok, planId: "pro", pages: 100, madeToday: 5 })
    ).toBeNull();
    expect(
      decideSummary({ ...ok, planId: "pro", madeToday: 10 })
    ).toMatchObject({
      reason: "daily_limit",
      paid: true,
    });
  });

  it("refuses an empty file and a second summary of a file still being written", () => {
    expect(decideSummary({ ...ok, pages: 0 })).toEqual({ reason: "empty" });
    expect(decideSummary({ ...ok, inProgress: true })).toEqual({
      reason: "in_progress",
    });
  });
});

describe("renderSummary", () => {
  const doc = buildSummaryDoc({
    head: parseHead(
      "TITLE: UTI <b>\nSUBJECT: Paediatrics\nLANG: en\n- Why?",
      "f"
    ),
    sections: parseSummaryMarkup(ANSWER),
    style: "full",
    sourcePages: 5,
    fileName: "file.pdf",
    date: "9 أكتوبر 2026",
  });
  const html = renderSummary(doc, {
    link: "https://t.me/Nirolearnbot?start=inv_abc",
    theme: "violet",
  });

  it("signs the page with the student's link to the bot, and uses the chosen look", () => {
    expect(html).toContain('data-theme="violet"');
    expect(
      html.match(/href="https:\/\/t\.me\/Nirolearnbot\?start=inv_abc"/g)
    ).toHaveLength(2);
    expect(html).toContain("NiroLearn");
  });

  it("escapes the AI's text and draws maths, tables and the checklist", () => {
    expect(html).toContain("UTI &lt;b&gt;");
    expect(html).not.toContain("UTI <b>");
    expect(html).toContain('class="katex');
    expect(html).toContain("<table");
    expect(html).toContain("Why?");
    expect(html).toContain('dir="rtl"');
  });

  it("carries no script", () => {
    expect(html).not.toMatch(/<script/i);
    const evil = renderSummary(
      { ...doc, title: '"><script>alert(1)</script>', sections: [] },
      { link: 'https://x.test/"><script>' }
    );
    expect(evil).not.toMatch(/<script/i);
  });
});
