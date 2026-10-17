import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProvider } from "./config";

describe("resolveProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("defaults to openrouter when nothing is configured", () => {
    vi.stubEnv("LLM_PROVIDER", "");
    vi.stubEnv("OMNIROUTE_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(resolveProvider()).toBe("openrouter");
  });

  it("honors LLM_PROVIDER=gemini once Google's key and model are set", () => {
    vi.stubEnv("LLM_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("GEMINI_DEFAULT_MODEL", "gemini-3.1-flash");
    vi.stubEnv("OMNIROUTE_API_KEY", "test-key");
    expect(resolveProvider()).toBe("gemini");
  });

  it("LLM_PROVIDER=gemini without a key or a model keeps the old path", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("LLM_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("GEMINI_DEFAULT_MODEL", "");
    vi.stubEnv("OMNIROUTE_API_KEY", "test-key");
    expect(resolveProvider()).toBe("omniroute");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_DEFAULT_MODEL", "gemini-3.1-flash");
    vi.stubEnv("OMNIROUTE_API_KEY", "");
    expect(resolveProvider()).toBe("openrouter");
  });

  it("prefers Gemini over OmniRoute when LLM_PROVIDER is unset", () => {
    vi.stubEnv("LLM_PROVIDER", "");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("GEMINI_DEFAULT_MODEL", "gemini-3.1-flash");
    vi.stubEnv("OMNIROUTE_API_KEY", "test-key");
    expect(resolveProvider()).toBe("gemini");
  });

  it("an explicit LLM_PROVIDER=omniroute still wins over a Gemini key", () => {
    vi.stubEnv("LLM_PROVIDER", "omniroute");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("GEMINI_DEFAULT_MODEL", "gemini-3.1-flash");
    vi.stubEnv("OMNIROUTE_API_KEY", "test-key");
    expect(resolveProvider()).toBe("omniroute");
  });

  it("defaults to omniroute once its key is present and LLM_PROVIDER is unset", () => {
    vi.stubEnv("LLM_PROVIDER", "");
    vi.stubEnv("OMNIROUTE_API_KEY", "test-key");
    expect(resolveProvider()).toBe("omniroute");
  });

  it("respects an explicit LLM_PROVIDER=openrouter even if OmniRoute is configured", () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OMNIROUTE_API_KEY", "test-key");
    expect(resolveProvider()).toBe("openrouter");
  });

  it("falls back to openrouter if LLM_PROVIDER=omniroute but no key is set", () => {
    vi.stubEnv("LLM_PROVIDER", "omniroute");
    vi.stubEnv("OMNIROUTE_API_KEY", "");
    expect(resolveProvider()).toBe("openrouter");
  });

  it("honors an explicit LLM_PROVIDER=omniroute when the key is present", () => {
    vi.stubEnv("LLM_PROVIDER", "omniroute");
    vi.stubEnv("OMNIROUTE_API_KEY", "test-key");
    expect(resolveProvider()).toBe("omniroute");
  });
});
