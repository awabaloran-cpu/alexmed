"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { Plus, Search } from "lucide-react";
import { COUNTRIES } from "@/lib/study-rooms/countries";
import { trpc } from "@/lib/trpc-client";
import {
  RoomCard,
  SectionCard,
  sectionColor,
  sectionIcon,
  sectionName,
} from "./parts";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// The filters every list of public rooms shares.
export function useRoomFilters() {
  const [q, setQ] = useState("");
  const [language, setLanguage] = useState<"" | "ar" | "en" | "mixed">("");
  const [country, setCountry] = useState("");
  const [womenOnly, setWomenOnly] = useState(false);
  const query = useDeferredValue(q.trim());
  return {
    q,
    setQ,
    language,
    setLanguage,
    country,
    setCountry,
    womenOnly,
    setWomenOnly,
    input: {
      ...(query.length >= 2 ? { q: query } : {}),
      ...(language ? { language } : {}),
      ...(country ? { country } : {}),
      ...(womenOnly ? { womenOnly: true } : {}),
    },
    active: query.length >= 2 || !!language || !!country || womenOnly,
  };
}

export function RoomFilters({
  filters,
  placeholder,
}: {
  filters: ReturnType<typeof useRoomFilters>;
  placeholder: string;
}) {
  const { t, language, viewer } = useRooms();
  return (
    <>
      <label className={s.search}>
        <Search size={17} aria-hidden="true" />
        <input
          id="rooms-search"
          type="search"
          value={filters.q}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={event => filters.setQ(event.target.value)}
        />
      </label>
      <div className={s.chips}>
        <label className={`${s.chip} ${filters.language ? s.chipOn : ""}`}>
          <select
            id="rooms-filter-language"
            aria-label={t("filter.language")}
            value={filters.language}
            onChange={event =>
              filters.setLanguage(event.target.value as typeof filters.language)
            }
          >
            <option value="">{t("filter.language")}</option>
            <option value="ar">{t("lang.ar")}</option>
            <option value="en">{t("lang.en")}</option>
            <option value="mixed">{t("lang.mixed")}</option>
          </select>
        </label>
        <label className={`${s.chip} ${filters.country ? s.chipOn : ""}`}>
          <select
            id="rooms-filter-country"
            aria-label={t("filter.country")}
            value={filters.country}
            onChange={event => filters.setCountry(event.target.value)}
          >
            <option value="">{t("filter.country")}</option>
            {COUNTRIES.map(item => (
              <option key={item.code} value={item.code}>
                {item[language]}
              </option>
            ))}
          </select>
        </label>
        {viewer.gender === "female" ? (
          <button
            type="button"
            className={`${s.chip} ${filters.womenOnly ? s.chipWomen : ""}`}
            aria-pressed={filters.womenOnly}
            onClick={() => filters.setWomenOnly(!filters.womenOnly)}
          >
            {t("filter.womenOnly")}
          </button>
        ) : null}
      </div>
    </>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useRooms();
  return (
    <div className={s.empty} role="alert">
      <b>{t("rooms.loadFailed")}</b>
      <button className={s.btn} type="button" onClick={onRetry}>
        {t("rooms.retry")}
      </button>
    </div>
  );
}

const Skeletons = ({ n }: { n: number }) => (
  <div className={s.cards} aria-busy="true">
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className={s.skeleton} />
    ))}
  </div>
);

// The Rooms tab. An adult: search and filters, the coloured sections with
// their live counts, then "live now" in two rows. A minor: their section
// and their own private rooms — no discovery at all.
export default function RoomsHome() {
  const { t, viewer, language } = useRooms();
  const adult = viewer.audience === "adult";
  const filters = useRoomFilters();
  const sections = trpc.rooms.sections.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const mine = trpc.rooms.mine.useQuery();
  const history = trpc.rooms.history.useQuery();
  const live = trpc.rooms.explore.useQuery(filters.input, {
    enabled: adult,
    refetchInterval: 20_000,
    placeholderData: previous => previous,
  });
  const colorOf = new Map(
    (sections.data ?? []).map(section => [section.id, section.color])
  );

  return (
    <>
      <div className={s.top}>
        <h1>{t("rooms.title")}</h1>
        <Link className={`${s.btn} ${s.primary}`} href="/rooms/new">
          <Plus size={17} aria-hidden="true" />
          {adult ? t("rooms.new") : t("rooms.newPrivate")}
        </Link>
      </div>

      {adult ? (
        <RoomFilters filters={filters} placeholder={t("rooms.search")} />
      ) : (
        <p className={s.note}>
          {t("rooms.minorNote")} {t("rooms.minorWhy")}
        </p>
      )}

      {filters.active ? null : (
        <>
          <p className={s.sub}>{t("rooms.sections")}</p>
          {sections.isLoading ? (
            <Skeletons n={4} />
          ) : sections.error ? (
            <LoadError onRetry={() => sections.refetch()} />
          ) : (
            <div className={s.secs}>
              {(sections.data ?? []).map(section => (
                <SectionCard key={section.id} section={section} />
              ))}
            </div>
          )}
        </>
      )}

      {mine.data?.length ? (
        <>
          <p className={s.sub}>{t("rooms.mine")}</p>
          <div className={s.cards}>
            {mine.data.map(room => (
              <RoomCard
                key={room.id}
                room={room}
                sectionColorName={colorOf.get(room.sectionId)}
              />
            ))}
          </div>
        </>
      ) : null}

      {adult ? (
        <>
          <div className={s.row}>
            <span className={s.live}>
              <i />
              {t("rooms.liveNow")}
            </span>
            {live.data ? (
              <span className={s.meta}>
                {t("rooms.liveCount", { n: live.data.length })}
              </span>
            ) : null}
          </div>
          {live.isLoading ? (
            <Skeletons n={3} />
          ) : live.error ? (
            <LoadError onRetry={() => live.refetch()} />
          ) : !live.data?.length ? (
            <div className={s.empty}>
              <b>
                {filters.active ? t("rooms.noResults") : t("rooms.emptyTitle")}
              </b>
              <Link className={`${s.btn} ${s.primary}`} href="/rooms/new">
                {t("rooms.openOne")}
              </Link>
            </div>
          ) : filters.active ? (
            <div className={s.cards}>
              {live.data.map(room => (
                <RoomCard
                  key={room.id}
                  room={room}
                  sectionColorName={colorOf.get(room.sectionId)}
                />
              ))}
            </div>
          ) : (
            <div className={s.hrows}>
              {live.data.map(room => (
                <RoomCard
                  key={room.id}
                  room={room}
                  mini
                  sectionColorName={colorOf.get(room.sectionId)}
                />
              ))}
            </div>
          )}
        </>
      ) : mine.data?.length ? null : (
        <div className={s.empty}>
          <b>{t("rooms.inviteFriends")}</b>
          <span className={s.meta}>{t("rooms.inviteFriendsHint")}</span>
          <Link className={`${s.btn} ${s.primary}`} href="/rooms/new">
            {t("rooms.newPrivate")}
          </Link>
        </div>
      )}

      {history.data?.length ? (
        <>
          <p className={s.sub}>{t("rooms.history")}</p>
          <ul className={s.historyList}>
            {history.data.map(past => (
              <li key={past.id}>
                <Link href={`/rooms/${past.id}/summary`}>
                  <b dir="auto">{past.title}</b>
                  <span>
                    {new Intl.DateTimeFormat(
                      language === "ar" ? "ar-EG-u-nu-latn" : "en",
                      { day: "numeric", month: "short" }
                    ).format(new Date(past.when))}
                    {" · "}
                    {t("rooms.historyLine", {
                      minutes: past.minutes,
                      people: past.people,
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

// One section: its colour on top, the same search and filters inside it.
export function SectionRooms({ sectionKey }: { sectionKey: string }) {
  const { t, language, viewer } = useRooms();
  const filters = useRoomFilters();
  const sections = trpc.rooms.sections.useQuery();
  const section = sections.data?.find(item => item.key === sectionKey);
  const publicHere = !!section?.publicRooms && viewer.audience === "adult";
  const rooms = trpc.rooms.explore.useQuery(
    { ...filters.input, sectionId: section?.id },
    {
      enabled: !!section && publicHere,
      refetchInterval: 20_000,
      placeholderData: previous => previous,
    }
  );
  const elsewhere = trpc.rooms.explore.useQuery(
    {},
    { enabled: publicHere && rooms.data?.length === 0 && !filters.active }
  );
  const mine = trpc.rooms.mine.useQuery(undefined, { enabled: !publicHere });

  if (sections.isLoading) return <Skeletons n={3} />;
  if (sections.error) return <LoadError onRetry={() => sections.refetch()} />;
  if (!section) {
    return (
      <div className={s.empty}>
        <b>{t("error.section_not_allowed")}</b>
        <Link className={s.btn} href="/rooms">
          {t("lobby.toRooms")}
        </Link>
      </div>
    );
  }
  const Icon = sectionIcon(section.icon);
  const name = sectionName(section, language);
  const newHref = `/rooms/new?section=${section.key}`;
  const colorOf = new Map(
    (sections.data ?? []).map(item => [item.id, item.color])
  );

  return (
    <>
      <div className={`${s.secHead} ${sectionColor(section.color)}`}>
        <div className={s.row}>
          <Link href="/rooms">‹ {t("rooms.sections")}</Link>
          {publicHere && section.liveRooms ? (
            <span className={s.secCount}>
              <i />
              {t("rooms.liveCount", { n: section.liveRooms })}
            </span>
          ) : null}
        </div>
        <h1>
          <Icon size={24} aria-hidden="true" /> {name}
        </h1>
        {publicHere ? (
          <label className={s.search}>
            <Search size={17} aria-hidden="true" />
            <input
              id="rooms-section-search"
              type="search"
              value={filters.q}
              placeholder={t("rooms.searchIn", { section: name })}
              aria-label={t("rooms.searchIn", { section: name })}
              onChange={event => filters.setQ(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      {publicHere ? (
        <>
          <div className={s.row}>
            <span className={s.meta} />
            <Link className={`${s.btn} ${s.primary}`} href={newHref}>
              <Plus size={17} aria-hidden="true" />
              {t("rooms.new")}
            </Link>
          </div>
          {rooms.isLoading ? (
            <Skeletons n={3} />
          ) : rooms.error ? (
            <LoadError onRetry={() => rooms.refetch()} />
          ) : rooms.data?.length ? (
            <div className={s.cards}>
              {rooms.data.map(room => (
                <RoomCard key={room.id} room={room} />
              ))}
            </div>
          ) : (
            <>
              <div className={s.empty}>
                <Icon size={34} aria-hidden="true" />
                <b>
                  {filters.active
                    ? t("rooms.noResults")
                    : t("rooms.emptyTitle")}
                </b>
                {filters.active ? null : (
                  <span className={s.meta}>{t("rooms.emptyHint")}</span>
                )}
                <Link className={`${s.btn} ${s.primary}`} href={newHref}>
                  {t("rooms.openOne")}
                </Link>
              </div>
              {elsewhere.data?.length ? (
                <>
                  <p className={s.sub}>{t("rooms.otherSections")}</p>
                  <div className={s.chips} style={{ gap: 10 }}>
                    {elsewhere.data.slice(0, 6).map(room => (
                      <div key={room.id} style={{ flex: "none", width: 236 }}>
                        <RoomCard
                          room={room}
                          mini
                          sectionColorName={colorOf.get(room.sectionId)}
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </>
      ) : (
        <>
          <p className={s.note}>{t("rooms.minorNote")}</p>
          {(mine.data ?? [])
            .filter(room => room.sectionId === section.id)
            .map(room => (
              <RoomCard key={room.id} room={room} />
            ))}
          <div className={s.empty}>
            <b>{t("rooms.inviteFriends")}</b>
            <span className={s.meta}>{t("rooms.inviteFriendsHint")}</span>
            <Link className={`${s.btn} ${s.primary}`} href={newHref}>
              {t("rooms.newPrivate")}
            </Link>
          </div>
        </>
      )}
    </>
  );
}
