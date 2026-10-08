import { describe, expect, it } from "vitest";
import {
  generateMultiplicationStage,
  multiplicationTier,
} from "./multiplication";
import { createRng } from "./rng";

const parse = (prompt: string) => {
  const match = /^(\d+) × (\d+) = \?$/.exec(prompt);
  if (!match) throw new Error(`bad prompt ${prompt}`);
  return [Number(match[1]), Number(match[2])] as const;
};

describe("Multiplication generator", () => {
  it("every stage 1–100: 10 unique facts, 4 distinct options, one correct", () => {
    for (let stage = 1; stage <= 100; stage++) {
      for (let seed = 0; seed < 8; seed++) {
        const questions = generateMultiplicationStage(
          stage,
          createRng(seed * 977 + stage),
          10
        );
        expect(questions).toHaveLength(10);
        const facts = questions.map(q =>
          [...parse(q.prompt)].sort((a, b) => a - b).join("x")
        );
        expect(new Set(facts).size).toBe(10);
        for (const q of questions) {
          const [a, b] = parse(q.prompt);
          expect(new Set(q.options).size).toBe(4);
          const correct = q.options.filter(o => Number(o) === a * b);
          expect(correct).toEqual([q.options[q.correctIndex]]);
          for (const option of q.options) {
            expect(Number(option)).toBeGreaterThanOrEqual(0);
            expect(Math.abs(Number(option) - a * b)).toBeLessThanOrEqual(
              Math.max(30, a * b * 0.3)
            );
          }
        }
      }
    }
  // CPU-heavy; needs room when the whole suite runs in parallel.
  }, 30000);

  it("follows the tables → harder products progression", () => {
    const pairs = (stage: number) =>
      Array.from({ length: 10 }, (_, s) =>
        generateMultiplicationStage(stage, createRng(s), 10)
      )
        .flat()
        .map(q => parse(q.prompt));
    // Stage 1–10: tables 2–5.
    for (const [a, b] of pairs(5)) {
      expect(Math.min(a, b)).toBeLessThanOrEqual(5);
      expect(Math.max(a, b)).toBeLessThanOrEqual(10);
    }
    // Stage 11–25: tables up to 10.
    for (const [a, b] of pairs(20)) {
      expect(Math.max(a, b)).toBeLessThanOrEqual(10);
    }
    // Stage 41–60: two-digit × one-digit (like 17 × 6).
    for (const [a, b] of pairs(50)) {
      expect(Math.max(a, b)).toBeGreaterThanOrEqual(11);
      expect(Math.min(a, b)).toBeLessThanOrEqual(9);
    }
    // Stage 81+: two-digit × two-digit (like 24 × 13).
    for (const [a, b] of pairs(90)) {
      expect(Math.min(a, b)).toBeGreaterThanOrEqual(11);
    }
  });

  it("gives the harder tiers enough time (never impossible)", () => {
    expect(multiplicationTier(1).timeLimitMs).toBe(8000);
    expect(multiplicationTier(30).timeLimitMs).toBe(7000);
    expect(multiplicationTier(90).timeLimitMs).toBeGreaterThanOrEqual(10000);
  });

  it("uses the one-factor-off mistakes as distractors", () => {
    const qs = Array.from({ length: 20 }, (_, s) =>
      generateMultiplicationStage(15, createRng(s), 10)
    ).flat();
    const withFactorSlip = qs.filter(q => {
      const [a, b] = parse(q.prompt);
      return q.options.some(
        o => Number(o) === (a + 1) * b || Number(o) === a * (b + 1)
      );
    });
    expect(withFactorSlip.length).toBeGreaterThan(qs.length / 2);
  });
});
