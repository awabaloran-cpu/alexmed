import { describe, expect, it } from "vitest";
import {
  describeSpeechError,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  startListening,
  speak,
  stopSpeaking,
} from "./voice";

// vitest.config.ts runs these tests under environment: "node" — `window` is
// genuinely undefined here, exactly like a server-rendered pass of a "use
// client" component. Every export must survive that without throwing.
describe("voice (SSR / non-browser safety)", () => {
  it("reports both features as unsupported when there is no window", () => {
    expect(isSpeechRecognitionSupported()).toBe(false);
    expect(isSpeechSynthesisSupported()).toBe(false);
  });

  it("startListening returns null instead of throwing", () => {
    const handle = startListening(
      "ar-SA",
      () => {},
      () => {},
      () => {}
    );
    expect(handle).toBeNull();
  });

  it("speak/stopSpeaking are no-ops instead of throwing", () => {
    expect(() => speak("hello", "ar-SA")).not.toThrow();
    expect(() => stopSpeaking()).not.toThrow();
  });
});

describe("describeSpeechError", () => {
  it("maps known SpeechRecognition error codes to Arabic messages", () => {
    expect(describeSpeechError("not-allowed")).toContain("الميكروفون");
    expect(describeSpeechError("permission-denied")).toContain("الميكروفون");
    expect(describeSpeechError("no-speech")).toContain("كلام");
    expect(describeSpeechError("audio-capture")).toContain("ميكروفون");
    expect(describeSpeechError("network")).toContain("الشبكة");
  });

  it("falls back to a generic message for an unknown error code", () => {
    expect(describeSpeechError("some-future-error-code")).toBeTruthy();
  });
});
