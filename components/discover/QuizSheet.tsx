"use client";

// A quiz's sheet, up from the bottom: what it is, where it lives, and the
// three things to do with it — learn, flashcards, or play it with friends
// in a room. Nothing else is offered.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  GraduationCap,
  Layers,
  Loader2,
  MoreVertical,
  Share2,
  Users,
  X,
} from "lucide-react";
import { translate as roomsText, errorKey } from "@/lib/study-rooms/i18n";
import { compact, label } from "@/lib/discover/i18n";
import { trpc } from "@/lib/trpc-client";
import { channelHref, Creator } from "./cards";
import { Cover } from "./Cover";
import { useDiscover } from "./DiscoverProvider";
import s from "./discover.module.css";

const DESCRIPTION_SHORT = 90;

// Opens (or reuses) the student's own private room and lands there with
// the quiz ready to start. The room, its link and every rule about who
// may enter are the rooms' own (lib/study-rooms); nothing is rebuilt here.
export function usePlayInRoom(slug: string, title: string) {
  const { language, t } = useDiscover();
  const router = useRouter();
  const utils = trpc.useUtils();
  const enabled = trpc.rooms.enabled.useQuery();
  const create = trpc.rooms.create.useMutation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; setup: boolean } | null>(
    null
  );

  const go = (roomId: string) =>
    router.push(`/rooms/${roomId}/live?quiz=${encodeURIComponent(slug)}`);

  async function play() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const sections = await utils.rooms.sections.fetch();
      const section = sections[0];
      if (!section) throw new Error("not_available");
      const room = await create.mutateAsync({
        visibility: "private",
        title: title.slice(0, 80),
        sectionId: section.id,
      });
      go(room.roomId);
    } catch (failure) {
      const reason =
        failure && typeof failure === "object" && "message" in failure
          ? String((failure as { message: unknown }).message)
          : "";
      if (reason === "already_hosting") {
        // The student's open room is where the game goes.
        const [me, mine] = await Promise.all([
          utils.rooms.me.fetch(),
          utils.rooms.mine.fetch(),
        ]).catch(() => [null, []] as const);
        const hosted = mine.find(room =>
          room.members.some(
            member => member.userId === me?.userId && member.role === "host"
          )
        );
        if (hosted) {
          go(hosted.id);
          return;
        }
      }
      setError({
        text: roomsText(language, errorKey(reason)),
        setup: [
          "birth_date_required",
          "gender_required",
          "rules_required",
        ].includes(reason),
      });
      setBusy(false);
    }
  }

  return {
    available: enabled.data?.enabled === true,
    known: !enabled.isLoading,
    busy,
    error,
    play,
    unavailableText: t("sheet.roomsOff"),
  };
}

export function QuizSheet({
  slug,
  onClose,
}: {
  slug: string;
  onClose: () => void;
}) {
  const { t, language } = useDiscover();
  const quiz = trpc.discover.quiz.useQuery({ slug }, { retry: 1 });
  const [more, setMore] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const room = usePlayInRoom(slug, quiz.data?.title ?? "");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // The page behind does not scroll under the sheet.
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      root.style.overflow = before;
    };
  }, [onClose]);

  async function share() {
    const url = `${window.location.origin}/discover?quiz=${slug}`;
    setMenu(false);
    try {
      if (navigator.share) {
        await navigator.share({ title: quiz.data?.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Dismissed, or no clipboard here: nothing to report.
    }
  }

  const data = quiz.data;
  const long = (data?.description.length ?? 0) > DESCRIPTION_SHORT;

  return (
    <>
      <button
        type="button"
        className={s.scrim}
        aria-label={t("sheet.close")}
        onClick={onClose}
      />
      <div
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={data?.title ?? t("card.quiz")}
      >
        <div className={s.sheetBar}>
          <button
            type="button"
            className={s.round}
            aria-label={t("sheet.close")}
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
          <b>{t("card.quiz")}</b>
          <button
            type="button"
            className={s.round}
            aria-label={t("sheet.options")}
            aria-expanded={menu}
            onClick={() => setMenu(open => !open)}
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
        </div>
        {copied ? (
          <p className={s.toast} role="status">
            {t("sheet.copied")}
          </p>
        ) : null}

        {quiz.isLoading ? (
          <div className={s.sheetLoading} aria-busy="true">
            <span className={`${s.skeleton} ${s.skeletonRow}`} />
            <span className={`${s.skeleton} ${s.skeletonLine}`} />
            <span className={`${s.skeleton} ${s.skeletonRow}`} />
          </div>
        ) : !data ? (
          <div className={s.state} role="alert">
            <b>
              {quiz.error?.message === "not_found"
                ? t("state.notFound")
                : t("state.loadFailed")}
            </b>
            {quiz.error?.message === "not_found" ? null : (
              <button
                type="button"
                className={s.button}
                onClick={() => quiz.refetch()}
              >
                {t("state.retry")}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className={s.sheetHead}>
              <Cover
                art={data.art}
                color={data.color}
                image={data.coverImage}
                className={s.sheetCover}
              />
              <div className={s.sheetTitle}>
                <h2 dir="auto">{data.title}</h2>
                <Creator
                  name={data.creatorName}
                  verified={data.creatorVerified}
                />
              </div>
            </div>

            {data.description ? (
              <p className={s.sheetAbout} dir="auto">
                {long && !more
                  ? `${data.description.slice(0, DESCRIPTION_SHORT).trimEnd()}… `
                  : `${data.description} `}
                {long ? (
                  <button
                    type="button"
                    className={s.linkButton}
                    onClick={() => setMore(open => !open)}
                  >
                    {more ? t("sheet.readLess") : t("sheet.readMore")}
                  </button>
                ) : null}
              </p>
            ) : null}

            <ul className={s.chips}>
              {data.playsCount > 0 ? (
                <li>{t("card.plays", { n: compact(data.playsCount) })}</li>
              ) : null}
              <li>{t("card.questions", { n: data.questionsCount })}</li>
              <li>{label(language, data.category)}</li>
              {data.tags.map(tag => (
                <li key={tag} dir="auto">
                  #{tag}
                </li>
              ))}
            </ul>

            {data.channel ? (
              <div className={s.inChannel}>
                <span>
                  {t("sheet.inChannel")}
                  <b dir="auto">{data.channel.name}</b>
                </span>
                <Link
                  href={channelHref(data.channel.slug)}
                  className={s.button}
                >
                  {t("channel.view")}
                </Link>
              </div>
            ) : null}

            <h3 className={s.sheetHeading}>{t("sheet.selfStudy")}</h3>
            <div className={s.actions}>
              <Link
                href={`/discover/learn/${data.slug}`}
                className={`${s.action} ${s.actionMain}`}
              >
                <GraduationCap size={30} aria-hidden="true" />
                {t("sheet.learn")}
              </Link>
              <Link href={`/discover/cards/${data.slug}`} className={s.action}>
                <Layers size={30} aria-hidden="true" />
                {t("sheet.cards")}
              </Link>
            </div>

            <h3 className={s.sheetHeading}>{t("sheet.group")}</h3>
            <button
              type="button"
              className={`${s.action} ${s.actionWide}`}
              disabled={room.busy || (room.known && !room.available)}
              onClick={room.play}
            >
              {room.busy ? (
                <Loader2 size={26} className="spin" aria-hidden="true" />
              ) : (
                <Users size={26} aria-hidden="true" />
              )}
              <span>
                {room.busy ? t("sheet.opening") : t("sheet.play")}
                <small>
                  {room.known && !room.available
                    ? room.unavailableText
                    : t("sheet.playHint")}
                </small>
              </span>
            </button>
            {room.error ? (
              <p className={s.error} role="alert">
                {room.error.text}{" "}
                {room.error.setup ? (
                  <Link href="/rooms" className={s.linkButton}>
                    {t("sheet.roomSetup")}
                  </Link>
                ) : null}
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
