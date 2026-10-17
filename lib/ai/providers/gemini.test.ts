import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geminiApiModel, geminiReasoningEffortFor } from "../config";
import { geminiProvider } from "./gemini";

const ENV_KEYS = [
  "GEMINI_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_DEFAULT_MODEL",
  "GEMINI_FALLBACK_MODELS",
  "GEMINI_VISION_MODEL",
  "GEMINI_VISION_FALLBACK_MODELS",
  "GEMINI_REASONING_EFFORT",
] as const;

const textMessages = [{ role: "user" as const, content: "hello" }];
const imageMessages = [
  {
    role: "user" as const,
    content: [
      { type: "text" as const, text: "Transcribe this page." },
      {
        type: "image_url" as const,
        image_url: { url: "data:image/png;base64,AAAA" },
      },
    ],
  },
];

function okResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: "x",
      created: 0,
      model,
      choices: [
        {
          message: { role: "assistant", content: '{"ok":true}' },
          finish_reason: "stop",
        },
      ],
    }),
    { status: 200 }
  );
}

describe("geminiApiModel", () => {
  it("drops an OmniRoute-style prefix and keeps Google's own ids", () => {
    expect(geminiApiModel("gemini/gemini-3.1-flash")).toBe("gemini-3.1-flash");
    expect(geminiApiModel("models/gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(geminiApiModel(" gemini-3.1-flash-lite ")).toBe(
      "gemini-3.1-flash-lite"
    );
  });
});

describe("geminiReasoningEffortFor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("thinks as little as each model allows by default", () => {
    vi.stubEnv("GEMINI_REASONING_EFFORT", "");
    // 3.x cannot switch thinking off; "minimal" is its smallest level.
    expect(geminiReasoningEffortFor("gemini-3.1-flash")).toBe("minimal");
    expect(geminiReasoningEffortFor("gemini/gemini-3.1-flash-lite")).toBe(
      "minimal"
    );
    // 2.5 Flash can, and 2.5 Pro cannot.
    expect(geminiReasoningEffortFor("gemini-2.5-flash")).toBe("none");
    expect(geminiReasoningEffortFor("gemini-2.5-flash-lite")).toBe("none");
    expect(geminiReasoningEffortFor("gemini-2.5-pro")).toBe("low");
  });

  it("GEMINI_REASONING_EFFORT overrides it, and 'default' sends nothing", () => {
    vi.stubEnv("GEMINI_REASONING_EFFORT", " Low ");
    expect(geminiReasoningEffortFor("gemini-3.1-flash")).toBe("low");
    vi.stubEnv("GEMINI_REASONING_EFFORT", "default");
    expect(geminiReasoningEffortFor("gemini-3.1-flash")).toBeUndefined();
  });
});

describe("Gemini provider", () => {
  const saved: Record<string, string | undefined> = {};
  let calls: Array<{ url: string; auth: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.GEMINI_API_KEY = "test-gemini-key";
    delete process.env.GEMINI_BASE_URL;
    process.env.GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-t1";
    process.env.GEMINI_FALLBACK_MODELS = "gemini-2.5-flash-t1";
    delete process.env.GEMINI_VISION_MODEL;
    delete process.env.GEMINI_VISION_FALLBACK_MODELS;
    delete process.env.GEMINI_REASONING_EFFORT;
    calls = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Every model fails with `status` except `succeedOn`.
  function stubFetch(succeedOn: string, status = 500) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const auth = (init.headers as Record<string, string>).authorization;
        calls.push({ url, auth, body });
        return body.model === succeedOn
          ? okResponse(String(body.model))
          : new Response("down", { status });
      })
    );
  }

  it("calls Google directly with its key, Google's model id and minimal thinking", async () => {
    stubFetch("gemini-3.1-flash-t1");
    const result = await geminiProvider.generateText({
      model: "gemini/gemini-3.1-flash-t1",
      messages: textMessages,
      maxTokens: 1600,
      responseFormat: { type: "json_object" },
    });
    expect(result.content).toBe('{"ok":true}');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    );
    expect(calls[0].auth).toBe("Bearer test-gemini-key");
    expect(calls[0].body).toMatchObject({
      model: "gemini-3.1-flash-t1",
      max_tokens: 1600,
      response_format: { type: "json_object" },
      reasoning_effort: "minimal",
      stream: true,
    });
  });

  it("a failing model falls through to GEMINI_FALLBACK_MODELS", async () => {
    process.env.GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-t2";
    process.env.GEMINI_FALLBACK_MODELS = "gemini-2.5-flash-t2";
    stubFetch("gemini-2.5-flash-t2");
    const result = await geminiProvider.generateText({
      model: "gemini-3.1-flash-t2",
      messages: textMessages,
    });
    expect(result.model).toBe("gemini-2.5-flash-t2");
    expect(calls.map(c => c.body.model)).toEqual([
      "gemini-3.1-flash-t2",
      "gemini-2.5-flash-t2",
    ]);
    // Each model gets its own thinking setting.
    expect(calls.map(c => c.body.reasoning_effort)).toEqual(["minimal", "none"]);
  });

  it("image requests use GEMINI_VISION_MODEL when it is set", async () => {
    process.env.GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-t3";
    process.env.GEMINI_VISION_MODEL = "gemini-3.1-pro-t3";
    stubFetch("gemini-3.1-pro-t3");
    await geminiProvider.generateText({
      model: "gemini-3.1-flash-t3",
      messages: imageMessages,
    });
    expect(calls[0].body.model).toBe("gemini-3.1-pro-t3");
  });

  it("a wrong key stops at once instead of trying every model", async () => {
    process.env.GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-t4";
    process.env.GEMINI_FALLBACK_MODELS = "gemini-2.5-flash-t4";
    stubFetch("none", 401);
    await expect(
      geminiProvider.generateText({
        model: "gemini-3.1-flash-t4",
        messages: textMessages,
      })
    ).rejects.toThrow("check GEMINI_API_KEY");
    expect(calls).toHaveLength(1);
  });
});
