"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";

export type McqCardData = {
  id: string;
  questionEn: string;
  choices: string[];
  correctIndex: number;
  explanationEn: string;
};

export type McqSubmitResult = {
  isCorrect: boolean;
  correctIndex: number;
  explanationEn: string;
};

// Shared one-question-at-a-time quiz interaction: hide answers until the
// student picks one, then reveal correct/incorrect + explanation. Used by
// /books/quizzes, the chapter reader's "الاختبار" tab, and /books/weak-points
// so all three record real attempts via the same submitMcqAttempt mutation
// instead of each re-implementing (or, as the chapter reader previously did,
// skipping) the interaction.
export default function McqCard({
  mcq,
  meta,
  onSubmit,
  onAnswered,
}: {
  mcq: McqCardData;
  meta?: string;
  onSubmit: (mcqId: string, selectedIndex: number) => Promise<McqSubmitResult>;
  onAnswered?: (result: McqSubmitResult) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<McqSubmitResult | null>(null);
  const [error, setError] = useState("");

  async function answer(index: number) {
    if (selected !== null) return;
    setError("");
    setSelected(index);
    try {
      const res = await onSubmit(mcq.id, index);
      setResult(res);
      onAnswered?.(res);
    } catch {
      setSelected(null);
      setError("تعذر حفظ إجابتك. اختر الإجابة مرة أخرى.");
    }
  }

  const answered = selected !== null && result !== null;

  return (
    <div className="panel-card">
      {meta && <span className="section-kicker">{meta}</span>}
      <strong
        className="en"
        style={{ display: "block", marginTop: meta ? 8 : 0 }}
      >
        {mcq.questionEn}
      </strong>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 12,
        }}
      >
        {mcq.choices.map((choice, i) => {
          const isSelected = selected === i;
          const isRightAnswer = answered && i === result.correctIndex;
          const isWrongSelected = answered && isSelected && !isRightAnswer;
          return (
            <button
              type="button"
              key={i}
              className="en"
              disabled={selected !== null}
              onClick={() => answer(i)}
              style={{
                textAlign: "left",
                padding: "9px 13px",
                borderRadius: 9,
                border: "1px solid",
                borderColor: isRightAnswer
                  ? "#69a17f"
                  : isWrongSelected
                    ? "#c8544d"
                    : "#e4ded5",
                background: isRightAnswer
                  ? "#e3f0e8"
                  : isWrongSelected
                    ? "#f9e3e0"
                    : "#fffdf9",
                cursor: selected !== null ? "default" : "pointer",
                fontSize: 12,
              }}
            >
              {choice}
            </button>
          );
        })}
      </div>
      {error && (
        <div className="inline-alert error" style={{ marginTop: 10 }}>
          <CircleAlert size={15} />
          {error}
        </div>
      )}
      {answered && (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: result.isCorrect ? "#528c6d" : "#974d49",
          }}
        >
          {result.isCorrect ? (
            <CheckCircle2 size={15} />
          ) : (
            <CircleAlert size={15} />
          )}
          {result.explanationEn}
        </div>
      )}
    </div>
  );
}
