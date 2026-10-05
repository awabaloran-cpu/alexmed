import type { Metadata } from "next";
import { Suspense } from "react";
import PublicExamClient from "./PublicExamClient";

export const metadata: Metadata = {
  title: "امتحان عام | NiroLearn",
  robots: { index: false, follow: false },
};

export default async function PublicExamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <Suspense>
      <PublicExamClient slug={slug} />
    </Suspense>
  );
}
