import { describe, expect, it } from "vitest";
import {
  PUBLIC_QUIZZES,
  publicQuiz,
  quizJsonLd,
  quizPath,
  quizzesIn,
  relatedQuizzes,
  totalQuestions,
} from "./public";
import { SEED_QUIZZES } from "./seed";

describe("the catalogue's public pages", () => {
  it("are every quiz of the catalogue, once, under its own address", () => {
    expect(PUBLIC_QUIZZES.map(quiz => quiz.slug).sort()).toEqual(
      SEED_QUIZZES.map(entry => entry.quiz.slug).sort()
    );
    const paths = PUBLIC_QUIZZES.map(quiz => quizPath(quiz.slug));
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^\/quizzes\/[a-z0-9-]+$/);
    expect(quizzesIn("ar").length + quizzesIn("en").length).toBe(
      PUBLIC_QUIZZES.length
    );
    expect(totalQuestions(PUBLIC_QUIZZES)).toBe(
      SEED_QUIZZES.reduce((sum, entry) => sum + entry.quiz.questions.length, 0)
    );
  });

  it("carry the question, its four options and the right one", () => {
    const quiz = publicQuiz("ar-science-space")!;
    expect(quiz.language).toBe("ar");
    expect(quiz.channelName).toBe("مختبر الفضول");
    expect(quiz.questions[0]).toEqual({
      text: "ما أقرب الكواكب إلى الشمس؟",
      options: ["الزهرة", "عطارد", "المريخ", "الأرض"],
      correctIndex: 1,
    });
    expect(publicQuiz("no-such-quiz")).toBeNull();
  });

  it("show subjects, never the app's own occasion tags", () => {
    for (const quiz of PUBLIC_QUIZZES) {
      expect(quiz.tags.some(tag => tag.startsWith("occ:"))).toBe(false);
    }
  });

  it("suggest other quizzes of the same language, the same subject first", () => {
    const quiz = publicQuiz("en-science-space")!;
    const related = relatedQuizzes(quiz);
    expect(related.length).toBe(4);
    expect(related.every(other => other.language === "en")).toBe(true);
    expect(related.some(other => other.slug === quiz.slug)).toBe(false);
    expect(related[0].category).toBe("science");
  });

  it("describe themselves to a search engine as a quiz with its answers", () => {
    const quiz = publicQuiz("en-geo-world-capitals")!;
    const data = quizJsonLd(quiz, "https://example.test");
    expect(data["@type"]).toBe("Quiz");
    expect(data.url).toBe("https://example.test/quizzes/en-geo-world-capitals");
    expect(data.inLanguage).toBe("en");
    expect(data.hasPart.length).toBe(quiz.questions.length);
    expect(data.hasPart[0]).toEqual({
      "@type": "Question",
      eduQuestionType: "Multiple choice",
      name: "What is the capital of France?",
      acceptedAnswer: { "@type": "Answer", text: "Paris" },
      suggestedAnswer: [
        { "@type": "Answer", text: "Lyon" },
        { "@type": "Answer", text: "Marseille" },
        { "@type": "Answer", text: "Nice" },
      ],
    });
    // It is embedded in a <script>: nothing in it may close one.
    expect(JSON.stringify(PUBLIC_QUIZZES)).not.toMatch(/<\/?script/i);
  });
});
