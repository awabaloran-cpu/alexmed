// Shared request/response shapes for the AI gateway (lib/ai/gateway.ts) and
// its providers (lib/ai/providers/*). Field names match what the OpenAI-
// compatible chat-completions API speaks, since every provider here is one.

export type TextContent = { type: "text"; text: string };
export type ImageContent = {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
};
export type MessageContent = string | TextContent | ImageContent;
export type Message = {
  role: "system" | "user" | "assistant";
  content: MessageContent | MessageContent[];
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

export type GenerateParams = {
  messages: Message[];
  model?: string;
  maxTokens?: number;
  responseFormat?: ResponseFormat;
};

export type GenerateResult = {
  id: string;
  created: number;
  model: string;
  content: string;
  finishReason: string | null;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

export type StreamChunk = { delta: string; done: boolean };

export type ModelInfo = {
  id: string;
  name: string;
  isFree: boolean;
  supportsImages: boolean;
  contextLength: number;
};

export type EmbedParams = { input: string | string[]; model?: string };
export type EmbedResult = { embeddings: number[][]; model: string };

// Thrown by a provider when the upstream gateway/model returns 429, so route
// handlers can tell "genuinely rate-limited, worth waiting and retrying" apart
// from other failures (bad request, provider outage, ...) instead of treating
// every invokeLLM() failure the same way.
export class AiRateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs = 20_000) {
    super(message);
    this.name = "AiRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

// The rest of the failure taxonomy, so callers (queue workers above all)
// can tell a failure worth retrying from one that will fail the same way
// every time:
//   transient  — AiUpstreamError (5xx), AiTimeoutError, AiCircuitOpenError,
//                and AiRateLimitError above: retry later, with backoff.
//   permanent  — AiAuthError (401/403: the one shared gateway key is wrong
//                or revoked, so every model fails the same way) and
//                AiInvalidRequestError (the request itself was rejected):
//                retrying only repeats the failure and the spend.
export class AiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiAuthError";
  }
}

export class AiInvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiInvalidRequestError";
  }
}

export class AiUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUpstreamError";
  }
}

export class AiTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTimeoutError";
  }
}

// Every candidate model's circuit is open (lib/ai/circuit-breaker.ts):
// nothing was sent upstream. Transient — the circuits close again after
// their cooldown.
export class AiCircuitOpenError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs = 30_000) {
    super(message);
    this.name = "AiCircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

export type AiErrorType =
  | "rate_limit"
  | "timeout"
  | "upstream"
  | "network"
  | "circuit_open"
  | "auth"
  | "invalid_request"
  | "unknown";

export function classifyAiError(error: unknown): AiErrorType {
  if (error instanceof AiRateLimitError) return "rate_limit";
  if (error instanceof AiTimeoutError) return "timeout";
  if (error instanceof AiUpstreamError) return "upstream";
  if (error instanceof AiCircuitOpenError) return "circuit_open";
  if (error instanceof AiAuthError) return "auth";
  if (error instanceof AiInvalidRequestError) return "invalid_request";
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "timeout";
    if (error.name === "TypeError" || error.name === "AbortError")
      return "network";
  }
  return "unknown";
}

// Retrying these repeats the same failure (and, for invalid requests, the
// same spend) — a worker should fail the job right away instead.
export function isPermanentAiError(error: unknown): boolean {
  const type = classifyAiError(error);
  return type === "auth" || type === "invalid_request";
}

// How long a transient failure asks the caller to wait before retrying, if
// the failure said so (Retry-After, circuit cooldown); undefined otherwise.
export function aiRetryAfterMs(error: unknown): number | undefined {
  if (error instanceof AiRateLimitError) return error.retryAfterMs;
  if (error instanceof AiCircuitOpenError) return error.retryAfterMs;
  return undefined;
}

// For a worker that walks many small items (the pages of a file) and gives
// each a few attempts: after a transient failure, how many seconds to stop
// for before the next attempt — 30s, 90s, 270s, or longer if the failure
// asked for it. null when the failure is not transient (waiting would not
// help). Live, 2026-10-08: with the vision model's circuit open, such a
// worker spent a page's three attempts in two seconds and failed 5 pages
// of a 7-page book for good.
export function transientAiRetryDelaySeconds(
  error: unknown,
  attemptCount: number
): number | null {
  const type = classifyAiError(error);
  const transient =
    type === "rate_limit" ||
    type === "timeout" ||
    type === "upstream" ||
    type === "network" ||
    type === "circuit_open";
  if (!transient) return null;
  const backoff = 30 * 3 ** Math.max(0, attemptCount - 1);
  const asked = Math.ceil((aiRetryAfterMs(error) ?? 0) / 1000);
  return Math.min(Math.max(backoff, asked), 300);
}

export interface AiProvider {
  generateText(params: GenerateParams): Promise<GenerateResult>;
  streamText(params: GenerateParams): AsyncGenerator<StreamChunk, void, void>;
  listModels(): Promise<ModelInfo[]>;
  /** Not every OpenAI-compatible gateway implements embeddings — optional. */
  embed?(params: EmbedParams): Promise<EmbedResult>;
}
