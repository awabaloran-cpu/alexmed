import Landing from "@/components/landing/Landing";
import StructuredData from "@/components/landing/StructuredData";
import { BASE_OPEN_GRAPH, SITE_DESCRIPTION, SITE_TITLE } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    ...BASE_OPEN_GRAPH,
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

// The public landing page. Signed-in students are served the app home at
// this same URL by middleware.ts, which looks at the session cookie before
// this page is reached. Nothing is read from the request here, so the page
// is built once and served as a file: it used to check the session itself,
// which made every visit a fresh render sent with "no-store" (and kept the
// browser from restoring the page on Back). Nothing here imports the app
// home, so this route ships none of its CSS or JS.
export default function Page() {
  return (
    <>
      <StructuredData />
      <Landing />
    </>
  );
}
