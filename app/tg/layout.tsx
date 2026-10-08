import type { Metadata } from "next";

// The Mini App's front door (app/tg/page.tsx) is a client page; its
// metadata lives here. Nothing to index: it only signs in and redirects.
export const metadata: Metadata = {
  title: "NiroLearn",
  robots: { index: false, follow: false },
};

export default function TelegramMiniAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
