"use client";

// 🧭 Discover — the catalogue's front page. What is on it, and in what
// order, is the server's (discover.page reads `discover_sections`); this
// file only knows how to draw each kind of block. One language at a time:
// changing it changes the words, the direction and the content together.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Globe,
  RotateCcw,
  Search,
  WifiOff,
  X,
} from "lucide-react";
import type { DiscoverBlock } from "@/lib/discover/data";
import { label } from "@/lib/discover/i18n";
import { trpc } from "@/lib/trpc-client";
import {
  ChannelBlock,
  channelHref,
  ChannelTile,
  LearnCard,
  RankedCard,
  RowCard,
  WideCard,
} from "@/components/discover/cards";
import { Cover } from "@/components/discover/Cover";
import {
  DiscoverProvider,
  useDiscover,
} from "@/components/discover/DiscoverProvider";
import { QuizSheet } from "@/components/discover/QuizSheet";
import s from "@/components/discover/discover.module.css";

const BANNER_SECONDS = 6;

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type Banners = Extract<DiscoverBlock, { type: "banner" }>["banners"];

// The banners slide sideways, by the finger or by themselves; the dots
// say where it is and take it there.
function BannerCarousel({
  banners,
  onQuiz,
}: {
  banners: Banners;
  onQuiz: (slug: string) => void;
}) {
  const router = useRouter();
  const track = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const shown = useRef(0);
  shown.current = index;
  const held = useRef(false);

  const goTo = useCallback((next: number) => {
    const slide = track.current?.children[next] as HTMLElement | undefined;
    slide?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, []);

  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIndex([...node.children].indexOf(entry.target));
          }
        }
      },
      { root: node, threshold: 0.6 }
    );
    for (const child of node.children) observer.observe(child);
    return () => observer.disconnect();
  }, [banners.length]);

  useEffect(() => {
    if (banners.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (held.current || document.visibilityState !== "visible") return;
      // The observer above moves the dot once the slide has arrived.
      goTo((shown.current + 1) % banners.length);
    }, BANNER_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [banners.length, goTo]);

  return (
    <div
      className={s.banners}
      onPointerEnter={() => (held.current = true)}
      onPointerLeave={() => (held.current = false)}
      onTouchStart={() => (held.current = true)}
      onTouchEnd={() => (held.current = false)}
    >
      <div ref={track} className={s.bannerTrack}>
        {banners.map(banner => (
          <button
            key={banner.title}
            type="button"
            className={s.banner}
            style={{ "--card": banner.color } as React.CSSProperties}
            onClick={() =>
              banner.quizSlug
                ? onQuiz(banner.quizSlug)
                : banner.channelSlug
                  ? router.push(channelHref(banner.channelSlug))
                  : undefined
            }
          >
            <Cover
              art={banner.art}
              color={banner.color}
              className={s.bannerArt}
            />
            <span className={s.bannerText}>
              <b dir="auto">{banner.title}</b>
              {banner.subtitle ? (
                <span dir="auto">{banner.subtitle}</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
      {banners.length > 1 ? (
        <div className={s.dots}>
          {banners.map((banner, dot) => (
            <button
              key={banner.title}
              type="button"
              className={dot === index ? s.dotOn : s.dot}
              aria-label={banner.title}
              aria-current={dot === index}
              onClick={() => goTo(dot)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// A dropdown of the top bar: channels to visit, occasions to filter by.
function Dropdown({
  title,
  options,
  onPick,
}: {
  title: string;
  options: { value: string; text: string }[];
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!options.length) return null;
  return (
    <div ref={box} className={s.dropdown}>
      <button
        type="button"
        className={s.dropdownButton}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        {title} <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div className={s.menu} role="menu">
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="menuitem"
              dir="auto"
              onClick={() => {
                setOpen(false);
                onPick(option.value);
              }}
            >
              {option.text}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div className={s.blocks} aria-busy="true">
      <span className={`${s.skeleton} ${s.skeletonBanner}`} />
      <span className={`${s.skeleton} ${s.skeletonLine}`} />
      <span className={`${s.skeleton} ${s.skeletonRow}`} />
      <span className={`${s.skeleton} ${s.skeletonRow}`} />
      <span className={`${s.skeleton} ${s.skeletonRow}`} />
    </div>
  );
}

function Home() {
  const { t, language, setLanguage } = useDiscover();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<{
    kind: "category" | "tag";
    value: string;
  } | null>(null);
  const [allChannels, setAllChannels] = useState(false);
  const [online, setOnline] = useState(true);
  const debounced = useDebounced(query.trim(), 250);
  const searching = debounced.length > 0 || filter !== null;

  // The open quiz is in the address, so a shared link opens its sheet and
  // "back" closes it.
  const open = params.get("quiz");
  const setOpen = useCallback(
    (slug: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (slug) next.set("quiz", slug);
      else next.delete("quiz");
      const search = next.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [params, pathname, router]
  );

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  // Another language is another catalogue: the old filter means nothing.
  useEffect(() => {
    setFilter(null);
    setQuery("");
  }, [language]);

  const page = trpc.discover.page.useQuery(
    { language },
    { staleTime: 60_000, retry: 1 }
  );
  const results = trpc.discover.search.useQuery(
    {
      language,
      query: debounced || undefined,
      category:
        filter?.kind === "category" ? (filter.value as "general") : undefined,
      tag: filter?.kind === "tag" ? filter.value : undefined,
    },
    { enabled: searching, placeholderData: previous => previous }
  );

  const block = (item: DiscoverBlock) => {
    const head = (extra?: React.ReactNode) =>
      item.title ? (
        <div className={s.blockHead}>
          <div>
            <h2>{item.title}</h2>
            {item.subtitle ? <p>{item.subtitle}</p> : null}
          </div>
          {extra}
        </div>
      ) : null;
    switch (item.type) {
      case "banner":
        return <BannerCarousel banners={item.banners} onQuiz={setOpen} />;
      case "partners":
        return (
          <>
            {head(
              item.channels.length > 3 ? (
                <button
                  type="button"
                  className={s.viewAll}
                  aria-pressed={allChannels}
                  onClick={() => setAllChannels(value => !value)}
                >
                  {t("section.viewAll")}
                </button>
              ) : null
            )}
            <div className={allChannels ? s.tilesAll : s.tiles}>
              {item.channels.map(channel => (
                <ChannelTile key={channel.slug} channel={channel} />
              ))}
            </div>
          </>
        );
      case "ranked_list":
        return (
          <>
            {head()}
            <div className={s.rankedGrid}>
              {item.quizzes.map((quiz, index) => (
                <RankedCard
                  key={quiz.slug}
                  quiz={quiz}
                  rank={index + 1}
                  onOpen={setOpen}
                />
              ))}
            </div>
          </>
        );
      case "featured_collections":
        return (
          <>
            {head()}
            <div className={s.shelf}>
              {item.collections.map(collection => (
                <button
                  key={collection.category}
                  type="button"
                  className={s.collection}
                  style={{ "--card": collection.color } as React.CSSProperties}
                  onClick={() =>
                    setFilter({ kind: "category", value: collection.category })
                  }
                >
                  <Cover
                    art={collection.art}
                    color={collection.color}
                    className={s.collectionArt}
                  />
                  <b>{label(language, collection.category)}</b>
                  <span>{t("card.quizzes", { n: collection.count })}</span>
                </button>
              ))}
            </div>
          </>
        );
      case "learn_cards":
        return (
          <>
            {head()}
            <div className={s.shelf}>
              {item.quizzes.map(quiz => (
                <LearnCard key={quiz.slug} quiz={quiz} onOpen={setOpen} />
              ))}
            </div>
          </>
        );
      case "channel_block":
        return (
          <ChannelBlock
            channel={item.channel}
            quizzes={item.quizzes}
            onOpen={setOpen}
          />
        );
      case "horizontal_cards":
        return (
          <>
            {head()}
            <div className={s.shelf}>
              {item.quizzes.map(quiz => (
                <WideCard key={quiz.slug} quiz={quiz} onOpen={setOpen} />
              ))}
            </div>
          </>
        );
    }
  };

  return (
    <div className={s.page}>
      <div className={s.top}>
        <label className={s.search}>
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            maxLength={64}
            dir="auto"
          />
          {query ? (
            <button
              type="button"
              className={s.clear}
              aria-label={t("search.clear")}
              onClick={() => setQuery("")}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          className={s.language}
          aria-label={t("lang.switch")}
          onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
        >
          <Globe size={20} aria-hidden="true" />
          <span dir="ltr">{language.toUpperCase()}</span>
        </button>
      </div>

      {page.data ? (
        <div className={s.filters}>
          <Dropdown
            title={t("filter.channels")}
            options={page.data.filters.channels.map(channel => ({
              value: channel.slug,
              text: channel.name,
            }))}
            onPick={slug => router.push(channelHref(slug))}
          />
          <Dropdown
            title={t("filter.occasions")}
            options={page.data.filters.occasions.map(tag => ({
              value: tag,
              text: label(language, tag),
            }))}
            onPick={tag => setFilter({ kind: "tag", value: tag })}
          />
        </div>
      ) : null}

      {!online ? (
        <p className={s.offline} role="status">
          <WifiOff size={16} aria-hidden="true" /> {t("state.offline")}
        </p>
      ) : null}

      {searching ? (
        <section className={s.results} aria-live="polite">
          <div className={s.blockHead}>
            <h2>
              {filter ? label(language, filter.value) : t("search.results")}
            </h2>
            <button
              type="button"
              className={s.viewAll}
              onClick={() => {
                setFilter(null);
                setQuery("");
              }}
            >
              <X size={15} aria-hidden="true" /> {t("search.clear")}
            </button>
          </div>
          {results.isLoading ? (
            <Skeleton />
          ) : results.error ? (
            <div className={s.state} role="alert">
              <b>{t("state.loadFailed")}</b>
              <button
                type="button"
                className={s.button}
                onClick={() => results.refetch()}
              >
                <RotateCcw size={16} aria-hidden="true" /> {t("state.retry")}
              </button>
            </div>
          ) : !results.data?.length ? (
            <div className={s.state}>
              <b>{t("search.none")}</b>
              <span>{t("search.noneHint")}</span>
            </div>
          ) : (
            <div className={s.rows}>
              {results.data.map(quiz => (
                <RowCard key={quiz.slug} quiz={quiz} onOpen={setOpen} />
              ))}
            </div>
          )}
        </section>
      ) : page.isLoading ? (
        <Skeleton />
      ) : page.error || !page.data ? (
        <div className={s.state} role="alert">
          <b>{t("state.loadFailed")}</b>
          <span>{t("state.loadFailedHint")}</span>
          <button
            type="button"
            className={s.button}
            onClick={() => page.refetch()}
          >
            <RotateCcw size={16} aria-hidden="true" /> {t("state.retry")}
          </button>
        </div>
      ) : !page.data.blocks.length ? (
        <div className={s.state}>
          <b>{t("state.empty")}</b>
          <span>{t("state.emptyHint")}</span>
          <button
            type="button"
            className={s.button}
            onClick={() => page.refetch()}
          >
            <RotateCcw size={16} aria-hidden="true" /> {t("state.refresh")}
          </button>
        </div>
      ) : (
        <div className={s.blocks}>
          {page.data.blocks.map(item => (
            <section key={item.key} className={s.block}>
              {block(item)}
            </section>
          ))}
        </div>
      )}

      {open ? <QuizSheet slug={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <DiscoverProvider>
      <Suspense fallback={null}>
        <Home />
      </Suspense>
    </DiscoverProvider>
  );
}
