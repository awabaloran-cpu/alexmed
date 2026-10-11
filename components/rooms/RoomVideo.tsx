"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Users,
  WifiOff,
} from "lucide-react";
import {
  expectedPosition,
  isOwnAction,
  syncVerdict,
  type VideoState,
} from "@/lib/study-rooms/youtube";
import type { RoomsKey } from "@/lib/study-rooms/i18n";
import { trpc } from "@/lib/trpc-client";
import { useRooms } from "./RoomsProvider";
import {
  loadYoutubeApi,
  PLAYER_STATE,
  playerErrorKey,
  type YoutubePlayer,
} from "./youtube-player";
import s from "./rooms.module.css";

export type RoomVideoData = {
  videoId: string;
  title: string | null;
  state: VideoState;
  // The server's clock when it answered.
  serverNow: number;
};

type Badge = "synced" | "syncing" | "behind" | "offline" | "tap";

const BADGE: Record<Badge, RoomsKey> = {
  synced: "video.synced",
  syncing: "video.syncing",
  behind: "video.behind",
  offline: "video.offline",
  tap: "video.tapToJoin",
};

// 🎬 The room's YouTube video, in step with the room.
//
// The server holds one small fact — which video, and where it was at its
// last change (lib/study-rooms/video.ts). This screen works out where the
// video is NOW from that and the server's clock, and keeps the official
// player there:
//   - a new revision (someone played, paused, sought, swapped the video)
//     is applied at once;
//   - while playing, the player's own place is looked at every couple of
//     seconds and moved only when it is more than two seconds out;
//   - what the player reports just after a command is that command's own
//     echo and is never sent on (no loop);
//   - nothing is sent while the video simply plays — only a play, a pause,
//     a seek or the end, and only by whoever may control it.
// A member who pauses or wanders on their own is left alone and shown
// "behind the room", with one button back.
export default function RoomVideo({
  roomId,
  video,
  canControl,
  online,
  timeRef,
  localSeek,
}: {
  roomId: string;
  video: RoomVideoData;
  canControl: boolean;
  online: boolean;
  // Kept at the player's current second, for a chat message to carry.
  timeRef: MutableRefObject<number | null>;
  // "Go to this second" on this screen only (a chat message's time).
  localSeek: { seconds: number } | null;
}) {
  const { t, tError } = useRooms();
  const utils = trpc.useUtils();
  const update = trpc.rooms.updateYoutubeState.useMutation();
  const resync = trpc.rooms.syncYoutube.useMutation();

  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YoutubePlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [playerError, setPlayerError] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [needsTap, setNeedsTap] = useState(false);
  const [detached, setDetached] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sendFailed, setSendFailed] = useState<string | null>(null);

  // What the room says, the clock it was said by, and what this screen has
  // already acted on.
  const stateRef = useRef(video.state);
  const videoIdRef = useRef(video.videoId);
  const offsetRef = useRef(video.serverNow - Date.now());
  const appliedRevision = useRef(-1);
  const lastAppliedAt = useRef(0);
  const detachedRef = useRef(false);
  detachedRef.current = detached;
  const canControlRef = useRef(canControl);
  canControlRef.current = canControl;

  const serverNow = () => Date.now() + offsetRef.current;
  const expected = () => expectedPosition(stateRef.current, serverNow());

  // Put the player where the room is. `force` moves it even when close.
  const apply = useCallback((force: boolean) => {
    const player = playerRef.current;
    if (!player) return;
    const state = stateRef.current;
    const target = expectedPosition(state, Date.now() + offsetRef.current);
    lastAppliedAt.current = Date.now();
    setSyncing(true);
    window.setTimeout(() => setSyncing(false), 1200);
    let local = 0;
    try {
      local = player.getCurrentTime() || 0;
    } catch {
      return;
    }
    if (state.status === "playing") {
      if (force || syncVerdict(local, target) === "seek") {
        player.seekTo(target, true);
      }
      player.playVideo();
      // A browser may refuse to start sound nobody asked for on this
      // page. That is not a failure: the student presses once to join.
      window.setTimeout(() => {
        const now = playerRef.current;
        if (!now || stateRef.current.status !== "playing") return;
        const playerState = now.getPlayerState();
        if (
          playerState !== PLAYER_STATE.PLAYING &&
          playerState !== PLAYER_STATE.BUFFERING
        ) {
          setNeedsTap(true);
        }
      }, 2000);
    } else {
      player.pauseVideo();
      if (force || Math.abs(local - target) > 0.5) player.seekTo(target, true);
    }
  }, []);

  // The room's word arrives (every few seconds, and at once after a change).
  useEffect(() => {
    offsetRef.current = video.serverNow - Date.now();
    const changedVideo = videoIdRef.current !== video.videoId;
    if (video.state.revision < appliedRevision.current && !changedVideo) {
      // Older than what this screen already holds (its own change, just
      // confirmed): not a step back.
      return;
    }
    stateRef.current = video.state;
    if (changedVideo) {
      videoIdRef.current = video.videoId;
      setPlayerError(null);
      setNeedsTap(false);
      setDetached(false);
      lastAppliedAt.current = Date.now();
      playerRef.current?.cueVideoById({ videoId: video.videoId });
      appliedRevision.current = -1;
    }
    if (video.state.revision > appliedRevision.current) {
      appliedRevision.current = video.state.revision;
      // The room has moved: this screen goes with it, wherever it was.
      setDetached(false);
      apply(true);
    }
  }, [video, apply]);

  // One player for the life of this screen.
  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    setReady(false);
    loadYoutubeApi().then(
      api => {
        const mount = mountRef.current;
        if (cancelled || !mount) return;
        const holder = document.createElement("div");
        mount.replaceChildren(holder);
        const player = new api.Player(holder, {
          videoId: videoIdRef.current,
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: {
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              playerRef.current = player;
              setReady(true);
              appliedRevision.current = stateRef.current.revision;
              apply(true);
            },
            onStateChange: event => onPlayerState(event.data),
            onError: event => setPlayerError(event.data),
          },
        });
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      }
    );
    return () => {
      cancelled = true;
      const player = playerRef.current;
      playerRef.current = null;
      try {
        player?.destroy();
      } catch {
        // The frame is already gone.
      }
    };
    // `attempt` builds the player again after a failed load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Tell the room (only whoever controls the video ever gets here).
  const send = (status: VideoState["status"]) => {
    const player = playerRef.current;
    if (!player) return;
    const base = stateRef.current;
    const positionSeconds = Math.max(0, player.getCurrentTime() || 0);
    const duration = player.getDuration();
    // The screen already shows this; the room's copy is brought up to it.
    const optimistic: VideoState = {
      ...base,
      status,
      positionSeconds,
      stateChangedAt: new Date(serverNow()).toISOString(),
      revision: base.revision + 1,
    };
    stateRef.current = optimistic;
    appliedRevision.current = optimistic.revision;
    update.mutate(
      {
        roomId,
        videoId: videoIdRef.current,
        status,
        positionSeconds,
        baseRevision: base.revision,
        durationSeconds: duration > 0 ? duration : null,
      },
      {
        onSuccess: result => {
          setSendFailed(null);
          if (!result.state) return;
          offsetRef.current = result.serverNow - Date.now();
          stateRef.current = result.state;
          appliedRevision.current = result.state.revision;
          // Someone else's change got there first: follow it.
          if (!result.applied) apply(true);
          void utils.rooms.state.invalidate({ roomId });
        },
        onError: error => {
          // Not saved: the room is where it was, and so is this screen.
          stateRef.current = base;
          appliedRevision.current = base.revision;
          setSendFailed(tError(error));
          apply(true);
        },
      }
    );
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  // The player says it changed. Was that the student, or our own command?
  function onPlayerState(data: number) {
    if (data === PLAYER_STATE.PLAYING) setNeedsTap(false);
    if (!isOwnAction(lastAppliedAt.current, Date.now())) return;
    const shared = stateRef.current.status;
    const mine =
      data === PLAYER_STATE.PLAYING
        ? "playing"
        : data === PLAYER_STATE.PAUSED
          ? "paused"
          : data === PLAYER_STATE.ENDED
            ? "ended"
            : null;
    if (!mine) return;
    if (canControlRef.current && !detachedRef.current) {
      const player = playerRef.current;
      const local = player ? player.getCurrentTime() || 0 : 0;
      const moved = syncVerdict(local, expected()) === "seek";
      if (mine !== shared || moved) sendRef.current(mine);
      return;
    }
    // A member on their own: paused while the room plays, or playing
    // while the room is paused. Left alone, and told.
    if (mine !== shared && mine !== "ended") setDetached(true);
  }

  // While the room plays: keep close, and notice the controller's seeks.
  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      let local = 0;
      let playerState = PLAYER_STATE.UNSTARTED as number;
      try {
        local = player.getCurrentTime() || 0;
        playerState = player.getPlayerState();
      } catch {
        return;
      }
      timeRef.current = local;
      if (stateRef.current.status !== "playing") return;
      if (playerState !== PLAYER_STATE.PLAYING) return;
      if (detachedRef.current) return;
      if (!isOwnAction(lastAppliedAt.current, Date.now())) return;
      if (syncVerdict(local, expected()) !== "seek") return;
      if (canControlRef.current) {
        // The controller dragged the bar: that is the room's new place.
        sendRef.current("playing");
      } else {
        apply(true);
      }
    }, 2000);
    return () => window.clearInterval(timer);
    // expected() reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, apply, timeRef]);

  // A time pressed in the chat: the controller takes the room there; a
  // member goes alone, and can come back with "sync".
  useEffect(() => {
    const player = playerRef.current;
    if (!localSeek || !player) return;
    if (canControlRef.current) {
      lastAppliedAt.current = Date.now();
      player.seekTo(localSeek.seconds, true);
      window.setTimeout(() => sendRef.current(stateRef.current.status), 300);
    } else {
      setDetached(true);
      lastAppliedAt.current = Date.now();
      player.seekTo(localSeek.seconds, true);
    }
  }, [localSeek]);

  useEffect(
    () => () => {
      timeRef.current = null;
    },
    [timeRef]
  );

  const syncNow = () => {
    setDetached(false);
    setNeedsTap(false);
    setSendFailed(null);
    void utils.rooms.state.invalidate({ roomId });
    apply(true);
  };

  const badge: Badge = !online
    ? "offline"
    : needsTap
      ? "tap"
      : detached
        ? "behind"
        : syncing || !ready
          ? "syncing"
          : "synced";
  const BadgeIcon =
    badge === "offline"
      ? WifiOff
      : badge === "synced"
        ? CircleCheck
        : badge === "syncing"
          ? Loader2
          : CircleAlert;
  const watchUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

  return (
    <section className={s.video} aria-label={t("video.title")}>
      <div className={s.videoHead}>
        <h2 dir="auto" title={video.title ?? undefined}>
          {video.title ?? t("video.untitled")}
        </h2>
        <span
          className={`${s.syncBadge} ${s[`sync_${badge}`] ?? ""}`}
          role="status"
        >
          <BadgeIcon
            size={15}
            aria-hidden="true"
            className={badge === "syncing" ? "spin" : undefined}
          />
          {t(BADGE[badge])}
        </span>
      </div>

      <div className={s.videoFrame}>
        <div ref={mountRef} className={s.videoMount} />
        {!ready && !loadFailed && playerError === null ? (
          <div className={s.videoCover} role="status">
            <Loader2 size={26} className="spin" aria-hidden="true" />
            <span>{t("video.loading")}</span>
          </div>
        ) : null}
        {loadFailed ? (
          <div className={s.videoCover} role="alert">
            <CircleAlert size={26} aria-hidden="true" />
            <span>{t("video.errLoad")}</span>
            <button
              type="button"
              className={s.btn}
              onClick={() => setAttempt(value => value + 1)}
            >
              {t("rooms.retry")}
            </button>
          </div>
        ) : null}
        {playerError !== null ? (
          <div className={s.videoCover} role="alert">
            <CircleAlert size={26} aria-hidden="true" />
            <span>{t(playerErrorKey(playerError))}</span>
            <a
              className={s.btn}
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} aria-hidden="true" />
              {t("video.openOnYoutube")}
            </a>
          </div>
        ) : null}
        {needsTap && playerError === null ? (
          <button
            type="button"
            className={s.videoTap}
            onClick={() => {
              setNeedsTap(false);
              setDetached(false);
              apply(true);
            }}
          >
            <Play size={22} aria-hidden="true" />
            {t("video.tapToJoin")}
          </button>
        ) : null}
      </div>

      <div className={s.videoTools}>
        <button type="button" className={s.btn} onClick={syncNow}>
          <RefreshCw size={16} aria-hidden="true" /> {t("video.syncNow")}
        </button>
        {canControl ? (
          <button
            type="button"
            className={s.btn}
            disabled={resync.isPending}
            onClick={() =>
              resync.mutate(
                { roomId },
                {
                  onSuccess: () => utils.rooms.state.invalidate({ roomId }),
                  onError: error => setSendFailed(tError(error)),
                }
              )
            }
          >
            <Users size={16} aria-hidden="true" /> {t("video.syncAll")}
          </button>
        ) : null}
        <a
          className={s.readerLink}
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("video.openOnYoutube")}
        </a>
      </div>

      <p className={s.meta}>
        {canControl ? t("video.youControl") : t("video.hostControls")}{" "}
        {t("video.qualityNote")}
      </p>
      {sendFailed ? (
        <p className={s.errorNote} role="alert">
          {t("video.notSaved")} {sendFailed}
        </p>
      ) : null}
    </section>
  );
}
