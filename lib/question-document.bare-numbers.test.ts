// Question banks that write the question number without a "." or ")":
//   "07 A 6-year-old boy presents with…"      (number, space, stem)
//   "2-Dissociative anaesthesia is produced…" (number, hyphen, stem)
// Found on a real file sent through the Telegram bot: the stems of every
// multi-line question were cut in two, the first lines shown as the
// PREVIOUS question's explanation. The page texts below are that file's
// layout (lines exactly as the PDF reader returns them).
import { describe, expect, it } from "vitest";
import { analyzeQuestionDocument } from "./question-document";

const PAGE_1 = `FINAL 2025 | QUESTIONS & ANSWERS
Deduplicated study set 1
01 Which of the following statements regarding measuring and plotting children's
growth is true?
A. Correction for prematurity should be made up to the age of 6 months
B. Final height usually approximates the father's height
C. Once a child is 5 years old, height does not usually deviate from the centile line
D. It is normal for an infant's weight to cross centiles in the first months of life
Answer: D. It is normal for an infant's weight to cross centiles in the first months of life
02 Which vitamin is often deficient in breastfed infants?
A. Vitamin A
B. Vitamin B12
C. Vitamin C
D. Vitamin D
Answer: D. Vitamin D
03 The parents of a 6-week-old boy are attending the clinic because he started to
have attacks of vomiting since a few days. He is their first child and was born at
full term. Which of the following is true regarding his condition?
A. If the vomit contains milk then pyloric stenosis can be excluded
B. If the baby is dehydrated then gastroenteritis is the cause
C. If the baby is completely well and thriving, gastro-esophageal reflux should be
considered
D. The baby should be admitted to hospital for observation
Answer: C. If the baby is completely well and thriving, gastro-esophageal reflux should be
considered`;

const PAGE_2 = `FINAL 2025 | QUESTIONS & ANSWERS
Deduplicated study set 2
04 A 6-year-old boy presents with a fever of 39°C, sore throat, and a red rash with a
sandpaper texture. He also has red cheeks and a "strawberry" tongue. What is the
most appropriate treatment?
A. Amoxicillin
B. Acetaminophen
C. Antihistamines
D. Acyclovir
E. Penicillin
Answer: E. Penicillin
05 A 1-year-old infant arrives at the emergency department with a history of diarrhea
and poor fluid intake for one day. Examination reveals lethargy, heart rate 180
beats/min, respiratory rate 30 breaths/min, low blood pressure, poor skin turgor,
5-second capillary refill, and cool extremities. The child was given
6 mg of ondansetron earlier. Which fluid is the most appropriate management?
A. IV Dextrose 5%
B. Oral rehydration solution
C. 0.9% sodium chloride
D. Whole blood
Answer: C. 0.9% sodium chloride
06 You are going to counsel parents of a newborn about prevention of sudden infant
death syndrome (SIDS). Which of the following statements is accurate?
A. Infants should sleep in the same bed as the parent.
B. Infants should sleep on their back on a firm mattress with no accompanying
bedding or objects.
C. Pacifiers should be avoided.
Answer: B. Infants should sleep on their back on a firm mattress with no accompanying
bedding or objects.
07 What is the primary nutritional intervention for an infant diagnosed with marasmus?
A. Gradual refeeding with a balanced diet
B. Immediate high-calorie feeding
C. Iron supplementation
Answer: A. Gradual refeeding with a balanced diet`;

// The running header repeats on every page (three pages, as the reader's
// header detection needs to see it recur).
const PAGE_3 = `FINAL 2025 | QUESTIONS & ANSWERS
Deduplicated study set 3
08 Which of the following is the most common abdominal solid tumor in infancy and
childhood?
A. Neuroblastoma
B. Wilms tumor
C. Sarcoma
Answer: A. Neuroblastoma`;

const pages = [
  { page: 1, text: PAGE_1 },
  { page: 2, text: PAGE_2 },
  { page: 3, text: PAGE_3 },
];

describe("questions numbered without punctuation", () => {
  const { questions, needsReview } = analyzeQuestionDocument(pages);

  it("finds every question, none left for review", () => {
    expect(questions).toHaveLength(8);
    expect(needsReview).toHaveLength(0);
  });

  it("keeps a multi-line stem whole and drops the number from it", () => {
    expect(questions[3].questionText).toBe(
      'A 6-year-old boy presents with a fever of 39°C, sore throat, and a red rash with a sandpaper texture. He also has red cheeks and a "strawberry" tongue. What is the most appropriate treatment?'
    );
    expect(questions[0].questionText).toBe(
      "Which of the following statements regarding measuring and plotting children's growth is true?"
    );
    for (const question of questions) {
      expect(question.questionText).not.toMatch(/^\d/);
    }
  });

  it("never shows the next question's opening lines as this question's explanation", () => {
    for (const question of questions) {
      expect(question.explanationText).toBeNull();
    }
  });

  it("reads each stated answer", () => {
    expect(questions.map(q => q.extractedAnswerIndex)).toEqual([
      3, 3, 2, 4, 2, 1, 0, 0,
    ]);
  });

  it("a wrapped option or answer line stays part of the option, not an explanation", () => {
    expect(questions[2].options?.[2]).toBe(
      "If the baby is completely well and thriving, gastro-esophageal reflux should be considered"
    );
    expect(questions[2].explanationText).toBeNull();
    expect(questions[5].options?.[1]).toBe(
      "Infants should sleep on their back on a firm mattress with no accompanying bedding or objects."
    );
  });

  it("a number inside a stem is not a new question", () => {
    // "5-second capillary refill" and "6 mg of ondansetron" both start a
    // line of question 05's stem.
    expect(questions[4].questionText).toContain("5-second capillary refill");
    expect(questions[4].questionText).toContain(
      "6 mg of ondansetron earlier. Which fluid is the most appropriate management?"
    );
    expect(questions[4].options).toHaveLength(4);
  });

  it("a question right after a wrapped answer line is still found", () => {
    expect(questions[6].questionText).toBe(
      "What is the primary nutritional intervention for an infant diagnosed with marasmus?"
    );
  });
});

describe('questions numbered "2-Text", restarting at 1 in each section', () => {
  const text = `1-All volatile anaesthetics should be delivered using devices known as:
A. Flowmeters
B. Vaporizers
C. Regulators
2-Dissociative anaesthesia is produced by:
A. Propofol
B. Ketamine
C. Thiopental
3-The best non depolarizing relaxant for a 2-year-old cardiac patient
is:
A. Atracurium
B. Vecuronium
C. Pancuronium
1-All of the following are absolute contraindications for spinal anaesthesia EXCEPT:
A. Patient refusal
B. Infection at the site
C. Hypertension
2-Soda lime is used to:
A. Absorb carbon dioxide
B. Humidify gases
C. Warm gases`;
  const { questions } = analyzeQuestionDocument([{ page: 1, text }]);

  it("finds all five, with clean stems", () => {
    expect(questions.map(q => q.questionText)).toEqual([
      "All volatile anaesthetics should be delivered using devices known as:",
      "Dissociative anaesthesia is produced by:",
      "The best non depolarizing relaxant for a 2-year-old cardiac patient is:",
      "All of the following are absolute contraindications for spinal anaesthesia EXCEPT:",
      "Soda lime is used to:",
    ]);
    expect(questions.every(q => q.options?.length === 3)).toBe(true);
  });
});

describe("documents that already punctuate their numbers", () => {
  it("are left exactly as they were", () => {
    const text = `1. A patient was given
5 mg of morphine. Which effect is expected?
A. Miosis
B. Mydriasis
2. Which drug reverses it?
A. Naloxone
B. Flumazenil`;
    const { questions } = analyzeQuestionDocument([{ page: 1, text }]);
    expect(questions.map(q => q.questionText)).toEqual([
      "A patient was given 5 mg of morphine. Which effect is expected?",
      "Which drug reverses it?",
    ]);
  });
});
