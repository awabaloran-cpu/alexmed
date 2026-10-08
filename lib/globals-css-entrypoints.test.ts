// The root layout only loads app/base.css; the app stylesheet
// (app/globals.css) is imported by the app's own layouts and pages so the
// public marketing pages don't pay for it. This guards the split: every
// app page must get globals.css from itself or an ancestor layout, and the
// marketing pages must not.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "..", "app");

// Public pages styled only by base.css + CSS modules.
const MARKETING = new Set([
  "pdf-summary",
  "flashcards",
  "mind-map",
  "how-to-study",
  "telegram-bot",
  "past-exam-questions",
  "solve-questions",
]);

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "api") continue;
      out.push(...pages(full));
    } else if (name === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

const importsGlobals = (file: string) =>
  existsSync(file) &&
  /import\s+["'][^"']*globals\.css["']/.test(readFileSync(file, "utf8"));

function styledByGlobals(page: string): boolean {
  if (importsGlobals(page)) return true;
  let dir = path.dirname(page);
  // Stop before app/ itself: the root layout must not import globals.css.
  while (dir !== APP && dir.startsWith(APP)) {
    if (importsGlobals(path.join(dir, "layout.tsx"))) return true;
    dir = path.dirname(dir);
  }
  return false;
}

const topSegment = (page: string) =>
  path.relative(APP, page).split(path.sep)[0];

describe("globals.css entry points", () => {
  const all = pages(APP);

  it("the root layout loads only base.css", () => {
    const root = path.join(APP, "layout.tsx");
    expect(importsGlobals(root)).toBe(false);
    expect(readFileSync(root, "utf8")).toMatch(
      /import\s+["']\.\/base\.css["']/
    );
  });

  it("every app page gets globals.css from itself or a layout", () => {
    const missing = all
      .filter(page => page !== path.join(APP, "page.tsx"))
      .filter(page => !MARKETING.has(topSegment(page)))
      .filter(page => !styledByGlobals(page))
      .map(page => path.relative(APP, page));
    expect(missing).toEqual([]);
  });

  it("the landing page (app/page.tsx) never pulls in the app home", () => {
    // The app home is served at "/" via middleware.ts -> app/home; importing
    // it here, even lazily, would ship globals.css with the landing page.
    const landing = readFileSync(path.join(APP, "page.tsx"), "utf8");
    expect(landing).not.toMatch(/components\/Home["']/);
    expect(importsGlobals(path.join(APP, "page.tsx"))).toBe(false);
  });

  // Root-level convention files are bundled with every route, public
  // pages included, so importing globals.css there would undo the split.
  it("root error and not-found screens stay off globals.css", () => {
    for (const file of ["error.tsx", "not-found.tsx", "global-error.tsx"])
      expect(importsGlobals(path.join(APP, file))).toBe(false);
  });

  it("marketing pages stay off globals.css", () => {
    const leaking = all
      .filter(page => MARKETING.has(topSegment(page)))
      .filter(page => styledByGlobals(page))
      .map(page => path.relative(APP, page));
    expect(leaking).toEqual([]);
  });
});
