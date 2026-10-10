// OmniRoute provider — a self-hosted OpenAI-compatible AI gateway (Railway).
// This is now the default AI path for the app once OMNIROUTE_API_KEY is set
// (see lib/ai/config.ts's resolveProvider()). OmniRoute already does its own
// routing/retries/fallbacks upstream, so this client keeps its own retry
// behavior deliberately conservative (network failures / 5xx only, never on
// 429 — retrying a rate-limit against a gateway that already handles rate-
// limit routing itself would just duplicate requests for no benefit).
import { omniRouteConfig, reasoningEffortFor } from "../config";
import { logAiEvent } from "../context";
import { noteGatewayBusy, withAiSlot } from "../gate";
import {
  checkModel,
  msUntilNextProbe,
  recordModelFailure,
  recordModelSuccess,
  type BreakerSnapshot,
} from "../circuit-breaker";
import { parseOpenAiSseStream } from "../sse";
import {
  AiAuthError,
  AiCircuitOpenError,
  AiInvalidRequestError,
  AiRateLimitError,
  AiTimeoutError,
  AiUpstreamError,
  classifyAiError,
  type AiErrorType,
  type AiProvider,
  type EmbedParams,
  type EmbedResult,
  type GenerateParams,
  type GenerateResult,
  type Message,
  type ModelInfo,
  type StreamChunk,
} from "../types";

function parseRetryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : undefined;
}

// No per-request hosting ceiling on Railway (unlike Vercel Hobby's 60s
// serverless cap this used to be tuned under) — observed live, card
// generation (up to GENERATE_MAX_TOKENS=14000) can genuinely take well
// over 50s under load, aborting requests that were on track to succeed.
// Give a single attempt real headroom; a timeout still never gets retried
// against the same model (see below) — the multi-candidate loop in
// generateText() is what moves on to a different model, not this retry.
const REQUEST_TIMEOUT_MS = 120_000;
// generateText() streams (see collectStreamedResponse): the whole
// generation — up to 16k tokens for a chapter analysis — must fit in one
// attempt, and a stream only takes as long as the model actually writes.
const STREAMED_GENERATION_TIMEOUT_MS = 240_000;
// Wall-clock budget for one generateText() call across ALL candidate models
// — without it a call could wait 240s on every model in the chain in turn.
// Later candidates get whatever is left; when it's spent the call fails as
// a timeout and the queue retries it later with backoff.
const GENERATION_TOTAL_BUDGET_MS = 300_000;
// A candidate isn't started with less than this left — too little time to
// produce anything but another timeout.
const MIN_ATTEMPT_MS = 20_000;
const RETRY_MAX_RETRIES = 1; // conservative — see file header.
const RETRY_BASE_DELAY_MS = 500;
// "503 chat_admission_busy" is the GATEWAY saying it has no room for one
// more call right now — not the model failing. The same model is asked
// again after a growing wait (about 1.5s, 3s, 6s, 12s); it is never counted
// against the model's circuit and never sent on to the dearer fallback,
// which sits behind the same gateway. Still busy after that: the call ends
// as a rate limit, and the queue brings it back later.
const GATEWAY_BUSY_RETRIES = 4;
const GATEWAY_BUSY_BASE_DELAY_MS = 2_000;
const GATEWAY_BUSY_RETRY_AFTER_MS = 30_000;

// Exported for tests.
export function isGatewayBusy(status: number, body: string): boolean {
  return status === 503 && body.includes("chat_admission_busy");
}

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

// Exponential backoff with "equal jitter": half the exponential delay is
// fixed, half random — so many callers failing at once don't all retry at
// the same instant. Exported for tests.
export function backoffWithJitter(
  attempt: number,
  baseMs = RETRY_BASE_DELAY_MS,
  random = Math.random
): number {
  const exponential = baseMs * 2 ** attempt;
  return Math.round(exponential / 2 + random() * (exponential / 2));
}

// Same-model retry is only worth it for errors that say "try again": the
// gateway/upstream is briefly unavailable. A 500 moves on to the next
// model instead (retrying a broken model just doubles the load), and 4xx
// never retries here. Exported for tests.
export function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

// What a failed HTTP status means for the fallback loop. Exported for tests.
export function classifyStatus(status: number): AiErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "upstream";
  return "invalid_request";
}

// Failures that say the MODEL (or its provider) is unhealthy — these count
// toward its circuit breaker. An invalid request is about the payload, and
// an auth error about the shared key, not the model. A 404 is counted: it
// usually means the model id no longer exists upstream.
function countsTowardBreaker(type: AiErrorType, status?: number): boolean {
  if (status === 404) return true;
  return (
    type === "rate_limit" ||
    type === "upstream" ||
    type === "timeout" ||
    type === "network"
  );
}

function requireApiKey(): string {
  const key = omniRouteConfig.apiKey;
  if (!key) throw new Error("OMNIROUTE_API_KEY is not configured");
  return key;
}

function headers(apiKey: string) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
}

// Maps an OmniRoute/upstream HTTP failure to a clear, distinct server-side
// log line — status + a short generic reason, NEVER the API key and never
// the raw request/response body (which could echo back sensitive upstream
// provider error details). The thrown Error's message is safe to bubble up
// to route handlers, which already show their own Arabic user-facing copy
// and never surface this raw string to the client.
function describeStatus(status: number): string {
  switch (status) {
    case 401:
      return "unauthorized (check OMNIROUTE_API_KEY)";
    case 403:
      return "forbidden";
    case 404:
      return "endpoint not found (check OMNIROUTE_BASE_URL)";
    case 429:
      return "rate limited upstream";
    case 500:
      return "OmniRoute internal error";
    case 502:
    case 503:
      return "OmniRoute or upstream provider unavailable";
    default:
      return `unexpected status ${status}`;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Only 502/503/504 are retried on the same model; never 429 (see
      // header) and never a plain 500 (the next model is a better bet).
      if (response.ok || !isRetryableStatus(response.status)) return response;
      if (attempt === RETRY_MAX_RETRIES) return response;
      // A busy gateway is handled by the caller, with a real wait — not
      // asked again half a second later.
      if (response.status === 503) {
        const body = await response
          .clone()
          .text()
          .catch(() => "");
        if (isGatewayBusy(response.status, body)) return response;
      }
      console.warn(
        `[AI][omniroute] retrying after ${describeStatus(response.status)}`
      );
      // Release the failed response before waiting.
      await response.body?.cancel().catch(() => undefined);
      await sleep(backoffWithJitter(attempt));
    } catch (error) {
      lastError = error;
      // A timeout (AbortSignal firing) is NOT the same as a fast network
      // failure: OmniRoute may still be mid-flight on the request we just
      // gave up on. Retrying here would fire a second, duplicate job at an
      // already-slow/overloaded upstream instead of giving it room to
      // recover — fail fast instead of piling on.
      const isTimeout = error instanceof Error && error.name === "TimeoutError";
      if (isTimeout || attempt === RETRY_MAX_RETRIES) throw error;
      console.warn("[AI][omniroute] retrying after network error");
      await sleep(backoffWithJitter(attempt));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("OmniRoute request failed");
}

// Downgrading json_schema -> json_object below drops the schema itself, so a
// model that was never told the required shape happily invents its own
// (verified live: without this, OmniRoute's chat models returned valid JSON
// that silently lacked a `cards` array — parsed fine, produced zero cards
// downstream). Same fix as the OpenRouter provider: since the gateway can no
// longer enforce the schema, the prompt has to.
function appendSchemaInstruction(
  messages: Message[],
  format: GenerateParams["responseFormat"]
): Message[] {
  if (!format || format.type !== "json_schema") return messages;

  const instruction =
    `Respond with a single JSON object that matches EXACTLY this JSON Schema — ` +
    `same field names, same nesting, no extra fields, no renamed fields, no prose, no markdown fences:\n\n` +
    JSON.stringify(format.json_schema.schema);

  return [...messages, { role: "user", content: instruction }];
}

function hasImageContent(messages: Message[]): boolean {
  return messages.some(message => {
    const parts = Array.isArray(message.content)
      ? message.content
      : [message.content];
    return parts.some(
      part => typeof part === "object" && part.type === "image_url"
    );
  });
}

const MODELS_CACHE_TTL_MS = 10 * 60 * 1000;
let modelsCache: { data: ModelInfo[]; fetchedAt: number } | null = null;

async function fetchModels(): Promise<ModelInfo[]> {
  const now = Date.now();
  if (modelsCache && now - modelsCache.fetchedAt < MODELS_CACHE_TTL_MS) {
    return modelsCache.data;
  }

  const apiKey = requireApiKey();
  const response = await fetchWithTimeout(`${omniRouteConfig.baseUrl}/models`, {
    method: "GET",
    headers: headers(apiKey),
  });

  if (!response.ok) {
    throw new Error(
      `OmniRoute models list failed: ${describeStatus(response.status)}`
    );
  }

  const body = (await response.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      // Verified live against the real endpoint: OmniRoute's /v1/models does
      // NOT expose OpenRouter-style pricing/architecture fields at all — real
      // entries look like { id, object, created, owned_by, context_length,
      // max_input_tokens, max_output_tokens, capabilities: {tool_calling,
      // reasoning, thinking, temperature} }, no cost or modality info. These
      // two are kept only in case a future OmniRoute version adds them.
      pricing?: { prompt?: string; completion?: string };
      architecture?: { input_modalities?: string[] };
    }>;
  };

  // No pricing/modality metadata exists to check (see above), so isFree /
  // supportsImages fall back to a naming-convention heuristic — OmniRoute's
  // own ids are literal about this (e.g. "auto/best-vision", "auto/multimodal",
  // "auto/best-free", "auto/coding:free", "oc/deepseek-v4-flash-free").
  const models: ModelInfo[] = (body.data ?? []).map(model => {
    const id = model.id.toLowerCase();
    return {
      id: model.id,
      name: model.name ?? model.id,
      isFree: model.pricing
        ? model.pricing.prompt === "0" && model.pricing.completion === "0"
        : /(^|[/:-])free($|[/:-])/.test(id),
      supportsImages: model.architecture?.input_modalities?.includes("image")
        ? true
        : /vision|multimodal/.test(id),
      contextLength: model.context_length ?? 0,
    };
  });

  modelsCache = { data: models, fetchedAt: now };
  return models;
}

// OMNIROUTE_DEFAULT_MODEL wins when set (no network call, no guessing). If
// unset, fetch the real live model list once (cached) and pick a model that
// actually exists rather than inventing an id — preferring a vision-capable
// one when the request includes an image.
async function resolveModel(params: GenerateParams): Promise<string> {
  // An image request goes to the vision model when one is configured —
  // unless the caller explicitly asked for some OTHER model than the text
  // default (call sites pass the resolved default, which isn't a real
  // choice; see generateText's comment below).
  if (hasImageContent(params.messages) && omniRouteConfig.visionModel) {
    const requested = params.model?.trim();
    if (!requested || requested === omniRouteConfig.defaultModel) {
      return omniRouteConfig.visionModel;
    }
  }
  if (params.model?.trim()) return params.model.trim();
  if (omniRouteConfig.defaultModel) return omniRouteConfig.defaultModel;

  const models = await fetchModels();
  if (!models.length) {
    throw new Error(
      "OmniRoute: no model specified and the live model list is empty — set OMNIROUTE_DEFAULT_MODEL"
    );
  }

  const needsVision = hasImageContent(params.messages);
  const match = needsVision
    ? models.find(model => model.supportsImages)
    : undefined;
  return (match ?? models[0]).id;
}

// Ordered models to try: the resolved primary, then the matching fallback
// chain — image requests use OMNIROUTE_VISION_FALLBACK_MODELS when set
// (falling back to text-only models would just fail again, or worse,
// "succeed" by answering that no image was provided), text requests use
// OMNIROUTE_FALLBACK_MODELS. Exported for tests.
export function candidateModels(
  primaryModel: string,
  needsVision: boolean
): string[] {
  const chain =
    needsVision && omniRouteConfig.visionFallbackModels.length
      ? omniRouteConfig.visionFallbackModels
      : omniRouteConfig.fallbackModels;
  return [primaryModel, ...chain.filter(model => model !== primaryModel)];
}

function buildPayload(model: string, params: GenerateParams, stream: boolean) {
  const payload: Record<string, unknown> = {
    model,
    messages: appendSchemaInstruction(params.messages, params.responseFormat),
  };
  if (typeof params.maxTokens === "number")
    payload.max_tokens = params.maxTokens;
  if (params.responseFormat?.type === "json_schema") {
    // Same reasoning as the OpenRouter provider: not every model behind an
    // OpenAI-compatible gateway honors strict json_schema mode, so downgrade
    // to the widely-supported json_object mode and let the prompt (already
    // ending in "Return JSON only" in lib/pdf-cards.ts) carry the shape.
    payload.response_format = { type: "json_object" };
  } else if (params.responseFormat?.type === "json_object") {
    payload.response_format = { type: "json_object" };
  }
  const reasoningEffort = reasoningEffortFor(model);
  if (reasoningEffort) payload.reasoning_effort = reasoningEffort;
  if (stream) payload.stream = true;
  return payload;
}

function parseGenerateResponse(raw: {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    message: { role: string; content: string | null };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}): GenerateResult {
  const choice = raw.choices[0];
  return {
    id: raw.id,
    created: raw.created,
    model: raw.model,
    content: choice?.message.content ?? "",
    finishReason: choice?.finish_reason ?? null,
    usage: raw.usage
      ? {
          promptTokens: raw.usage.prompt_tokens,
          completionTokens: raw.usage.completion_tokens,
          totalTokens: raw.usage.total_tokens,
        }
      : undefined,
  };
}

// Same recovery rules as lib/pdf-cards.ts's parseJsonResponse: the whole
// answer (fences stripped) or its outermost {...} block must parse, and be
// a non-empty object. Exported for tests.
export function containsJsonObject(content: string): boolean {
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const candidates = [text];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  return candidates.some(candidate => {
    try {
      const parsed = JSON.parse(candidate);
      return (
        !!parsed && typeof parsed === "object" && Object.keys(parsed).length > 0
      );
    } catch {
      return false;
    }
  });
}

// Assembles a streamed chat completion into the same GenerateResult a
// non-streamed call returns. A gateway/provider that ignores `stream` and
// answers with plain JSON is handled too. Exported for tests.
export async function collectStreamedResponse(
  response: Response,
  model: string
): Promise<GenerateResult> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const text = await response.text();
    try {
      return parseGenerateResponse(
        JSON.parse(text) as Parameters<typeof parseGenerateResponse>[0]
      );
    } catch {
      // Some gateways send SSE frames without the SSE content type.
      if (!text.includes("data:")) throw new Error("Unreadable response body");
      return collectStreamedResponse(
        new Response(text, {
          headers: { "content-type": "text/event-stream" },
        }),
        model
      );
    }
  }
  if (!response.body) throw new Error("Stream response had no body");
  let content = "";
  for await (const chunk of parseOpenAiSseStream(response.body)) {
    content += chunk.delta;
  }
  if (!content.trim()) throw new Error("Stream finished with no content");
  return {
    id: `stream-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model,
    content,
    finishReason: "stop",
  };
}

// Every background generation waits its turn at the gate (lib/ai/gate.ts).
function generateText(params: GenerateParams): Promise<GenerateResult> {
  return withAiSlot(() => generateTextNow(params));
}

async function generateTextNow(
  params: GenerateParams
): Promise<GenerateResult> {
  const apiKey = requireApiKey();
  const primaryModel = await resolveModel(params);
  // Every call site in this app resolves its model from
  // OMNIROUTE_DEFAULT_MODEL up front (OmniRoute "owns model selection —
  // never client-selectable", per lib/pdf-cards.ts's OCR_MODEL/etc.) and
  // passes that resolved string as params.model, so params.model always
  // equals primaryModel here in practice — there's no real caller whose
  // explicit choice a fallback would be overriding. Always chain fallbacks.
  //
  // Tried in listed order (OMNIROUTE_DEFAULT_MODEL first, then
  // OMNIROUTE_FALLBACK_MODELS in order) — a deliberate priority, not load
  // distribution: e.g. a free provider first, a paid/quota-limited one only
  // as last resort. (An earlier version shuffled this for load spreading;
  // that's what a fixed order gives up in exchange for honoring priority.)
  //
  // Failure handling per candidate:
  //   - circuit open (lib/ai/circuit-breaker.ts) → skipped, nothing sent;
  //   - 401/403 → stop: the one gateway key is shared by every model;
  //   - 429 / 5xx / timeout / network → counted against the model's
  //     circuit, next model;
  //   - other 4xx → next model (it may accept the payload), not counted;
  //   - a JSON request answered without JSON → next model.
  // Everything runs inside GENERATION_TOTAL_BUDGET_MS.
  const candidates = candidateModels(
    primaryModel,
    hasImageContent(params.messages)
  );
  const deadline = Date.now() + GENERATION_TOTAL_BUDGET_MS;

  let lastError: Error | undefined;
  let lastRateLimitRetryAfter: number | undefined;
  const skipped: (BreakerSnapshot | null)[] = [];
  let attempted = 0;
  let busyRetries = 0;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const isLastCandidate = i === candidates.length - 1;
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) {
      lastError = new AiTimeoutError(
        "OmniRoute: the generation time budget ran out before a model answered"
      );
      break;
    }

    const breaker = await checkModel(model);
    if (!breaker.allowed) {
      skipped.push(breaker.snapshot);
      logAiEvent("ai_call", {
        provider: "omniroute",
        model,
        attempt: i + 1,
        status: "skipped",
        errorType: "circuit_open",
      });
      continue;
    }
    attempted++;

    const startedAt = Date.now();
    const fail = (
      type: AiErrorType,
      error: Error,
      httpStatus?: number
    ): void => {
      lastError = error;
      logAiEvent("ai_call", {
        provider: "omniroute",
        model,
        attempt: i + 1,
        status: "error",
        errorType: type,
        httpStatus,
        durationMs: Date.now() - startedAt,
      });
      if (countsTowardBreaker(type, httpStatus)) {
        void recordModelFailure(model, type);
      }
    };

    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${omniRouteConfig.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: headers(apiKey),
          // Streamed even though callers want one complete result:
          // OmniRoute cancels a non-streamed request whose response hasn't
          // STARTED within 30s (DIRECT_RESPONSE_START_TIMEOUT, observed
          // 2026-09-24) — and a non-streamed long generation (chapter
          // analysis, notes) sends nothing until it's completely written.
          // A stream starts within seconds, so long generations finish.
          body: JSON.stringify(buildPayload(model, params, true)),
        },
        Math.min(STREAMED_GENERATION_TIMEOUT_MS, remaining)
      );
    } catch (error) {
      const type = classifyAiError(error);
      fail(
        type,
        type === "timeout"
          ? new AiTimeoutError(`OmniRoute ${model} timed out`)
          : new AiUpstreamError(`OmniRoute ${model} request failed`)
      );
      if (!isLastCandidate) {
        console.warn(
          `[AI][omniroute] ${model} request failed, trying next fallback model`,
          error
        );
      }
      continue;
    }

    if (response.ok) {
      try {
        const result = await collectStreamedResponse(response, model);
        // A JSON request answered without any parseable JSON (observed with
        // reasoning models writing their chain-of-thought into the answer)
        // is a failed attempt too — try the next model. The last candidate's
        // answer is still returned as-is, exactly as before this check.
        if (
          params.responseFormat &&
          !isLastCandidate &&
          !containsJsonObject(result.content)
        ) {
          throw new Error("JSON was requested but the answer contains none");
        }
        logAiEvent("ai_call", {
          provider: "omniroute",
          model,
          attempt: i + 1,
          status: "ok",
          durationMs: Date.now() - startedAt,
        });
        void recordModelSuccess(model);
        return result;
      } catch (error) {
        // Cut off mid-stream, or finished with no content at all — the
        // same "this model failed" as an error status: move on.
        const type = classifyAiError(error);
        fail(
          type === "timeout" ? "timeout" : "upstream",
          type === "timeout"
            ? new AiTimeoutError(`OmniRoute ${model} stream timed out`)
            : new AiUpstreamError(
                `OmniRoute ${model} stream failed: ${
                  error instanceof Error ? error.message : "unknown"
                }`
              )
        );
        if (!isLastCandidate) {
          console.warn(
            `[AI][omniroute] ${model} stream failed, trying next fallback model`,
            error
          );
        }
        continue;
      }
    }

    // Server-log only (never sent to the client, never the API key) — a 400
    // in particular usually means the payload itself was rejected for a
    // reason worth seeing while debugging a new model/provider.
    let bodyText = "";
    try {
      bodyText = (await response.text()).slice(0, 500);
      console.warn(
        `[AI][omniroute] ${model} returned ${response.status}: ${bodyText}`
      );
    } catch {
      // Body already consumed or unreadable.
    }

    if (isGatewayBusy(response.status, bodyText)) {
      const wait = backoffWithJitter(busyRetries, GATEWAY_BUSY_BASE_DELAY_MS);
      // Calls about to start hold back too, instead of knocking at once.
      noteGatewayBusy(wait);
      logAiEvent("ai_call", {
        provider: "omniroute",
        model,
        attempt: i + 1,
        status: "busy",
        httpStatus: response.status,
        durationMs: Date.now() - startedAt,
      });
      if (
        busyRetries < GATEWAY_BUSY_RETRIES &&
        deadline - Date.now() - wait > MIN_ATTEMPT_MS
      ) {
        busyRetries++;
        await sleep(wait);
        i--; // the same model again
        continue;
      }
      throw new AiRateLimitError(
        "OmniRoute is busy (chat admission)",
        GATEWAY_BUSY_RETRY_AFTER_MS
      );
    }

    const type = classifyStatus(response.status);
    const message = `OmniRoute chat completion failed: ${describeStatus(response.status)}`;
    if (type === "auth") {
      fail(type, new AiAuthError(message), response.status);
      // Same key for every model — the rest of the chain would fail too.
      throw lastError!;
    }
    if (type === "rate_limit") {
      lastRateLimitRetryAfter = parseRetryAfterMs(response);
      fail(
        type,
        new AiRateLimitError(message, lastRateLimitRetryAfter),
        response.status
      );
    } else if (type === "upstream") {
      fail(type, new AiUpstreamError(message), response.status);
    } else {
      fail(
        type,
        new AiInvalidRequestError(message, response.status),
        response.status
      );
    }
    if (!isLastCandidate) {
      console.warn(
        `[AI][omniroute] ${model} returned ${describeStatus(response.status)}, trying next fallback model`
      );
    }
  }

  // Nothing was even tried: every candidate's circuit is open.
  if (attempted === 0 && skipped.length) {
    throw new AiCircuitOpenError(
      "OmniRoute: every candidate model is temporarily unavailable",
      Math.max(5_000, msUntilNextProbe(skipped))
    );
  }
  // A rate limit anywhere in the chain is the most useful signal to hand
  // back when the last candidate's own failure is less specific.
  if (
    lastRateLimitRetryAfter !== undefined &&
    !(lastError instanceof AiRateLimitError) &&
    !(lastError instanceof AiInvalidRequestError)
  ) {
    throw new AiRateLimitError(
      lastError?.message ?? "OmniRoute rate limited",
      lastRateLimitRetryAfter
    );
  }
  throw lastError ?? new AiUpstreamError("OmniRoute chat completion failed");
}

async function* streamText(
  params: GenerateParams
): AsyncGenerator<StreamChunk, void, void> {
  const apiKey = requireApiKey();
  const model = await resolveModel(params);

  // Same circuit as generateText: an open circuit fails fast, and the
  // caller (lib/fast-answer-stream.ts) falls back to the regular chain.
  const breaker = await checkModel(model);
  if (!breaker.allowed) {
    logAiEvent("ai_stream", {
      provider: "omniroute",
      model,
      status: "skipped",
      errorType: "circuit_open",
    });
    throw new AiCircuitOpenError(
      `OmniRoute ${model} is temporarily unavailable`,
      Math.max(5_000, msUntilNextProbe([breaker.snapshot]))
    );
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${omniRouteConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify(buildPayload(model, params, true)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const type = classifyAiError(error);
    logAiEvent("ai_stream", {
      provider: "omniroute",
      model,
      status: "error",
      errorType: type,
      durationMs: Date.now() - startedAt,
    });
    void recordModelFailure(model, type);
    throw type === "timeout"
      ? new AiTimeoutError(`OmniRoute ${model} stream timed out`)
      : new AiUpstreamError(`OmniRoute ${model} stream request failed`);
  }

  if (!response.ok || !response.body) {
    const type = response.ok ? "upstream" : classifyStatus(response.status);
    logAiEvent("ai_stream", {
      provider: "omniroute",
      model,
      status: "error",
      errorType: type,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
    });
    if (countsTowardBreaker(type, response.status)) {
      void recordModelFailure(model, type);
    }
    const message = `OmniRoute stream failed: ${describeStatus(response.status)}`;
    if (type === "auth") throw new AiAuthError(message);
    if (type === "rate_limit")
      throw new AiRateLimitError(message, parseRetryAfterMs(response));
    if (type === "invalid_request") throw new AiInvalidRequestError(message);
    throw new AiUpstreamError(message);
  }

  logAiEvent("ai_stream", {
    provider: "omniroute",
    model,
    status: "ok",
    durationMs: Date.now() - startedAt,
  });
  void recordModelSuccess(model);
  yield* parseOpenAiSseStream(response.body);
}

async function embed(params: EmbedParams): Promise<EmbedResult> {
  const apiKey = requireApiKey();
  const model = params.model ?? omniRouteConfig.defaultModel;
  if (!model) {
    throw new Error(
      "OmniRoute: embed() needs a model — pass one explicitly or set OMNIROUTE_DEFAULT_MODEL"
    );
  }

  const response = await fetchWithTimeout(
    `${omniRouteConfig.baseUrl}/embeddings`,
    {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ model, input: params.input }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `OmniRoute embeddings failed: ${describeStatus(response.status)}`
    );
  }

  const raw = (await response.json()) as {
    model: string;
    data: Array<{ embedding: number[] }>;
  };

  return {
    embeddings: raw.data.map(item => item.embedding),
    model: raw.model,
  };
}

export const omnirouteProvider: AiProvider = {
  generateText,
  streamText,
  listModels: fetchModels,
  embed,
};
