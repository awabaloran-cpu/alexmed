"use client";

// The cards of Discover: one quiz drawn four ways (a numbered row, a wide
// card, a learn card, a search row), a channel's tile and its block.
import Link from "next/link";
import {
  BadgeCheck,
  GraduationCap,
  Layers,
  LayoutGrid,
  User,
} from "lucide-react";
import type { DiscoverCard, DiscoverChannelCard } from "@/lib/discover/data";
import { compact } from "@/lib/discover/i18n";
import { Cover } from "./Cover";
import { useDiscover } from "./DiscoverProvider";
import s from "./discover.module.css";

type Open = (slug: string) => void;

export function Verified() {
  const { t } = useDiscover();
  return (
    <BadgeCheck
      size={15}
      className={s.verified}
      role="img"
      aria-label={t("card.verified")}
    />
  );
}

export function Creator({
  name,
  verified,
}: {
  name: string;
  verified: boolean;
}) {
  return (
    <span className={s.creator}>
      <bdi>{name}</bdi>
      {verified ? <Verified /> : null}
    </span>
  );
}

// Over the cover: how often it was played (once anyone has) and how many
// questions it holds.
function Counts({ quiz }: { quiz: DiscoverCard }) {
  const { t } = useDiscover();
  return (
    <span className={s.counts}>
      {quiz.playsCount > 0 ? (
        <span title={t("card.plays", { n: quiz.playsCount })}>
          <User size={13} aria-hidden="true" />
          {compact(quiz.playsCount)}
        </span>
      ) : null}
      <span title={t("card.questions", { n: quiz.questionsCount })}>
        <Layers size={13} aria-hidden="true" />
        {quiz.questionsCount}
      </span>
    </span>
  );
}

function Kind({ quiz }: { quiz: DiscoverCard }) {
  const { t } = useDiscover();
  return (
    <span className={s.kindRow}>
      <span className={s.kind}>
        <LayoutGrid size={13} aria-hidden="true" /> {t("card.quiz")}
      </span>
      {quiz.isFree ? <span className={s.free}>{t("card.free")}</span> : null}
    </span>
  );
}

// "Picked for you": the big number, then the cover beside the words on the
// cover's own dark colour.
export function RankedCard({
  quiz,
  rank,
  onOpen,
}: {
  quiz: DiscoverCard;
  rank: number;
  onOpen: Open;
}) {
  return (
    <button
      type="button"
      className={s.ranked}
      onClick={() => onOpen(quiz.slug)}
    >
      <span className={s.rank} aria-hidden="true">
        {rank}
      </span>
      <span
        className={s.rankedBody}
        style={{ "--card": quiz.color } as React.CSSProperties}
      >
        <Cover
          art={quiz.art}
          color={quiz.color}
          image={quiz.coverImage}
          className={s.rankedCover}
        >
          <Counts quiz={quiz} />
        </Cover>
        <span className={s.rankedText}>
          <Kind quiz={quiz} />
          <b dir="auto">{quiz.title}</b>
          <Creator name={quiz.creatorName} verified={quiz.creatorVerified} />
        </span>
      </span>
    </button>
  );
}

// "Recommended" and a channel's shelf: the cover on top, the words under.
export function WideCard({
  quiz,
  onOpen,
}: {
  quiz: DiscoverCard;
  onOpen: Open;
}) {
  return (
    <button
      type="button"
      className={s.wide}
      style={{ "--card": quiz.color } as React.CSSProperties}
      onClick={() => onOpen(quiz.slug)}
    >
      <Kind quiz={quiz} />
      <Cover
        art={quiz.art}
        color={quiz.color}
        image={quiz.coverImage}
        className={s.wideCover}
      >
        <Counts quiz={quiz} />
      </Cover>
      <span className={s.wideText}>
        <b dir="auto">{quiz.title}</b>
        <Creator name={quiz.creatorName} verified={quiz.creatorVerified} />
      </span>
    </button>
  );
}

// Solo learning: a pale card, the cover in the middle.
export function LearnCard({
  quiz,
  onOpen,
}: {
  quiz: DiscoverCard;
  onOpen: Open;
}) {
  const { t } = useDiscover();
  return (
    <button
      type="button"
      className={s.learn}
      style={{ "--card": quiz.color } as React.CSSProperties}
      onClick={() => onOpen(quiz.slug)}
    >
      <span className={s.kindRow}>
        <span className={s.kind}>
          <GraduationCap size={14} aria-hidden="true" /> {t("card.learn")}
        </span>
        {quiz.isFree ? <span className={s.free}>{t("card.free")}</span> : null}
      </span>
      <Cover
        art={quiz.art}
        color={quiz.color}
        image={quiz.coverImage}
        className={s.learnCover}
      >
        <span className={s.counts}>
          <span>{t("card.questions", { n: quiz.questionsCount })}</span>
        </span>
      </Cover>
      <b dir="auto">{quiz.title}</b>
      <Creator name={quiz.creatorName} verified={quiz.creatorVerified} />
    </button>
  );
}

// A search result, or a channel's full list.
export function RowCard({
  quiz,
  onOpen,
}: {
  quiz: DiscoverCard;
  onOpen: Open;
}) {
  const { t } = useDiscover();
  return (
    <button
      type="button"
      className={s.rowCard}
      onClick={() => onOpen(quiz.slug)}
    >
      <Cover
        art={quiz.art}
        color={quiz.color}
        image={quiz.coverImage}
        className={s.rowCover}
      />
      <span className={s.rowText}>
        <b dir="auto">{quiz.title}</b>
        <span>
          {t("card.questions", { n: quiz.questionsCount })} ·{" "}
          <bdi>{quiz.creatorName}</bdi>
        </span>
      </span>
    </button>
  );
}

export const channelHref = (slug: string) => `/discover/channel/${slug}`;

// "Niro channels": a tile a channel, its drawing as the logo.
export function ChannelTile({ channel }: { channel: DiscoverChannelCard }) {
  return (
    <Link
      href={channelHref(channel.slug)}
      className={s.tile}
      style={{ "--card": channel.color } as React.CSSProperties}
    >
      <Cover
        art={channel.art}
        color={channel.color}
        image={channel.logo}
        className={s.tileCover}
      />
      <b dir="auto">{channel.name}</b>
    </Link>
  );
}

// A channel's block: its name and "view channel" beside a shelf of its
// quizzes, all on the channel's colour.
export function ChannelBlock({
  channel,
  quizzes,
  onOpen,
}: {
  channel: DiscoverChannelCard;
  quizzes: DiscoverCard[];
  onOpen: Open;
}) {
  const { t } = useDiscover();
  return (
    <section
      className={s.channelBlock}
      style={{ "--card": channel.color } as React.CSSProperties}
      aria-label={channel.name}
    >
      <div className={s.channelIntro}>
        <span className={s.channelBadge}>{t("card.channel")}</span>
        <Cover
          art={channel.art}
          color={channel.color}
          image={channel.logo}
          className={s.channelLogo}
        />
        <b dir="auto">{channel.name}</b>
        <span>{t("card.quizzes", { n: channel.quizzesCount })}</span>
        <Link href={channelHref(channel.slug)} className={s.channelButton}>
          {t("channel.view")}
        </Link>
      </div>
      <div className={s.shelf}>
        {quizzes.map(quiz => (
          <WideCard key={quiz.slug} quiz={quiz} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
