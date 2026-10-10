import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiAuthError,
  AiInvalidRequestError,
  AiRateLimitError,
  classifyAiError,
  isPermanentAiError,
} from "../types";
import { aiGateState, resetAiGateForTests } from "../gate";
import {
  backoffWithJitter,
  classifyStatus,
  isGatewayBusy,
  isRetryableStatus,
  omnirouteProvider,
} from "./omniroute";

const ENV_KEYS = [
  "OMNIROUTE_API_KEY",
  "OMNIROUTE_BASE_URL",
  "OMNIROUTE_DEFAULT_MODEL",
  "OMNIROUTE_FALLBACK_MODELS",
  "OMNIROUTE_VISION_MODEL",
  "OMNIROUTE_VISION_FALLBACK_MODELS",
] as const;

const messages = [{ role: "user" as const, content: "hello" }];

function okResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: "x",
      created: 0,
      model,
      choices: [
        {
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
    }),
    { status: 200 }
  );
}

describe("retry policy helpers", () => {
  it("backoff grows exponentially and stays within its jitter band", () => {
    for (const attempt of [0, 1, 2, 3]) {
      const full = 500 * 2 ** attempt;
      expect(backoffWithJitter(attempt, 500, () => 0)).toBe(full / 2);
      expect(backoffWithJitter(attempt, 500, () => 0.999999)).toBeLessThan(
        full + 1
      );
    }
  });

  it("only 502/503/504 are retried on the same model", () => {
    expect([500, 502, 503, 504, 429, 400, 401].map(isRetryableStatus)).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("classifies statuses", () => {
    expect(classifyStatus(401)).toBe("auth");
    expect(classifyStatus(403)).toBe("auth");
    expect(classifyStatus(429)).toBe("rate_limit");
    expect(classifyStatus(503)).toBe("upstream");
    expect(classifyStatus(400)).toBe("invalid_request");
  });

  it("auth and invalid requests are permanent; rate limits are not", () => {
    expect(isPermanentAiError(new AiAuthError("x"))).toBe(true);
    expect(isPermanentAiError(new AiInvalidRequestError("x"))).toBe(true);
    expect(isPermanentAiError(new AiRateLimitError("x"))).toBe(false);
    expect(isPermanentAiError(new Error("x"))).toBe(false);
    expect(classifyAiError(new AiRateLimitError("x"))).toBe("rate_limit");
  });
});

describe("OmniRoute failure handling across the model chain", () => {
  const saved: Record<string, string | undefined> = {};
  let requested: string[];

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.OMNIROUTE_API_KEY = "test-key";
    process.env.OMNIROUTE_BASE_URL = "https://omni.test/v1";
    process.env.OMNIROUTE_DEFAULT_MODEL = "m/a";
    process.env.OMNIROUTE_FALLBACK_MODELS = "m/b, m/c";
    delete process.env.OMNIROUTE_VISION_MODEL;
    delete process.env.OMNIROUTE_VISION_FALLBACK_MODELS;
    requested = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetAiGateForTests();
  });

  function stub(byModel: Record<string, () => Response>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const model = JSON.parse(String(init.body)).model as string;
        requested.push(model);
        return (byModel[model] ?? (() => okResponse(model)))();
      })
    );
  }

  it("401 stops the chain at once — the key is shared by every model", async () => {
    stub({ "m/a": () => new Response("no", { status: 401 }) });
    await expect(
      omnirouteProvider.generateText({ messages, model: "m/a" })
    ).rejects.toBeInstanceOf(AiAuthError);
    expect(requested).toEqual(["m/a"]);
  });

  it("429 is never resent to the same model; the next model answers", async () => {
    stub({ "m/a": () => new Response("slow", { status: 429 }) });
    const result = await omnirouteProvider.generateText({
      messages,
      model: "m/a",
    });
    expect(result.model).toBe("m/b");
    expect(requested).toEqual(["m/a", "m/b"]);
  });

  it("a plain 500 moves on without a same-model retry", async () => {
    stub({ "m/a": () => new Response("boom", { status: 500 }) });
    await omnirouteProvider.generateText({ messages, model: "m/a" });
    expect(requested).toEqual(["m/a", "m/b"]);
  });

  it("503 is retried once on the same model before moving on", async () => {
    stub({ "m/a": () => new Response("down", { status: 503 }) });
    await omnirouteProvider.generateText({ messages, model: "m/a" });
    expect(requested).toEqual(["m/a", "m/a", "m/b"]);
  });

  const busy = () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Chat admission capacity is temporarily unavailable.",
          code: "chat_admission_busy",
        },
      }),
      { status: 503 }
    );

  it("tells a busy gateway from a model that is down", () => {
    expect(isGatewayBusy(503, '{"error":{"code":"chat_admission_busy"}}')).toBe(
      true
    );
    expect(isGatewayBusy(503, "down")).toBe(false);
    expect(isGatewayBusy(500, "chat_admission_busy")).toBe(false);
  });

  it("a busy gateway is waited out on the same model — no fallback, no failed model", async () => {
    vi.useFakeTimers();
    let calls = 0;
    stub({ "m/a": () => (++calls <= 2 ? busy() : okResponse("m/a")) });
    const result = omnirouteProvider.generateText({ messages, model: "m/a" });
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(result).resolves.toMatchObject({ content: "ok" });
    // One request per wait, and the dearer models were never asked.
    expect(requested).toEqual(["m/a", "m/a", "m/a"]);
    expect(
      vi
        .mocked(console.warn)
        .mock.calls.some(call => String(call[0]).includes('"status":"error"'))
    ).toBe(false);
  });

  it("a gateway that stays busy ends as a rate limit for the queue to bring back", async () => {
    vi.useFakeTimers();
    stub({ "m/a": busy });
    const result = omnirouteProvider
      .generateText({ messages, model: "m/a" })
      .catch(e => e);
    await vi.advanceTimersByTimeAsync(120_000);
    const error = await result;
    expect(error).toBeInstanceOf(AiRateLimitError);
    expect((error as AiRateLimitError).retryAfterMs).toBe(30_000);
    expect(requested).toEqual(["m/a", "m/a", "m/a", "m/a", "m/a"]);
    expect(aiGateState().inFlight).toBe(0);
  });

  it("every model rate-limited surfaces as a rate limit with Retry-After", async () => {
    const limited = () =>
      new Response("slow", { status: 429, headers: { "retry-after": "7" } });
    stub({ "m/a": limited, "m/b": limited, "m/c": limited });
    const error = await omnirouteProvider
      .generateText({ messages, model: "m/a" })
      .catch(e => e);
    expect(error).toBeInstanceOf(AiRateLimitError);
    expect((error as AiRateLimitError).retryAfterMs).toBe(7000);
    expect(requested).toEqual(["m/a", "m/b", "m/c"]);
  });

  it("an invalid request on every model is permanent", async () => {
    const bad = () => new Response("bad", { status: 400 });
    stub({ "m/a": bad, "m/b": bad, "m/c": bad });
    const error = await omnirouteProvider
      .generateText({ messages, model: "m/a" })
      .catch(e => e);
    expect(error).toBeInstanceOf(AiInvalidRequestError);
    expect(isPermanentAiError(error)).toBe(true);
  });
});
