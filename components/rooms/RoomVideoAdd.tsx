"use client";

import { useState } from "react";
import { parseYoutubeLink } from "@/lib/study-rooms/youtube";
import { trpc } from "@/lib/trpc-client";
import { Sheet } from "./parts";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// 🎬 The leader adds a YouTube video to the room: paste a link, check it,
// see which video it is, then add it. Only the video's id is ever sent on
// and kept — never the link as typed. The server checks the link again and
// asks YouTube whether the video exists and may be played inside another
// site (lib/study-rooms/video.ts).
export default function RoomVideoAdd({
  roomId,
  // A video is already in the room: adding replaces it for everyone.
  replacing,
  othersPresent,
  onClose,
}: {
  roomId: string;
  replacing: boolean;
  othersPresent: boolean;
  onClose: () => void;
}) {
  const { t, tError } = useRooms();
  const utils = trpc.useUtils();
  const [link, setLink] = useState("");
  const [confirming, setConfirming] = useState(false);
  const check = trpc.rooms.checkYoutube.useMutation();
  const add = trpc.rooms.setContent.useMutation({
    onSuccess: async () => {
      await utils.rooms.state.invalidate({ roomId });
      onClose();
    },
  });
  const found = check.data;
  // Said at once, before asking the server: this is not a YouTube link.
  const looksWrong = link.trim().length > 0 && !parseYoutubeLink(link);

  const addIt = () => {
    if (!found) return;
    if (replacing && othersPresent && !confirming) {
      setConfirming(true);
      return;
    }
    add.mutate({ roomId, contentType: "youtube", videoId: found.videoId });
  };

  return (
    <Sheet title={t("video.addTitle")} onClose={onClose}>
      <form
        className={s.videoForm}
        onSubmit={event => {
          event.preventDefault();
          if (!link.trim() || looksWrong) return;
          setConfirming(false);
          check.mutate({ roomId, link: link.trim() });
        }}
      >
        <label className={s.field}>
          {t("video.linkLabel")}
          <input
            className={s.input}
            dir="ltr"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.youtube.com/watch?v=…"
            value={link}
            maxLength={300}
            aria-invalid={looksWrong}
            onChange={event => {
              setLink(event.target.value);
              check.reset();
              setConfirming(false);
            }}
          />
        </label>
        <p className={s.meta} dir="auto">
          {t("video.linkExamples")} <bdi dir="ltr">youtube.com/watch?v=…</bdi> ·{" "}
          <bdi dir="ltr">youtu.be/…</bdi> ·{" "}
          <bdi dir="ltr">youtube.com/shorts/…</bdi>
        </p>
        {looksWrong ? (
          <p className={s.errorNote} role="alert">
            {t("error.video_invalid")}
          </p>
        ) : null}
        <button
          type="submit"
          className={`${s.btn} ${s.wide}`}
          disabled={!link.trim() || looksWrong || check.isPending}
        >
          {check.isPending ? t("video.checking") : t("video.check")}
        </button>
      </form>

      {check.error ? (
        <p className={s.errorNote} role="alert">
          {tError(check.error)}
        </p>
      ) : null}

      {found ? (
        <div className={s.videoPreview}>
          {/* YouTube's own thumbnail for this id; decorative beside the title. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={found.thumbnail} alt="" loading="lazy" />
          <div>
            <b dir="auto">{found.title ?? t("video.untitled")}</b>
            <span>{t("video.previewNote")}</span>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <p className={s.sub} role="alert">
          {t("video.replaceConfirm")}
        </p>
      ) : null}
      {add.error ? (
        <p className={s.errorNote} role="alert">
          {tError(add.error)}
        </p>
      ) : null}
      {found ? (
        <button
          type="button"
          className={`${s.btn} ${s.primary} ${s.wide}`}
          disabled={add.isPending}
          onClick={addIt}
        >
          {add.isPending
            ? t("video.adding")
            : confirming
              ? t("video.replaceYes")
              : t("video.add")}
        </button>
      ) : null}
    </Sheet>
  );
}
