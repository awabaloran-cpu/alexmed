// 📝 The summary markup the AI writes -> the blocks lib/summary/render.ts
// draws. Pure.
// Line-based on purpose: models write it reliably, where deeply nested JSON
// kept coming back with a dropped comma.
//
//   # Section title
//   @pages 1,2,3
//   ## Sub-heading
//   A paragraph.
//   - a bullet            1. a step
//   Term :: explanation
//   > KEY: ...   > EXAM: ...   > WARN: ...   > TIP: ...
//   $$ LaTeX $$           (next line may be "NOTE: what the symbols mean")
//   | a | b |             (a table; a |---| line after the head is optional)
//   AR: two sentences of simple Arabic
//   EXAMPLE: title        (then numbered steps, then "ANSWER: ...")
//   FLOW: a -> b -> c     (one thing leading to the next)
//   STAGE: name :: what happens   (consecutive lines: phases side by side)

import type { SummaryBlock, SummaryCalloutKind, SummarySection } from "./types";

const CALLOUT: Record<string, SummaryCalloutKind> = {
  KEY: "key",
  EXAM: "exam",
  WARN: "warn",
  TIP: "tip",
};

export function parseSummaryMarkup(text: string): SummarySection[] {
  const sections: SummarySection[] = [];
  let section: SummarySection | null = null;
  // The list / term list / table / example / formula still being filled.
  let list: SummaryBlock | null = null;
  const blocks = () => {
    if (!section) {
      section = { title: "", pages: [], blocks: [] };
      sections.push(section);
    }
    return section.blocks;
  };
  const close = () => (list = null);

  for (const rawLine of String(text).replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (!line || /^```/.test(line)) {
      if (!line && list?.t !== "example") close();
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^#\s+(.+)$/.exec(line))) {
      close();
      section = { title: m[1].replace(/\s*#+$/, ""), pages: [], blocks: [] };
      sections.push(section);
    } else if ((m = /^@pages?\s*:?\s*(.+)$/i.exec(line))) {
      const pages = (m[1].match(/\d+/g) ?? []).map(Number);
      if (section) section.pages.push(...pages);
    } else if ((m = /^#{2,}\s+(.+)$/.exec(line))) {
      close();
      blocks().push({ t: "h", text: m[1] });
    } else if ((m = /^>\s*(KEY|EXAM|WARN|TIP)\s*:\s*(.+)$/i.exec(line))) {
      close();
      blocks().push({
        t: "callout",
        kind: CALLOUT[m[1].toUpperCase()],
        text: m[2],
      });
    } else if ((m = /^\$\$\s*(.+?)\s*\$\$$/.exec(line))) {
      close();
      list = { t: "formula", tex: m[1] };
      blocks().push(list);
    } else if ((m = /^NOTE\s*:\s*(.+)$/i.exec(line)) && list?.t === "formula") {
      list.note = m[1];
      close();
    } else if ((m = /^AR\s*:\s*(.+)$/.exec(line))) {
      close();
      blocks().push({ t: "ar", text: m[1] });
    } else if ((m = /^FLOW\s*:\s*(.+)$/i.exec(line))) {
      close();
      const steps = m[1]
        .split(/\s*(?:->|→|=>|⇒)\s*/)
        .map(step => step.trim())
        .filter(Boolean);
      // A chain of two to six; anything else reads better as a sentence.
      if (steps.length >= 2 && steps.length <= 6) {
        blocks().push({ t: "flow", steps });
      } else {
        blocks().push({ t: "p", text: m[1] });
      }
    } else if ((m = /^STAGE\s*:\s*(.{1,60}?)\s+::\s+(.+)$/i.exec(line))) {
      if (list?.t !== "stages") {
        list = { t: "stages", items: [] };
        blocks().push(list);
      }
      list.items.push([m[1], m[2]]);
    } else if ((m = /^EXAMPLE\s*:\s*(.+)$/i.exec(line))) {
      close();
      list = { t: "example", title: m[1], steps: [] };
      blocks().push(list);
    } else if (
      (m = /^ANSWER\s*:\s*(.+)$/i.exec(line)) &&
      list?.t === "example"
    ) {
      list.answer = m[1];
      close();
    } else if (/^\|.*\|$/.test(line)) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue; // the |---| rule
      const cells = line
        .slice(1, -1)
        .split("|")
        .map(c => c.trim());
      if (list?.t !== "table") {
        list = { t: "table", head: cells, rows: [] };
        blocks().push(list);
      } else {
        list.rows.push(cells);
      }
    } else if ((m = /^(\d+)[.)]\s+(.+)$/.exec(line))) {
      if (list?.t === "example") {
        list.steps.push(m[2]);
      } else {
        if (!(list?.t === "list" && list.ordered)) {
          list = { t: "list", ordered: true, items: [] };
          blocks().push(list);
        }
        list.items.push(m[2]);
      }
    } else if ((m = /^[-*•]\s+(.+)$/.exec(line)) && list?.t === "stages") {
      // Bullets under a stage are what happens in it (models write the
      // detail of each phase this way), so the phases stay in one row.
      const stage = list.items[list.items.length - 1];
      stage[1] = `${stage[1].replace(/[.;]\s*$/, "")}; ${m[1]}`;
    } else if ((m = /^[-*•]\s+(.+)$/.exec(line))) {
      if (!(list?.t === "list" && !list.ordered)) {
        list = { t: "list", ordered: false, items: [] };
        blocks().push(list);
      }
      list.items.push(m[1]);
    } else if ((m = /^(.{1,60}?)\s+::\s+(.+)$/.exec(line))) {
      if (list?.t !== "kv") {
        list = { t: "kv", items: [] };
        blocks().push(list);
      }
      list.items.push([m[1], m[2]]);
    } else {
      close();
      blocks().push({ t: "p", text: line });
    }
  }
  // A table needs a body, an example needs steps: drop what came out empty.
  for (const s of sections) {
    s.pages = [...new Set(s.pages)].sort((a, b) => a - b);
    s.blocks = s.blocks.filter(
      b =>
        !(b.t === "table" && !b.rows.length) &&
        !(b.t === "example" && !b.steps.length)
    );
    // One stage is not a sequence of phases: it reads as a term.
    s.blocks = s.blocks.map(b =>
      b.t === "stages" && b.items.length < 2 ? { t: "kv", items: b.items } : b
    );
  }
  return sections.filter(s => s.title && s.blocks.length);
}
