// Single place that reads AI-related env vars, so no other file in the
// codebase touches these `process.env.*` names directly.
export type ProviderName = "gemini" | "omniroute" | "openrouter";

export function resolveProvider(): ProviderName {
  const configured = process.env.LLM_PROVIDER?.trim().toLowerCase();

  if (configured === "gemini") {
    if (geminiReady()) return "gemini";
    const fallback = omniRouteConfig.apiKey ? "omniroute" : "openrouter";
    console.warn(
      `[AI] LLM_PROVIDER=gemini but GEMINI_API_KEY or GEMINI_DEFAULT_MODEL is missing — falling back to ${fallback}`
    );
    return fallback;
  }

  if (configured === "omniroute") {
    if (!omniRouteConfig.apiKey) {
      console.warn(
        "[AI] LLM_PROVIDER=omniroute but OMNIROUTE_API_KEY is missing — falling back to openrouter"
      );
      return "openrouter";
    }
    return "omniroute";
  }

  if (configured === "openrouter") return "openrouter";

  // LLM_PROVIDER unset/unrecognized: Google directly once its key and model
  // are set, then OmniRoute once it's configured, otherwise OpenRouter.
  if (geminiReady()) return "gemini";
  return omniRouteConfig.apiKey ? "omniroute" : "openrouter";
}

// Both are needed: without a model the provider would have to guess one
// from Google's list, which also holds models that cannot chat.
function geminiReady(): boolean {
  return !!(geminiConfig.apiKey && geminiConfig.defaultModel);
}

// Google's Gemini API reached directly through its OpenAI-compatible
// endpoint — no gateway in between. Model ids are Google's own
// ("gemini-3.1-flash"); an OmniRoute-style "gemini/…" prefix is accepted
// and dropped, so the ids already in OMNIROUTE_* variables carry over.
export const geminiConfig = {
  get baseUrl() {
    return (
      process.env.GEMINI_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta/openai"
    ).replace(/\/+$/, "");
  },
  get apiKey() {
    return process.env.GEMINI_API_KEY?.trim() || undefined;
  },
  get defaultModel() {
    return process.env.GEMINI_DEFAULT_MODEL?.trim() || undefined;
  },
  // Same roles as the OMNIROUTE_* lists above, tried in order.
  get fallbackModels() {
    return parseModelList(process.env.GEMINI_FALLBACK_MODELS);
  },
  get visionModel() {
    return process.env.GEMINI_VISION_MODEL?.trim() || undefined;
  },
  get visionFallbackModels() {
    return parseModelList(process.env.GEMINI_VISION_FALLBACK_MODELS);
  },
  get fastTextModel() {
    return process.env.GEMINI_FAST_TEXT_MODEL?.trim() || undefined;
  },
  // Thinking is billed and counted inside max_tokens (see
  // geminiReasoningEffort above). GEMINI_REASONING_EFFORT overrides the
  // per-model default below; "default" sends nothing.
  get reasoningEffort() {
    return process.env.GEMINI_REASONING_EFFORT?.trim().toLowerCase() || undefined;
  },
};

// The id Google's API expects for a configured model id. Exported for tests.
export function geminiApiModel(model: string): string {
  return model.trim().replace(/^(gemini|google|models)\//i, "");
}

// How much a model reached directly may think before it answers. Google's
// OpenAI-compatible endpoint takes "none" (no thinking) only for the 2.5
// models; the 3.x models cannot switch thinking off, and "minimal" is their
// smallest level. Exported for tests.
export function geminiReasoningEffortFor(model: string): string | undefined {
  const configured = geminiConfig.reasoningEffort;
  if (configured) return configured === "default" ? undefined : configured;
  const id = geminiApiModel(model).toLowerCase();
  if (/^gemini-2\.5-pro/.test(id)) return "low";
  if (/^gemini-2\.5-/.test(id)) return "none";
  return "minimal";
}

export const omniRouteConfig = {
  get baseUrl() {
    return (
      process.env.OMNIROUTE_BASE_URL ||
      "https://omniroute-noodeenv.up.railway.app/v1"
    ).replace(/\/+$/, "");
  },
  get apiKey() {
    return process.env.OMNIROUTE_API_KEY?.trim() || undefined;
  },
  get defaultModel() {
    return process.env.OMNIROUTE_DEFAULT_MODEL?.trim() || undefined;
  },
  // Comma-separated concrete model ids tried in order, after defaultModel,
  // when a call has no explicit model and the previous one fails — OmniRoute's
  // own "auto/*" routing has been observed picking a provider with no active
  // credentials for vision requests, so falling back to another "auto/*"
  // alias wouldn't help; these need to be concrete provider/model ids.
  get fallbackModels() {
    return parseModelList(process.env.OMNIROUTE_FALLBACK_MODELS);
  },
  // Separate chain for requests that carry an image (OCR, page-visual
  // analysis, question-image classification). Many strong text models are
  // text-only — measured 2026-09-24: grok-cli/*, nemotron-3-super, glm-5.3
  // and gpt-oss-20b all ignore or reject images — so letting the text
  // default also serve images makes OCR fail (or silently read nothing).
  // Unset = today's behavior (images use the text chain).
  get visionModel() {
    return process.env.OMNIROUTE_VISION_MODEL?.trim() || undefined;
  },
  get visionFallbackModels() {
    return parseModelList(process.env.OMNIROUTE_VISION_FALLBACK_MODELS);
  },
  // Fast, cheap text model for short interactive answers (the PDF reader's
  // "اسأل AI" on selected text) — e.g. grok-cli/grok-4.6: fast and free but
  // text-only and slow on very long generations, so it's NOT the default
  // for chapter analysis. Its failures still fall back through
  // OMNIROUTE_FALLBACK_MODELS. Unset = the default model.
  get fastTextModel() {
    return process.env.OMNIROUTE_FAST_TEXT_MODEL?.trim() || undefined;
  },
  // How much hidden "thinking" a Google model reached directly ("gemini/…")
  // may do before it answers. The thinking is billed and counted inside
  // max_tokens: measured 2026-10-10 on gemini-3.1-flash-lite, a question's
  // explanation spent 1,533 of its 1,600 tokens thinking and came back as
  // 156 characters of cut-off JSON — every question of a file failed.
  // "none" answers the same question whole in ~300 tokens. Set
  // OMNIROUTE_GEMINI_REASONING_EFFORT to low/medium/high for a model that
  // cannot switch thinking off, or to "default" to send nothing.
  get geminiReasoningEffort() {
    const value = process.env.OMNIROUTE_GEMINI_REASONING_EFFORT?.trim();
    if (!value) return "none";
    return value.toLowerCase() === "default" ? undefined : value.toLowerCase();
  },
};

// The reasoning effort to send with a call to this model, if any. Only the
// models Google serves directly take it; every other provider behind the
// gateway is sent exactly what it was sent before.
export function reasoningEffortFor(model: string): string | undefined {
  return /^gemini\//i.test(model)
    ? omniRouteConfig.geminiReasoningEffort
    : undefined;
}

function parseModelList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(model => model.trim())
    .filter(Boolean);
}

export const openRouterConfig = {
  get apiKey() {
    return process.env.OPENROUTER_API_KEY?.trim() || undefined;
  },
};
