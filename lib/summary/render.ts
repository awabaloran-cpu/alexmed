// 📝 A summary (lib/summary/types.ts) -> one HTML page, ready to print to
// PDF (lib/summary/pdf.ts). Pure: no I/O.
//
// Four looks share one layout; a theme is a set of CSS variables plus a few
// overrides. Every page carries the NiroLearn signature with a link to the
// bot — a fixed element repeats on each printed page, and its link stays
// clickable in the PDF.
import katex from "katex";
import type { SummaryBlock, SummaryDoc, SummaryTheme } from "./types";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ESCAPES[c]);

const isArabic = (s: string) => /[؀-ۿ]/.test(s);
const dirOf = (s: unknown) =>
  isArabic(String(s).replace(/\$[^$]*\$/g, "")) ? "rtl" : "ltr";

function tex(src: string, display: boolean) {
  try {
    return katex.renderToString(src, {
      displayMode: display,
      throwOnError: false,
      output: "html",
    });
  } catch {
    return `<code>${esc(src)}</code>`;
  }
}

// Inline marks: **bold**, ==highlight==, `code`, $math$.
function inline(text: unknown) {
  const parts = String(text).split(/(\$[^$\n]+\$)/g);
  return parts
    .map(part => {
      if (/^\$[^$\n]+\$$/.test(part))
        return `<span class="im" dir="ltr">${tex(part.slice(1, -1), false)}</span>`;
      return esc(part)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/==([^=]+)==/g, "<mark>$1</mark>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
    })
    .join("");
}

const CALLOUT: Record<string, { ar: string; en: string; icon: string }> = {
  key: { ar: "الفكرة الأساسية", en: "Key idea", icon: "◆" },
  exam: { ar: "يتكرر في الامتحان", en: "Exam favourite", icon: "★" },
  warn: { ar: "خطأ شائع", en: "Common mistake", icon: "!" },
  tip: { ar: "تذكّر", en: "Remember", icon: "✓" },
};

function block(b: SummaryBlock) {
  switch (b.t) {
    case "p":
      return `<p dir="${dirOf(b.text)}">${inline(b.text)}</p>`;
    case "h":
      return `<h3 dir="${dirOf(b.text)}">${inline(b.text)}</h3>`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      const d = dirOf(b.items.join(" "));
      return `<${tag} dir="${d}">${b.items.map(i => `<li>${inline(i)}</li>`).join("")}</${tag}>`;
    }
    case "kv": {
      const d = dirOf(b.items.map(i => i[1]).join(" "));
      return `<ul class="kv" dir="${d}">${b.items
        .map(
          ([k, v]) =>
            `<li><strong>${inline(k)}</strong><span>${inline(v)}</span></li>`
        )
        .join("")}</ul>`;
    }
    case "callout": {
      const c = CALLOUT[b.kind] ?? CALLOUT.key;
      const d = dirOf(b.text);
      const title = b.title ?? (d === "rtl" ? c.ar : c.en);
      return `<aside class="callout ${b.kind}" dir="${d}"><div class="ct"><i>${c.icon}</i>${inline(title)}</div><div>${inline(b.text)}</div></aside>`;
    }
    case "formula":
      return `<figure class="formula"><div dir="ltr">${tex(b.tex, true)}</div>${
        b.note
          ? `<figcaption dir="${dirOf(b.note)}">${inline(b.note)}</figcaption>`
          : ""
      }</figure>`;
    case "example": {
      const d = dirOf(b.title + b.steps.join(" "));
      const label = d === "rtl" ? "مثال محلول" : "Worked example";
      const ans = d === "rtl" ? "الجواب" : "Answer";
      return `<section class="example" dir="${d}"><div class="et"><span>${label}</span><div>${inline(b.title)}</div></div><ol>${b.steps
        .map(s => `<li>${inline(s)}</li>`)
        .join(
          ""
        )}</ol>${b.answer ? `<div class="ans"><b>${ans}:</b> ${inline(b.answer)}</div>` : ""}</section>`;
    }
    case "table": {
      const d = dirOf(b.head.join(" ") + b.rows.flat().join(" "));
      return `<div class="tw"><table dir="${d}"><thead><tr>${b.head.map(h => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${b.rows
        .map(
          r =>
            `<tr>${r.map((c, i) => (i === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("")}</tr>`
        )
        .join("")}</tbody></table></div>`;
    }
    case "ar":
      return `<div class="simple" dir="rtl"><b>بالعربي المبسّط</b><span>${inline(b.text)}</span></div>`;
    default:
      return "";
  }
}

const CSS = `
@page { size: A4; margin: 16mm 15mm 12mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: var(--ink); font: 10.6pt/1.7 "Inter", "Noto Naskh Arabic", "Segoe UI", sans-serif; }
[dir=rtl] { font-family: "Noto Naskh Arabic", "Inter", serif; font-size: 1.07em; line-height: 1.85; }
h1,h2,h3,.ct,.et,.brand,.chip,.toc,th { font-family: "Readex Pro", "Inter", sans-serif; }
table.page { width: 100%; border-collapse: collapse; }
table.page > tfoot td { height: 13mm; padding: 0; border: 0; }
table.page > tbody > tr > td { padding: 0; border: 0; vertical-align: top; }

/* cover */
.cover { border-radius: 18px; padding: 26px 28px 24px; position: relative; overflow: hidden;
  background: var(--cover); }
.cover:after { content: ""; position: absolute; width: 260px; height: 260px; border-radius: 50%; top: -110px; inset-inline-end: -70px;
  background: var(--blob); }
.cover:before { content: ""; position: absolute; width: 150px; height: 150px; border-radius: 50%; bottom: -80px; inset-inline-end: 120px;
  background: rgba(255,255,255,.12); }
.cover > * { position: relative; z-index: 1; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.chip { font-size: 8.6pt; font-weight: 600; padding: 4px 12px; border-radius: 999px; background: rgba(255,255,255,.18); }
h1 { font-size: 25pt; line-height: 1.25; margin: 0 0 8px; font-weight: 700; max-width: 78%; }
.sub { font-size: 10.5pt; opacity: .92; max-width: 76%; margin: 0; }
.meta { margin-top: 16px; font-size: 8.8pt; opacity: .85; }

/* contents */
.toc { margin: 16px 0 6px; padding: 14px 18px; border-radius: 14px; background: var(--paper); font-size: 9.4pt;
  columns: 2; column-gap: 26px; }
.toc div { break-inside: avoid; padding: 2.5px 0; display: flex; gap: 8px; }
.toc b { color: var(--a); min-width: 18px; }

/* sections */
section.sec { margin-top: 20px; }
h2 { font-size: 15pt; line-height: 1.35; margin: 0 0 10px; display: flex; gap: 12px; align-items: center; break-after: avoid; }
h2 .n { flex: none; width: 32px; height: 32px; border-radius: 10px; background: var(--a); color: #fff; font-size: 12.5pt;
  display: grid; place-items: center; }
h2 .tx { background: linear-gradient(transparent 62%, var(--hl) 62%); padding: 0 2px; }
h3 { font-size: 11.6pt; margin: 14px 0 4px; color: var(--ad); break-after: avoid; }
p { margin: 5px 0; }
ul, ol { margin: 5px 0; padding-inline-start: 20px; }
li { margin: 2.5px 0; }
li::marker { color: var(--a); font-weight: 700; }
ul.kv { list-style: none; padding: 0; }
ul.kv li { display: grid; grid-template-columns: minmax(96px, 24%) 1fr; gap: 12px; padding: 5px 0; border-bottom: 1px solid #e6e9f2; break-inside: avoid; }
ul.kv li strong { color: var(--ink); }
strong { font-weight: 700; }
mark { background: #fff3c4; padding: 0 3px; border-radius: 3px; color: inherit; }
code { font-family: "JetBrains Mono", Consolas, monospace; font-size: .9em; background: #eef1f8; padding: 1px 5px; border-radius: 4px; direction: ltr; unicode-bidi: isolate; }
.im { unicode-bidi: isolate; }

.callout { margin: 10px 0; padding: 11px 14px; border-radius: 12px; border-inline-start: 5px solid; break-inside: avoid; }
.callout .ct { font-weight: 700; font-size: 9.6pt; margin-bottom: 2px; display: flex; gap: 8px; align-items: center; }
.callout .ct i { font-style: normal; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 8.5pt; }
.callout.key { background: var(--as); border-color: var(--a); } .callout.key .ct { color: var(--ad); } .callout.key i { background: var(--a); }
.callout.exam { background: #fff3c4; border-color: #f2b705; } .callout.exam .ct { color: #7a5a00; } .callout.exam i { background: #e0a800; }
.callout.warn { background: #fdecee; border-color: #dc3f46; } .callout.warn .ct { color: #a8262d; } .callout.warn i { background: #dc3f46; }
.callout.tip { background: #e2f5ec; border-color: #0e9f6e; } .callout.tip .ct { color: #0a7350; } .callout.tip i { background: #0e9f6e; }

.formula { margin: 10px 0; padding: 12px 16px; border-radius: 12px; background: #f7f8fc; border: 1.5px solid #dfe3ec; text-align: center; break-inside: avoid; }
.formula figcaption { font-size: 9.2pt; color: #454c66; margin-top: 4px; }
.katex { font-size: 1.12em; }

.example { margin: 10px 0; border: 1.5px solid var(--ab); border-radius: 12px; overflow: hidden; break-inside: avoid; }
.example .et { background: var(--as); padding: 8px 14px; font-weight: 600; font-size: 10pt; display: flex; gap: 10px; align-items: center; }
.example .et > span { background: var(--a); color: #fff; font-size: 8pt; padding: 2px 9px; border-radius: 999px; flex: none; }
.example ol { margin: 8px 14px 8px; }
.example .ans { margin: 0 14px 10px; padding: 7px 12px; border-radius: 8px; background: #e2f5ec; color: #0a7350; }

.tw { margin: 10px 0; break-inside: avoid; }
.tw table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 9.1pt; line-height: 1.5; table-layout: fixed;
  border: 1.5px solid #dfe3ec; border-radius: 12px; overflow: hidden; }
.tw th, .tw td { padding: 7px 9px; text-align: start; vertical-align: top; border-bottom: 1px solid #e6e9f2; word-wrap: break-word; }
.tw thead th { background: var(--ink); color: #fff; font-weight: 600; font-size: 8.8pt; }
.tw tbody th { background: var(--paper); font-weight: 600; color: var(--ad); }
.tw tbody tr:nth-child(even) td { background: #fafbfe; }
.tw tbody tr:last-child th, .tw tbody tr:last-child td { border-bottom: 0; }

.simple { margin: 9px 0; padding: 9px 14px; border-radius: 12px; background: #fff8dc; display: grid; grid-template-columns: auto 1fr; gap: 12px; break-inside: avoid; }
.simple b { font-family: "Readex Pro"; font-size: 8.4pt; background: var(--hl2); padding: 2px 10px; border-radius: 999px; height: fit-content; margin-top: 3px; white-space: nowrap; }

.check { margin-top: 20px; padding: 16px 20px; border-radius: 16px; background: var(--ink); color: #fff; break-inside: avoid; }
.check h2 { color: #fff; margin-bottom: 8px; } .check h2 .n { background: var(--hl2); color: var(--ink); } .check h2 .tx { background: none; }
.check ul { list-style: none; padding: 0; margin: 0; }
.check li { display: flex; gap: 10px; padding: 3px 0; }
.check li:before { content: ""; flex: none; width: 13px; height: 13px; border-radius: 4px; border: 2px solid var(--hl2); margin-top: 6px; }
.note { margin-top: 12px; font-size: 8.4pt; color: #6b7188; text-align: center; }

/* themes */
:root { --a:#3355ff; --ad:#2440c7; --as:#e9eeff; --ab:#c9d3ff; --a2:#5b7bff; --hl:#ffe27a; --hl2:#ffd43b; --blob:rgba(255,212,59,.9);
  --ink:#1b2340; --paper:#f2f4f9; --cover:linear-gradient(135deg,#2440c7 0%,#3355ff 55%,#5b7bff 100%); --cover-ink:#fff; }
[data-theme=mint] { --a:#0e9f6e; --ad:#0a7350; --as:#e2f5ec; --ab:#b5e6d1; --a2:#34c796; --hl:#bff0dc; --hl2:#7be0b8; --blob:rgba(14,159,110,.16);
  --ink:#12332a; --paper:#f1f7f4; --cover:#e2f5ec; --cover-ink:#12332a; }
[data-theme=mint] .cover { border: 2px solid #b5e6d1; border-inline-start: 14px solid var(--a); border-radius: 14px; }
[data-theme=mint] .cover:after { width: 190px; height: 190px; top: -60px; }
[data-theme=mint] .cover:before { background: rgba(14,159,110,.10); }
[data-theme=mint] .chip { background: #fff; color: var(--ad); }
[data-theme=mint] h2 .n { border-radius: 50%; }
[data-theme=mint] h2 .tx { background: none; border-bottom: 3px solid var(--hl2); }
[data-theme=mint] .tw thead th { background: var(--ad); }
[data-theme=mint] .check { background: var(--ad); }

[data-theme=violet] { --a:#7c3aed; --ad:#5b21b6; --as:#f1e9ff; --ab:#d9c6ff; --a2:#ec4899; --hl:#ffd0e6; --hl2:#ff9ecb; --blob:rgba(255,255,255,.22);
  --ink:#241a3a; --paper:#f6f3fb; --cover:linear-gradient(120deg,#5b21b6 0%,#7c3aed 45%,#ec4899 100%); --cover-ink:#fff; }
[data-theme=violet] .cover { border-radius: 26px; padding-bottom: 30px; }
[data-theme=violet] h2 .n { background: linear-gradient(135deg,#7c3aed,#ec4899); border-radius: 12px; }
[data-theme=violet] h2 .tx { background: linear-gradient(transparent 62%, var(--hl) 62%); }
[data-theme=violet] .tw thead th { background: linear-gradient(120deg,#5b21b6,#7c3aed); }
[data-theme=violet] .check { background: linear-gradient(120deg,#241a3a,#5b21b6); }
[data-theme=violet] .check h2 .n, [data-theme=violet] .check li:before { background: none; border-color: var(--hl2); }
[data-theme=violet] .check h2 .n { background: var(--hl2); }

[data-theme=classic] { --a:#9a3412; --ad:#7c2d12; --as:#fbf3ec; --ab:#e7d3c3; --a2:#9a3412; --hl:transparent; --hl2:#d9b08c; --blob:transparent;
  --ink:#1f1b16; --paper:#f7f4ef; --cover:#fff; --cover-ink:#1f1b16; }
[data-theme=classic] body { font-family: "Source Serif 4", "Noto Naskh Arabic", Georgia, serif; font-size: 10.9pt; }
[data-theme=classic] h1, [data-theme=classic] h2, [data-theme=classic] h3 { font-family: "Source Serif 4", "Noto Naskh Arabic", Georgia, serif; }
[data-theme=classic] .cover { border-radius: 0; padding: 22px 0 18px; border-top: 5px solid var(--ink); border-bottom: 1px solid var(--ink); }
[data-theme=classic] .cover:after, [data-theme=classic] .cover:before { display: none; }
[data-theme=classic] .chip { background: none; border: 1px solid var(--ink); color: var(--ink); border-radius: 3px; }
[data-theme=classic] h1 { font-size: 28pt; max-width: 100%; }
[data-theme=classic] .sub { max-width: 100%; font-style: italic; }
[data-theme=classic] .toc { background: none; border-bottom: 1px solid var(--ab); border-radius: 0; padding: 10px 0; }
[data-theme=classic] h2 { border-bottom: 1.5px solid var(--ink); padding-bottom: 4px; }
[data-theme=classic] h2 .n { background: none; color: var(--a); width: auto; height: auto; font-size: 15pt; display: inline-flex; }
[data-theme=classic] h2 .n:after { content: "."; }
[data-theme=classic] .callout { border-radius: 0; background: none !important; border-top: 1px solid var(--ab); border-bottom: 1px solid var(--ab); }
[data-theme=classic] .formula, [data-theme=classic] .example, [data-theme=classic] .tw table, [data-theme=classic] .simple { border-radius: 2px; }
[data-theme=classic] .tw thead th { background: none; color: var(--ink); border-bottom: 2px solid var(--ink); }
[data-theme=classic] .tw tbody th { background: none; color: var(--ad); }
[data-theme=classic] .simple { background: var(--as); } [data-theme=classic] .simple b { background: var(--hl2); }
[data-theme=classic] .check { background: none; color: var(--ink); border: 1.5px solid var(--ink); border-radius: 2px; }
[data-theme=classic] .check h2 { color: var(--ink); border: 0; } [data-theme=classic] .check h2 .n { color: var(--a); background: none; }
[data-theme=classic] .check li:before { border-color: var(--ink); border-radius: 0; }
[data-theme=classic] .sig { border-radius: 0; background: none; border-top: 1px solid var(--ab); }

.cover { color: var(--cover-ink); }
/* signature on every page */
.sig { position: fixed; bottom: 0; left: 0; right: 0; height: 9.5mm; display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 0 12px; border-radius: 10px; background: var(--paper); font-family: "Readex Pro", "Inter", sans-serif; font-size: 8.3pt; color: #454c66; direction: ltr; }
.sig a { color: inherit; text-decoration: none; display: flex; align-items: center; gap: 8px; }
.sig .logo { width: 18px; height: 18px; border-radius: 6px; background: var(--a); color: #fff; font-weight: 700; font-size: 9pt; display: grid; place-items: center; }
.sig .nm b { background: linear-gradient(transparent 60%, var(--hl2) 60%); }
.sig .cta { background: var(--a); color: #fff; padding: 3px 12px; border-radius: 999px; font-weight: 600; font-size: 7.9pt; }
.sig .mid { direction: rtl; }
`;

export function renderSummary(
  doc: SummaryDoc,
  opts: { link?: string; theme?: SummaryTheme } = {}
) {
  const lang = doc.lang === "ar" ? "ar" : "en";
  const rtl = lang === "ar";
  const link = opts.link ?? "https://t.me/Nirolearnbot";
  const t = rtl
    ? {
        contents: "المحتويات",
        check: "راجِع نفسك",
        made: "صُنع هذا الملخص بـ",
        cta: "اصنع ملخصك مجانًا",
        note: "ملخص للمذاكرة، راجِعه مع مصدرك.",
      }
    : {
        contents: "Contents",
        check: "Check yourself",
        made: "صُنع هذا الملخص بـ",
        cta: "اصنع ملخصك مجانًا",
        note: "A study summary. Check it against your source.",
      };
  const sections = doc.sections
    .map(
      (s, i) =>
        `<section class="sec"><h2 dir="${dirOf(s.title)}"><span class="n">${i + 1}</span><span class="tx">${inline(s.title)}</span></h2>${s.blocks
          .map(b => block(b))
          .join("")}</section>`
    )
    .join("");
  const toc = doc.sections
    .map(
      (s, i) =>
        `<div dir="${dirOf(s.title)}"><b>${i + 1}</b><span>${inline(s.title)}</span></div>`
    )
    .join("");
  const check = doc.checklist?.length
    ? `<section class="check" dir="${dirOf(doc.checklist.join(" "))}"><h2><span class="n">✓</span><span class="tx">${t.check}</span></h2><ul>${doc.checklist
        .map(c => `<li><span>${inline(c)}</span></li>`)
        .join("")}</ul></section>`
    : "";
  return `<!doctype html><html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}" data-theme="${esc(opts.theme ?? "niro")}"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex.min.css">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&family=Noto+Naskh+Arabic:wght@400;600;700&family=Readex+Pro:wght@400;600;700&display=block" rel="stylesheet">
<style>${CSS}</style></head><body>
<div class="sig"><a href="${esc(link)}"><span class="logo">N</span><span class="nm">Niro<b>Learn</b></span></a>
<span class="mid">${t.made} NiroLearn من ملف الطالب</span>
<a href="${esc(link)}"><span class="cta" dir="rtl">${t.cta} ← ‎@Nirolearnbot</span></a></div>
<table class="page"><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>
<header class="cover" dir="${dirOf(doc.title)}"><div class="chips">${(doc.chips ?? []).map(c => `<span class="chip">${esc(c)}</span>`).join("")}</div>
<h1>${inline(doc.title)}</h1><p class="sub">${inline(doc.subtitle ?? "")}</p><div class="meta">${(
    doc.meta ?? ""
  )
    .split(" · ")
    .map(m => `<bdi>${esc(m)}</bdi>`)
    .join(" · ")}</div></header>
<nav class="toc" dir="${rtl ? "rtl" : "ltr"}">${toc}</nav>
${sections}${check}<p class="note" dir="${rtl ? "rtl" : "ltr"}">${t.note}</p>
</td></tr></tbody></table></body></html>`;
}
