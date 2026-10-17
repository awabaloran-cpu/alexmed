// OmniRoute provider — a self-hosted OpenAI-compatible AI gateway (Railway),
// picked by LLM_PROVIDER=omniroute (see lib/ai/config.ts's
// resolveProvider()). The client itself, with its fallback chain, circuit
// breaker and retries, is shared with the direct Gemini provider in
// ./chat-completions.ts; this file only says where OmniRoute is and which
// models to use.
import { omniRouteConfig, reasoningEffortFor } from "../config";
import {
  candidateChain,
  createChatCompletionsProvider,
} from "./chat-completions";

export {
  backoffWithJitter,
  classifyStatus,
  collectStreamedResponse,
  containsJsonObject,
  isGatewayBusy,
  isRetryableStatus,
} from "./chat-completions";

// Ordered models to try: the resolved primary, then
// OMNIROUTE_VISION_FALLBACK_MODELS for image requests (when set) or
// OMNIROUTE_FALLBACK_MODELS. Exported for tests.
export function candidateModels(
  primaryModel: string,
  needsVision: boolean
): string[] {
  return candidateChain(
    primaryModel,
    needsVision,
    omniRouteConfig.fallbackModels,
    omniRouteConfig.visionFallbackModels
  );
}

export const omnirouteProvider = createChatCompletionsProvider({
  name: "omniroute",
  label: "OmniRoute",
  apiKeyEnv: "OMNIROUTE_API_KEY",
  baseUrlEnv: "OMNIROUTE_BASE_URL",
  defaultModelEnv: "OMNIROUTE_DEFAULT_MODEL",
  baseUrl: () => omniRouteConfig.baseUrl,
  apiKey: () => omniRouteConfig.apiKey,
  defaultModel: () => omniRouteConfig.defaultModel,
  visionModel: () => omniRouteConfig.visionModel,
  fallbackModels: () => omniRouteConfig.fallbackModels,
  visionFallbackModels: () => omniRouteConfig.visionFallbackModels,
  reasoningEffortFor,
});
