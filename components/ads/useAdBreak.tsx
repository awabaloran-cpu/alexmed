"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { isBreakAfter } from "@/lib/ads/policy";
import { trpc } from "@/lib/trpc-client";
import AdBreak from "./AdBreak";

// 📣 Ad breaks for a viewer that shows one card at a time (quiz questions,
// flashcards, Exam Focus cards). The viewer only does two things:
//
//   const ads = useAdBreak(bookId);
//   onNext = () => ads.advance(position, total, moveToNextCard);
//   …and renders `ads.node` in place of its card while it is not null.
//
// Whether there is a break at all, how often, and what fills it is decided
// by lib/ads/policy.ts (asked through ads.questionBreakPolicy) — never by
// the viewer. Without a bookId, on a paid plan, or with ads off, `advance`
// simply moves on and `node` is always null.
// "?adPreview=1" in the address: an admin asking to see the break (the
// server ignores it for anyone else).
export function adPreviewRequested(): boolean {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("adPreview")
  );
}

export function useAdBreak(bookId: string | undefined): {
  // `position` is the 1-based number of the card being left.
  advance: (position: number, total: number, move: () => void) => void;
  node: ReactNode;
} {
  const policy = trpc.ads.questionBreakPolicy.useQuery(
    { bookId: bookId ?? "", preview: adPreviewRequested() },
    {
      enabled: !!bookId,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    }
  ).data;
  const [pending, setPending] = useState<{
    afterPosition: number;
    total: number;
    move: () => void;
  } | null>(null);
  // Each break shows once per visit, however the student moves around.
  const shown = useRef(new Set<number>());

  const every = policy?.enabled ? policy.questionsPerBreak : 0;
  const advance = useCallback(
    (position: number, total: number, move: () => void) => {
      if (
        every &&
        isBreakAfter(position, total, every) &&
        !shown.current.has(position)
      ) {
        shown.current.add(position);
        setPending({ afterPosition: position, total, move });
        return;
      }
      move();
    },
    [every]
  );

  const node =
    pending && policy?.enabled && bookId ? (
      <AdBreak
        policy={policy}
        bookId={bookId}
        info={{
          afterPosition: pending.afterPosition,
          total: pending.total,
          answered: 0,
          correct: 0,
          onContinue: () => {
            const { move } = pending;
            setPending(null);
            move();
          },
        }}
      />
    ) : null;

  return { advance, node };
}
