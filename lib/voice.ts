// Browser-only voice I/O for اسألني (PR8) — the Web Speech API
// (SpeechRecognition for speech-to-text, speechSynthesis for text-to-speech),
// chosen explicitly over a server-side Whisper/TTS provider to avoid adding
// a new paid provider and new backend wiring for a first voice pass. This is
// a real, disclosed tradeoff, not an oversight: SpeechRecognition has no
// support in Firefox and only partial support in Safari, and Arabic speech-
// to-text quality varies by browser/OS. Every export here is feature-
// detected — callers MUST check isSpeechRecognitionSupported() /
// isSpeechSynthesisSupported() before using the rest, so an unsupported
// browser never sees a mic/speaker control that silently does nothing.
//
// No RAG/chat logic lives here — this only turns speech into the same text
// input the existing chat already accepts, and speaks the existing chat's
// text response aloud. lib/rag.ts / lib/db-chat.ts / lib/trpc/chatRouter.ts
// (PR5) are entirely unmodified and unaware this exists.

type MinimalSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionResultEvent = {
  results: { 0: { transcript: string } }[];
};

type SpeechRecognitionErrorEvent = {
  error: string;
};

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => MinimalSpeechRecognition;
  webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
};

function getSpeechRecognitionCtor():
  | (new () => MinimalSpeechRecognition)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as SpeechRecognitionWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function describeSpeechError(error: string): string {
  switch (error) {
    case "not-allowed":
    case "permission-denied":
      return "لم يُسمح بالوصول إلى الميكروفون.";
    case "no-speech":
      return "لم يتم سماع أي كلام.";
    case "audio-capture":
      return "تعذر العثور على ميكروفون.";
    case "network":
      return "خطأ في الشبكة أثناء التعرف على الصوت.";
    default:
      return "تعذر التعرف على الصوت.";
  }
}

export type SpeechRecognitionHandle = {
  stop: () => void;
};

// Starts one listening session. Returns null (does nothing) when
// unsupported — callers should hide the mic button entirely in that case
// rather than rely on this return value to fail silently at click time.
export function startListening(
  lang: string,
  onResult: (transcript: string) => void,
  onError: (message: string) => void,
  onEnd: () => void
): SpeechRecognitionHandle | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  const recognizer = new Ctor();
  recognizer.lang = lang;
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;

  recognizer.onresult = event => {
    const transcript = event.results?.[0]?.[0]?.transcript;
    if (transcript) onResult(transcript);
  };
  recognizer.onerror = event => {
    onError(describeSpeechError(event.error));
  };
  recognizer.onend = onEnd;

  recognizer.start();
  return { stop: () => recognizer.stop() };
}

// Speaks text aloud, replacing any utterance already in progress (never
// stacks/queues) — a student asking a second question shouldn't have to
// wait through the first answer being read out.
export function speak(text: string, lang: string): void {
  if (!isSpeechSynthesisSupported()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return;
  window.speechSynthesis.cancel();
}
