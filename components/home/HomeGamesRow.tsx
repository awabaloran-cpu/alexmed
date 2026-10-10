"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import s from "./HomeGamesRow.module.css";

// 🧩 The solo games, as a row to swipe at the end of the home page. Shown
// only while Study Rooms is on: the Rooms tab then takes the games' place
// in the bottom bar (components/BottomNav.tsx), and this row is where the
// games live. With the feature off, the "ألعاب" tab is still there and the
// home page is unchanged.
const TINTS = [
  "#5b6cff",
  "#d9466f",
  "#d98312",
  "#0f9a8a",
  "#8a5bd6",
  "#2f8fd0",
];

export function HomeGamesRow() {
  const roomsOn =
    trpc.rooms.enabled.useQuery(undefined, {
      staleTime: Infinity,
      retry: false,
    }).data?.enabled === true;
  const overview = trpc.brainGames.overview.useQuery(undefined, {
    enabled: roomsOn,
    staleTime: 60_000,
    retry: false,
  });
  if (!roomsOn || !overview.data?.length) return null;

  return (
    <section className={s.wrap} aria-labelledby="home-games-title">
      <div className={s.head}>
        <h2 id="home-games-title">استراحة: ألعاب</h2>
        <Link href="/games">الكل ‹</Link>
      </div>
      <div className={s.row}>
        {overview.data.map((game, i) => (
          <Link key={game.id} href={`/games/${game.id}`} className={s.card}>
            <span
              className={s.art}
              style={{ background: TINTS[i % TINTS.length] }}
              aria-hidden="true"
            >
              {game.emoji}
            </span>
            <strong>{game.titleAr}</strong>
            <span className={s.meta}>
              {game.progress?.bestScore
                ? `أفضل نتيجة ${game.progress.bestScore.toLocaleString("en")}`
                : game.taglineAr}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
