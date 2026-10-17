import { OG_SIZE, renderOg } from "@/components/landing/og";

export const alt = "NiroLearn — حل أسئلة بالذكاء الاصطناعي مع الشرح";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOg({
    lead: "Solve a PDF's questions with AI,",
    marked: "with every answer explained.",
    footer: "Multiple choice · Arabic and English · Explanations",
  });
}
