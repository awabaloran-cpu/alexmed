"use client";

// A channel: its cover and name, follow, what it is about, and its
// quizzes — a featured shelf, then all of them.
import { Suspense, use, useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  MoreVertical,
  RotateCcw,
  Share2,
} from "lucide-react";
import { label } from "@/lib/discover/i18n";
import type { AppRouter } from "@/lib/trpc/router";
import { trpc } from "@/lib/trpc-client";
import { RowCard, Verified, WideCard } from "@/components/discover/cards";
import { Cover } from "@/components/discover/Cover";
import {
  DiscoverProvider,
  useDiscover,
} from "@/components/discover/DiscoverProvider";
import { QuizSheet } from "@/components/discover/QuizSheet";
import s from "@/components/discover/discover.module.css";

const DESCRIPTION_SHORT = 110;

type Channel = inferRouterOutputs<AppRouter>["discover"]["channel"];

function ChannelView({ channel }: { channel: Channel }) {
  const { t, language } = useDiscover();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"content" | "about">("content");
  const [more, setMore] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const follow = trpc.discover.follow.useMutation({
    onSuccess: () => utils.discover.channel.invalidate({ slug: channel.slug }),
  });
  const long = channel.description.length > DESCRIPTION_SHORT;
  const Back = language === "ar" ? ChevronRight : ChevronLeft;

  async function share() {
    setMenu(false);
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: channel.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Dismissed, or no clipboard here.
    }
  }

  return (
    <div
      className={s.channelPage}
      style={{ "--card": channel.color } as React.CSSProperties}
    >
      <div className={s.channelCover}>
        <Cover
          art={channel.art}
          color={channel.color}
          image={channel.cover}
          className={s.channelCoverArt}
        />
        <div className={s.channelBar}>
          <button
            type="button"
            className={s.round}
            aria-label={t("channel.back")}
            onClick={() =>
              window.history.length > 1
                ? router.back()
                : router.push("/discover")
            }
          >
            <Back size={22} aria-hidden="true" />
          </button>
          <span className={s.channelBarEnd}>
            <span className={s.languagePill}>
              <Globe size={18} aria-hidden="true" />
              <span dir="ltr">{channel.language.toUpperCase()}</span>
            </span>
            <button
              type="button"
              className={s.round}
              aria-label={t("sheet.options")}
              aria-expanded={menu}
              onClick={() => setMenu(value => !value)}
            >
              <MoreVertical size={20} aria-hidden="true" />
            </button>
            {menu ? (
              <div className={s.menu} role="menu">
                <button type="button" role="menuitem" onClick={share}>
                  <Share2 size={16} aria-hidden="true" /> {t("sheet.share")}
                </button>
              </div>
            ) : null}
          </span>
        </div>
      </div>

      <div className={s.channelCard}>
        <Cover
          art={channel.art}
          color={channel.color}
          image={channel.logo}
          className={s.channelCardLogo}
        />
        <h1 dir="auto">
          {channel.name} {channel.verified ? <Verified /> : null}
        </h1>
        <p className={s.channelCounts}>
          {t("card.quizzes", { n: channel.quizzes.length })} ·{" "}
          {t("channel.followers", { n: channel.followers })}
        </p>
        <button
          type="button"
          className={channel.following ? s.followOn : s.follow}
          aria-pressed={channel.following}
          disabled={follow.isPending}
          onClick={() =>
            follow.mutate({ slug: channel.slug, follow: !channel.following })
          }
        >
          {channel.following ? t("channel.following") : t("channel.follow")}
        </button>
        {copied ? (
          <p className={s.toast} role="status">
            {t("sheet.copied")}
          </p>
        ) : null}
        <p className={s.channelAbout} dir="auto">
          {long && !more
            ? `${channel.description.slice(0, DESCRIPTION_SHORT).trimEnd()}… `
            : `${channel.description} `}
          {long ? (
            <button
              type="button"
              className={s.linkButton}
              onClick={() => setMore(value => !value)}
            >
              {more ? t("sheet.readLess") : t("sheet.readMore")}
            </button>
          ) : null}
        </p>
      </div>

      <div className={s.tabs} role="tablist">
        {(["content", "about"] as const).map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? s.tabOn : s.tab}
            onClick={() => setTab(id)}
          >
            {t(id === "content" ? "channel.content" : "channel.about")}
          </button>
        ))}
      </div>

      {tab === "content" ? (
        channel.quizzes.length ? (
          <div role="tabpanel" className={s.blocks}>
            <section className={s.block}>
              <div className={s.blockHead}>
                <h2>{t("channel.featured")}</h2>
              </div>
              <div className={s.shelf}>
                {channel.featured.map(quiz => (
                  <WideCard key={quiz.slug} quiz={quiz} onOpen={setOpen} />
                ))}
              </div>
            </section>
            <section className={s.block}>
              <div className={s.blockHead}>
                <h2>{t("channel.all")}</h2>
              </div>
              <div className={s.rows}>
                {channel.quizzes.map(quiz => (
                  <RowCard key={quiz.slug} quiz={quiz} onOpen={setOpen} />
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div role="tabpanel" className={s.state}>
            <b>{t("state.empty")}</b>
            <span>{t("state.emptyHint")}</span>
          </div>
        )
      ) : (
        <div role="tabpanel" className={s.aboutPanel}>
          <p dir="auto">{channel.description}</p>
          <dl>
            <div>
              <dt>{t("channel.aboutQuizzes")}</dt>
              <dd>{channel.quizzes.length}</dd>
            </div>
            <div>
              <dt>{t("channel.aboutQuestions")}</dt>
              <dd>{channel.questionsCount}</dd>
            </div>
            <div>
              <dt>{t("channel.aboutTopics")}</dt>
              <dd>
                {channel.categories
                  .map(category => label(language, category))
                  .join(language === "ar" ? "، " : ", ")}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {open ? <QuizSheet slug={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function ChannelLoader({ slug }: { slug: string }) {
  const { t } = useDiscover();
  const channel = trpc.discover.channel.useQuery({ slug }, { retry: 1 });
  if (channel.isLoading) {
    return (
      <div className={s.page} aria-busy="true">
        <span className={`${s.skeleton} ${s.skeletonBanner}`} />
        <span className={`${s.skeleton} ${s.skeletonRow}`} />
        <span className={`${s.skeleton} ${s.skeletonRow}`} />
      </div>
    );
  }
  if (!channel.data) {
    const missing = channel.error?.message === "not_found";
    return (
      <div className={s.page}>
        <div className={s.state} role="alert">
          <b>{missing ? t("state.notFound") : t("state.loadFailed")}</b>
          {missing ? null : (
            <button
              type="button"
              className={s.button}
              onClick={() => channel.refetch()}
            >
              <RotateCcw size={16} aria-hidden="true" /> {t("state.retry")}
            </button>
          )}
          <Link href="/discover" className={s.button}>
            {t("learn.toDiscover")}
          </Link>
        </div>
      </div>
    );
  }
  return (
    // A channel speaks its own language, whatever the page was set to.
    <DiscoverProvider fixed={channel.data.language}>
      <ChannelView channel={channel.data} />
    </DiscoverProvider>
  );
}

export default function ChannelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  return (
    <DiscoverProvider>
      <Suspense fallback={null}>
        <ChannelLoader slug={slug} />
      </Suspense>
    </DiscoverProvider>
  );
}
