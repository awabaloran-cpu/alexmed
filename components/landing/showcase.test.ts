// What the showcase says about Discover comes from the catalogue itself,
// and its Arabic counts agree with their noun.
import { describe, expect, it } from "vitest";
import { PUBLIC_QUIZZES, totalQuestions } from "@/lib/discover/public";
import { DISCOVER_FACTS, questionsLabel } from "./Showcase";

describe("the showcase", () => {
  it("counts questions in Arabic as the noun needs", () => {
    expect(questionsLabel(1)).toBe("سؤال واحد");
    expect(questionsLabel(2)).toBe("سؤالان");
    expect(questionsLabel(8)).toBe("8 أسئلة");
    expect(questionsLabel(10)).toBe("10 أسئلة");
    expect(questionsLabel(20)).toBe("20 سؤالًا");
  });

  it("reads Discover's numbers from the public catalogue", () => {
    expect(DISCOVER_FACTS.quizzes).toBe(PUBLIC_QUIZZES.length);
    expect(DISCOVER_FACTS.questions).toBe(totalQuestions(PUBLIC_QUIZZES));
    expect(DISCOVER_FACTS.categories.length).toBeGreaterThan(5);
    expect(DISCOVER_FACTS.channels).toBeGreaterThan(0);
  });
});
