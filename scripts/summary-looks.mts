// Prints the hand-written samples below in every summary look, to judge the
// design (no AI, no database, nothing of a student's):
//   CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npx tsx scripts/summary-looks.mts <out-dir> [png]
// With "png", each PDF page is also saved as a picture.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { htmlToPdf } from "../lib/summary/pdf";
import { renderSummary } from "../lib/summary/render";
import { SUMMARY_THEMES, type SummaryDoc } from "../lib/summary/types";

const medicine: SummaryDoc = {
  lang: "en",
  title: "Kidney & Urinary Tract",
  subtitle:
    "Everything in your file, organised by disorder, with the clues examiners use.",
  chips: ["Paediatrics", "ملخص شامل", "7 صفحات من المصدر"],
  meta: "المصدر: Kidney_Urinary_MCQ.pdf · 9 أكتوبر 2026",
  sections: [
    {
      title: "Approach to a urinary presentation",
      pages: [1, 2],
      blocks: [
        {
          t: "callout",
          kind: "key",
          text: "First decide: is the child **unwell** (septic, shocked, oliguric)? Stabilise before any routine test.",
        },
        { t: "h", text: "Initial tests" },
        {
          t: "kv",
          items: [
            [
              "Urine dipstick",
              "Blood, protein, leukocyte esterase, nitrites, glucose.",
            ],
            [
              "Urine M&C",
              "Confirms infection and guides the antibiotic. Take it **before** antibiotics when that does not delay treatment.",
            ],
            [
              "Ultrasound",
              "First-line look at structure: hydronephrosis, obstruction, stones.",
            ],
            [
              "DMSA scan",
              "Cortical scarring, after the acute infection has settled.",
            ],
          ],
        },
        {
          t: "ar",
          text: "ابدأ بسؤال واحد: هل الطفل مريض جدًا؟ إن كان كذلك فالإنعاش أولًا، ثم الفحوص.",
        },
      ],
    },
    {
      title: "Urinary tract infection (UTI)",
      pages: [2, 3, 4],
      blocks: [
        {
          t: "p",
          text: "Bacterial infection of the urinary tract. **Cystitis** is the bladder; **pyelonephritis** reaches the kidney and causes fever and systemic illness.",
        },
        {
          t: "list",
          ordered: false,
          items: [
            "**Infants:** non-specific — fever, vomiting, poor feeding, lethargy.",
            "**Older children:** dysuria, frequency, loin pain, cloudy urine.",
            "==E. coli== is the commonest organism; Proteus is linked to struvite stones.",
          ],
        },
        {
          t: "callout",
          kind: "warn",
          text: "A positive **bag sample** is not proof of infection: contamination is common. A negative nitrite does **not** exclude UTI.",
        },
        {
          t: "ar",
          text: "التهاب البول في المثانة يسبب حرقة وكثرة تبول، وإن وصل للكلى سبّب حرارة وقيئًا وألمًا بالخاصرة. عيّنة الكيس قد تتلوث فلا يُعتمد عليها.",
        },
      ],
    },
    {
      title: "Nephrotic vs nephritic",
      pages: [5, 6, 7],
      blocks: [
        {
          t: "table",
          head: ["Feature", "Nephrotic (MCD)", "Nephritic (PSGN)", "HUS"],
          rows: [
            [
              "Main problem",
              "Heavy protein loss",
              "Glomerular inflammation",
              "Microangiopathy + AKI",
            ],
            [
              "Typical clue",
              "Marked oedema, 4+ protein",
              "Cola urine, hypertension",
              "Bloody diarrhoea, then pallor",
            ],
            ["Complement", "Normal", "**Low C3**", "Not diagnostic"],
            [
              "Key action",
              "Oral prednisolone",
              "Supportive, monitor BP",
              "Urgent hospital care",
            ],
          ],
        },
        {
          t: "callout",
          kind: "exam",
          text: "Oedema + 4+ protein + normal complement → **MCD**. Tea-coloured urine + hypertension after a sore throat → **PSGN**.",
        },
        {
          t: "callout",
          kind: "tip",
          text: "HUS triad: haemolytic anaemia, thrombocytopenia, acute kidney injury.",
        },
      ],
    },
  ],
  checklist: [
    "Can you tell nephrotic from nephritic by urine and complement?",
    "Can you recall the HUS triad and what precedes it?",
    "Do you know why a clean-catch sample beats a bag sample?",
  ],
};

const math: SummaryDoc = {
  lang: "ar",
  title: "المعادلات التربيعية",
  subtitle: "كل قوانين الوحدة وطرق الحل، مع مثال محلول لكل طريقة.",
  chips: ["رياضيات", "ملخص شامل", "12 صفحة من المصدر"],
  meta: "المصدر: الوحدة الثالثة.pdf · 9 أكتوبر 2026",
  sections: [
    {
      title: "الصورة العامة",
      pages: [1, 2, 3],
      blocks: [
        {
          t: "p",
          text: "المعادلة التربيعية هي كل معادلة يمكن كتابتها على الصورة التالية، حيث $a \\neq 0$:",
        },
        {
          t: "formula",
          tex: "ax^2 + bx + c = 0",
          note: "$a$ معامل $x^2$، و$b$ معامل $x$، و$c$ الحد الثابت.",
        },
        {
          t: "callout",
          kind: "key",
          text: "عدد الحلول يحدّده **المميّز** $\\Delta = b^2 - 4ac$ قبل أن تبدأ الحل.",
        },
        {
          t: "table",
          head: ["قيمة المميّز", "عدد الحلول", "شكل المنحنى"],
          rows: [
            [
              "$\\Delta > 0$",
              "حلّان حقيقيان مختلفان",
              "يقطع محور السينات في نقطتين",
            ],
            ["$\\Delta = 0$", "حل واحد مكرر", "يمسّ المحور في نقطة"],
            ["$\\Delta < 0$", "لا حلول حقيقية", "لا يقطع المحور"],
          ],
        },
      ],
    },
    {
      title: "القانون العام",
      pages: [4, 5, 6, 7],
      blocks: [
        { t: "formula", tex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
        {
          t: "example",
          title: "حُلّ المعادلة $2x^2 - 5x - 3 = 0$",
          steps: [
            "حدّد المعاملات: $a = 2$، $b = -5$، $c = -3$.",
            "احسب المميّز: $\\Delta = (-5)^2 - 4(2)(-3) = 25 + 24 = 49$.",
            "عوّض في القانون: $x = \\dfrac{5 \\pm 7}{4}$.",
          ],
          answer: "$x = 3$ أو $x = -\\tfrac{1}{2}$",
        },
        {
          t: "callout",
          kind: "warn",
          text: "انتبه لإشارة $b$: إن كانت $b = -5$ فإن $-b = +5$. هذا أكثر خطأ يتكرر في الامتحان.",
        },
      ],
    },
    {
      title: "التحليل إلى العوامل",
      pages: [8, 9, 10, 12],
      blocks: [
        {
          t: "list",
          ordered: true,
          items: [
            "اجعل الطرف الأيمن صفرًا.",
            "ابحث عن عددين حاصل ضربهما $ac$ ومجموعهما $b$.",
            "حلّل، ثم ساوِ كل قوس بالصفر.",
          ],
        },
        {
          t: "callout",
          kind: "tip",
          text: "جرّب التحليل أولًا إن كانت الأعداد صغيرة، فهو أسرع من القانون العام.",
        },
        {
          t: "callout",
          kind: "exam",
          text: "سؤال «أوجد قيمة $k$ التي تجعل للمعادلة حلًا واحدًا» يعني دائمًا $\\Delta = 0$.",
        },
      ],
    },
  ],
  checklist: [
    "هل تستطيع تحديد عدد الحلول من المميّز دون حل المعادلة؟",
    "هل تحفظ القانون العام وتطبّقه مع إشارات سالبة؟",
    "متى تختار التحليل ومتى تختار القانون العام؟",
  ],
};

const outDir = path.resolve(process.argv[2] ?? "summary-looks");
const png = process.argv[3] === "png";
fs.mkdirSync(outDir, { recursive: true });

// The pictures are drawn from the printed PDF itself (pdf.js in a browser
// page), so they show the real pages: breaks, margins and the signature.
const pdfjs = pathToFileURL(path.resolve("node_modules/pdfjs-dist/build")).href;
const viewer = path.join(outDir, "viewer.html");
const browser = png
  ? await puppeteer.launch({
      executablePath: process.env.CHROMIUM_PATH,
      headless: true,
      args: ["--allow-file-access-from-files"],
      defaultViewport: { width: 900, height: 1200 },
    })
  : null;
const page = await browser?.newPage();
if (page) {
  fs.writeFileSync(
    viewer,
    `<body style="margin:0"><canvas id="c"></canvas><script type="module">
import * as pdfjsLib from "${pdfjs}/pdf.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "${pdfjs}/pdf.worker.mjs";
let doc;
window.openPdf = async b64 => {
  doc = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) }).promise;
  return doc.numPages;
};
window.drawPage = async n => {
  const p = await doc.getPage(n);
  const viewport = p.getViewport({ scale: 794 / p.getViewport({ scale: 1 }).width });
  const canvas = document.getElementById("c");
  canvas.width = viewport.width; canvas.height = viewport.height;
  await p.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
};
window.ready = true;
</script></body>`
  );
  await page.goto(pathToFileURL(viewer).href);
  await page.waitForFunction("window.ready === true");
}

for (const [name, doc] of Object.entries({ medicine, math })) {
  for (const theme of SUMMARY_THEMES) {
    const base = path.join(outDir, `${name}-${theme}`);
    const pdf = await htmlToPdf(renderSummary(doc, { theme }));
    fs.writeFileSync(`${base}.pdf`, pdf);
    let pages = "";
    if (page) {
      const count = (await page.evaluate(
        `openPdf(${JSON.stringify(Buffer.from(pdf).toString("base64"))})`
      )) as number;
      pages = ` (${count} pages)`;
      for (let n = 1; n <= count; n++) {
        await page.evaluate(`drawPage(${n})`);
        const canvas = await page.$("#c");
        await canvas?.screenshot({ path: `${base}-${n}.png` });
      }
    }
    console.log(`${name}-${theme}${pages}`);
  }
}
await browser?.close();
