import { OG_SIZE, renderOg } from "@/components/landing/og";

export const alt = "NiroLearn — أسئلة سنوات سابقة إلى اختبار تفاعلي مع شرح";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOg({
    lead: "Past exam questions,",
    marked: "turned into an interactive quiz.",
    footer: "Your PDF · Instant feedback · An explanation for every answer",
  });
}
