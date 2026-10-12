"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// 🤝 Home (/subjects): the packs colleagues shared in the last two weeks,
// from sharing.homeSummary — nothing shown that the server didn't return.
// What waits for an answer is on the bell of the home's top bar
// (components/home/HomeTop.tsx).
export function SharedHomeWidget() {
  const summary = trpc.sharing.homeSummary.useQuery();
  if (!summary.data?.recent.length) return null;

  return (
    <div className="sh-home">
      {summary.data.recent.map(pack => (
        <Link
          key={pack.bookId}
          href={`/books/${pack.bookId}`}
          className="sh-home-row is-recent"
        >
          <span className="sh-home-icon" aria-hidden="true">
            📘
          </span>
          <span className="sh-home-text">
            <strong dir="auto">{pack.bookTitle}</strong>
            <span>
              مشترك من{" "}
              <bdi>
                {pack.ownerName ||
                  (pack.ownerUsername ? `@${pack.ownerUsername}` : "زميل")}
              </bdi>
            </span>
          </span>
          <ChevronLeft size={18} aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
