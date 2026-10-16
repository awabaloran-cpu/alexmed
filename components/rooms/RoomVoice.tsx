"use client";

import { useEffect } from "react";
import {
  Hand,
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  RotateCw,
} from "lucide-react";
import { REACTION_KINDS } from "@/lib/study-rooms/reactions";
import { trpc } from "@/lib/trpc-client";
import { useActiveRoom } from "./ActiveRoom";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

export type VoicePresence = {
  // Who is in the room's voice, and who is speaking right now.
  inVoice: Set<string>;
  speaking: Set<string>;
};

// 🎙️ The room's voice, on the room's own page: live sound between the
// students in the room, never recorded. Nothing is asked of the microphone
// until the student opens it — joining is listening.
//
// The voice itself lives above the pages (ActiveRoom.tsx), so it goes on
// when the student leaves this page for another and comes back. The server
// decides who may speak (lib/study-rooms/voice.ts) and LiveKit enforces it:
// a student the host mutes loses the microphone there, not here. This only
// shows what is so, and says plainly when the browser refused the
// microphone or the connection dropped.
export default function RoomVoice({
  roomId,
  canGrant,
  names,
}: {
  roomId: string;
  // The leader: may let a student who asked speak.
  canGrant: boolean;
  names: Map<string, string | null>;
}) {
  const { t, tError } = useRooms();
  const active = useActiveRoom();
  const voice = active.voice;
  const utils = trpc.useUtils();
  const allow = trpc.rooms.setMember.useMutation({
    onSuccess: () => utils.rooms.state.invalidate({ roomId }),
  });

  // The microphone is allowed on the rooms' pages only (next.config.ts), and
  // a browser fixes that when it LOADS a page: a student who arrived from
  // another page of the app without a full load still carries "no
  // microphone". Loading this page once, here, puts it right before they
  // ever press anything — never while they are already listening.
  const connected = voice.phase === "live" || voice.phase === "reconnecting";
  useEffect(() => {
    if (connected) return;
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
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  if (voice.unavailable) return null;

  return (
    <section className={s.voice} aria-label={t("voice.title")}>
      {voice.phase === "idle" || voice.phase === "connecting" ? (
        <div className={s.voiceRow}>
          <button
            type="button"
            className={`${s.btn} ${s.primary}`}
            disabled={voice.phase === "connecting"}
            onClick={() => void active.join()}
          >
            <Headphones size={17} aria-hidden="true" />
            {voice.phase === "connecting"
              ? t("voice.joining")
              : t("voice.join")}
          </button>
          <span className={s.meta}>{t("voice.joinHint")}</span>
        </div>
      ) : voice.phase === "lost" ? (
        <div className={s.voiceRow} role="alert">
          <span>{t("voice.lost")}</span>
          <button
            type="button"
            className={s.btn}
            onClick={() => void active.join()}
          >
            <RotateCw size={16} aria-hidden="true" /> {t("voice.rejoin")}
          </button>
        </div>
      ) : (
        <>
          <div className={s.voiceRow}>
            <span className={s.live} role="status">
              <i />
              {voice.phase === "reconnecting"
                ? t("live.reconnecting")
                : t("voice.connected")}
            </span>
            {voice.maySpeak ? (
              <button
                type="button"
                className={`${s.btn} ${voice.micOn ? s.primary : ""}`}
                aria-pressed={voice.micOn}
                disabled={voice.micBusy || voice.phase === "reconnecting"}
                onClick={() => void active.toggleMic()}
              >
                {voice.micOn ? (
                  <Mic size={17} aria-hidden="true" />
                ) : (
                  <MicOff size={17} aria-hidden="true" />
                )}
                {voice.micOn ? t("voice.micOn") : t("voice.micOff")}
              </button>
            ) : (
              <button
                type="button"
                className={s.btn}
                disabled={voice.asked}
                onClick={() => void active.raiseHand()}
              >
                <Hand size={17} aria-hidden="true" />
                {voice.asked ? t("voice.asked") : t("voice.ask")}
              </button>
            )}
            <button
              type="button"
              className={`${s.btn} ${s.danger}`}
              onClick={active.leaveVoice}
            >
              <PhoneOff size={17} aria-hidden="true" /> {t("voice.leave")}
            </button>
          </div>

          {voice.maySpeak ? (
            <p className={s.meta} role="status">
              {voice.micOn
                ? voice.heard
                  ? t("voice.heard")
                  : t("voice.micOnHint")
                : t("voice.micOffHint")}
            </p>
          ) : (
            <p className={s.meta}>{t("voice.listenOnly")}</p>
          )}

          <div className={s.reactRow} role="group" aria-label={t("app.react")}>
            {REACTION_KINDS.map(kind => (
              <button
                key={kind}
                type="button"
                className={`${s.reactBtn} ${s[`react-${kind}`]}`}
                onClick={() => active.react(kind)}
              >
                {t(`react.${kind}`)}
              </button>
            ))}
          </div>

          {voice.micOn && voice.devices.length > 1 ? (
            <label className={s.field}>
              {t("voice.device")}
              <select
                className={s.input}
                value={voice.deviceId}
                onChange={event => active.switchDevice(event.target.value)}
              >
                {voice.devices.map(device => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {canGrant
            ? voice.hands.map(userId => (
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
                      active.dropHand(userId);
                    }}
                  >
                    {t("voice.allow")}
                  </button>
                </div>
              ))
            : null}
        </>
      )}

      {voice.problem ? (
        <p className={s.errorNote} role="alert">
          {voice.problem}
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
