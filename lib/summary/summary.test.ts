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
import { pageRanges, renderSummary, sectionLandmarks } from "./render";
import { SUMMARY_THEMES, toSummaryTheme, type SummarySection } from "./types";

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
    theme: "dusk",
  });

  it("signs the page with the student's link to the bot, and uses the chosen look", () => {
    expect(html).toContain('data-theme="dusk"');
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

  it("says which source pages each section covers, as short ranges", () => {
    expect(pageRanges([5, 3, 4, 9, 9])).toBe("3–5, 9");
    expect(pageRanges([])).toBe("");
    const withPages = renderSummary({
      ...doc,
      sections: [{ title: "Croup", pages: [2, 3, 4, 7], blocks: [] }],
    });
    expect(withPages).toContain('Source pages <bdi dir="ltr">2–4, 7</bdi>');
  });

  it("opens the revision look with a map of the file's sections", () => {
    const section = (title: string): SummarySection => ({
      title,
      pages: [1],
      blocks: [
        { t: "p", text: "A paragraph." },
        { t: "list", ordered: false, items: ["**Cough** at night:"] },
        { t: "h", text: "Treatment" },
        { t: "kv", items: [["Croup", "steroids"]] },
      ],
    });
    // Sub-headings first, then defined terms, then list items; no repeats.
    expect(sectionLandmarks(section("x").blocks, 3)).toEqual([
      "Treatment",
      "Croup",
      "**Cough** at night",
    ]);

    const few = renderSummary(
      { ...doc, sections: ["Asthma", "Croup", "Cough"].map(section) },
      { theme: "revision" }
    );
    expect(few.match(/class="node"/g)).toHaveLength(3);
    expect(few.match(/<path /g)).toHaveLength(3);
    expect(few).toContain("<b>Croup</b>");
    expect(few).toContain("<strong>Cough</strong> at night");
    expect(few).not.toContain('class="toc only"');

    // Too many sections for a map: the contents list takes its place.
    const many = renderSummary(
      {
        ...doc,
        sections: Array.from({ length: 13 }, (_, i) => section(`S${i}`)),
      },
      { theme: "revision" }
    );
    expect(many).not.toContain('class="node"');
    expect(many).toContain('class="toc only"');

    // Only this look has it.
    expect(
      renderSummary(
        { ...doc, sections: ["Asthma", "Croup"].map(section) },
        { theme: "studio" }
      )
    ).not.toContain('class="node"');
  });

  it("has every look, and gives a retired one the look that replaced it", () => {
    for (const theme of SUMMARY_THEMES) {
      const page = renderSummary(doc, { theme });
      expect(page).toContain(`data-theme="${theme}"`);
      // Each look styles itself.
      expect(page).toContain(`[data-theme=${theme}] {`);
    }
    expect(toSummaryTheme("mint")).toBe("bloom");
    expect(toSummaryTheme("niro")).toBe("studio");
    expect(toSummaryTheme("violet")).toBe("dusk");
    expect(toSummaryTheme("classic")).toBe("classic");
    expect(toSummaryTheme(undefined)).toBe("revision");
  });
});

describe("flows and stages", () => {
  const [section] = parseSummaryMarkup(
    [
      "# Pneumonia",
      "@pages 4",
      "FLOW: Pneumonia -> Small sterile effusion → **Empyema** => Chest drain",
      "STAGE: Catarrhal :: coryza-like symptoms, about a week",
      "STAGE: Paroxysmal :: spasms of cough, then a whoop",
      "STAGE: Convalescent :: gradual improvement",
      "A paragraph after them.",
      "FLOW: only one thing",
    ].join("\n")
  );

  it("reads a chain of steps and a row of phases", () => {
    expect(section.blocks.map(b => b.t)).toEqual(["flow", "stages", "p", "p"]);
    expect(section.blocks[0]).toEqual({
      t: "flow",
      steps: [
        "Pneumonia",
        "Small sterile effusion",
        "**Empyema**",
        "Chest drain",
      ],
    });
    expect(section.blocks[1]).toMatchObject({
      items: [
        ["Catarrhal", "coryza-like symptoms, about a week"],
        ["Paroxysmal", "spasms of cough, then a whoop"],
        ["Convalescent", "gradual improvement"],
      ],
    });
    // Not a chain: kept as the sentence it is.
    expect(section.blocks[3]).toEqual({ t: "p", text: "only one thing" });
  });

  it("keeps the bullets written under a stage inside that stage", () => {
    const [steps] = parseSummaryMarkup(
      [
        "# Asthma",
        "STAGE: Step 1 :: Infrequent short-lived wheeze",
        "- **SABA** as needed",
        "- Consider very-low-dose ICS.",
        "STAGE: Step 2 :: Regular preventer therapy.",
        "- Very-low-dose ICS",
        "",
        "- A bullet after a blank line is a list of its own",
      ].join("\n")
    );
    expect(steps.blocks.map(b => b.t)).toEqual(["stages", "list"]);
    expect(steps.blocks[0]).toMatchObject({
      items: [
        [
          "Step 1",
          "Infrequent short-lived wheeze; **SABA** as needed; Consider very-low-dose ICS.",
        ],
        ["Step 2", "Regular preventer therapy; Very-low-dose ICS"],
      ],
    });
  });

  it("a single stage is a term, not a row of phases", () => {
    const [alone] = parseSummaryMarkup("# T\nSTAGE: Latent :: no symptoms");
    expect(alone.blocks).toEqual([
      { t: "kv", items: [["Latent", "no symptoms"]] },
    ]);
  });

  it("draws them: boxes joined by arrows, and numbered phases side by side", () => {
    const html = renderSummary({
      lang: "en",
      title: "T",
      sections: [section],
    });
    expect(html.match(/class="fs"/g)).toHaveLength(4);
    expect(html.match(/class="fa"/g)).toHaveLength(3);
    expect(html).toContain("<strong>Empyema</strong>");
    expect(html).toContain('class="stages" dir="ltr" style="--n:3"');
    expect(html).toContain("<b><i>2</i>Paroxysmal</b>");
  });
});
