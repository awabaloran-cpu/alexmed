// 🧠 Card / question types of the knowledge-based study tools
// (lib/knowledge-study.ts) and their Arabic labels. Dependency-free so the
// study UI can import it without pulling server code into the bundle.
export const CARD_TYPES = [
  "definition",
  "mechanism",
  "classification",
  "association",
  "clinical_distinction",
  "number_dose",
  "confusion",
  "recall",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const QUESTION_TYPES = [
  "recall",
  "clinical_vignette",
  "association",
  "differentiation",
  "next_best_step",
  "diagnosis",
  "management",
  "complication",
  "misconception",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABEL_AR: Record<QuestionType, string> = {
  recall: "تذكّر",
  clinical_vignette: "حالة سريرية",
  association: "ارتباط",
  differentiation: "تمييز",
  next_best_step: "الخطوة التالية",
  diagnosis: "تشخيص",
  management: "علاج",
  complication: "مضاعفات",
  misconception: "فخ شائع",
};

export const CARD_TYPE_LABEL_AR: Record<CardType, string> = {
  definition: "تعريف",
  mechanism: "آلية",
  classification: "تصنيف",
  association: "ارتباط",
  clinical_distinction: "تمييز سريري",
  number_dose: "رقم / جرعة",
  confusion: "خلط شائع",
  recall: "تذكّر",
};

export function questionTypeLabel(type: string | null | undefined): string {
  return type && type in QUESTION_TYPE_LABEL_AR
    ? QUESTION_TYPE_LABEL_AR[type as QuestionType]
    : "";
}
