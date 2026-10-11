import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compact,
  directionOf,
  DISCOVER_MESSAGES,
  label,
  translate,
  type DiscoverKey,
} from "./i18n";

const ARABIC = /\p{Script=Arabic}/u;
// A name this product never carries — spelled here letter by letter so
// that not even this file contains it.
const OTHER_PRODUCT = new RegExp(["k", "a", "h", "o", "o", "t"].join(""), "i");
const keys = Object.keys(DISCOVER_MESSAGES.ar) as DiscoverKey[];

describe("the words of Discover", () => {
  it("every key has both languages, each in its own script", () => {
    expect(Object.keys(DISCOVER_MESSAGES.en).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(ARABIC.test(DISCOVER_MESSAGES.ar[key]), `ar ${key}`).toBe(true);
      expect(ARABIC.test(DISCOVER_MESSAGES.en[key]), `en ${key}`).toBe(false);
    }
  });

  it("both languages take the same parameters", () => {
    const params = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of keys) {
      expect(params(DISCOVER_MESSAGES.en[key]), key).toEqual(
        params(DISCOVER_MESSAGES.ar[key])
      );
    }
  });

  it("fills parameters, reads right-to-left only in Arabic", () => {
    expect(translate("en", "card.questions", { n: 8 })).toBe("8 questions");
    expect(translate("ar", "learn.question", { n: 2, total: 8 })).toBe(
      "السؤال 2 من 8"
    );
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
  });

  it("names a subject or an occasion, and shows an unknown one as written", () => {
    expect(label("ar", "science")).toBe("علوم");
    expect(label("en", "occ:school")).toBe("Back to school");
    expect(label("en", "occ:new-year")).toBe("new-year");
    expect(label("en", "poetry")).toBe("poetry");
  });

  it("shortens large counts", () => {
    expect(compact(0)).toBe("0");
    expect(compact(929)).toBe("929");
    expect(compact(1900)).toBe("1.9K");
    expect(compact(365_600)).toBe("366K");
    expect(compact(2_100_000)).toBe("2.1M");
  });

  it("no Discover screen writes a sentence of its own", () => {
    // Arabic letters in a screen's source mean a text that skipped this
    // file. Comments are not text.
    const roots = ["components/discover", "app/discover"];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
      }
    };
    for (const root of roots) walk(root);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      expect(ARABIC.test(code), file).toBe(false);
      expect(OTHER_PRODUCT.test(code), file).toBe(false);
    }
  });
});
