import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  candidateModels,
  collectStreamedResponse,
  containsJsonObject,
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
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
    }),
    { status: 200 }
  );
}

describe("OmniRoute vision model chain", () => {
  const saved: Record<string, string | undefined> = {};
  let requestedModels: string[];

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.OMNIROUTE_API_KEY = "test-key";
    process.env.OMNIROUTE_BASE_URL = "https://omni.test/v1";
    process.env.OMNIROUTE_DEFAULT_MODEL = "nvidia/text-main";
    process.env.OMNIROUTE_FALLBACK_MODELS = "nvidia/text-b, nvidia/text-c";
    delete process.env.OMNIROUTE_VISION_MODEL;
    delete process.env.OMNIROUTE_VISION_FALLBACK_MODELS;
    requestedModels = [];
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

  // Every model fails with 503 except `succeedOn`, recording the order tried.
  function stubFetch(succeedOn?: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const model = JSON.parse(String(init.body)).model as string;
        requestedModels.push(model);
        return model === succeedOn
          ? okResponse(model)
          : new Response("down", { status: 503 });
      })
    );
  }

  it("without vision settings, image requests keep today's text chain", () => {
    expect(candidateModels("nvidia/text-main", true)).toEqual([
      "nvidia/text-main",
      "nvidia/text-b",
      "nvidia/text-c",
    ]);
  });

  it("text requests never use the vision chain", async () => {
    process.env.OMNIROUTE_VISION_MODEL = "nvidia/vision-main";
    process.env.OMNIROUTE_VISION_FALLBACK_MODELS = "nvidia/vision-b";
    stubFetch("nvidia/text-main");
    await omnirouteProvider.generateText({
      model: "nvidia/text-main",
      messages: textMessages,
    });
    expect(requestedModels).toEqual(["nvidia/text-main"]);
  });

  it("image requests go to the vision model, then the vision fallbacks", async () => {
    process.env.OMNIROUTE_VISION_MODEL = "nvidia/vision-main";
    process.env.OMNIROUTE_VISION_FALLBACK_MODELS =
      "nvidia/vision-b,nvidia/vision-c";
    stubFetch("nvidia/vision-c");
    const result = await omnirouteProvider.generateText({
      // Call sites pass the resolved default — not a real override.
      model: "nvidia/text-main",
      messages: imageMessages,
    });
    expect(result.model).toBe("nvidia/vision-c");
    expect(requestedModels.filter((m, i, a) => a.indexOf(m) === i)).toEqual([
      "nvidia/vision-main",
      "nvidia/vision-b",
      "nvidia/vision-c",
    ]);
    // A text-only model is never tried for an image.
    expect(requestedModels.some(m => m.startsWith("nvidia/text"))).toBe(false);
  });

  it("an explicit non-default model on an image request is respected", async () => {
    process.env.OMNIROUTE_VISION_MODEL = "nvidia/vision-main";
    stubFetch("gemini/explicit");
    await omnirouteProvider.generateText({
      model: "gemini/explicit",
      messages: imageMessages,
    });
    expect(requestedModels[0]).toBe("gemini/explicit");
  });

  // What each model was sent as reasoning_effort (undefined = not sent).
  async function effortSentTo(model: string) {
    const sent: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        sent[body.model] = body.reasoning_effort;
        return okResponse(body.model);
      })
    );
    await omnirouteProvider.generateText({ model, messages: textMessages });
    return sent[model];
  }

  it("a Google model is asked not to spend the answer's tokens thinking", async () => {
    const saved = process.env.OMNIROUTE_GEMINI_REASONING_EFFORT;
    try {
      delete process.env.OMNIROUTE_GEMINI_REASONING_EFFORT;
      expect(await effortSentTo("gemini/gemini-3.1-flash-lite")).toBe("none");
      process.env.OMNIROUTE_GEMINI_REASONING_EFFORT = " Low ";
      expect(await effortSentTo("gemini/gemini-3.1-flash-lite")).toBe("low");
      process.env.OMNIROUTE_GEMINI_REASONING_EFFORT = "default";
      expect(
        await effortSentTo("gemini/gemini-3.1-flash-lite")
      ).toBeUndefined();
    } finally {
      if (saved === undefined)
        delete process.env.OMNIROUTE_GEMINI_REASONING_EFFORT;
      else process.env.OMNIROUTE_GEMINI_REASONING_EFFORT = saved;
    }
  });

  it("every other provider is sent what it was sent before", async () => {
    expect(await effortSentTo("nvidia/text-main")).toBeUndefined();
    expect(
      await effortSentTo("openrouter/google/gemini-2.5-flash-lite")
    ).toBeUndefined();
  });
});

// generateText streams internally: OmniRoute cancels a non-streamed request
// whose response hasn't started within 30s, which every long generation hits.
describe("OmniRoute streamed generation", () => {
  function sse(...deltas: string[]) {
    const body =
      deltas
        .map(
          d =>
            `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`
        )
        .join("") + "data: [DONE]\n\n";
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OMNIROUTE_FALLBACK_MODELS;
  });

  it("assembles SSE deltas into one complete result", async () => {
    const result = await collectStreamedResponse(
      sse('{"flash', 'cards":', "[]}"),
      "m"
    );
    expect(result.content).toBe('{"flashcards":[]}');
    expect(result.model).toBe("m");
  });

  it("still accepts a plain JSON (non-streamed) answer", async () => {
    const res = new Response(
      JSON.stringify({
        id: "1",
        created: 0,
        model: "m",
        choices: [
          {
            message: { role: "assistant", content: "hi" },
            finish_reason: "stop",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
    expect((await collectStreamedResponse(res, "m")).content).toBe("hi");
  });

  it("requests stream:true, and an empty stream falls through to the next model", async () => {
    process.env.OMNIROUTE_API_KEY = "k";
    process.env.OMNIROUTE_BASE_URL = "https://omni.test/v1";
    process.env.OMNIROUTE_FALLBACK_MODELS = "model-b";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies: { model: string; stream: boolean }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        bodies.push({ model: body.model, stream: body.stream });
        return body.model === "model-a" ? sse() : sse("answer from b");
      })
    );
    const result = await omnirouteProvider.generateText({
      model: "model-a",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.content).toBe("answer from b");
    expect(bodies.map(b => b.model)).toEqual(["model-a", "model-b"]);
    expect(bodies.every(b => b.stream === true)).toBe(true);
  });
});

describe("OmniRoute JSON answers from reasoning models", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OMNIROUTE_FALLBACK_MODELS;
  });

  it("recognizes real JSON, fenced JSON and JSON after prose", () => {
    expect(containsJsonObject('{"a":1}')).toBe(true);
    expect(containsJsonObject('```json\n{"a":1}\n```')).toBe(true);
    expect(containsJsonObject('Sure:\n{"a":[1,2]}')).toBe(true);
    expect(containsJsonObject("We need to organize the sections...")).toBe(
      false
    );
    expect(containsJsonObject("{}")).toBe(false);
  });

  it("a JSON request answered with reasoning prose moves to the next model", async () => {
    process.env.OMNIROUTE_API_KEY = "k";
    process.env.OMNIROUTE_BASE_URL = "https://omni.test/v1";
    process.env.OMNIROUTE_FALLBACK_MODELS = "model-b";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tried: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const model = JSON.parse(String(init.body)).model as string;
        tried.push(model);
        const content =
          model === "model-a" ? "We need to think first..." : '{"ok":true}';
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { "content-type": "text/event-stream" } }
        );
      })
    );
    const result = await omnirouteProvider.generateText({
      model: "model-a",
      messages: [{ role: "user", content: "json please" }],
      responseFormat: { type: "json_object" },
    });
    expect(tried).toEqual(["model-a", "model-b"]);
    expect(result.content).toBe('{"ok":true}');
  });
});
