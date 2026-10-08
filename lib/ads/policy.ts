// 📣 Ads — the ONE place that decides whether a student sees an ad break,
// how often, and which provider fills it. No component decides any of this:
// the question viewer is handed a "break" slot to render (or nothing), so a
// new provider, a new plan rule or a new placement never touches it.
//
// Pure (no I/O, no process.env reads): the caller passes the plan, where the
// file came from and the configuration, so every rule is unit-tested.
//
// Who sees ads: only a plan that costs nothing. Any paid plan — or a plan
// whose features carry NO_ADS — never does.
import type { PlanConfig } from "../billing/catalog";

export type AdProviderId = "adsense" | "house";
export type AdSource = "telegram" | "web";

export type AdConfig = {
  // Master switch (ADS_ENABLED). Off = no ad anywhere.
  enabled: boolean;
  // "all" (the default): every free student's questions, flashcards and
  // Exam Focus cards. "telegram": only files that arrived through the bot.
  scope: "telegram" | "all";
  questionsPerBreak: number;
  adsenseClient: string | null;
  adsenseSlot: string | null;
};

export type AdBreakPolicy =
  | { enabled: false }
  | {
      enabled: true;
      questionsPerBreak: number;
      provider: AdProviderId;
      // Present for provider "adsense" only.
      adsense?: { client: string; slot: string };
    };

export const DEFAULT_QUESTIONS_PER_BREAK = 10;

export function planShowsAds(
  plan: Pick<PlanConfig, "priceMonthlyCents" | "features">
): boolean {
  if (plan.features.NO_ADS === true) return false;
  return plan.priceMonthlyCents === 0;
}

export function resolveAdBreakPolicy(input: {
  plan: Pick<PlanConfig, "priceMonthlyCents" | "features">;
  source: AdSource;
  config: AdConfig;
}): AdBreakPolicy {
  const { plan, source, config } = input;
  if (!config.enabled || !planShowsAds(plan)) return { enabled: false };
  if (config.scope === "telegram" && source !== "telegram") {
    return { enabled: false };
  }
  const questionsPerBreak =
    Number.isInteger(config.questionsPerBreak) && config.questionsPerBreak >= 5
      ? config.questionsPerBreak
      : DEFAULT_QUESTIONS_PER_BREAK;

  // Google's units need both ids; without them the break is filled by
  // NiroLearn's own card rather than left as an empty box.
  if (config.adsenseClient && config.adsenseSlot) {
    return {
      enabled: true,
      questionsPerBreak,
      provider: "adsense",
      adsense: { client: config.adsenseClient, slot: config.adsenseSlot },
    };
  }
  return { enabled: true, questionsPerBreak, provider: "house" };
}

// The questions after which a break falls: every `every`-th, but never
// after the last one (there is nothing to continue to).
export function isBreakAfter(
  position: number,
  total: number,
  every: number
): boolean {
  return every > 0 && position > 0 && position < total && position % every === 0;
}

const ADSENSE_CLIENT = /^ca-pub-\d{10,20}$/;
const ADSENSE_SLOT = /^\d{6,20}$/;

export function readAdConfig(env: Record<string, string | undefined>): AdConfig {
  const client = env.ADSENSE_CLIENT_ID?.trim() ?? "";
  const slot = env.ADSENSE_SLOT_QUESTION_BREAK?.trim() ?? "";
  return {
    enabled: env.ADS_ENABLED === "true",
    scope: env.ADS_SCOPE === "telegram" ? "telegram" : "all",
    questionsPerBreak: Number(env.ADS_QUESTIONS_PER_BREAK) || DEFAULT_QUESTIONS_PER_BREAK,
    adsenseClient: ADSENSE_CLIENT.test(client) ? client : null,
    adsenseSlot: ADSENSE_SLOT.test(slot) ? slot : null,
  };
}
