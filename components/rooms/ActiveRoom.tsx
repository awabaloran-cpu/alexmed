"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { LogOut, Maximize2, Mic, MicOff, X } from "lucide-react";
import type { Room } from "livekit-client";
import {
  errorKey,
  translate,
  type RoomsKey,
  type RoomsLanguage,
} from "@/lib/study-rooms/i18n";
import {
  encodeReaction,
  parseReaction,
  REACTION_GAP_MS,
  REACTION_LIFE_MS,
  REACTION_TOPIC,
  withReaction,
  type ReactionKind,
  type ShownReaction,
} from "@/lib/study-rooms/reactions";
import { trpc } from "@/lib/trpc-client";
import m from "./active-room.module.css";

// 🎧 The room the student is in, kept above the pages (the phone app's
// rooms/application/active_room.dart): leaving the room's page — the arrow
// at the top of it — leaves the page, not the room. The voice goes on, the
// room keeps being read (that reading is the student's heartbeat), and a
// small card on every other page brings them back or takes them out, asked
// once. Leaving is only ever on purpose.
//
// The voice itself moved here from RoomVoice.tsx unchanged in what it does:
// joining is listening, the microphone opens only when the student opens
// it, nothing is recorded, and the server decides who may speak.

export const HAND_TOPIC = "hand";
const POLL_MS = 4000;
// What the server says when there is no room to come back to.
export const FINAL_REFUSALS = [
  "not_available",
  "room_ended",
  "banned_from_room",
];

export type VoicePhase =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "lost";
export type VoiceDevice = { id: string; label: string };

export type VoiceState = {
  phase: VoicePhase;
  // The server has no voice set up: nothing about voice is shown.
  unavailable: boolean;
  maySpeak: boolean;
  micOn: boolean;
  micBusy: boolean;
  asked: boolean;
  // The student's own voice is reaching the others.
  heard: boolean;
  // Who raised a hand, oldest first (seen by whoever may let them speak).
  hands: string[];
  inVoice: Set<string>;
  speaking: Set<string>;
  problem: string | null;
  devices: VoiceDevice[];
  deviceId: string;
};

export const IDLE_VOICE: VoiceState = {
  phase: "idle",
  unavailable: false,
  maySpeak: false,
  micOn: false,
  micBusy: false,
  asked: false,
  heard: false,
  hands: [],
  inVoice: new Set(),
  speaking: new Set(),
  problem: null,
  devices: [],
  deviceId: "",
};

export type ActiveRoom = {
  roomId: string | null;
  // Makes [roomId] the room: the voice and the reading of any other stop
  // (the caller asked the student before leaving that one on the server).
  enter: (roomId: string) => void;
  // Stops the voice and the reading here, without asking the server.
  forget: () => void;
  voice: VoiceState;
  join: () => Promise<void>;
  // Joins listening by itself, once per entry into a room, and only once
  // the student has pressed something on the site (a browser plays sound
  // only then). Leaving the voice is never undone by coming back.
  autoJoin: () => void;
  leaveVoice: () => void;
  toggleMic: () => Promise<void>;
  raiseHand: () => Promise<void>;
  // Puts a raised hand aside here (after it was allowed, or "later").
  dropHand: (userId: string) => void;
  switchDevice: (deviceId: string) => void;
  clearProblem: () => void;
  reactions: ShownReaction[];
  react: (kind: ReactionKind) => void;
};

const Context = createContext<ActiveRoom | null>(null);

export function useActiveRoom(): ActiveRoom {
  const value = useContext(Context);
  if (!value) throw new Error("useActiveRoom outside ActiveRoomProvider");
  return value;
}

// The same for pages that may render without it (the rooms' tests).
export function useActiveRoomMaybe(): ActiveRoom | null {
  return useContext(Context);
}

export default function ActiveRoomProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [voice, setVoiceState] = useState<VoiceState>(IDLE_VOICE);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const [reactions, setReactions] = useState<ShownReaction[]>([]);
  const roomRef = useRef<Room | null>(null);
  const roomIdRef = useRef<string | null>(null);
  roomIdRef.current = roomId;
  const soundRef = useRef<HTMLDivElement | null>(null);
  const lastSent = useRef(0);
  const reactionIds = useRef(0);
  const timers = useRef(new Set<number>());

  const me = trpc.rooms.me.useQuery(undefined, {
    enabled: !!roomId,
    staleTime: 60_000,
    retry: 1,
  });
  const language: RoomsLanguage = me.data?.uiLanguage ?? "ar";
  const languageRef = useRef(language);
  languageRef.current = language;
  const t = useCallback(
    (key: RoomsKey, values?: Record<string, string | number>) =>
      translate(languageRef.current, key, values),
    []
  );

  const setVoice = useCallback(
    (change: (v: VoiceState) => VoiceState) => setVoiceState(change),
    []
  );

  const disconnect = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) void room.disconnect();
    soundRef.current?.replaceChildren();
  }, []);

  const leaveVoice = useCallback(() => {
    disconnect();
    setVoice(v => ({
      ...IDLE_VOICE,
      unavailable: v.unavailable,
    }));
  }, [disconnect, setVoice]);

  const forget = useCallback(() => {
    disconnect();
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.clear();
    setVoiceState(IDLE_VOICE);
    setReactions([]);
    setRoomId(null);
  }, [disconnect]);

  // The room whose voice was already joined by itself, this entry.
  const autoTried = useRef<string | null>(null);
  const enter = useCallback(
    (next: string) => {
      if (roomIdRef.current === next) return;
      forget();
      autoTried.current = null;
      // Known at once, for a join that follows in the same moment.
      roomIdRef.current = next;
      setRoomId(next);
    },
    [forget]
  );

  // Signing out drops the room on this browser.
  const session = useSession();
  useEffect(() => {
    if (session.status === "unauthenticated" && roomIdRef.current) forget();
  }, [session.status, forget]);

  // Nothing left behind when the app itself goes.
  useEffect(() => () => disconnect(), [disconnect]);

  const showReaction = useCallback((userId: string, kind: ReactionKind) => {
    const shown: ShownReaction = { id: ++reactionIds.current, userId, kind };
    setReactions(list => withReaction(list, shown));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setReactions(list => list.filter(r => r.id !== shown.id));
    }, REACTION_LIFE_MS);
    timers.current.add(timer);
  }, []);

  const pass = trpc.rooms.voice.useMutation();
  const passRef = useRef(pass.mutateAsync);
  passRef.current = pass.mutateAsync;

  const loadDevices = useCallback(
    async (room: Room) => {
      try {
        const { Room: RoomClass } = await import("livekit-client");
        const found = await RoomClass.getLocalDevices("audioinput", false);
        setVoice(v => ({
          ...v,
          devices: found
            .filter(device => device.deviceId)
            .map((device, index) => ({
              id: device.deviceId,
              label: device.label || t("voice.micNumber", { n: index + 1 }),
            })),
          deviceId: room.getActiveDevice("audioinput") ?? "",
        }));
      } catch {
        // The list is a convenience; the default microphone still works.
      }
    },
    [setVoice, t]
  );

  const join = useCallback(async () => {
    const forRoom = roomIdRef.current;
    if (!forRoom || roomRef.current) return;
    setVoice(v => ({ ...v, problem: null, phase: "connecting" }));
    // Only this call's own connection is ever torn down below: a late
    // failure must not cut the voice of a room entered since.
    let created: Room | null = null;
    try {
      const granted = await passRef.current({ roomId: forRoom });
      if (roomIdRef.current !== forRoom) return;
      if (!granted) {
        setVoice(v => ({ ...v, unavailable: true, phase: "idle" }));
        return;
      }
      const {
        Room: RoomClass,
        RoomEvent,
        Track,
      } = await import("livekit-client");
      const room = new RoomClass({ adaptiveStream: false, dynacast: false });
      created = room;
      roomRef.current = room;
      const report = () => {
        if (roomRef.current !== room) return;
        const inVoice = new Set<string>([room.localParticipant.identity]);
        for (const person of room.remoteParticipants.values()) {
          inVoice.add(person.identity);
        }
        const speaking = new Set(
          room.activeSpeakers.map(person => person.identity)
        );
        setVoice(v => ({
          ...v,
          inVoice,
          speaking,
          heard: speaking.has(room.localParticipant.identity),
        }));
      };
      room
        .on(RoomEvent.TrackSubscribed, track => {
          if (track.kind !== Track.Kind.Audio) return;
          soundRef.current?.appendChild(track.attach());
        })
        .on(RoomEvent.TrackUnsubscribed, track => {
          for (const element of track.detach()) element.remove();
        })
        .on(RoomEvent.ParticipantConnected, report)
        .on(RoomEvent.ParticipantDisconnected, person => {
          setVoice(v => ({
            ...v,
            hands: v.hands.filter(id => id !== person.identity),
          }));
          report();
        })
        .on(RoomEvent.ActiveSpeakersChanged, report)
        .on(RoomEvent.Reconnecting, () => {
          if (roomRef.current === room) {
            setVoice(v => ({ ...v, phase: "reconnecting" }));
          }
        })
        .on(RoomEvent.Reconnected, () => {
          if (roomRef.current !== room) return;
          setVoice(v => ({ ...v, phase: "live" }));
          report();
        })
        .on(RoomEvent.Disconnected, () => {
          // Not our own "leave": the line dropped, or the server put the
          // student out (removed, or the room ended). A fresh start on
          // rejoining: the pass says again who may speak.
          if (roomRef.current !== room) return;
          roomRef.current = null;
          soundRef.current?.replaceChildren();
          setVoice(v => ({
            ...IDLE_VOICE,
            unavailable: v.unavailable,
            phase: "lost",
          }));
        })
        .on(RoomEvent.ParticipantPermissionsChanged, (_before, person) => {
          if (
            roomRef.current !== room ||
            person.identity !== room.localParticipant.identity
          ) {
            return;
          }
          const now = person.permissions?.canPublish ?? false;
          setVoice(v => ({
            ...v,
            maySpeak: now,
            asked: now ? false : v.asked,
            micOn: now ? v.micOn : false,
          }));
        })
        .on(RoomEvent.LocalTrackUnpublished, () => {
          if (roomRef.current !== room) return;
          setVoice(v => ({
            ...v,
            micOn: room.localParticipant.isMicrophoneEnabled,
          }));
        })
        .on(RoomEvent.DataReceived, (payload, person, _kind, topic) => {
          if (roomRef.current !== room || !person) return;
          if (topic === HAND_TOPIC) {
            setVoice(v =>
              v.hands.includes(person.identity)
                ? v
                : { ...v, hands: [...v.hands, person.identity] }
            );
          } else if (topic === REACTION_TOPIC) {
            const kind = parseReaction(payload);
            if (kind) showReaction(person.identity, kind);
          }
        })
        .on(RoomEvent.MediaDevicesChanged, () => void loadDevices(room));
      await room.connect(granted.url, granted.token);
      if (roomRef.current !== room || roomIdRef.current !== forRoom) {
        void room.disconnect();
        return;
      }
      setVoice(v => ({ ...v, maySpeak: granted.maySpeak, phase: "live" }));
      report();
    } catch (error) {
      if (created && roomRef.current === created) {
        roomRef.current = null;
        soundRef.current?.replaceChildren();
      }
      if (created) void (created as Room).disconnect();
      if (roomIdRef.current !== forRoom || roomRef.current) return;
      const message =
        error && typeof error === "object" && "data" in error
          ? translate(
              languageRef.current,
              errorKey(String((error as { message?: unknown }).message ?? ""))
            )
          : t("voice.connectFailed");
      setVoice(v => ({ ...v, phase: "idle", problem: message }));
    }
  }, [loadDevices, setVoice, showReaction, t]);

  const autoJoin = useCallback(() => {
    const id = roomIdRef.current;
    if (!id || autoTried.current === id) return;
    autoTried.current = id;
    const activation = (
      navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
    ).userActivation;
    if (activation?.hasBeenActive) void join();
  }, [join]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    if (voiceRef.current.micBusy) return;
    const next = !voiceRef.current.micOn;
    setVoice(v => ({ ...v, problem: null, micBusy: true }));
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setVoice(v => ({ ...v, micOn: next }));
      if (next) void loadDevices(room);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      setVoice(v => ({
        ...v,
        micOn: false,
        problem:
          name === "NotAllowedError" || name === "SecurityError"
            ? t("voice.micDenied")
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? t("voice.micMissing")
              : t("voice.micFailed"),
      }));
    } finally {
      setVoice(v => ({ ...v, micBusy: false }));
    }
  }, [loadDevices, setVoice, t]);

  const raiseHand = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.publishData(new Uint8Array([1]), {
        reliable: true,
        topic: HAND_TOPIC,
      });
      setVoice(v => ({ ...v, asked: true }));
    } catch {
      setVoice(v => ({ ...v, problem: t("voice.connectFailed") }));
    }
  }, [setVoice, t]);

  const react = useCallback(
    (kind: ReactionKind) => {
      const room = roomRef.current;
      if (!room) return;
      const now = Date.now();
      if (now - lastSent.current < REACTION_GAP_MS) return;
      lastSent.current = now;
      room.localParticipant
        .publishData(encodeReaction(kind), {
          reliable: true,
          topic: REACTION_TOPIC,
        })
        .then(() => showReaction(room.localParticipant.identity, kind))
        .catch(() => {
          // A reaction that did not go is not worth a message.
        });
    },
    [showReaction]
  );

  const value = useMemo<ActiveRoom>(
    () => ({
      roomId,
      enter,
      forget,
      voice,
      join,
      autoJoin,
      leaveVoice,
      toggleMic,
      raiseHand,
      dropHand: userId =>
        setVoice(v => ({ ...v, hands: v.hands.filter(id => id !== userId) })),
      switchDevice: deviceId => {
        setVoice(v => ({ ...v, deviceId }));
        void roomRef.current
          ?.switchActiveDevice("audioinput", deviceId)
          .catch(() =>
            setVoice(v => ({ ...v, problem: t("voice.micFailed") }))
          );
      },
      clearProblem: () => setVoice(v => ({ ...v, problem: null })),
      reactions,
      react,
    }),
    [
      roomId,
      enter,
      forget,
      voice,
      join,
      autoJoin,
      leaveVoice,
      toggleMic,
      raiseHand,
      reactions,
      react,
      setVoice,
      t,
    ]
  );

  return (
    <Context.Provider value={value}>
      {children}
      {/* The room's sound plays from here, whatever the page. */}
      <div ref={soundRef} hidden />
      {roomId ? <MiniRoom roomId={roomId} language={language} /> : null}
    </Context.Provider>
  );
}

// The room minimised: a small card over every other page (design ز8).
function MiniRoom({
  roomId,
  language,
}: {
  roomId: string;
  language: RoomsLanguage;
}) {
  const active = useActiveRoom();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [asking, setAsking] = useState(false);
  const t = (key: RoomsKey, values?: Record<string, string | number>) =>
    translate(language, key, values);
  // The same reading as the room's page (one request for both): the
  // heartbeat goes on while the student is elsewhere.
  const state = trpc.rooms.state.useQuery(
    { roomId },
    {
      // A dropped line is asked again at the next beat; only a refusal
      // (out of the room, the room ended) stops the reading.
      refetchInterval: query =>
        FINAL_REFUSALS.includes(query.state.error?.message ?? "")
          ? false
          : POLL_MS,
      refetchIntervalInBackground: true,
      retry: (count, error) =>
        !FINAL_REFUSALS.includes(error.message) && count < 3,
    }
  );
  const leave = trpc.rooms.leave.useMutation({
    onSettled: () => active.forget(),
  });
  const onRoomPages = pathname.startsWith(`/rooms/${roomId}`);
  const gone = state.error?.message;
  const { forget } = active;
  useEffect(() => {
    // The room's own page handles its refusals (it rejoins a dropped
    // member once); elsewhere there is nothing to come back to.
    if (gone && FINAL_REFUSALS.includes(gone) && !onRoomPages) {
      forget();
    }
  }, [gone, onRoomPages, forget]);

  const data = state.data;
  if (onRoomPages || !data) return null;
  const { voice } = active;
  const names = new Map(data.members.map(m => [m.userId, m.name]));
  const speaking = [...voice.speaking]
    .map(id => names.get(id))
    .filter(Boolean)
    .slice(0, 2);
  const line =
    voice.problem ??
    (speaking.length
      ? `${t("voice.speaking")}: ${speaking.join("، ")}`
      : t("live.present", { n: data.members.length }));

  return (
    <aside
      className={m.mini}
      dir={language === "ar" ? "rtl" : "ltr"}
      lang={language}
      aria-label={data.room.title}
    >
      <button
        type="button"
        className={m.head}
        onClick={() => router.push(`/rooms/${roomId}/live`)}
      >
        <span className={m.dot} data-speaking={speaking.length > 0} />
        <span className={m.text}>
          <b dir="auto">{data.room.title}</b>
          <small dir="auto" data-problem={!!voice.problem}>
            {line}
          </small>
        </span>
      </button>
      {asking ? (
        <div className={m.row}>
          <span>{t("app.sure")}</span>
          <button
            type="button"
            className={m.btn}
            aria-label={t("live.cancel")}
            onClick={() => setAsking(false)}
          >
            <X size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${m.btn} ${m.out}`}
            aria-label={t("app.leaveShort")}
            disabled={leave.isPending}
            onClick={() => leave.mutate({ roomId })}
          >
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className={m.row}>
          {voice.phase === "live" && voice.maySpeak ? (
            <button
              type="button"
              className={`${m.btn} ${voice.micOn ? m.on : ""}`}
              aria-label={voice.micOn ? t("voice.micOn") : t("voice.micOff")}
              aria-pressed={voice.micOn}
              disabled={voice.micBusy}
              onClick={() => void active.toggleMic()}
            >
              {voice.micOn ? (
                <Mic size={17} aria-hidden="true" />
              ) : (
                <MicOff size={17} aria-hidden="true" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className={`${m.btn} ${m.back}`}
            aria-label={t("quiz.backToFile")}
            onClick={() => router.push(`/rooms/${roomId}/live`)}
          >
            <Maximize2 size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${m.btn} ${m.out}`}
            aria-label={t("live.leave")}
            onClick={() => setAsking(true)}
          >
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>
      )}
    </aside>
  );
}
