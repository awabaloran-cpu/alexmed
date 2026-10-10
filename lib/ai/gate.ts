// One gate for every background generation this process sends to the AI
// gateway. Each pipeline has its own queue limit, but nothing bounded them
// TOGETHER: two students' files at once sent more calls than the gateway
// admits, it answered "503 chat_admission_busy" (live, 2026-10-08/09), and
// each of those was counted as a failed model — circuits opened, calls
// moved to the dearer fallback model, pages spent their attempts.
//
// The gate does two things:
//   - at most aiMaxConcurrent() generations are in flight; the rest wait
//     their turn, first come first served;
//   - when the gateway says it is busy, every waiting call holds back for a
//     moment instead of knocking again at once.
// Short interactive answers (streamText) do not pass through it: a student
// waiting on a reply is never queued behind a file.
const DEFAULT_MAX_CONCURRENT = 6;
// The longest a "busy" answer holds the gate closed.
const MAX_PAUSE_MS = 20_000;

export function aiMaxConcurrent(): number {
  const parsed = Number(process.env.AI_MAX_CONCURRENT);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_CONCURRENT;
  return Math.min(64, Math.floor(parsed));
}

let inFlight = 0;
let pausedUntil = 0;
const waiting: (() => void)[] = [];

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

// A finished call hands its slot straight to the next one waiting, so a
// call arriving at that moment cannot slip in ahead of the line.
function release() {
  const next = waiting.shift();
  if (next) next();
  else inFlight--;
}

// Runs `task` when a slot is free. The slot is given back whatever happens.
export async function withAiSlot<T>(task: () => Promise<T>): Promise<T> {
  if (inFlight >= aiMaxConcurrent()) {
    await new Promise<void>(resolve => waiting.push(resolve));
  } else {
    inFlight++;
  }
  try {
    for (let wait = pausedUntil - Date.now(); wait > 0; ) {
      await sleep(wait);
      wait = pausedUntil - Date.now();
    }
    return await task();
  } finally {
    release();
  }
}

// The gateway said it has no room: calls about to start wait this long.
export function noteGatewayBusy(waitMs: number) {
  const until = Date.now() + Math.min(Math.max(0, waitMs), MAX_PAUSE_MS);
  if (until > pausedUntil) pausedUntil = until;
}

// For tests and the health snapshot.
export function aiGateState() {
  return {
    inFlight,
    waiting: waiting.length,
    pausedForMs: Math.max(0, pausedUntil - Date.now()),
  };
}

export function resetAiGateForTests() {
  inFlight = 0;
  pausedUntil = 0;
  waiting.length = 0;
}
