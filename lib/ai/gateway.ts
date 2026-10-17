// Central AI gateway. Every AI call in this app goes through the functions
// here (generateText/generateJSON/streamText/embed/listModels) instead of
// any page/route talking to a provider directly — resolveProvider() picks
// Gemini, OmniRoute or OpenRouter per lib/ai/config.ts, so callers never
// know which one actually served the request.
import { resolveProvider } from "./config";
import { geminiProvider } from "./providers/gemini";
import { omnirouteProvider } from "./providers/omniroute";
import { openrouterProvider } from "./providers/openrouter";
import type {
  AiProvider,
  EmbedParams,
  EmbedResult,
  GenerateParams,
  GenerateResult,
  ModelInfo,
  StreamChunk,
} from "./types";

function getProvider(): AiProvider {
  const provider = resolveProvider();
  if (provider === "gemini") return geminiProvider;
  return provider === "omniroute" ? omnirouteProvider : openrouterProvider;
}

export async function generateText(
  params: GenerateParams
): Promise<GenerateResult> {
  return getProvider().generateText(params);
}

/** Same call shape as generateText — named separately so call sites that
 * expect structured JSON output (params.responseFormat.type === "json_schema")
 * read clearly at the call site. */
export async function generateJSON(
  params: GenerateParams
): Promise<GenerateResult> {
  return getProvider().generateText(params);
}

export async function* streamText(
  params: GenerateParams
): AsyncGenerator<StreamChunk, void, void> {
  yield* getProvider().streamText(params);
}

export async function listModels(): Promise<ModelInfo[]> {
  return getProvider().listModels();
}

export async function embed(params: EmbedParams): Promise<EmbedResult> {
  const provider = getProvider();
  if (!provider.embed) {
    throw new Error(
      `embed() is not supported by the active AI provider (${resolveProvider()})`
    );
  }
  return provider.embed(params);
}

export { resolveProvider } from "./config";
export * from "./types";
