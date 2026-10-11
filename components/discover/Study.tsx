"use client";

// What the two self-study screens (learn, flashcards) share: reading the
// quiz with its loading and error states, a screen of their own over the
// app's bottom bar, and the sound switches.
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { Music, RotateCcw, Volume2, VolumeX } from "lucide-react";
import type { AppRouter } from "@/lib/trpc/router";
import { trpc } from "@/lib/trpc-client";
import { DiscoverProvider, useDiscover } from "./DiscoverProvider";
import {
  effectsOn,
  musicOn,
  setEffects,
  setMusic,
  startMusic,
  stopMusic,
} from "./sound";
import s from "./discover.module.css";

export type StudyQuiz = inferRouterOutputs<AppRouter>["discover"]["questions"];

function Loader({
  slug,
  children,
}: {
  slug: string;
  children: (quiz: StudyQuiz) => ReactNode;
}) {
  const { t } = useDiscover();
  const quiz = trpc.discover.questions.useQuery(
    { slug },
    { retry: 1, staleTime: Infinity }
  );
  // One more play, counted once in a while per student on the server.
  const { mutate: played } = trpc.discover.played.useMutation();
  const loaded = !!quiz.data;
  useEffect(() => {
    if (loaded) played({ slug });
  }, [loaded, played, slug]);
  // The music is this screen's: it ends when the screen is left.
  useEffect(() => () => stopMusic(), []);

  if (quiz.isLoading) {
    return (
      <div className={s.study} aria-busy="true">
        <span className={`${s.skeleton} ${s.skeletonLine}`} />
        <span className={`${s.skeleton} ${s.skeletonBanner}`} />
        <span className={`${s.skeleton} ${s.skeletonRow}`} />
      </div>
    );
  }
  if (!quiz.data || !quiz.data.questions.length) {
    const missing = quiz.error?.message === "not_found";
    return (
      <div className={s.study}>
        <div className={s.state} role="alert">
          <b>
            {missing
              ? t("state.notFound")
              : quiz.data
                ? t("state.empty")
                : t("state.loadFailed")}
          </b>
          {quiz.error && !missing ? (
            <button
              type="button"
              className={s.button}
              onClick={() => quiz.refetch()}
            >
              <RotateCcw size={16} aria-hidden="true" /> {t("state.retry")}
            </button>
          ) : null}
          <Link href="/discover" className={s.button}>
            {t("learn.toDiscover")}
          </Link>
        </div>
      </div>
    );
  }
  return (
    // The quiz's own language, whatever the catalogue was set to.
    <DiscoverProvider fixed={quiz.data.language}>
      <div className={s.study}>{children(quiz.data)}</div>
    </DiscoverProvider>
  );
}

export function StudyScreen({
  slug,
  children,
}: {
  slug: string;
  children: (quiz: StudyQuiz) => ReactNode;
}) {
  return (
    <DiscoverProvider>
      <Loader slug={slug}>{children}</Loader>
    </DiscoverProvider>
  );
}

// Effects on or off, and the background music — both remembered on the
// device. The music only ever starts from a tap here, or from a tap on the
// screen once it was left on.
export function SoundControls() {
  const { t } = useDiscover();
  const [effects, setEffectsOn] = useState(true);
  const [music, setMusicOn] = useState(false);
  useEffect(() => {
    setEffectsOn(effectsOn());
    setMusicOn(musicOn());
    if (!musicOn()) return;
    // Left on last time: it comes back at the first touch (a browser
    // plays nothing before one).
    const resume = () => startMusic();
    window.addEventListener("pointerdown", resume, { once: true });
    return () => window.removeEventListener("pointerdown", resume);
  }, []);
  return (
    <>
      <button
        type="button"
        className={s.round}
        aria-label={effects ? t("learn.soundOff") : t("learn.soundOn")}
        aria-pressed={effects}
        onClick={() => {
          setEffects(!effects);
          setEffectsOn(!effects);
        }}
      >
        {effects ? (
          <Volume2 size={20} aria-hidden="true" />
        ) : (
          <VolumeX size={20} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className={`${s.round} ${music ? s.roundOn : ""}`}
        aria-label={t("learn.music")}
        aria-pressed={music}
        onClick={() => {
          setMusic(!music);
          setMusicOn(!music);
        }}
      >
        <Music size={20} aria-hidden="true" />
      </button>
    </>
  );
}
