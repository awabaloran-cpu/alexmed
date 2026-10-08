import Providers from "@/components/Providers";
import {
  BASE_OPEN_GRAPH,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";
import { readAdConfig } from "@/lib/ads/policy";
import type { Metadata, Viewport } from "next";
import { Noto_Naskh_Arabic, Readex_Pro } from "next/font/google";
// Only the small shared base here; the app stylesheet (globals.css) is
// imported by the app's own layouts and pages, so the public marketing
// pages don't download and parse it.
import "./base.css";

// Self-hosted by next/font: no render-blocking Google Fonts stylesheet, and
// a size-matched fallback so text doesn't jump when the font arrives.
// globals.css reads them through --font-readex / --font-naskh.
const readexPro = Readex_Pro({
  subsets: ["arabic", "latin"],
  display: "swap",
  variable: "--font-readex",
});
// The reading face is secondary: not preloaded (its ~50KB competed with the
// HTML, CSS and UI font before first paint) and "optional", so a view that
// doesn't have it yet keeps the fallback instead of re-flowing when it
// lands. It is cached for every later visit.
const notoNaskh = Noto_Naskh_Arabic({
  subsets: ["arabic", "latin"],
  display: "optional",
  preload: false,
  variable: "--font-naskh",
});

const ADSENSE_CLIENT = readAdConfig(process.env).adsenseClient;

// Site-wide defaults. Each public page sets its own title, description and
// canonical; app pages behind sign-in inherit these and are kept out of the
// sitemap.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // No og:title here: a page without its own falls back to its <title>
  // rather than inheriting the home page's.
  openGraph: BASE_OPEN_GRAPH,
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
  // Google AdSense's ownership check (its "meta tag" method), present only
  // when a publisher id is configured. Chosen over pasting AdSense's script
  // into every page: the script is loaded only where an ad is actually
  // shown (components/ads/AdBreak.tsx), never for paying students.
  ...(ADSENSE_CLIENT
    ? { other: { "google-adsense-account": ADSENSE_CLIENT } }
    : {}),
};

export const viewport: Viewport = {
  themeColor: "#1b2340",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${readexPro.variable} ${notoNaskh.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
