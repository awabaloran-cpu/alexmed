import { describe, expect, it } from "vitest";
import {
  forgettingCurve,
  FSRS_DEFAULT_WEIGHTS,
  initDifficulty,
  initStability,
  nextDifficulty,
  nextForgetStability,
  nextRecallStability,
  scheduleFsrsReview,
} from "./fsrs";

const w = FSRS_DEFAULT_WEIGHTS;

describe("forgettingCurve", () => {
  it("returns ~1 (100% recall) at zero elapsed days regardless of stability", () => {
    expect(forgettingCurve(w, 0, 5)).toBeCloseTo(1, 5);
    expect(forgettingCurve(w, 0, 500)).toBeCloseTo(1, 5);
  });

  it("equals exactly 0.9 when elapsed days equals stability — the defining property of 'stability'", () => {
    for (const stability of [1, 5, 30, 365]) {
      expect(forgettingCurve(w, stability, stability)).toBeCloseTo(0.9, 6);
    }
  });

  it("is monotonically decreasing as elapsed days grows", () => {
    const r10 = forgettingCurve(w, 10, 30);
    const r20 = forgettingCurve(w, 20, 30);
    const r40 = forgettingCurve(w, 40, 30);
    expect(r20).toBeLessThan(r10);
    expect(r40).toBeLessThan(r20);
  });
});

describe("initStability / initDifficulty", () => {
  it("initStability pulls directly from the first 4 weights, floored at 0.1", () => {
    expect(initStability(w, "again")).toBeCloseTo(w[0], 8);
    expect(initStability(w, "hard")).toBeCloseTo(w[1], 8);
    expect(initStability(w, "good")).toBeCloseTo(w[2], 8);
    expect(initStability(w, "easy")).toBeCloseTo(w[3], 8);
  });

  it("initDifficulty decreases as the first rating gets easier (an easy first card is not a hard card)", () => {
    const dAgain = initDifficulty(w, "again");
    const dHard = initDifficulty(w, "hard");
    const dGood = initDifficulty(w, "good");
    const dEasy = initDifficulty(w, "easy");
    expect(dAgain).toBeGreaterThan(dHard);
    expect(dHard).toBeGreaterThan(dGood);
    expect(dGood).toBeGreaterThan(dEasy);
  });

  it("keeps difficulty within the documented [1, 10] range", () => {
    for (const grade of ["again", "hard", "good", "easy"] as const) {
      const d = initDifficulty(w, grade);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(10);
    }
  });
});

describe("nextRecallStability", () => {
  it("grows stability more for easier ratings, given identical difficulty/stability/retrievability", () => {
    const args = [w, 5, 10, 0.85] as const;
    const hard = nextRecallStability(...args, "hard");
    const good = nextRecallStability(...args, "good");
    const easy = nextRecallStability(...args, "easy");
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });

  it("grows stability on a successful review (good, moderate retrievability)", () => {
    const s = nextRecallStability(w, 5, 10, 0.85, "good");
    expect(s).toBeGreaterThan(10);
  });
});

describe("nextForgetStability", () => {
  it("produces a positive, bounded stability after a lapse", () => {
    const s = nextForgetStability(w, 5, 10, 0.3);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(10); // a lapse should not grow stability
  });
});

describe("nextDifficulty", () => {
  it("increases difficulty after 'again' and decreases it after 'easy'", () => {
    const base = 5;
    expect(nextDifficulty(w, base, "again")).toBeGreaterThan(base);
    expect(nextDifficulty(w, base, "easy")).toBeLessThan(base);
  });

  it("stays within [1, 10] even from an extreme starting point", () => {
    expect(nextDifficulty(w, 10, "again")).toBeLessThanOrEqual(10);
    expect(nextDifficulty(w, 1, "easy")).toBeGreaterThanOrEqual(1);
  });
});

describe("scheduleFsrsReview", () => {
  const day = 24 * 60 * 60 * 1000;

  it("initializes a brand-new card (null stability/difficulty) from the grade alone", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const result = scheduleFsrsReview(
      w,
      { stability: null, difficulty: null, lastReviewedAt: null },
      "good",
      now
    );
    expect(result.stability).toBeCloseTo(initStability(w, "good"), 8);
    expect(result.intervalDays).toBeGreaterThanOrEqual(1);
    expect(result.dueAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("schedules a longer interval after a second consecutive 'good' review than the first", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const first = scheduleFsrsReview(
      w,
      { stability: null, difficulty: null, lastReviewedAt: null },
      "good",
      start
    );
    const secondReviewTime = new Date(
      start.getTime() + first.intervalDays * day
    );
    const second = scheduleFsrsReview(
      w,
      {
        stability: first.stability,
        difficulty: first.difficulty,
        lastReviewedAt: start,
      },
      "good",
      secondReviewTime
    );
    expect(second.intervalDays).toBeGreaterThan(first.intervalDays);
  });

  it("sharply shortens the interval after 'again' on an established card (a lapse)", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const established = { stability: 30, difficulty: 5, lastReviewedAt: start };
    const reviewTime = new Date(start.getTime() + 30 * day);

    const good = scheduleFsrsReview(w, established, "good", reviewTime);
    const again = scheduleFsrsReview(w, established, "again", reviewTime);

    expect(again.stability).toBeLessThan(established.stability!);
    expect(again.intervalDays).toBeLessThan(good.intervalDays);
  });

  it("uses the same-day short-term path when reviewed again within the same day", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const established = { stability: 10, difficulty: 5, lastReviewedAt: start };
    // Reviewed again 2 hours later — still elapsedDays === 0.
    const laterSameDay = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const result = scheduleFsrsReview(w, established, "good", laterSameDay);
    // Same-day "good"/"easy" masks the increment to at least 1x (never
    // shrinks same-day on a positive rating).
    expect(result.stability).toBeGreaterThanOrEqual(established.stability!);
  });
});
