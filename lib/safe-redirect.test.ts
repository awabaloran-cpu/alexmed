import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./safe-redirect";

describe("safeCallbackUrl", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeCallbackUrl("/books/abc")).toBe("/books/abc");
    expect(safeCallbackUrl("/connect/tok?error=x")).toBe("/connect/tok?error=x");
  });

  it("falls back to the app home for anything that could leave the site", () => {
    for (const value of [
      null,
      undefined,
      "",
      "books",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "javascript:alert(1)",
      "/ok\nLocation: https://evil.example",
    ]) {
      expect(safeCallbackUrl(value)).toBe("/subjects");
    }
  });
});
