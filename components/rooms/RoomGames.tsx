"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Cover } from "@/components/discover/Cover";
import type { DiscoverCategory } from "@/lib/discover/data";
import { label } from "@/lib/discover/i18n";
import { trpc } from "@/lib/trpc-client";
import { Sheet } from "./parts";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// Discover's subjects (lib/discover/data.ts DISCOVER_CATEGORIES, a server
// module: its list is written here, the type keeps the two the same).
const CATEGORIES: readonly DiscoverCategory[] = [
  "general",
  "geography",
  "history",
  "science",
  "animals",
  "sports",
];

// 🎮 The games of Discover, over the room: the leader picks one and it
// waits in the room, named, until they start it (the same ready card a
// "play with friends" from Discover lands on). Voice and chat stay as
// they are — the room is never left.
export default function RoomGames({
  onPick,
  onClose,
}: {
  onPick: (slug: string) => void;
  onClose: () => void;
}) {
  const { t, language } = useRooms();
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const games = trpc.discover.search.useQuery(
    {
      language,
      query: query || undefined,
      category: category ?? undefined,
    },
    { placeholderData: previous => previous, staleTime: 60_000 }
  );

  return (
    <Sheet title={t("games.title")} onClose={onClose}>
      <label className={s.gameSearch}>
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          value={typed}
          maxLength={64}
          placeholder={t("games.search")}
          aria-label={t("games.search")}
          onChange={event => setTyped(event.target.value)}
        />
      </label>
      <div className={s.gameChips} role="group">
        {[null, ...CATEGORIES].map(key => (
          <button
            key={key ?? "all"}
            type="button"
            aria-pressed={category === key}
            onClick={() => setCategory(key)}
          >
            {key ? label(language, key) : t("games.all")}
          </button>
        ))}
      </div>
      <p className={s.meta}>{t("games.pickHint")}</p>
      {games.isError ? (
        <>
          <p className={s.sub}>{t("catalog.loadFailed")}</p>
          <button
            type="button"
            className={`${s.btn} ${s.wide}`}
            onClick={() => games.refetch()}
          >
            {t("rooms.retry")}
          </button>
        </>
      ) : !games.data ? (
        <div className={s.skeleton} style={{ minHeight: 160 }} />
      ) : games.data.length === 0 ? (
        <p className={s.sub}>{t("games.none")}</p>
      ) : (
        <div className={s.gameGrid}>
          {games.data.map(game => (
            <button
              key={game.slug}
              type="button"
              className={s.gameCard}
              onClick={() => onPick(game.slug)}
            >
              <Cover
                art={game.art}
                color={game.color}
                image={game.coverImage}
                className={s.gameCover}
              />
              <b dir="auto">{game.title}</b>
              <small>
                {label(language, game.category)} ·{" "}
                {t("games.questions", { n: game.questionsCount })}
              </small>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
