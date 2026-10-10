// What each rating button on the review screen would do, said before it is
// pressed: "جيدة — بعد 3 أيام". Pure — it runs the SAME schedulers the
// server runs when the rating is saved (lib/fsrs.ts for a book's cards,
// lib/srs.ts for a deck's), on the scheduling state the due-cards queries
// return, so the label is the real next interval and not an estimate.
import {
  FSRS_DEFAULT_WEIGHTS,
  scheduleFsrsReview,
  type FsrsGrade,
} from "./fsrs";
import { applySrsRating, type SrsRating } from "./srs";

export type ReviewSchedule =
  | {
      source: "book";
      stability: number | null;
      difficulty: number | null;
      lastReviewedAt: string | Date | null;
    }
  | {
      source: "deck";
      easeFactor: number;
      intervalDays: number;
      reviewCount: number;
    };

// When this card would come back after `rating`, in whole days from now.
// null when the rating does not exist for this kind of card ("again" on a
// deck card) or the card carries no scheduling state.
export function nextIntervalDays(
  schedule: ReviewSchedule | undefined,
  rating: FsrsGrade,
  now: Date = new Date()
): number | null {
  if (!schedule) return null;
  if (schedule.source === "book") {
    return scheduleFsrsReview(
      FSRS_DEFAULT_WEIGHTS,
      {
        stability: schedule.stability,
        difficulty: schedule.difficulty,
        lastReviewedAt: schedule.lastReviewedAt
          ? new Date(schedule.lastReviewedAt)
          : null,
      },
      rating,
      now
    ).intervalDays;
  }
  if (rating === "again") return null;
  return applySrsRating(schedule, rating as SrsRating, now).intervalDays;
}

// "اليوم"، "غدًا"، "بعد 3 أيام"، "بعد شهرين"…
export function intervalLabelAr(days: number): string {
  const whole = Math.max(0, Math.round(days));
  if (whole === 0) return "اليوم";
  if (whole === 1) return "غدًا";
  if (whole === 2) return "بعد يومين";
  if (whole <= 10) return `بعد ${whole} أيام`;
  if (whole < 30) return `بعد ${whole} يومًا`;
  if (whole < 365) {
    const months = Math.round(whole / 30);
    if (months <= 1) return "بعد شهر";
    if (months === 2) return "بعد شهرين";
    return months <= 10 ? `بعد ${months} أشهر` : `بعد ${months} شهرًا`;
  }
  const years = Math.round(whole / 365);
  if (years <= 1) return "بعد سنة";
  if (years === 2) return "بعد سنتين";
  return `بعد ${years} سنوات`;
}
