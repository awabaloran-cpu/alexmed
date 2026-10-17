/**
 * Backward-compatible shim over lib/ai/gateway.ts. All AI provider logic now
 * lives under lib/ai/ (Gemini, OmniRoute and OpenRouter providers behind one
 * gateway);
 * this file just adapts the existing call sites' shapes onto it so none of
 * them need to change: lib/pdf-cards.ts, app/api/pdf/{generate,ocr}/route.ts,
 * app/api/models/route.ts.
 */
import {
  generateText as gatewayGenerateText,
  listModels as gatewayListModels,
} from "./ai/gateway";
// From config, not the gateway: this file runs resolveProvider() while it
// loads, and lib/db → lib/pdf-cards → this file can be reached while the
// gateway itself is still loading (its providers import lib/db).
import { geminiConfig, omniRouteConfig, resolveProvider } from "./ai/config";
import {
  DEFAULT_TEXT_MODEL as OPENROUTER_DEFAULT_TEXT_MODEL,
  DEFAULT_VISION_MODEL as OPENROUTER_DEFAULT_VISION_MODEL,
} from "./ai/providers/openrouter";
import type {
  ImageContent,
  JsonSchema,
  Message,
  MessageContent,
  ModelInfo,
  ResponseFormat,
  TextContent,
} from "./ai/types";

export type {
  ImageContent,
  JsonSchema,
  Message,
  MessageContent,
  ResponseFormat,
  TextContent,
};

// Resolved once per process, same as before — the active provider is fixed
// by env vars for the lifetime of the server, so this doesn't need to be
// re-evaluated per request. An empty string for OmniRoute (no
// OMNIROUTE_DEFAULT_MODEL configured) is a deliberate signal, not a bug: the
// OmniRoute provider treats a missing model as "pick a real one from the
// live /v1/models list" (lib/ai/providers/omniroute.ts's resolveModel) rather
// than this file inventing a model id it can't verify exists.
function resolveDefaultModel(kind: "text" | "vision"): string {
  // Same rules for Google reached directly, with its own GEMINI_* models.
  if (resolveProvider() === "gemini") {
    if (kind === "vision" && geminiConfig.visionModel) {
      return geminiConfig.visionModel;
    }
    return geminiConfig.defaultModel ?? "";
  }
  if (resolveProvider() === "omniroute") {
    // Image call sites (OCR, page visuals, question images) get their own
    // model when OMNIROUTE_VISION_MODEL is set — see lib/ai/config.ts.
    if (kind === "vision" && omniRouteConfig.visionModel) {
      return omniRouteConfig.visionModel;
    }
    return omniRouteConfig.defaultModel ?? "";
  }
  return kind === "vision"
    ? OPENROUTER_DEFAULT_VISION_MODEL
    : OPENROUTER_DEFAULT_TEXT_MODEL;
}

export const DEFAULT_TEXT_MODEL = resolveDefaultModel("text");
export const DEFAULT_VISION_MODEL = resolveDefaultModel("vision");
// Short interactive answers (see omniRouteConfig.fastTextModel).
function resolveFastTextModel(): string {
  const provider = resolveProvider();
  if (provider === "gemini" && geminiConfig.fastTextModel) {
    return geminiConfig.fastTextModel;
  }
  if (provider === "omniroute" && omniRouteConfig.fastTextModel) {
    return omniRouteConfig.fastTextModel;
  }
  return DEFAULT_TEXT_MODEL;
}
export const FAST_TEXT_MODEL = resolveFastTextModel();

export type InvokeParams = {
  messages: Message[];
  model?: string;
  max_tokens?: number;
  maxTokens?: number;
  response_format?: ResponseFormat;
  responseFormat?: ResponseFormat;
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const responseFormat = params.response_format ?? params.responseFormat;
  const maxTokens = params.max_tokens ?? params.maxTokens;
  const model = params.model?.trim() || undefined;

  const result = await gatewayGenerateText({
    messages: params.messages,
    model,
    maxTokens,
    responseFormat,
  });

  return {
    id: result.id,
    created: result.created,
    model: result.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.content },
        finish_reason: result.finishReason,
      },
    ],
    usage: result.usage
      ? {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.totalTokens,
        }
      : undefined,
  };
}

export type OpenRouterModel = ModelInfo;

/** Provider-aware now (was OpenRouter-only) — reflects whichever gateway
 * provider is actually active, per lib/ai/config.ts's resolveProvider(). Name
 * kept for app/api/models/route.ts's existing import. */
export async function listOpenRouterModels(): Promise<ModelInfo[]> {
  return gatewayListModels();
}
