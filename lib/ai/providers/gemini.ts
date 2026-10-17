// Gemini provider — Google's Gemini API reached directly through its
// OpenAI-compatible endpoint, picked by LLM_PROVIDER=gemini (or by
// GEMINI_API_KEY alone when LLM_PROVIDER is unset; see lib/ai/config.ts).
// No gateway in between: the same client as OmniRoute
// (./chat-completions.ts), with Google's address, key and models.
import {
  geminiApiModel,
  geminiConfig,
  geminiReasoningEffortFor,
} from "../config";
import { createChatCompletionsProvider } from "./chat-completions";

export const geminiProvider = createChatCompletionsProvider({
  name: "gemini",
  label: "Gemini",
  apiKeyEnv: "GEMINI_API_KEY",
  baseUrlEnv: "GEMINI_BASE_URL",
  defaultModelEnv: "GEMINI_DEFAULT_MODEL",
  baseUrl: () => geminiConfig.baseUrl,
  apiKey: () => geminiConfig.apiKey,
  defaultModel: () => geminiConfig.defaultModel,
  visionModel: () => geminiConfig.visionModel,
  fallbackModels: () => geminiConfig.fallbackModels,
  visionFallbackModels: () => geminiConfig.visionFallbackModels,
  reasoningEffortFor: geminiReasoningEffortFor,
  apiModel: geminiApiModel,
});
