"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Hand,
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  RotateCw,
} from "lucide-react";
import type { Room } from "livekit-client";
import { trpc } from "@/lib/trpc-client";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

type Phase = "idle" | "connecting" | "live" | "reconnecting" | "lost";
type Device = { id: string; label: string };

const HAND_TOPIC = "hand";

export type VoicePresence = {
  // Who is in the room's voice, and who is speaking right now.
  inVoice: Set<string>;
  speaking: Set<string>;
};

// 🎙️ The room's voice: live sound between the students in the room, never
// recorded. Nothing is asked of the microphone until the student presses
// to join and then to open it — joining is listening.
//
// The server decides who may speak (lib/study-rooms/voice.ts) and LiveKit
// enforces it: a student the host mutes loses the microphone there, not
// here. This screen only shows what is so, and says plainly when the
// browser refused the microphone or the connection dropped.
export default function RoomVoice({
  roomId,
  canGrant,
  names,
  onPresence,
}: {
  roomId: string;
  // The leader: may let a student who asked speak.
  canGrant: boolean;
  names: Map<string, string | null>;
  onPresence: (presence: VoicePresence) => void;
}) {
  const { t, tError } = useRooms();
  const utils = trpc.useUtils();
  const pass = trpc.rooms.voice.useMutation();
  const allow = trpc.rooms.setMember.useMutation({
    onSuccess: () => utils.rooms.state.invalidate({ roomId }),
  });
  const [phase, setPhase] = useState<Phase>("idle");
  const [unavailable, setUnavailable] = useState(false);
  const [maySpeak, setMaySpeak] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [asked, setAsked] = useState(false);
  const [hands, setHands] = useState<string[]>([]);
  const [heard, setHeard] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const soundRef = useRef<HTMLDivElement | null>(null);
  const presenceRef = useRef(onPresence);
  presenceRef.current = onPresence;

  const leave = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) void room.disconnect();
    soundRef.current?.replaceChildren();
    setPhase("idle");
    setMicOn(false);
    setHands([]);
    setAsked(false);
    setHeard(false);
    presenceRef.current({ inVoice: new Set(), speaking: new Set() });
  }, []);
  // The microphone is allowed on the rooms' pages only (next.config.ts), and
  // a browser fixes that when it LOADS a page: a student who arrived from
  // another page of the app without a full load still carries "no
  // microphone". Loading this page once, here, puts it right before they
  // ever press anything.
  useEffect(() => {
    const policy = (
      document as Document & {
        featurePolicy?: { allowsFeature?: (name: string) => boolean };
      }
    ).featurePolicy;
    if (policy?.allowsFeature?.("microphone") !== false) return;
    const key = `room-voice-reload-${roomId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    window.location.reload();
  }, [roomId]);

  // Leaving the page leaves the voice.
  useEffect(() => leave, [leave]);

  const join = async () => {
    setProblem(null);
    setPhase("connecting");
    try {
      const granted = await pass.mutateAsync({ roomId });
      if (!granted) {
        setUnavailable(true);
        setPhase("idle");
        return;
      }
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({ adaptiveStream: false, dynacast: false });
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
        setHeard(speaking.has(room.localParticipant.identity));
        presenceRef.current({ inVoice, speaking });
      };
      room
        .on(RoomEvent.TrackSubscribed, track => {
          if (track.kind !== Track.Kind.Audio) return;
          const element = track.attach();
          soundRef.current?.appendChild(element);
        })
        .on(RoomEvent.TrackUnsubscribed, track => {
          for (const element of track.detach()) element.remove();
        })
        .on(RoomEvent.ParticipantConnected, report)
        .on(RoomEvent.ParticipantDisconnected, person => {
          setHands(list => list.filter(id => id !== person.identity));
          report();
        })
        .on(RoomEvent.ActiveSpeakersChanged, report)
        .on(RoomEvent.Reconnecting, () => setPhase("reconnecting"))
        .on(RoomEvent.Reconnected, () => {
          setPhase("live");
          report();
        })
        .on(RoomEvent.Disconnected, () => {
          // Not by this page's own "leave": the line dropped, or the
          // server put the student out (removed, or the room ended).
          if (roomRef.current !== room) return;
          roomRef.current = null;
          soundRef.current?.replaceChildren();
          setMicOn(false);
          setPhase("lost");
          presenceRef.current({ inVoice: new Set(), speaking: new Set() });
        })
        .on(RoomEvent.ParticipantPermissionsChanged, (_before, person) => {
          if (person.identity !== room.localParticipant.identity) return;
          const now = person.permissions?.canPublish ?? false;
          setMaySpeak(now);
          if (now) setAsked(false);
          else setMicOn(false);
        })
        .on(RoomEvent.LocalTrackUnpublished, () =>
          setMicOn(room.localParticipant.isMicrophoneEnabled)
        )
        .on(RoomEvent.DataReceived, (_payload, person, _kind, topic) => {
          if (topic !== HAND_TOPIC || !person) return;
          setHands(list =>
            list.includes(person.identity) ? list : [...list, person.identity]
          );
        })
        .on(RoomEvent.MediaDevicesChanged, () => void loadDevices(room));
      await room.connect(granted.url, granted.token);
      if (roomRef.current !== room) {
        void room.disconnect();
        return;
      }
      setMaySpeak(granted.maySpeak);
      setPhase("live");
      report();
    } catch (error) {
      roomRef.current = null;
      setPhase("idle");
      setProblem(
        error instanceof Error && "data" in error
          ? tError(error)
          : t("voice.connectFailed")
      );
    }
  };

  const loadDevices = async (room: Room) => {
    try {
      const { Room: RoomClass } = await import("livekit-client");
      const found = await RoomClass.getLocalDevices("audioinput", false);
      setDevices(
        found
          .filter(device => device.deviceId)
          .map((device, index) => ({
            id: device.deviceId,
            label: device.label || t("voice.micNumber", { n: index + 1 }),
          }))
      );
      setDeviceId(room.getActiveDevice("audioinput") ?? "");
    } catch {
      // The list is a convenience; the default microphone still works.
    }
  };

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room || micBusy) return;
    setProblem(null);
    setMicBusy(true);
    try {
      const next = !micOn;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      if (next) void loadDevices(room);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      setProblem(
        name === "NotAllowedError" || name === "SecurityError"
          ? t("voice.micDenied")
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? t("voice.micMissing")
            : t("voice.micFailed")
      );
      setMicOn(false);
    } finally {
      setMicBusy(false);
    }
  };

  const raiseHand = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.publishData(new Uint8Array([1]), {
        reliable: true,
        topic: HAND_TOPIC,
      });
      setAsked(true);
    } catch {
      setProblem(t("voice.connectFailed"));
    }
  };

  if (unavailable) return null;

  return (
    <section className={s.voice} aria-label={t("voice.title")}>
      <div ref={soundRef} hidden />

      {phase === "idle" || phase === "connecting" ? (
        <div className={s.voiceRow}>
          <button
            type="button"
            className={`${s.btn} ${s.primary}`}
            disabled={phase === "connecting"}
            onClick={() => void join()}
          >
            <Headphones size={17} aria-hidden="true" />
            {phase === "connecting" ? t("voice.joining") : t("voice.join")}
          </button>
          <span className={s.meta}>{t("voice.joinHint")}</span>
        </div>
      ) : phase === "lost" ? (
        <div className={s.voiceRow} role="alert">
          <span>{t("voice.lost")}</span>
          <button type="button" className={s.btn} onClick={() => void join()}>
            <RotateCw size={16} aria-hidden="true" /> {t("voice.rejoin")}
          </button>
        </div>
      ) : (
        <>
          <div className={s.voiceRow}>
            <span className={s.live} role="status">
              <i />
              {phase === "reconnecting"
                ? t("live.reconnecting")
                : t("voice.connected")}
            </span>
            {maySpeak ? (
              <button
                type="button"
                className={`${s.btn} ${micOn ? s.primary : ""}`}
                aria-pressed={micOn}
                disabled={micBusy || phase === "reconnecting"}
                onClick={() => void toggleMic()}
              >
                {micOn ? (
                  <Mic size={17} aria-hidden="true" />
                ) : (
                  <MicOff size={17} aria-hidden="true" />
                )}
                {micOn ? t("voice.micOn") : t("voice.micOff")}
              </button>
            ) : (
              <button
                type="button"
                className={s.btn}
                disabled={asked}
                onClick={() => void raiseHand()}
              >
                <Hand size={17} aria-hidden="true" />
                {asked ? t("voice.asked") : t("voice.ask")}
              </button>
            )}
            <button
              type="button"
              className={`${s.btn} ${s.danger}`}
              onClick={leave}
            >
              <PhoneOff size={17} aria-hidden="true" /> {t("voice.leave")}
            </button>
          </div>

          {maySpeak ? (
            <p className={s.meta} role="status">
              {micOn
                ? heard
                  ? t("voice.heard")
                  : t("voice.micOnHint")
                : t("voice.micOffHint")}
            </p>
          ) : (
            <p className={s.meta}>{t("voice.listenOnly")}</p>
          )}

          {micOn && devices.length > 1 ? (
            <label className={s.field}>
              {t("voice.device")}
              <select
                className={s.input}
                value={deviceId}
                onChange={event => {
                  const id = event.target.value;
                  setDeviceId(id);
                  void roomRef.current
                    ?.switchActiveDevice("audioinput", id)
                    .catch(() => setProblem(t("voice.micFailed")));
                }}
              >
                {devices.map(device => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {canGrant
            ? hands.map(userId => (
                <div key={userId} className={s.markInfo} role="status">
                  <span dir="auto">
                    {t("voice.wantsToSpeak", {
                      name: names.get(userId) ?? t("chat.someone"),
                    })}
                  </span>
                  <button
                    type="button"
                    className={s.msgPage}
                    disabled={allow.isPending}
                    onClick={() => {
                      allow.mutate({
                        roomId,
                        userId,
                        grants: { speak: true },
                      });
                      setHands(list => list.filter(id => id !== userId));
                    }}
                  >
                    {t("voice.allow")}
                  </button>
                </div>
              ))
            : null}
        </>
      )}

      {problem ? (
        <p className={s.errorNote} role="alert">
          {problem}
        </p>
      ) : null}
      {allow.error ? (
        <p className={s.errorNote} role="alert">
          {tError(allow.error)}
        </p>
      ) : null}
    </section>
  );
}
