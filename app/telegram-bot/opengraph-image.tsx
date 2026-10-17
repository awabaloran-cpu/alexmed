import { OG_SIZE, renderOg } from "@/components/landing/og";

export const alt =
  "NiroLearn — بوت تلغرام يحوّل PDF إلى أسئلة وملخص وفلاش كارد";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOg({
    lead: "Send a PDF on Telegram,",
    marked: "get questions with explanations.",
    footer: "@Nirolearnbot · Arabic explanations · Inside Telegram",
  });
}
