// 📣 AdsGram (https://docs.adsgram.ai/publisher/) — the ad network of
// Telegram Mini Apps. Its ads exist only INSIDE Telegram: the SDK reads the
// launch data Telegram's own script left in sessionStorage when the student
// came in through /tg, and AdsGram refuses any other origin than the one
// registered for the block.
//
// One call, `watchRewardedAd`, with three endings — the break
// (components/ads/AdBreak.tsx) only ever sees these:
//   "watched"      the ad played to its end: the next questions open
//   "skipped"      the student closed it early: the break stays
//   "unavailable"  no ad, a blocked script, an error, no answer in time:
//                  the student goes on — a network with nothing to show
//                  must never lock anyone out of their own questions
export type RewardedAdResult = "watched" | "skipped" | "unavailable";

type ShowResult = { done?: boolean; error?: boolean };
type AdsgramEvent =
  | "onStart"
  | "onSkip"
  | "onBannerNotFound"
  | "onNonStopShow"
  | "onTooLongSession";
type AdController = {
  show: () => Promise<ShowResult>;
  destroy: () => void;
  addEventListener: (event: AdsgramEvent, handler: () => void) => void;
  removeEventListener: (event: AdsgramEvent, handler: () => void) => void;
};

declare global {
  interface Window {
    Adsgram?: { init: (options: { blockId: string }) => AdController };
  }
}

const SDK = "https://sad.adsgram.ai/js/sad.min.js";
// How long an ad may take to START. Once it plays, nothing cuts it short.
export const AD_START_TIMEOUT_MS = 12_000;

// True when this page was opened as a Mini App: Telegram's script keeps the
// launch data under this key for the whole visit, across page loads.
export function insideTelegram(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.sessionStorage.getItem("__telegram__initParams");
    return !!stored && stored.includes("tgWebAppData");
  } catch {
    return false;
  }
}

let sdk: Promise<void> | null = null;
// Loaded once, and only for a student who reaches a break inside Telegram.
export function loadAdsgram(): Promise<void> {
  if (window.Adsgram) return Promise.resolve();
  sdk ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = SDK;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      sdk = null;
      reject(new Error("adsgram sdk"));
    };
    document.head.appendChild(script);
  });
  return sdk;
}

export async function watchRewardedAd(
  blockId: string
): Promise<RewardedAdResult> {
  let controller: AdController;
  try {
    await loadAdsgram();
    if (!window.Adsgram) return "unavailable";
    controller = window.Adsgram.init({ blockId });
  } catch {
    return "unavailable";
  }

  let started = false;
  let skipped = false;
  const onStart = () => {
    started = true;
  };
  const onSkip = () => {
    skipped = true;
  };
  // With a listener on these three the SDK stays quiet instead of opening
  // its own alert box over the questions.
  const quiet = () => {};
  const silenced: AdsgramEvent[] = [
    "onBannerNotFound",
    "onNonStopShow",
    "onTooLongSession",
  ];
  controller.addEventListener("onStart", onStart);
  controller.addEventListener("onSkip", onSkip);
  for (const event of silenced) controller.addEventListener(event, quiet);

  let timer = 0;
  const neverStarted = new Promise<RewardedAdResult>(resolve => {
    timer = window.setTimeout(() => {
      if (started) return;
      try {
        controller.destroy();
      } catch {
        // Nothing was on screen.
      }
      resolve("unavailable");
    }, AD_START_TIMEOUT_MS);
  });
  const shown = controller.show().then(
    (): RewardedAdResult => "watched",
    // The student closing the ad is the only refusal that keeps the break
    // closed.
    (): RewardedAdResult => (skipped ? "skipped" : "unavailable")
  );
  try {
    return await Promise.race([shown, neverStarted]);
  } finally {
    window.clearTimeout(timer);
    controller.removeEventListener("onStart", onStart);
    controller.removeEventListener("onSkip", onSkip);
    for (const event of silenced) controller.removeEventListener(event, quiet);
  }
}
