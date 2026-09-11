// FSRS-6 spaced-repetition scheduler for كتبي's bookCards ONLY. SM-2
// (lib/srs.ts) keeps running unmodified for مِرآة's cards and for
// adminMaterialReviews — this file is never imported by either, per the
// standing "never touch مِرآة" rule.
//
// Ported directly from the reference implementation at
// github.com/open-spaced-repetition/ts-fsrs (packages/fsrs/src/algorithm.ts
// and constant.ts, FSRS-6.0) — read from source rather than reconstructed
// from memory, since a spaced-repetition algorithm with subtly wrong
// constants is worse than an honest simpler one.
//
// Two deliberate simplifications vs. ts-fsrs, both scope decisions rather
// than bugs:
//   - No Anki-style sub-day "learning steps" for brand-new cards (minutes-
//     scale re-prompting before the first real interval) — this app's old
//     SM-2 scheduler didn't have those either, and this stays a day-scale
//     scheduler like the rest of the app's review flow.
//   - No interval fuzzing (ts-fsrs randomizes intervals slightly to avoid
//     review pile-ups across many cards) — kept deterministic, both for
//     testability and because a single student's own review load is what
//     it is regardless of small randomization.

export type FsrsGrade = "again" | "hard" | "good" | "easy";

const GRADE_NUMBER: Record<FsrsGrade, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

// FSRS-6.0 default parameters (21 weights) — exact values from ts-fsrs's
// `default_w` (packages/fsrs/src/constant.ts). These are the published,
// community-calibrated defaults used when no per-user optimization has been
// run (optimizing per-user requires a review-history dataset this app
// doesn't have yet).
export const FSRS_DEFAULT_WEIGHTS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
] as const;

const S_MIN = 0.001;
const S_MAX = 36500;
const MAXIMUM_INTERVAL_DAYS = 36500;
// Target recall probability the scheduler aims for — "stability" is defined
// as the number of days for retrievability to decay to exactly this value.
const REQUEST_RETENTION = 0.9;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function decayAndFactor(w: readonly number[]): {
  decay: number;
  factor: number;
} {
  const decay = -w[20];
  const factor = Math.exp(Math.log(0.9) / decay) - 1;
  return { decay, factor };
}

// R(t, S) — probability of recall t days after a review, given stability S.
// By construction, forgettingCurve(w, S, S) === REQUEST_RETENTION (0.9) for
// any S: that's the actual definition of "stability" in this model.
export function forgettingCurve(
  w: readonly number[],
  elapsedDays: number,
  stability: number
): number {
  const { decay, factor } = decayAndFactor(w);
  return roundTo(Math.pow(1 + (factor * elapsedDays) / stability, decay), 8);
}

function intervalModifier(w: readonly number[]): number {
  const { decay, factor } = decayAndFactor(w);
  return roundTo((Math.pow(REQUEST_RETENTION, 1 / decay) - 1) / factor, 8);
}

export function initStability(w: readonly number[], grade: FsrsGrade): number {
  return Math.max(w[GRADE_NUMBER[grade] - 1], 0.1);
}

export function initDifficulty(w: readonly number[], grade: FsrsGrade): number {
  const g = GRADE_NUMBER[grade];
  const d = w[4] - Math.exp((g - 1) * w[5]) + 1;
  return clamp(roundTo(d, 8), 1, 10);
}

function linearDamping(deltaD: number, oldD: number): number {
  return roundTo((deltaD * (10 - oldD)) / 9, 8);
}

export function nextDifficulty(
  w: readonly number[],
  difficulty: number,
  grade: FsrsGrade
): number {
  const g = GRADE_NUMBER[grade];
  const deltaD = -w[6] * (g - 3);
  const nextD = difficulty + linearDamping(deltaD, difficulty);
  // Mean-reversion pulls difficulty back toward the "easy" baseline so it
  // doesn't drift to an extreme after a long run of the same rating.
  const meanReversionTarget = initDifficulty(w, "easy");
  const reverted = roundTo(w[7] * meanReversionTarget + (1 - w[7]) * nextD, 8);
  return clamp(reverted, 1, 10);
}

export function nextRecallStability(
  w: readonly number[],
  difficulty: number,
  stability: number,
  retrievability: number,
  grade: Exclude<FsrsGrade, "again">
): number {
  const hardPenalty = grade === "hard" ? w[15] : 1;
  const easyBonus = grade === "easy" ? w[16] : 1;
  const value =
    stability *
    (1 +
      Math.exp(w[8]) *
        (11 - difficulty) *
        Math.pow(stability, -w[9]) *
        (Math.exp((1 - retrievability) * w[10]) - 1) *
        hardPenalty *
        easyBonus);
  return roundTo(clamp(value, S_MIN, S_MAX), 8);
}

export function nextForgetStability(
  w: readonly number[],
  difficulty: number,
  stability: number,
  retrievability: number
): number {
  const value =
    w[11] *
    Math.pow(difficulty, -w[12]) *
    (Math.pow(stability + 1, w[13]) - 1) *
    Math.exp((1 - retrievability) * w[14]);
  return roundTo(clamp(value, S_MIN, S_MAX), 8);
}

// Used only when a card is reviewed again the SAME day (elapsedDays === 0) —
// a distinct, gentler update than the full recall/forget formulas above,
// which assume at least a day's gap.
export function nextShortTermStability(
  w: readonly number[],
  stability: number,
  grade: FsrsGrade
): number {
  const g = GRADE_NUMBER[grade];
  const sinc = Math.pow(stability, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
  const masked = grade !== "again" ? Math.max(sinc, 1) : sinc;
  return roundTo(clamp(stability * masked, S_MIN, S_MAX), 8);
}

export type FsrsCardState = {
  stability: number | null;
  difficulty: number | null;
  lastReviewedAt: Date | null;
};

export type FsrsUpdate = {
  stability: number;
  difficulty: number;
  intervalDays: number;
  dueAt: Date;
};

export function scheduleFsrsReview(
  weights: readonly number[],
  card: FsrsCardState,
  grade: FsrsGrade,
  now: Date = new Date()
): FsrsUpdate {
  const isNew = card.stability === null || card.difficulty === null;

  let stability: number;
  let difficulty: number;

  if (isNew) {
    stability = initStability(weights, grade);
    difficulty = initDifficulty(weights, grade);
  } else {
    const elapsedDays = card.lastReviewedAt
      ? Math.max(
          0,
          Math.floor(
            (now.getTime() - card.lastReviewedAt.getTime()) / 86_400_000
          )
        )
      : 0;
    const retrievability = forgettingCurve(
      weights,
      elapsedDays,
      card.stability!
    );

    if (elapsedDays === 0) {
      stability = nextShortTermStability(weights, card.stability!, grade);
    } else if (grade === "again") {
      const afterFail = nextForgetStability(
        weights,
        card.difficulty!,
        card.stability!,
        retrievability
      );
      // A lapse never drops stability below stability/e^(w17*w18), even if
      // the raw forgetting formula alone would say less — matches the
      // reference implementation's enable_short_term floor.
      const floor = card.stability! / Math.exp(weights[17] * weights[18]);
      stability = clamp(roundTo(floor, 8), S_MIN, afterFail);
    } else {
      stability = nextRecallStability(
        weights,
        card.difficulty!,
        card.stability!,
        retrievability,
        grade
      );
    }
    difficulty = nextDifficulty(weights, card.difficulty!, grade);
  }

  const intervalDays = clamp(
    Math.round(stability * intervalModifier(weights)),
    1,
    MAXIMUM_INTERVAL_DAYS
  );
  const dueAt = new Date(now);
  dueAt.setDate(dueAt.getDate() + intervalDays);

  return { stability, difficulty, intervalDays, dueAt };
}
