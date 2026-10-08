import { describe, expect, it } from "vitest";
import {
  AiAuthError,
  AiCircuitOpenError,
  AiInvalidRequestError,
  AiRateLimitError,
  AiTimeoutError,
  AiUpstreamError,
  transientAiRetryDelaySeconds,
} from "./types";

describe("transientAiRetryDelaySeconds", () => {
  it("backs off 30s, 90s, 270s over a page's attempts, capped at 300s", () => {
    const down = new AiUpstreamError("502");
    expect(transientAiRetryDelaySeconds(down, 1)).toBe(30);
    expect(transientAiRetryDelaySeconds(down, 2)).toBe(90);
    expect(transientAiRetryDelaySeconds(down, 3)).toBe(270);
    expect(transientAiRetryDelaySeconds(down, 4)).toBe(300);
  });

  it("waits as long as the failure asks when that is longer", () => {
    expect(
      transientAiRetryDelaySeconds(new AiCircuitOpenError("open", 60_000), 1)
    ).toBe(60);
    expect(
      transientAiRetryDelaySeconds(new AiRateLimitError("429", 20_000), 1)
    ).toBe(30);
  });

  it("treats timeouts and network failures as passing too", () => {
    expect(transientAiRetryDelaySeconds(new AiTimeoutError("slow"), 1)).toBe(
      30
    );
    expect(transientAiRetryDelaySeconds(new TypeError("fetch failed"), 1)).toBe(
      30
    );
  });

  it("does not wait for a failure that would repeat", () => {
    expect(transientAiRetryDelaySeconds(new AiAuthError("401"), 1)).toBeNull();
    expect(
      transientAiRetryDelaySeconds(new AiInvalidRequestError("400"), 1)
    ).toBeNull();
    expect(
      transientAiRetryDelaySeconds(new Error("unreadable answer"), 1)
    ).toBeNull();
  });
});
