import { describe, expect, it } from "vitest";
import { FSRS_DEFAULT_WEIGHTS, scheduleFsrsReview } from "./fsrs";
import {
  intervalLabelAr,
  nextIntervalDays,
  type ReviewSchedule,
} from "./review-preview";
import { applySrsRating } from "./srs";

const NOW = new Date("2026-10-11T09:00:00Z");

describe("what a rating button says it will do", () => {
  it("is exactly what the server's scheduler does for a book card", () => {
    const state = {
      stability: 6.4,
      difficulty: 5.1,
      lastReviewedAt: new Date("2026-10-04T09:00:00Z"),
    };
    const schedule: ReviewSchedule = {
      source: "book",
      ...state,
      lastReviewedAt: state.lastReviewedAt.toISOString(),
    };
    for (const rating of ["again", "hard", "good", "easy"] as const) {
      expect(nextIntervalDays(schedule, rating, NOW)).toBe(
        scheduleFsrsReview(FSRS_DEFAULT_WEIGHTS, state, rating, NOW)
          .intervalDays
      );
    }
    // A harder rating never brings the card back later than an easier one.
    const days = (["again", "hard", "good", "easy"] as const).map(
      rating => nextIntervalDays(schedule, rating, NOW)!
    );
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it("covers a book card that was never reviewed", () => {
    const fresh: ReviewSchedule = {
      source: "book",
      stability: null,
      difficulty: null,
      lastReviewedAt: null,
    };
    expect(nextIntervalDays(fresh, "easy", NOW)).toBeGreaterThanOrEqual(
      nextIntervalDays(fresh, "good", NOW)!
    );
  });

  it("is exactly what the server's scheduler does for a deck card", () => {
    const state = { easeFactor: 2.5, intervalDays: 4, reviewCount: 3 };
    const schedule: ReviewSchedule = { source: "deck", ...state };
    for (const rating of ["hard", "good", "easy"] as const) {
      expect(nextIntervalDays(schedule, rating, NOW)).toBe(
        applySrsRating(state, rating, NOW).intervalDays
      );
    }
    // A deck card has no "again".
    expect(nextIntervalDays(schedule, "again", NOW)).toBeNull();
  });

  it("says nothing when the card carries no schedule", () => {
    expect(nextIntervalDays(undefined, "good", NOW)).toBeNull();
  });
});

describe("the interval in Arabic", () => {
  it.each([
    [0, "اليوم"],
    [1, "غدًا"],
    [2, "بعد يومين"],
    [3, "بعد 3 أيام"],
    [10, "بعد 10 أيام"],
    [11, "بعد 11 يومًا"],
    [29, "بعد 29 يومًا"],
    [30, "بعد شهر"],
    [61, "بعد شهرين"],
    [95, "بعد 3 أشهر"],
    [340, "بعد 11 شهرًا"],
    [365, "بعد سنة"],
    [730, "بعد سنتين"],
    [1200, "بعد 3 سنوات"],
  ])("%i days → %s", (days, label) => {
    expect(intervalLabelAr(days)).toBe(label);
  });
});
