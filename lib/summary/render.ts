// 📝 A summary (lib/summary/types.ts) -> one HTML page, ready to print to
// PDF (lib/summary/pdf.ts). Pure: no I/O.
//
// The looks share one layout; a theme is a set of CSS variables, its own
// faces and a few overrides. Every page carries the NiroLearn signature with a link to the
// bot — a fixed element repeats on each printed page, and its link stays
// clickable in the PDF.
import katex from "katex";
import {
  toSummaryTheme,
  type SummaryBlock,
  type SummaryDoc,
  type SummaryTheme,
} from "./types";

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
    case "flow": {
      const d = dirOf(b.steps.join(" "));
      return `<div class="flow" dir="${d}">${b.steps
        .map(step => `<div class="fs">${inline(step)}</div>`)
        .join('<i class="fa"></i>')}</div>`;
    }
    case "stages": {
      const d = dirOf(b.items.map(i => i[1]).join(" "));
      return `<div class="stages" dir="${d}" style="--n:${Math.min(b.items.length, 4)}">${b.items
        .map(
          ([name, what], i) =>
            `<div class="sg"><b><i>${i + 1}</i>${inline(name)}</b><span>${inline(what)}</span></div>`
        )
        .join("")}</div>`;
    }
    default:
      return "";
  }
}

// Source pages as short ranges: [3,4,5,9] -> "3–5, 9".
export function pageRanges(pages: number[]) {
  const sorted = [...new Set(pages.filter(Number.isFinite))].sort(
    (a, b) => a - b
  );
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return out.join(", ");
}

// The faces each look prints in. One family covers Arabic and Latin, so a
// mixed line never changes face mid-sentence.
const FONTS: Record<SummaryTheme, string[]> = {
  revision: ["Lato:wght@400;700;900", "IBM+Plex+Sans+Arabic:wght@400;600;700"],
  guide: ["Noto+Sans:wght@400;700", "Noto+Sans+Arabic:wght@400;700"],
  handout: [
    "Libre+Baskerville:wght@400;700",
    "Amiri:wght@400;700",
    "Arimo:wght@400;700",
    "IBM+Plex+Sans+Arabic:wght@400;700",
  ],
  studio: [
    "Alexandria:wght@300;500;700;800",
    "IBM+Plex+Sans+Arabic:wght@400;600;700",
  ],
  bloom: [
    "Baloo+Bhaijaan+2:wght@500;700;800",
    "IBM+Plex+Sans+Arabic:wght@400;600;700",
  ],
  dusk: [
    "Readex+Pro:wght@300;500;700",
    "IBM+Plex+Sans+Arabic:wght@400;600;700",
  ],
  paper: [
    "Playpen+Sans+Arabic:wght@400;600;800",
    "IBM+Plex+Sans+Arabic:wght@400;600;700",
  ],
  classic: [
    "Amiri:ital,wght@0,400;0,700;1,400",
    "Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400",
    "Noto+Naskh+Arabic:wght@400;600;700",
  ],
};

const fontsHref = (theme: SummaryTheme) =>
  `https://fonts.googleapis.com/css2?${[
    ...FONTS[theme],
    "IBM+Plex+Mono:wght@400;600",
  ]
    .map(f => `family=${f}`)
    .join("&")}&display=block`;

// The page is laid out without @page margins, so a cover or a dark look can
// run to the paper's edge: a repeating table header / footer gives every
// page its top and bottom margin instead, and the signature sits in the
// bottom one.
const CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: var(--bg); }
body { margin: 0; background: var(--bg); color: var(--ink); font: 10.4pt/1.72 var(--fb); }
[dir=rtl] { line-height: 1.95; }
h1, h2, h3, .eb, .ct, .et, .brand, .chip, .toc, .tw th, .n, .sig, .simple b, .ans b { font-family: var(--fd); }
h1, h2, h3 { text-wrap: balance; }
table.page { width: 100%; border-collapse: collapse; }
table.page > thead td { height: 14mm; padding: 0; border: 0; }
table.page > tfoot td { height: 21mm; padding: 0; border: 0; }
table.page > tbody > tr > td { padding: 0 16mm; border: 0; vertical-align: top; }

/* cover */
.cover { position: relative; overflow: hidden; color: var(--cink); background: var(--cover); }
.cover > :not(.deco) { position: relative; }
.deco { position: absolute; inset: 0; }
.deco i { position: absolute; display: block; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 11pt; direction: ltr; }
.brand .logo { width: 22px; height: 22px; border-radius: 7px; background: var(--cink); color: var(--clogo); font-size: 11pt; display: grid; place-items: center; }
.chips { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 14px; }
.chip { font-size: 8.4pt; font-weight: 600; padding: 3px 12px; border-radius: 999px; border: 1px solid currentColor; }
h1 { font-size: 34pt; line-height: 1.22; margin: 0 0 10px; font-weight: 800; }
.sub { font-size: 11.5pt; line-height: 1.7; margin: 0; max-width: 88%; opacity: .92; }
.meta { font-size: 8.8pt; opacity: .85; }
.full { height: 297mm; break-after: page; padding: 20mm 18mm 30mm; display: flex; flex-direction: column; }
.full .ttl { margin-top: auto; }
.full .meta { margin-top: 16mm; padding-top: 10px; border-top: 1px solid currentColor; }
.band { margin: 14mm 16mm 0; padding: 22px 26px 20px; border-radius: 22px; }
.band .brand { margin-bottom: 20px; }
.band .meta { margin-top: 14px; }

/* contents */
.toc { margin: 0 0 4mm; font-size: 9.6pt; break-inside: avoid; }
.toc .tt { font-size: 9pt; font-weight: 700; color: var(--a); margin-bottom: 4px; }
.toc ol { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 12mm; }
.toc li { break-inside: avoid; display: flex; gap: 10px; align-items: baseline; padding: 5px 0; border-bottom: 1px solid var(--line); }
.toc li b { color: var(--a); font-weight: 700; min-width: 20px; font-variant-numeric: tabular-nums; }
.toc li span { flex: 1; }
.toc li em { font-style: normal; font-size: 8pt; color: var(--mute); white-space: nowrap; }

/* sections */
section.sec { margin-top: 9mm; }
.sh { display: flex; gap: 14px; align-items: center; margin-bottom: 8px; break-inside: avoid; break-after: avoid; }
.sh .n { flex: none; font-variant-numeric: tabular-nums; line-height: 1; }
.sh .st { min-width: 0; }
.eb { display: block; font-size: 7.8pt; font-weight: 500; color: var(--mute); line-height: 1.5; }
h2 { font-size: 16pt; line-height: 1.35; margin: 0; font-weight: 700; }
h3 { font-size: 11.4pt; margin: 14px 0 3px; color: var(--ad); font-weight: 700; break-after: avoid; }
p { margin: 5px 0; }
ul, ol { margin: 5px 0; padding-inline-start: 20px; }
li { margin: 2.5px 0; }
li::marker { color: var(--a); font-weight: 700; }
ul.kv { list-style: none; padding: 0; }
ul.kv li { display: grid; grid-template-columns: minmax(96px, 25%) 1fr; gap: 14px; padding: 6px 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
ul.kv li strong { color: var(--ad); }
strong { font-weight: 700; }
mark { background: var(--hl); padding: 0 3px; border-radius: 3px; color: inherit; }
code { font-family: "IBM Plex Mono", Consolas, monospace; font-size: .9em; background: var(--panel); padding: 1px 5px; border-radius: 4px; direction: ltr; unicode-bidi: isolate; }
.im { unicode-bidi: isolate; }

.callout { position: relative; margin: 11px 0; padding: 10px 14px 11px; border-radius: 12px; background: var(--cb); break-inside: avoid; }
.callout .ct { font-weight: 700; font-size: 9.2pt; color: var(--cc); margin-bottom: 1px; display: flex; gap: 7px; align-items: center; }
.callout .ct i { font-style: normal; width: 17px; height: 17px; border-radius: 50%; display: grid; place-items: center; background: var(--cc); color: var(--ci, #fff); font-size: 8pt; line-height: 1; }
.callout.key { --cb: var(--as); --cc: var(--ad); }
.callout.exam { --cb: #fff3cc; --cc: #8a5a00; }
.callout.warn { --cb: #fdeaea; --cc: #b3261e; }
.callout.tip { --cb: #e2f5eb; --cc: #0b7a4b; }

.formula { margin: 11px 0; padding: 12px 16px; border-radius: 12px; background: var(--panel); text-align: center; break-inside: avoid; }
.formula figcaption { font-size: 9.2pt; color: var(--mute); margin-top: 4px; }
.katex { font-size: 1.12em; }

.example { margin: 11px 0; border: 1.5px solid var(--line); border-radius: 12px; overflow: hidden; break-inside: avoid; }
.example .et { background: var(--panel); padding: 8px 14px; font-weight: 600; font-size: 10pt; display: flex; gap: 10px; align-items: center; }
.example .et > span { background: var(--a); color: var(--on-a, #fff); font-size: 7.8pt; padding: 2px 10px; border-radius: 999px; flex: none; }
.example ol { margin: 8px 14px; }
.example .ans { margin: 0 14px 11px; padding: 7px 12px; border-radius: 8px; background: var(--okb, #e2f5eb); color: var(--okc, #0b7a4b); }

.tw { margin: 12px 0; break-inside: avoid; }
.tw table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 9pt; line-height: 1.55; table-layout: fixed; }
.tw th, .tw td { padding: 7px 10px; text-align: start; vertical-align: top; border-bottom: 1px solid var(--line); word-wrap: break-word; font-weight: 400; }
.tw thead th { font-weight: 700; font-size: 8.6pt; }
.tw tbody th { font-weight: 700; color: var(--ad); }

.simple { margin: 10px 0; padding: 9px 14px; border-radius: 12px; background: var(--sb); display: grid; grid-template-columns: auto 1fr; gap: 12px; break-inside: avoid; }
.flow { margin: 11px 0; display: flex; align-items: stretch; break-inside: avoid; }
.flow .fs { flex: 1 1 0; min-width: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 6px 9px;
  border: 1.5px solid var(--a); border-radius: 8px; background: var(--bg); font-size: .93em; line-height: 1.4; }
.flow .fs:first-child { background: var(--a); color: var(--on-a, #fff); font-weight: 700; }
.flow .fa { flex: none; width: 7mm; display: grid; place-items: center; font-style: normal; color: var(--a); font-size: 12pt; line-height: 1; }
.flow .fa:before { content: "→"; }
.flow[dir=rtl] .fa:before { content: "←"; }
.stages { margin: 11px 0; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 6px; break-inside: avoid; }
.stages .sg { padding: 7px 10px; border-radius: 8px; background: var(--panel); font-size: .93em; line-height: 1.45; }
.stages .sg:nth-child(even) { background: var(--as); }
.stages .sg b { display: block; color: var(--ad); font-family: var(--fd); }
.stages .sg b i { font-style: normal; color: var(--a); margin-inline-end: 6px; }
.simple b { font-size: 8.2pt; font-weight: 700; background: var(--sl); color: var(--sc); padding: 1px 10px; border-radius: 999px; height: fit-content; margin-top: 4px; white-space: nowrap; }

.check { margin-top: 10mm; padding: 16px 20px; border-radius: 16px; background: var(--kb); color: var(--kc); break-inside: avoid; }
.check h2 { font-size: 14pt; margin-bottom: 6px; }
.check ul { list-style: none; padding: 0; margin: 0; }
.check li { display: flex; gap: 10px; padding: 3px 0; }
.check li:before { content: ""; flex: none; width: 13px; height: 13px; border-radius: 4px; border: 2px solid var(--kk); margin-top: .5em; }
.note { margin-top: 12px; font-size: 8.4pt; color: var(--mute); text-align: center; }

/* signature on every page */
.sig { position: fixed; bottom: 7mm; left: 14mm; right: 14mm; height: 9.5mm; display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 0 6px 0 12px; border-radius: 999px; background: var(--gb); border: 1px solid var(--gl); font-size: 8.2pt; color: var(--gc); direction: ltr; z-index: 5; }
.sig a { color: inherit; text-decoration: none; display: flex; align-items: center; gap: 8px; }
.sig .logo { width: 18px; height: 18px; border-radius: 6px; background: var(--a); color: var(--on-a, #fff); font-weight: 700; font-size: 9pt; display: grid; place-items: center; }
.sig .nm { font-weight: 700; }
.sig .cta { background: var(--a); color: var(--on-a, #fff); padding: 3px 13px; border-radius: 999px; font-weight: 600; font-size: 7.9pt; }
.sig .mid { direction: rtl; }

/* ── studio: a report. One blue, one yellow, a lot of white. ── */
[data-theme=studio] { --fd: "Alexandria", sans-serif; --fb: "IBM Plex Sans Arabic", sans-serif;
  --bg: #fff; --ink: #141a2e; --mute: #6a7189; --line: #e3e6ef; --panel: #f4f6fb;
  --a: #2743e6; --ad: #1b30b0; --as: #ebefff; --hl: #ffe98a;
  --cover: #2743e6; --cink: #fff; --clogo: #2743e6;
  --sb: #fff8d9; --sl: #ffd84a; --sc: #141a2e; --kb: #141a2e; --kc: #fff; --kk: #ffd84a;
  --gb: #fff; --gl: #e3e6ef; --gc: #4a5170; }
[data-theme=studio] .deco i:nth-child(1) { width: 150mm; height: 150mm; border-radius: 50%; border: 22mm solid rgba(255,255,255,.09); top: -52mm; inset-inline-end: -58mm; }
[data-theme=studio] .deco i:nth-child(2) { width: 56mm; height: 56mm; border-radius: 50%; background: #ffd84a; top: 62mm; inset-inline-end: 24mm; }
[data-theme=studio] .deco i:nth-child(3) { width: 22mm; height: 22mm; background: #141a2e; top: 106mm; inset-inline-end: 70mm; }
[data-theme=studio] .ttl:before { content: ""; display: block; width: 26mm; height: 2.4mm; background: #ffd84a; margin-bottom: 9mm; }
[data-theme=studio] h1 { font-size: 38pt; }
[data-theme=studio] .sh { align-items: flex-end; border-top: 2px solid var(--ink); padding-top: 9px; }
[data-theme=studio] .sh .n { font-size: 31pt; font-weight: 300; color: var(--a); }
[data-theme=studio] .tw thead th { color: var(--a); border-bottom: 2px solid var(--ink); }
[data-theme=studio] .callout { border-radius: 4px; }
[data-theme=studio] .formula, [data-theme=studio] .example, [data-theme=studio] .simple { border-radius: 6px; }
[data-theme=studio] .check { border-radius: 6px; }

/* ── bloom: soft colour, a different one for each section. ── */
[data-theme=bloom] { --fd: "Baloo Bhaijaan 2", sans-serif; --fb: "IBM Plex Sans Arabic", sans-serif;
  --bg: #fff; --ink: #2a2440; --mute: #7a7391; --line: #ebe7f3; --panel: #f7f5fb;
  --a: #6b5ce7; --ad: #4a3cc0; --as: #eeebff; --hl: #ffe59a;
  --cover: #f4f0ff; --cink: #2a2440; --clogo: #fff;
  --sb: #fff6da; --sl: #ffd666; --sc: #2a2440; --kb: #f4f0ff; --kc: #2a2440; --kk: #6b5ce7;
  --gb: #fff; --gl: #ebe7f3; --gc: #5d5678; }
[data-theme=bloom] .sec.c1 { --a: #d6409f; --ad: #a82a7a; --as: #fde8f4; }
[data-theme=bloom] .sec.c2 { --a: #0fa99a; --ad: #087a70; --as: #e1f6f3; }
[data-theme=bloom] .sec.c3 { --a: #e8912b; --ad: #a9630f; --as: #fff1dc; }
[data-theme=bloom] .sec.c4 { --a: #3b82f6; --ad: #1f5fcb; --as: #e6f0ff; }
[data-theme=bloom] .cover { border-radius: 30px; padding: 26px 30px 26px; }
[data-theme=bloom] .brand .logo { background: #6b5ce7; }
[data-theme=bloom] .deco i { border-radius: 50%; }
[data-theme=bloom] .deco i:nth-child(1) { width: 62mm; height: 62mm; background: #ffd666; top: -24mm; inset-inline-end: -14mm; }
[data-theme=bloom] .deco i:nth-child(2) { width: 34mm; height: 34mm; background: #ef5d6c; top: 22mm; inset-inline-end: 34mm; }
[data-theme=bloom] .deco i:nth-child(3) { width: 20mm; height: 20mm; background: #0fa99a; bottom: -7mm; inset-inline-end: 20mm; }
[data-theme=bloom] .cover .ttl { max-width: 72%; }
[data-theme=bloom] h1 { font-size: 33pt; line-height: 1.2; }
[data-theme=bloom] .chip { border: 0; background: #fff; color: #4a3cc0; }
[data-theme=bloom] .toc { margin-top: 2mm; }
[data-theme=bloom] .toc li { border: 0; padding: 4px 0; }
[data-theme=bloom] .toc li b { background: var(--as); border-radius: 8px; min-width: 24px; text-align: center; }
[data-theme=bloom] .sh .n { width: 40px; height: 40px; border-radius: 14px; background: var(--a); color: #fff; font-size: 15pt; font-weight: 800; display: grid; place-items: center; transform: rotate(-4deg); }
[data-theme=bloom] h2 { font-size: 18pt; font-weight: 800; color: var(--ad); }
[data-theme=bloom] .callout { border-radius: 18px; padding: 12px 16px; }
[data-theme=bloom] .tw table { border-radius: 16px; overflow: hidden; border: 1.5px solid var(--as); }
[data-theme=bloom] .tw thead th { background: var(--a); color: #fff; border: 0; }
[data-theme=bloom] .tw tbody th { background: var(--as); }
[data-theme=bloom] .tw tbody tr:last-child > * { border-bottom: 0; }
[data-theme=bloom] .formula { border-radius: 18px; background: var(--as); }
[data-theme=bloom] .example { border-radius: 18px; border-color: var(--as); }
[data-theme=bloom] .example .et { background: var(--as); }
[data-theme=bloom] .simple { border-radius: 18px; }
[data-theme=bloom] .check { border-radius: 24px; }

/* ── dusk: night pages, for reading on a phone. ── */
[data-theme=dusk] { --fd: "Readex Pro", sans-serif; --fb: "IBM Plex Sans Arabic", sans-serif;
  --bg: #10141f; --ink: #e7eaf4; --mute: #8f97b3; --line: #262d42; --panel: #181e2e;
  --a: #5fe0c2; --ad: #8cebd5; --as: #14302f; --hl: rgba(255,214,102,.3); --on-a: #0c1a1a;
  --cover: #10141f; --cink: #f3f5fb; --clogo: #10141f;
  --sb: #2a2413; --sl: #ffd666; --sc: #1c1705; --kb: #181e2e; --kc: #e7eaf4; --kk: #5fe0c2;
  --okb: #14302a; --okc: #7fe3b8;
  --gb: #181e2e; --gl: #262d42; --gc: #aab1c9; }
[data-theme=dusk] .deco i { border-radius: 50%; filter: blur(28mm); }
[data-theme=dusk] .deco i:nth-child(1) { width: 130mm; height: 130mm; background: #1f8f7c; opacity: .55; top: -40mm; inset-inline-end: -40mm; }
[data-theme=dusk] .deco i:nth-child(2) { width: 110mm; height: 110mm; background: #4a55d9; opacity: .5; top: 60mm; inset-inline-start: -50mm; }
[data-theme=dusk] .deco i:nth-child(3) { width: 80mm; height: 80mm; background: #e0a23c; opacity: .28; bottom: 10mm; inset-inline-end: 0; }
[data-theme=dusk] h1 { font-weight: 700; font-size: 36pt; }
[data-theme=dusk] .chip { border-color: rgba(255,255,255,.35); }
[data-theme=dusk] .full .meta { border-color: rgba(255,255,255,.25); }
[data-theme=dusk] .sh .n { font-size: 11pt; font-weight: 700; color: var(--on-a); background: var(--a); border-radius: 8px; padding: 7px 9px; }
[data-theme=dusk] h2 { color: #fff; }
[data-theme=dusk] ul.kv li strong, [data-theme=dusk] strong { color: #fff; }
[data-theme=dusk] .callout { border: 1px solid var(--cl); --ci: #10141f; }
[data-theme=dusk] .callout.key { --cb: #14302f; --cc: #7fe8cf; --cl: #1f4a46; }
[data-theme=dusk] .callout.exam { --cb: #2c2512; --cc: #ffd666; --cl: #4a3d18; }
[data-theme=dusk] .callout.warn { --cb: #321a1c; --cc: #ff9a94; --cl: #55282b; }
[data-theme=dusk] .callout.tip { --cb: #162a3d; --cc: #8fc4ff; --cl: #244463; }
[data-theme=dusk] .formula, [data-theme=dusk] .example { border: 1px solid var(--line); }
[data-theme=dusk] .tw table { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
[data-theme=dusk] .tw thead th { background: #1e2538; color: var(--a); }
[data-theme=dusk] .tw tbody tr:last-child > * { border-bottom: 0; }
[data-theme=dusk] .check { border: 1px solid var(--line); }

/* ── paper: a tidy notebook — dotted page, marker, sticky notes. ── */
[data-theme=paper] { --fd: "Playpen Sans Arabic", "IBM Plex Sans Arabic", sans-serif; --fb: "IBM Plex Sans Arabic", sans-serif;
  --bg: #fdfcf8; --ink: #1f2a44; --mute: #737a8c; --line: #dcd9cf; --panel: #f3f1ea;
  --a: #e04a3a; --ad: #1f2a44; --as: #dff0ff; --hl: #fff08a;
  --cover: transparent; --cink: #1f2a44; --clogo: #fdfcf8;
  --sb: #fff; --sl: #fff08a; --sc: #1f2a44; --kb: #fff; --kc: #1f2a44; --kk: #e04a3a;
  --gb: #fff; --gl: #dcd9cf; --gc: #4d566e; }
[data-theme=paper] html, html[data-theme=paper] { background: #fdfcf8 radial-gradient(circle, #cfcbbd 0.9px, transparent 1.1px) 0 0 / 6mm 6mm; }
[data-theme=paper] body { background: none; }
[data-theme=paper] .cover { padding: 6px 4px 0; border-radius: 0; overflow: visible; }
[data-theme=paper] .deco { display: none; }
[data-theme=paper] .chip { border: 1.5px solid var(--ink); background: #fff; border-radius: 6px; }
[data-theme=paper] h1 { font-size: 32pt; display: inline; padding: 0 6px; background: linear-gradient(transparent 55%, var(--hl) 55%); -webkit-box-decoration-break: clone; box-decoration-break: clone; }
[data-theme=paper] .sub { margin-top: 14px; }
[data-theme=paper] .toc { background: #fff; border: 1.5px solid var(--ink); border-radius: 10px; padding: 10px 16px 8px; box-shadow: 4px 4px 0 var(--ink); margin-top: 2mm; }
[data-theme=paper] .toc li { border-bottom: 1px dashed var(--line); }
[data-theme=paper] .sh .n { font-size: 13pt; font-weight: 800; color: #fff; background: var(--a); width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; }
[data-theme=paper] h2 { display: inline; font-weight: 800; padding: 0 4px; background: linear-gradient(transparent 58%, var(--hl) 58%); -webkit-box-decoration-break: clone; box-decoration-break: clone; }
[data-theme=paper] h3 { color: var(--a); }
[data-theme=paper] ul.kv li { border-bottom-style: dashed; }
[data-theme=paper] .callout { border-radius: 3px; padding: 14px 16px 12px; margin: 16px 6px 13px; box-shadow: 2px 3px 0 rgba(31,42,68,.14); transform: rotate(-.4deg); }
[data-theme=paper] .callout:before { content: ""; position: absolute; top: -7px; left: 50%; width: 22mm; height: 5mm; margin-left: -11mm; background: rgba(120,170,255,.45); transform: rotate(-2deg); }
[data-theme=paper] .callout.key { --cb: #dff0ff; --cc: #1b4f8f; }
[data-theme=paper] .callout.exam { --cb: #fff3a6; --cc: #7a5a00; transform: rotate(.35deg); }
[data-theme=paper] .callout.warn { --cb: #ffdcd7; --cc: #b3261e; }
[data-theme=paper] .callout.tip { --cb: #d9f5dc; --cc: #1d6b33; transform: rotate(.3deg); }
[data-theme=paper] .formula { background: #fff; border: 1.5px dashed var(--ink); border-radius: 10px; }
[data-theme=paper] .example { background: #fff; border: 1.5px solid var(--ink); border-radius: 10px; }
[data-theme=paper] .tw table { background: #fff; border: 1.5px solid var(--ink); border-radius: 10px; overflow: hidden; }
[data-theme=paper] .tw thead th { background: var(--ink); color: #fff; }
[data-theme=paper] .tw tbody tr:last-child > * { border-bottom: 0; }
[data-theme=paper] .simple { border: 1.5px solid var(--ink); border-radius: 10px; }
[data-theme=paper] .check { border: 1.5px solid var(--ink); border-radius: 10px; box-shadow: 4px 4px 0 var(--ink); }

/* ── classic: a printed handout. Serif, rules, one deep red. ── */
[data-theme=classic] { --fd: "Source Serif 4", "Noto Naskh Arabic", Georgia, serif; --fb: "Source Serif 4", "Noto Naskh Arabic", Georgia, serif;
  --bg: #fff; --ink: #1d1a17; --mute: #6f675e; --line: #ded6cb; --panel: #f7f3ed;
  --a: #8c2f1b; --ad: #6f2413; --as: #f8efe8; --hl: #f6e3b0;
  --cover: #fff; --cink: #1d1a17; --clogo: #fff;
  --sb: #f8efe8; --sl: #e6c9a8; --sc: #1d1a17; --kb: #fff; --kc: #1d1a17; --kk: #1d1a17;
  --gb: #fff; --gl: #ded6cb; --gc: #5a534b; }
[data-theme=classic] body { font-size: 10.8pt; }
[data-theme=classic] h1, [data-theme=classic] h2 { font-family: "Source Serif 4", "Amiri", Georgia, serif; }
[data-theme=classic] .full { text-align: center; align-items: center; padding: 30mm 28mm 40mm; }
[data-theme=classic] .deco i:nth-child(1) { inset: 12mm 12mm 22mm; border: 1.2px solid var(--ink); }
[data-theme=classic] .deco i:nth-child(2) { inset: 14mm 14mm 24mm; border: .5px solid var(--ink); }
[data-theme=classic] .full .ttl { margin: auto 0; }
[data-theme=classic] .ttl:after { content: ""; display: block; width: 30mm; height: 1.2px; background: var(--a); margin: 9mm auto 0; }
[data-theme=classic] .chips { justify-content: center; }
[data-theme=classic] .chip { border-radius: 2px; font-weight: 400; }
[data-theme=classic] h1 { font-size: 36pt; font-weight: 700; }
[data-theme=classic] .sub { font-style: italic; margin: 0 auto; }
[data-theme=classic] .full .meta { margin-top: 0; border: 0; }
[data-theme=classic] .sh { border-bottom: 1.2px solid var(--ink); padding-bottom: 5px; align-items: baseline; }
[data-theme=classic] .sh .n { font-size: 20pt; color: var(--a); font-weight: 700; }
[data-theme=classic] .callout { border-radius: 0; background: none; border-block: 1px solid var(--line); padding-inline: 4px; }
[data-theme=classic] .formula, [data-theme=classic] .example, [data-theme=classic] .simple, [data-theme=classic] .check { border-radius: 2px; }
[data-theme=classic] .tw thead th { border-top: 1.5px solid var(--ink); border-bottom: 1px solid var(--ink); }
[data-theme=classic] .tw tbody tr:last-child > * { border-bottom: 1.5px solid var(--ink); }
[data-theme=classic] .check { border: 1.2px solid var(--ink); }
[data-theme=classic] .sig { border-radius: 2px; }
[data-theme=classic] .sig .cta, [data-theme=classic] .sig .logo { border-radius: 2px; }

/* inline cover (revision, handout): a title at the top of page one */
.inline { background: none; overflow: visible; padding: 0; }
.inline .brand, .inline .deco { display: none; }
.run { display: none; }

/* ── revision: a dense clinical revision sheet — navy bars, teal marks,
   a map of the whole file on page one. ── */
[data-theme=revision] { --fd: "Lato", "IBM Plex Sans Arabic", sans-serif; --fb: "Lato", "IBM Plex Sans Arabic", sans-serif;
  --bg: #fff; --ink: #1c2333; --mute: #5d6678; --line: #cfd6e2; --panel: #f1f4f9;
  --a: #1a8a87; --ad: #17305c; --as: #e6f1f1; --hl: #fff1a8; --navy: #17305c; --red: #b8322c;
  --cover: none; --cink: #17305c; --clogo: #fff;
  --sb: #e6f1f1; --sl: #1a8a87; --sc: #fff; --kb: #f1f4f9; --kc: #1c2333; --kk: #1a8a87;
  --gb: #fff; --gl: #cfd6e2; --gc: #5d6678; }
[data-theme=revision] body { font-size: 8.9pt; line-height: 1.5; }
[data-theme=revision] [dir=rtl] { line-height: 1.8; }
[data-theme=revision] table.page > thead td { height: 12mm; vertical-align: bottom; padding: 0 13mm; }
[data-theme=revision] table.page > tbody > tr > td { padding: 0 13mm; }
[data-theme=revision] .run { display: block; font-size: 7.4pt; color: var(--mute); padding-bottom: 3px; margin-bottom: 4mm;
  border-bottom: 1px solid var(--line); position: relative; }
[data-theme=revision] .run:after { content: ""; position: absolute; inset-inline-start: 0; bottom: -1px; width: 16mm; height: 2px; background: var(--a); }
[data-theme=revision] .chips, [data-theme=revision] .meta { display: none; }
[data-theme=revision] h1 { font-size: 21pt; line-height: 1.2; margin: 0; color: var(--navy); font-weight: 900; }
[data-theme=revision] .sub { font-size: 9.6pt; color: var(--a); max-width: none; opacity: 1; line-height: 1.5; }
[data-theme=revision] .toc { display: none; }
[data-theme=revision] .toc.only { display: block; margin-top: 4mm; }
[data-theme=revision] section.sec { margin-top: 4mm; }
[data-theme=revision] .sh { background: var(--navy); color: #fff; border-radius: 6px; padding: 5px 12px; gap: 9px; margin-bottom: 5px; }
[data-theme=revision] .sh .n { font-size: 12.5pt; font-weight: 900; color: #7fd6d2; }
[data-theme=revision] .sh .st { flex: 1; display: flex; flex-direction: row-reverse; justify-content: space-between; align-items: center; gap: 12px; }
[data-theme=revision] h2 { font-size: 12.5pt; font-weight: 900; }
[data-theme=revision] .eb { color: #dfe7f5; font-size: 7.4pt; font-weight: 700; white-space: nowrap; }
[data-theme=revision] h3 { font-size: 10.4pt; color: var(--a); font-weight: 900; margin: 9px 0 2px; }
[data-theme=revision] p { margin: 3px 0; }
[data-theme=revision] ul, [data-theme=revision] ol { margin: 3px 0; padding-inline-start: 16px; }
[data-theme=revision] li { margin: 1px 0; }
[data-theme=revision] ul.kv { border: 1px solid var(--line); padding: 0; }
[data-theme=revision] ul.kv li { margin: 0; padding: 4px 8px; gap: 10px; grid-template-columns: minmax(90px, 22%) 1fr; }
[data-theme=revision] ul.kv li:nth-child(even) { background: var(--panel); }
[data-theme=revision] ul.kv li:last-child { border-bottom: 0; }
[data-theme=revision] .callout { border-radius: 0; border-inline-start: 3.5px solid var(--cc); padding: 6px 12px 7px; margin: 7px 0; }
[data-theme=revision] .callout .ct { font-size: 8.9pt; font-weight: 900; text-transform: uppercase; }
[data-theme=revision] .callout .ct i { display: none; }
[data-theme=revision] .callout.key { --cb: var(--as); --cc: var(--a); }
[data-theme=revision] .callout.exam { --cb: #fff6dc; --cc: #b07a00; }
[data-theme=revision] .callout.warn { --cb: #fbe9e7; --cc: var(--red); }
[data-theme=revision] .callout.tip { --cb: var(--as); --cc: var(--a); }
[data-theme=revision] .formula { border-radius: 4px; padding: 8px 12px; margin: 7px 0; border: 1px solid var(--line); }
[data-theme=revision] .example { border-radius: 4px; border-width: 1px; margin: 7px 0; }
[data-theme=revision] .example .et { background: var(--navy); color: #fff; padding: 4px 10px; font-size: 9pt; }
[data-theme=revision] .example .ans { margin: 0 10px 8px; padding: 4px 10px; border-radius: 4px; }
[data-theme=revision] .tw { margin: 7px 0; }
[data-theme=revision] .tw table { font-size: 8.3pt; line-height: 1.4; border: 1px solid var(--line); }
[data-theme=revision] .tw th, [data-theme=revision] .tw td { padding: 4px 7px; }
[data-theme=revision] .tw thead th { background: var(--navy); color: #fff; font-size: 8.1pt; font-weight: 900; border-bottom: 0; }
[data-theme=revision] .tw tbody th { color: var(--navy); font-weight: 900; }
[data-theme=revision] .tw tbody tr:nth-child(even) > * { background: var(--panel); }
[data-theme=revision] .tw tbody tr:last-child > * { border-bottom: 0; }
[data-theme=revision] .flow, [data-theme=revision] .stages { margin: 7px 0; }
[data-theme=revision] .flow .fs { border-radius: 5px; border-width: 1px; padding: 5px 8px; }
[data-theme=revision] .flow .fs:first-child { background: var(--navy); border-color: var(--navy); color: #fff; }
[data-theme=revision] .flow .fs:last-child { border-color: var(--red); background: #fbe9e7; }
[data-theme=revision] .stages { gap: 3px; }
[data-theme=revision] .stages .sg { border-radius: 0; padding: 5px 9px; }
[data-theme=revision] .stages .sg b { color: var(--navy); }
[data-theme=revision] .simple { border-radius: 0; border-inline-start: 3.5px solid var(--a); padding: 6px 12px; margin: 7px 0; }
[data-theme=revision] .simple b { border-radius: 3px; }
[data-theme=revision] .check { border-radius: 6px; padding: 10px 14px; margin-top: 6mm; border-inline-start: 3.5px solid var(--navy); }
[data-theme=revision] .check h2 { font-size: 11pt; color: var(--navy); }
[data-theme=revision] .sig { left: 13mm; right: 13mm; border-radius: 6px; }
[data-theme=revision] .sig .logo, [data-theme=revision] .sig .cta { background: var(--navy); border-radius: 4px; }

/* the map of the file: section boxes around a centre, joined by curves */
.map { position: relative; margin: 5mm 0 2mm; direction: ltr; break-inside: avoid; }
.map svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.map path { fill: none; stroke: var(--a); stroke-width: .55; }
.map .hub { position: absolute; left: 67mm; width: 50mm; height: 15mm; margin-top: -7.5mm; border-radius: 50%; background: var(--navy); color: #fff;
  display: grid; place-items: center; text-align: center; font: 900 9.4pt/1.2 var(--fd); padding: 0 6mm; }
.map .hub span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.map .node { position: absolute; width: 54mm; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); overflow: hidden; }
.map .node b { display: block; background: var(--navy); color: #fff; font: 900 8.4pt/1.3 var(--fd); padding: 3px 8px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.map .node ul { margin: 0; padding: 4px 8px 0 8px; list-style: none; font-size: 8pt; line-height: 1.35; }
.map .node li { margin: 0 0 2.2px; display: flex; gap: 6px; align-items: baseline; }
.map .node li i { flex: none; width: 3.5px; height: 3.5px; border-radius: 50%; background: var(--a); transform: translateY(-2px); }
.map .node li span { flex: 1; min-width: 0; white-space: nowrap; overflow-x: clip; overflow-y: visible; text-overflow: ellipsis; }
.map .node .katex { font-size: 1em; }

/* ── guide: a clinical study guide — navy headings, steel-blue sub-heads,
   ruled tables with a navy head, pale blue note boxes. ── */
[data-theme=guide] { --fd: "Noto Sans", "Noto Sans Arabic", sans-serif; --fb: "Noto Sans", "Noto Sans Arabic", sans-serif;
  --bg: #fff; --ink: #1a1f27; --mute: #5b6573; --line: #d3dae3; --panel: #f3f5f8;
  --a: #2a6d92; --ad: #16324f; --as: #e8f1f7; --hl: #fff1a8; --navy: #16324f;
  --cover: #fff; --cink: #16324f; --clogo: #fff;
  --sb: #f3f5f8; --sl: none; --sc: #2a6d92; --kb: none; --kc: #1a1f27; --kk: #2a6d92;
  --gb: #fff; --gl: #d3dae3; --gc: #5b6573; }
[data-theme=guide] body { font-size: 9.8pt; line-height: 1.5; }
[data-theme=guide] [dir=rtl] { line-height: 1.8; }
[data-theme=guide] table.page > tbody > tr > td { padding: 0 18mm; }
[data-theme=guide] .brand, [data-theme=guide] .deco { display: none; }
[data-theme=guide] .full { padding: 38mm 18mm 30mm; text-align: center; align-items: center; }
[data-theme=guide] .full .ttl { margin-top: 0; display: flex; flex-direction: column; align-items: center; }
[data-theme=guide] h1 { order: 1; font-size: 25pt; line-height: 1.3; font-weight: 700; text-transform: uppercase; margin: 0 0 4mm; }
[data-theme=guide] .sub { order: 2; font-size: 11pt; line-height: 1.6; color: var(--mute); opacity: 1; max-width: none; }
[data-theme=guide] .sub:after { content: ""; display: block; width: 110mm; height: 1.5px; background: var(--a); margin: 6mm auto 7mm; }
[data-theme=guide] .chips { order: 3; justify-content: center; gap: 0; margin: 0; color: var(--mute); }
[data-theme=guide] .chip { border: 0; padding: 0; font: 400 10.5pt/1.6 var(--fb); }
[data-theme=guide] .chip + .chip:before { content: "•"; margin: 0 7px; }
[data-theme=guide] .full .meta { margin-top: 12mm; align-self: stretch; text-align: start; padding: 8px 10px; border: 1px solid var(--a);
  background: var(--as); color: var(--ink); opacity: 1; font-size: 9.4pt; }
[data-theme=guide] .toc { display: none; }
[data-theme=guide] section.sec { margin-top: 6mm; }
[data-theme=guide] .sh { gap: 6px; align-items: baseline; margin-bottom: 3px; }
[data-theme=guide] .sh .n { font-size: 17pt; font-weight: 700; color: var(--navy); line-height: 1.3; }
[data-theme=guide] .sh .n:after { content: "."; }
[data-theme=guide] .sh .st { flex: 1; display: flex; flex-direction: row-reverse; justify-content: space-between; align-items: baseline; gap: 12px; }
[data-theme=guide] h2 { flex: 1; font-size: 17pt; line-height: 1.3; color: var(--navy); }
[data-theme=guide] .eb { font-size: 7.4pt; white-space: nowrap; }
[data-theme=guide] h3 { font-size: 12pt; color: var(--a); margin: 10px 0 3px; }
[data-theme=guide] p { margin: 4px 0; }
[data-theme=guide] ul, [data-theme=guide] ol { margin: 4px 0; padding-inline-start: 18px; }
[data-theme=guide] li { margin: 2px 0; }
[data-theme=guide] li::marker { color: var(--ink); font-weight: 400; }
[data-theme=guide] ul.kv { border: 1px solid var(--line); padding: 0; }
[data-theme=guide] ul.kv li { margin: 0; padding: 4px 8px; gap: 10px; grid-template-columns: minmax(90px, 24%) 1fr; }
[data-theme=guide] ul.kv li:nth-child(even) { background: var(--panel); }
[data-theme=guide] ul.kv li:last-child { border-bottom: 0; }
[data-theme=guide] .callout { border-radius: 0; border: 1px solid var(--cl); padding: 7px 10px; margin: 8px 0; }
[data-theme=guide] .callout > div { display: inline; }
[data-theme=guide] .callout .ct { font-size: inherit; margin: 0; }
[data-theme=guide] .callout .ct:after { content: ": "; }
[data-theme=guide] .callout .ct i { display: none; }
[data-theme=guide] .callout.key, [data-theme=guide] .callout.exam, [data-theme=guide] .callout.tip { --cb: var(--as); --cc: var(--navy); --cl: var(--a); }
[data-theme=guide] .callout.warn { --cb: #fbeeec; --cc: #9c2b22; --cl: #c0564c; }
[data-theme=guide] .formula { border-radius: 0; border: 1px solid var(--line); padding: 8px 12px; margin: 8px 0; }
[data-theme=guide] .example { border-radius: 0; border-width: 1px; margin: 8px 0; }
[data-theme=guide] .example .et { background: var(--navy); color: #fff; padding: 5px 10px; font-size: 9pt; }
[data-theme=guide] .example .et > span { background: none; color: #cfe2ee; padding: 0; font-size: inherit; }
[data-theme=guide] .example .et > span:after { content: ":"; }
[data-theme=guide] .example .ans { margin: 0 10px 8px; padding: 5px 10px; border-radius: 0; background: var(--as); color: var(--navy); }
[data-theme=guide] .tw { margin: 8px 0; }
[data-theme=guide] .tw table { font-size: 8.4pt; line-height: 1.45; border-top: 1px solid var(--line); border-inline-start: 1px solid var(--line); }
[data-theme=guide] .tw th, [data-theme=guide] .tw td { padding: 5px 7px; border-inline-end: 1px solid var(--line); }
[data-theme=guide] .tw thead th { background: var(--navy); color: #fff; font-size: 8.4pt; }
[data-theme=guide] .tw tbody th { color: var(--ink); font-weight: 400; }
[data-theme=guide] .tw tbody tr:nth-child(even) > * { background: var(--panel); }
[data-theme=guide] .flow, [data-theme=guide] .stages { margin: 8px 0; }
[data-theme=guide] .flow .fs { border-radius: 0; border-width: 1px; }
[data-theme=guide] .flow .fs:first-child { background: var(--navy); border-color: var(--navy); color: #fff; }
[data-theme=guide] .stages { gap: 4px; }
[data-theme=guide] .stages .sg { border-radius: 0; border: 1px solid var(--line); }
[data-theme=guide] .simple { border-radius: 0; border: 1px solid var(--line); padding: 7px 10px; margin: 8px 0; }
[data-theme=guide] .simple b { background: none; padding: 0; margin: 0; font-size: inherit; }
[data-theme=guide] .check { padding: 0; border-radius: 0; margin-top: 7mm; }
[data-theme=guide] .check h2 { font-size: 17pt; margin-bottom: 4px; }
[data-theme=guide] .check li:before { border-width: 1.5px; border-radius: 0; }
[data-theme=guide] .sig { left: 18mm; right: 18mm; border-radius: 0; border-width: 1px 0 0; padding: 0; }
[data-theme=guide] .sig .logo, [data-theme=guide] .sig .cta { background: var(--navy); border-radius: 2px; }

/* ── handout: a plain typed document. Serif headings, nothing else. ── */
[data-theme=handout] { --fd: "Libre Baskerville", "Amiri", Georgia, serif; --fb: "Arimo", "IBM Plex Sans Arabic", Arial, sans-serif;
  --bg: #fff; --ink: #2b2b2b; --mute: #8a8a8a; --line: #e4e4e4; --panel: #f6f6f6;
  --a: #2b2b2b; --ad: #2b2b2b; --as: #f6f6f6; --hl: #fff3b0;
  --cover: none; --cink: #2b2b2b; --clogo: #fff;
  --sb: none; --sl: none; --sc: #2b2b2b; --kb: #fff; --kc: #2b2b2b; --kk: #2b2b2b;
  --gb: #fff; --gl: #e4e4e4; --gc: #6f6f6f; }
[data-theme=handout] body { font-size: 10.2pt; line-height: 1.6; }
[data-theme=handout] table.page > thead td { height: 20mm; }
[data-theme=handout] table.page > tbody > tr > td { padding: 0 19mm; }
[data-theme=handout] .chips { display: none; }
[data-theme=handout] h1 { font-size: 22pt; line-height: 1.3; margin: 0 0 6px; font-weight: 700; }
[data-theme=handout] .sub { max-width: none; opacity: 1; font-size: 10.2pt; line-height: 1.6; font-weight: 700; }
[data-theme=handout] .meta { margin-top: 4px; color: var(--mute); opacity: 1; }
[data-theme=handout] .toc { display: none; }
[data-theme=handout] section.sec { margin-top: 8mm; padding-top: 7mm; border-top: 1px solid var(--line); }
[data-theme=handout] .inline + .toc + section.sec { border-top: 0; padding-top: 0; }
[data-theme=handout] .sh { gap: 5px; align-items: baseline; margin-bottom: 4px; }
[data-theme=handout] .sh .n { font-size: 14.5pt; font-weight: 700; }
[data-theme=handout] .sh .n:after { content: "."; }
[data-theme=handout] h2 { font-size: 14.5pt; }
[data-theme=handout] .eb { display: none; }
[data-theme=handout] h3 { font-size: 11.4pt; margin: 16px 0 4px; }
[data-theme=handout] li { margin: 5px 0; }
[data-theme=handout] li::marker { color: var(--ink); font-weight: 400; }
[data-theme=handout] ul.kv li { display: block; border: 0; padding: 0; margin: 5px 0; }
[data-theme=handout] ul.kv { list-style: disc; padding-inline-start: 20px; }
[data-theme=handout] ul.kv li > strong:after { content: ": "; }
[data-theme=handout] .callout { background: none; border-radius: 0; border-inline-start: 3px solid #c9c9c9; padding: 2px 12px; color: var(--mute); }
[data-theme=handout] .callout .ct { color: #6f6f6f; }
[data-theme=handout] .callout .ct i { display: none; }
[data-theme=handout] .formula { background: none; padding: 6px 0; }
[data-theme=handout] .example { border-radius: 0; border-width: 1px; }
[data-theme=handout] .example .et > span { background: none; color: var(--ink); padding: 0; font-size: inherit; font-weight: 700; }
[data-theme=handout] .example .et > span:after { content: ":"; }
[data-theme=handout] .example .ans { background: none; color: var(--ink); padding: 0; }
[data-theme=handout] .tw thead th { border-bottom: 1.5px solid var(--ink); }
[data-theme=handout] .tw tbody th { color: var(--ink); }
[data-theme=handout] .simple { display: block; padding: 0; border-radius: 0; }
[data-theme=handout] .simple b { font-size: inherit; padding: 0; border-radius: 0; margin: 0; font-family: var(--fb); }
[data-theme=handout] .simple b:after { content: ": "; }
[data-theme=handout] .check { border-radius: 0; padding: 7mm 0 0; border-top: 1px solid var(--line); }
[data-theme=handout] .sig { font-family: var(--fb); border-radius: 0; border-width: 1px 0 0; left: 19mm; right: 19mm; padding: 0; }
[data-theme=handout] .sig .logo, [data-theme=handout] .sig .cta { border-radius: 2px; }
`;

// How each look opens: a cover that fills the first page, a band at its
// top, or just a title above the text.
const COVER: Record<SummaryTheme, "full" | "band" | "inline"> = {
  revision: "inline",
  guide: "full",
  handout: "inline",
  studio: "full",
  bloom: "band",
  dusk: "full",
  paper: "band",
  classic: "full",
};

// Plain words of a marked-up line, for a label that must stay on one line.
const plain = (text: string) =>
  text
    .replace(/\$[^$\n]*\$/g, " ")
    .replace(/\*\*|==|`/g, "")
    .replace(/\s+/g, " ")
    .trim();

// A section's own landmarks, for its box on the map: its sub-headings
// first, then the terms it defines, then its list items.
export function sectionLandmarks(blocks: SummaryBlock[], max: number) {
  const of = (pick: (b: SummaryBlock) => string[]) => blocks.flatMap(pick);
  const found = [
    ...of(b => (b.t === "h" ? [b.text] : [])),
    ...of(b => (b.t === "kv" ? b.items.map(i => i[0]) : [])),
    ...of(b => (b.t === "stages" ? b.items.map(i => i[0]) : [])),
    ...of(b => (b.t === "table" ? b.rows.map(r => r[0] ?? "") : [])),
    ...of(b => (b.t === "list" ? b.items : [])),
    // A section of formulas and worked examples has none of the above.
    ...of(b => (b.t === "example" ? [b.title] : [])),
    ...of(b => (b.t === "table" ? [b.head.join(" · ")] : [])),
    ...of(b => (b.t === "callout" ? [b.title ?? b.text] : [])),
    ...of(b => (b.t === "p" ? [b.text] : [])),
  ]
    // Marks and maths stay: the box draws them as the text does.
    .map(s =>
      s
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[:：.،,;]+$/, "")
    )
    .filter(Boolean)
    // Plain words read best in a one-line label; maths fills what is left.
    .sort((a, b) => Number(a.includes("$")) - Number(b.includes("$")));
  return [...new Set(found)].slice(0, max);
}

// The map on page one of the "revision" look: every section as a box around
// the title, joined to it by a curve. Laid out here in millimetres (the page
// runs no script). Past twelve sections there is no room, and the caller
// shows the contents list instead.
const MAP_MAX = 12;
function sectionMap(doc: SummaryDoc, rtl: boolean) {
  const count = doc.sections.length;
  if (count < 2 || count > MAP_MAX) return "";
  const lines = count <= 8 ? 4 : 2;
  const boxHeight = 8 + lines * 4.6;
  const gap = 4.5;
  const width = 184;
  const boxWidth = 54;
  const first = doc.sections.slice(0, Math.ceil(count / 2));
  const second = doc.sections.slice(Math.ceil(count / 2));
  const height = first.length * (boxHeight + gap) - gap;
  const middle = height / 2;
  // The first half sits where reading starts: left, or right in Arabic.
  const sides = rtl ? [second, first] : [first, second];
  const nodes: string[] = [];
  const paths: string[] = [];
  sides.forEach((side, sideIndex) => {
    const left = sideIndex === 0;
    side.forEach((section, i) => {
      const y = ((i + 0.5) * height) / side.length;
      const boxEdge = left ? boxWidth : width - boxWidth;
      const hubEdge = left ? 67 : 117;
      const bend = left ? 6 : -6;
      paths.push(
        `<path d="M${boxEdge},${y.toFixed(1)} C${boxEdge + bend},${y.toFixed(1)} ${hubEdge - bend},${middle.toFixed(1)} ${hubEdge},${middle.toFixed(1)}"/>`
      );
      const d = dirOf(section.title);
      nodes.push(
        `<div class="node" dir="${d}" style="${left ? "left" : "right"}:0;top:${(y - boxHeight / 2).toFixed(1)}mm;height:${boxHeight.toFixed(1)}mm"><b>${esc(plain(section.title))}</b><ul>${sectionLandmarks(
          section.blocks,
          lines
        )
          .map(item => `<li><i></i><span>${inline(item)}</span></li>`)
          .join("")}</ul></div>`
      );
    });
  });
  return `<div class="map" style="height:${height.toFixed(1)}mm"><svg viewBox="0 0 ${width} ${height.toFixed(1)}" preserveAspectRatio="none">${paths.join("")}</svg><div class="hub" dir="${dirOf(doc.title)}" style="top:${middle.toFixed(1)}mm"><span>${esc(plain(doc.title))}</span></div>${nodes.join("")}</div>`;
}

export function renderSummary(
  doc: SummaryDoc,
  opts: { link?: string; theme?: SummaryTheme } = {}
) {
  const lang = doc.lang === "ar" ? "ar" : "en";
  const rtl = lang === "ar";
  const theme = toSummaryTheme(opts.theme);
  const link = opts.link ?? "https://t.me/Nirolearnbot";
  const t = rtl
    ? {
        contents: "المحتويات",
        check: "راجِع نفسك",
        note: "ملخص للمذاكرة، راجِعه مع مصدرك.",
      }
    : {
        contents: "Contents",
        check: "Check yourself",
        note: "A study summary. Check it against your source.",
      };
  // "1" in the looks that number like a document, "01" in the others.
  const number = (n: number) =>
    COVER[theme] === "inline" || theme === "guide"
      ? String(n)
      : String(n).padStart(2, "0");
  const sourcePages = (pages: number[], titleDir: string) => {
    const ranges = pageRanges(pages);
    if (!ranges) return "";
    return `${titleDir === "rtl" ? "من صفحات المصدر" : "Source pages"} <bdi dir="ltr">${ranges}</bdi>`;
  };
  const sections = doc.sections
    .map((s, i) => {
      const d = dirOf(s.title);
      const from = sourcePages(s.pages ?? [], d);
      return `<section class="sec c${i % 5}"><header class="sh" dir="${d}"><span class="n">${number(i + 1)}</span><div class="st">${
        from ? `<span class="eb">${from}</span>` : ""
      }<h2>${inline(s.title)}</h2></div></header>${s.blocks
        .map(b => block(b))
        .join("")}</section>`;
    })
    .join("");
  const toc = doc.sections
    .map((s, i) => {
      const ranges = pageRanges(s.pages ?? []);
      return `<li dir="${dirOf(s.title)}"><b>${number(i + 1)}</b><span>${inline(s.title)}</span>${
        ranges ? `<em><bdi dir="ltr">${ranges}</bdi></em>` : ""
      }</li>`;
    })
    .join("");
  const check = doc.checklist?.length
    ? `<section class="check" dir="${dirOf(doc.checklist.join(" "))}"><h2>${t.check}</h2><ul>${doc.checklist
        .map(c => `<li><span>${inline(c)}</span></li>`)
        .join("")}</ul></section>`
    : "";
  const meta = (doc.meta ?? "")
    .split(" · ")
    .map(m => `<bdi>${esc(m)}</bdi>`)
    .join(" · ");
  const map = theme === "revision" ? sectionMap(doc, rtl) : "";
  const cover = `<header class="cover ${COVER[theme]}" dir="${dirOf(doc.title)}"><div class="deco"><i></i><i></i><i></i></div>
<div class="brand"><span class="logo">N</span><span>NiroLearn</span></div>
<div class="ttl"><div class="chips">${(doc.chips ?? []).map(c => `<span class="chip">${esc(c)}</span>`).join("")}</div>
<h1>${inline(doc.title)}</h1><p class="sub">${inline(doc.subtitle ?? "")}</p></div>
<div class="meta">${meta}</div></header>`;
  const inlineCover = COVER[theme] === "inline";
  // The line that runs along the top of every page of the "revision" look.
  const running = (doc.chips ?? [])
    .map(c => `<bdi>${esc(c)}</bdi>`)
    .join(" · ");
  return `<!doctype html><html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}" data-theme="${theme}"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex.min.css">
<link href="${fontsHref(theme)}" rel="stylesheet">
<style>${CSS}</style></head><body>
<div class="sig"><a href="${esc(link)}"><span class="logo">N</span><span class="nm">NiroLearn</span></a>
<span class="mid">صُنع هذا الملخص بـ NiroLearn من ملف الطالب</span>
<a href="${esc(link)}"><span class="cta" dir="rtl">اصنع ملخصك مجانًا ← ‎@Nirolearnbot</span></a></div>
${inlineCover ? "" : cover}
<table class="page"><thead><tr><td><div class="run" dir="${rtl ? "rtl" : "ltr"}">${running}</div></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>
${inlineCover ? cover : ""}${map}<nav class="toc${theme === "revision" && !map ? " only" : ""}" dir="${rtl ? "rtl" : "ltr"}"><div class="tt">${t.contents}</div><ol>${toc}</ol></nav>
${sections}${check}<p class="note" dir="${rtl ? "rtl" : "ltr"}">${t.note}</p>
</td></tr></tbody></table></body></html>`;
}
