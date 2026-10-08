import { describe, expect, it } from "vitest";
import { generateMathStage, mathTier } from "./math";
import { createRng } from "./rng";

// Independent checker: substitutes a candidate for "?" and evaluates both
// sides of the equation — it doesn't reuse the generator's own arithmetic.
function satisfies(prompt: string, candidate: string): boolean {
  const [lhs, rhs] = prompt
    .replace(/\?/g, candidate)
    .replace(/×/g, "*")
    .replace(/−/g, "-")
    .split("=");
  const evaluate = (expr: string) => {
    if (!/^[\d\s+\-*]+$/.test(expr)) throw new Error(`bad expr ${expr}`);
    return Function(`"use strict"; return (${expr});`)() as number;
  };
  return evaluate(lhs) === evaluate(rhs);
}

const SEEDS = Array.from({ length: 12 }, (_, i) => 1000 + i * 7919);

describe("Math Challenge generator", () => {
  it("every stage 1–100: 10 questions, 4 distinct options, exactly one correct", () => {
    for (let stage = 1; stage <= 100; stage++) {
      for (const seed of SEEDS) {
        const questions = generateMathStage(stage, createRng(seed + stage), 10);
        expect(questions).toHaveLength(10);
        expect(new Set(questions.map(q => q.prompt)).size).toBe(10);
        for (const q of questions) {
          expect(q.options).toHaveLength(4);
          expect(new Set(q.options).size).toBe(4);
          const right = q.options.filter(option => satisfies(q.prompt, option));
          expect(right, `${q.prompt} → ${q.options}`).toEqual([
            q.options[q.correctIndex],
          ]);
          for (const option of q.options) {
            expect(Number(option)).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  // CPU-heavy; needs room when the whole suite runs in parallel.
  }, 30000);

  it("distractors are plausible (close to the answer, not 63 vs 1000)", () => {
    for (let stage = 1; stage <= 100; stage += 3) {
      for (const q of generateMathStage(stage, createRng(stage * 31), 10)) {
        const answer = Number(q.options[q.correctIndex]);
        for (const option of q.options) {
          expect(Math.abs(Number(option) - answer)).toBeLessThanOrEqual(
            Math.max(30, answer * 0.35)
          );
        }
      }
    }
  });

  it("keeps multiplication out of the early stages", () => {
    for (let stage = 1; stage <= 75; stage++) {
      for (const q of generateMathStage(stage, createRng(stage), 10)) {
        expect(q.prompt).not.toContain("×");
      }
    }
    const late = Array.from({ length: 25 }, (_, i) =>
      generateMathStage(76 + i, createRng(i), 10)
    ).flat();
    expect(late.some(q => q.prompt.includes("×"))).toBe(true);
  });

  it("uses missing-number questions from stage 11, never before", () => {
    const early = generateMathStage(5, createRng(1), 10);
    expect(early.every(q => q.prompt.endsWith("= ?"))).toBe(true);
    const mid = Array.from({ length: 10 }, (_, i) =>
      generateMathStage(15, createRng(i), 10)
    ).flat();
    const missing = mid.filter(q => q.instruction === "أوجد الرقم الناقص");
    expect(missing.length).toBeGreaterThan(10);
  });

  it("timer tightens with the stage (8s → 7s → 6s → 5s), never below 5s", () => {
    expect(mathTier(1).timeLimitMs).toBe(8000);
    expect(mathTier(10).timeLimitMs).toBe(8000);
    expect(mathTier(11).timeLimitMs).toBe(7000);
    expect(mathTier(26).timeLimitMs).toBe(6000);
    expect(mathTier(51).timeLimitMs).toBe(5000);
    expect(mathTier(100).timeLimitMs).toBe(5000);
  });

  it("numbers grow with the stage (real difficulty progression)", () => {
    const averageAnswer = (stage: number) => {
      const qs = Array.from({ length: 20 }, (_, i) =>
        generateMathStage(stage, createRng(i * 13 + stage), 10)
      ).flat();
      return (
        qs.reduce((sum, q) => sum + Number(q.options[q.correctIndex]), 0) /
        qs.length
      );
    };
    const s1 = averageAnswer(1);
    const s20 = averageAnswer(20);
    const s60 = averageAnswer(60);
    expect(s20).toBeGreaterThan(s1);
    expect(s60).toBeGreaterThan(s20);
    expect(mathTier(1).maxOperand).toBeLessThan(mathTier(10).maxOperand);
  });

  it("is deterministic for a seed (the server can rebuild a stage)", () => {
    expect(generateMathStage(33, createRng(42), 10)).toEqual(
      generateMathStage(33, createRng(42), 10)
    );
  });
});
