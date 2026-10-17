import { OG_SIZE, renderOg } from "@/components/landing/og";

export const alt = "NiroLearn — اختبارات ومسابقات أسئلة مع الأصدقاء";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOg({
    lead: "Quizzes to play with friends,",
    marked: "same question, same moment.",
    footer: "Ready quizzes · Your own questions · Points for right and fast",
  });
}
