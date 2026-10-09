import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AD_START_TIMEOUT_MS,
  insideTelegram,
  watchRewardedAd,
} from "./adsgram";

// A stand-in for AdsGram's controller: the test decides how show() ends and
// which events fire.
function fakeController() {
  const listeners = new Map<string, Set<() => void>>();
  let settle!: { resolve: () => void; reject: () => void };
  const controller = {
    show: vi.fn(
      () =>
        new Promise<{ done: boolean }>((resolve, reject) => {
          settle = {
            resolve: () => resolve({ done: true }),
            reject: () => reject({ done: false }),
          };
        })
    ),
    destroy: vi.fn(),
    addEventListener: (event: string, handler: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    removeEventListener: (event: string, handler: () => void) => {
      listeners.get(event)?.delete(handler);
    },
  };
  return {
    controller,
    fire: (event: string) => listeners.get(event)?.forEach(h => h()),
    listening: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    resolve: () => settle.resolve(),
    reject: () => settle.reject(),
  };
}

describe("the rewarded ad inside Telegram", () => {
  let ad: ReturnType<typeof fakeController>;
  let stored: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    ad = fakeController();
    stored = {};
    vi.stubGlobal("window", {
      Adsgram: { init: vi.fn(() => ad.controller) },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      sessionStorage: { getItem: (key: string) => stored[key] ?? null },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("watched to the end: the next questions open", async () => {
    const result = watchRewardedAd("53005");
    await vi.advanceTimersByTimeAsync(0);
    expect(window.Adsgram!.init).toHaveBeenCalledWith({ blockId: "53005" });
    ad.fire("onStart");
    // A long ad is never cut short once it plays.
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS * 5);
    expect(ad.controller.destroy).not.toHaveBeenCalled();
    ad.resolve();
    await expect(result).resolves.toBe("watched");
    expect(ad.listening()).toBe(0);
  });

  it("closed early: the break stays", async () => {
    const result = watchRewardedAd("53005");
    await vi.advanceTimersByTimeAsync(0);
    ad.fire("onStart");
    ad.fire("onSkip");
    ad.reject();
    await expect(result).resolves.toBe("skipped");
  });

  it("no ad to show, or an error: the student is let through", async () => {
    const result = watchRewardedAd("53005");
    await vi.advanceTimersByTimeAsync(0);
    ad.fire("onBannerNotFound");
    ad.reject();
    await expect(result).resolves.toBe("unavailable");
  });

  it("an ad that never starts does not hold the student", async () => {
    const result = watchRewardedAd("53005");
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    await expect(result).resolves.toBe("unavailable");
    expect(ad.controller.destroy).toHaveBeenCalledTimes(1);
  });

  it("a broken SDK is the same as no ad", async () => {
    (window.Adsgram as { init: unknown }).init = () => {
      throw new Error("blocked");
    };
    await expect(watchRewardedAd("53005")).resolves.toBe("unavailable");
  });

  it("knows the Mini App by the launch data Telegram's script keeps", () => {
    expect(insideTelegram()).toBe(false);
    stored.__telegram__initParams = JSON.stringify({ tgWebAppVersion: "8.0" });
    expect(insideTelegram()).toBe(false);
    stored.__telegram__initParams = JSON.stringify({
      tgWebAppData: "user=%7B%7D&hash=abc",
    });
    expect(insideTelegram()).toBe(true);
  });
});
