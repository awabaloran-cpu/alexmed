// 📝 Prints a summary's HTML (lib/summary/render.ts) to an A4 PDF with a
// headless Chromium: the only renderer that gets Arabic shaping, maths and
// the page design right.
//
// On the server the browser comes from @sparticuz/chromium (a Chromium built
// to run without system packages). CHROMIUM_PATH points at an installed
// Chrome instead — for a developer's machine. One browser per call, closed
// before returning: the page loads web fonts and nothing of the student's.
import puppeteer from "puppeteer-core";

const RENDER_TIMEOUT_MS = 90_000;

// @sparticuz/chromium carries the shared libraries Chromium needs (NSS,
// NSPR, …) but only unpacks them, and only points LD_LIBRARY_PATH at them,
// when it believes it runs on AWS Lambda — it reads these variables when it
// is first imported. Railway's image has none of those libraries: the first
// live summary (2026-10-09) failed with "libnspr4.so: cannot open shared
// object file". So the package is imported lazily, with the variable it
// looks for set for just that long; what it leaves behind (LD_LIBRARY_PATH,
// FONTCONFIG_PATH) is read by the browser process it starts, not by this
// one.
async function bundledChromium() {
  const had = process.env.AWS_LAMBDA_JS_RUNTIME;
  process.env.AWS_LAMBDA_JS_RUNTIME ??= "nodejs22.x";
  try {
    const { default: chromium } = await import("@sparticuz/chromium");
    return {
      executablePath: await chromium.executablePath(),
      args: chromium.args,
    };
  } finally {
    if (had === undefined) delete process.env.AWS_LAMBDA_JS_RUNTIME;
  }
}

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const local = process.env.CHROMIUM_PATH?.trim();
  const browser = await puppeteer.launch({
    ...(local ? { executablePath: local, args: [] } : await bundledChromium()),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    // The summary is our own markup; it needs no script.
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, {
      waitUntil: "load",
      timeout: RENDER_TIMEOUT_MS,
    });
    // The web fonts are fetched when first used: wait for them, so the PDF
    // is never printed in a fallback font. Best effort — a font that does
    // not arrive must not cost the student their summary.
    await page
      .waitForNetworkIdle({ idleTime: 500, timeout: 20_000 })
      .catch(() => undefined);
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      timeout: RENDER_TIMEOUT_MS,
    });
  } finally {
    await browser.close().catch(() => undefined);
  }
}
