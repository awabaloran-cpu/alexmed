import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSummaryDoc, parseHead } from "./compose";
import { parseSummaryMarkup } from "./markup";
import { htmlToPdf } from "./pdf";
import { renderSummary } from "./render";
import { SUMMARY_THEMES } from "./types";

// Prints a real PDF with a real browser. Skipped unless LIVE_PDF=1 and
// CHROMIUM_PATH points at an installed Chrome (a developer's machine) — or,
// on the server, with the bundled Chromium:
//   LIVE_PDF=1 CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npx vitest run lib/summary/pdf.live.test.ts
describe.skipIf(process.env.LIVE_PDF !== "1")("htmlToPdf (live)", () => {
  it("prints every look to a PDF whose every page links to the bot", async () => {
    const sections = parseSummaryMarkup(
      Array.from(
        { length: 14 },
        (_, i) =>
          `# القسم ${i + 1}\n@pages ${i + 1}\nفقرة عربية مع $x^2 + ${i}$ ومصطلح **Croup**.\n- نقطة أولى\n- نقطة ثانية\n> KEY: الفكرة\n$$ x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a} $$\n| أ | ب |\n| 1 | 2 |\nAR: شرح مبسّط.`
      ).join("\n")
    );
    for (const theme of SUMMARY_THEMES) {
      const html = renderSummary(
        buildSummaryDoc({
          head: parseHead(
            "TITLE: تجربة الطباعة\nSUBJECT: رياضيات\nLANG: ar\n- سؤال؟",
            "f"
          ),
          sections,
          style: "full",
          sourcePages: 14,
          fileName: "ملف.pdf",
          date: "9 أكتوبر 2026",
        }),
        { link: "https://t.me/Nirolearnbot?start=inv_live", theme }
      );
      const pdf = await htmlToPdf(html);
      const out = path.join(os.tmpdir(), `nirolearn-summary-${theme}.pdf`);
      fs.writeFileSync(out, pdf);
      const text = Buffer.from(pdf).toString("latin1");
      expect(text.startsWith("%PDF")).toBe(true);
      const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      const links = (
        text.match(/\/URI\s*\(https:\/\/t\.me\/Nirolearnbot/g) ?? []
      ).length;
      expect(pages).toBeGreaterThan(1);
      // Two links in the signature, on every page.
      expect(links).toBe(pages * 2);
    }
  }, 180_000);
});
