import { OG_SIZE, renderOg } from "@/components/landing/og";

export const alt = "NiroLearn — غرف مذاكرة جماعية أونلاين مجانية";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOg({
    lead: "Free online study rooms,",
    marked: "together on one file.",
    footer: "Voice · Shared PDF with pens · YouTube together · Group quizzes",
  });
}
