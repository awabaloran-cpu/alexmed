import { describe, expect, it } from "vitest";
import { errorKey, REASON_KEYS, ROOMS_MESSAGES, translate } from "./i18n";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe("the rooms' two languages", () => {
  const arabic = ROOMS_MESSAGES.ar;
  const english = ROOMS_MESSAGES.en;

  it("every sentence exists in both, and none is empty", () => {
    expect(Object.keys(english).sort()).toEqual(Object.keys(arabic).sort());
    for (const [key, text] of [
      ...Object.entries(arabic),
      ...Object.entries(english),
    ]) {
      expect(text.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("both versions of a sentence take the same values", () => {
    for (const key of Object.keys(arabic) as (keyof typeof arabic)[]) {
      expect(placeholders(english[key]), key).toEqual(
        placeholders(arabic[key])
      );
    }
  });

  it("the English is English and the Arabic is Arabic", () => {
    // The three language names are written in their own script on purpose.
    const ownScript = new Set(["lang.ar", "lang.en", "lang.mixed"]);
    for (const [key, text] of Object.entries(english)) {
      if (ownScript.has(key)) continue;
      expect(/[؀-ۿ]/.test(text), key).toBe(false);
    }
    for (const [key, text] of Object.entries(arabic)) {
      if (ownScript.has(key)) continue;
      expect(/[؀-ۿ]/.test(text), key).toBe(true);
    }
  });

  it("fills values and leaves an unknown one visible", () => {
    expect(translate("en", "card.members", { n: 4, max: 8 })).toBe("4 of 8");
    expect(translate("ar", "card.members", { n: 4, max: 8 })).toBe("4 من 8");
    expect(translate("en", "card.members", { n: 4 })).toBe("4 of {max}");
  });

  it("every refusal of the server has its sentence", () => {
    for (const [reason, key] of Object.entries(REASON_KEYS)) {
      expect(errorKey(reason)).toBe(key);
      expect(arabic[key]).toBeTruthy();
    }
    expect(errorKey("something_new")).toBe("error.unknown");
    expect(errorKey(undefined)).toBe("error.unknown");
  });
});
