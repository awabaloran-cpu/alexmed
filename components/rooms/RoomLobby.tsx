"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Headphones, MicOff } from "lucide-react";
import type { RoomsKey } from "@/lib/study-rooms/i18n";
import { trpc } from "@/lib/trpc-client";
import {
  Avatar,
  AvatarStack,
  Sheet,
  SubjectLine,
  sectionColor,
  sectionIcon,
  sectionName,
} from "./parts";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

const LANGUAGE_KEYS: Record<string, RoomsKey> = {
  ar: "lang.ar",
  en: "lang.en",
  mixed: "lang.mixed",
};

// The lobby (design ز2): what the room is, who is inside and who leads,
// before stepping in. Every refusal (full, locked, ended, banned, not
// available) is said here; a public room asks for its rules once, right
// here, with the rules a tap away.
export default function RoomLobby({
  roomId,
  invite: inviteProp,
}: {
  roomId?: string;
  invite?: string;
}) {
  const { t, tError, language, refreshViewer } = useRooms();
  const router = useRouter();
  const invite = useSearchParams().get("i") ?? inviteProp ?? undefined;
  const [agreed, setAgreed] = useState(false);
  const [readingRules, setReadingRules] = useState(false);
  const preview = trpc.rooms.preview.useQuery(
    roomId ? { roomId, invite } : { invite },
    { retry: false, refetchInterval: 8000 }
  );
  const sections = trpc.rooms.sections.useQuery(undefined, {
    staleTime: 60_000,
  });
  const join = trpc.rooms.join.useMutation({
    onSuccess: result => router.replace(`/rooms/${result.roomId}/live`),
  });
  const accept = trpc.rooms.setProfile.useMutation({
    onSuccess: () => refreshViewer(),
  });
  const room = preview.data;

  // Already inside (another tab, a reload): straight back to the room.
  useEffect(() => {
    if (room?.joined && room.status === "active") {
      router.replace(`/rooms/${room.id}/live`);
    }
  }, [room?.joined, room?.status, room?.id, router]);

  const back = (
    <Link className={s.btn} href="/rooms">
      {t("lobby.toRooms")}
    </Link>
  );

  if (preview.isLoading) {
    return <div className={s.skeleton} style={{ minHeight: 260 }} />;
  }
  if (!room) {
    return (
      <div className={s.empty} role="alert">
        <b>{tError(preview.error)}</b>
        {back}
      </div>
    );
  }
  if (room.status !== "active") {
    return (
      <div className={s.empty}>
        <b>{t("lobby.ended")}</b>
        {back}
      </div>
    );
  }

  const blocked = room.banned
    ? t("error.banned_from_room")
    : room.locked
      ? t("error.room_locked")
      : room.full
        ? t("error.room_full")
        : null;
  const section = sections.data?.find(item => item.id === room.sectionId);
  const Icon = sectionIcon(section?.icon ?? "");
  const host = room.members.find(member => member.role === "host");
  const busy = join.isPending || accept.isPending;
  const canJoin = !blocked && !busy && (!room.needsRules || agreed);
  const error = join.error ?? accept.error;

  const enter = async () => {
    if (room.needsRules) {
      try {
        await accept.mutateAsync({ acceptRules: true });
      } catch {
        return;
      }
    }
    join.mutate({ roomId: room.id, invite });
  };

  return (
    <div className={s.door}>
      <header
        className={`${s.doorHead} ${sectionColor(section?.color ?? "med")}`}
      >
        <span className={s.doorSection}>
          <i aria-hidden="true">
            <Icon size={16} />
          </i>
          {section ? sectionName(section, language) : null}
          <SubjectLine room={room} />
        </span>
        <h1 dir="auto">{room.title}</h1>
      </header>

      <div className={s.doorFacts}>
        <span>
          <b dir="ltr">
            {room.memberCount} / {room.capacity}
          </b>
          <small>{t("app.factInside")}</small>
        </span>
        <span>
          <b>
            {room.visibility === "private"
              ? t("card.private")
              : t("card.public")}
          </b>
          <small>{t("app.factKind")}</small>
        </span>
        <span>
          <b>{t(LANGUAGE_KEYS[room.language] ?? "lang.ar")}</b>
          <small>{t("app.factLanguage")}</small>
        </span>
      </div>

      {room.members.length ? (
        <div className={s.doorWho}>
          <AvatarStack people={room.members.slice(0, 4)} />
          <span>
            {host
              ? t("app.leading", { name: host.name ?? "" })
              : t("lobby.inside")}
          </span>
        </div>
      ) : (
        <p className={s.meta}>{t("lobby.nobody")}</p>
      )}

      {room.members.length > 4 ? (
        <div className={s.seats}>
          {room.members.map(member => (
            <span
              key={member.userId}
              className={s.seat}
              style={{ cursor: "default" }}
            >
              <Avatar person={member} />
              <span dir="auto">{member.name}</span>
              {member.role === "host" ? <small>{t("live.host")}</small> : null}
            </span>
          ))}
        </div>
      ) : null}

      {room.womenOnly ? (
        <span
          className={`${s.chip} ${s.chipWomen}`}
          style={{ justifySelf: "start" }}
        >
          {t("filter.womenOnly")}
        </span>
      ) : null}

      {room.needsRules ? (
        <div className={s.doorRules}>
          <label>
            <input
              type="checkbox"
              checked={agreed}
              onChange={event => setAgreed(event.target.checked)}
            />
            {t("app.agreeRules")}
          </label>
          <button
            type="button"
            className={s.readerLink}
            onClick={() => setReadingRules(true)}
          >
            {t("app.readRules")}
          </button>
        </div>
      ) : null}

      {blocked ? (
        <p className={s.note} role="status">
          {blocked}
        </p>
      ) : null}
      {error ? (
        <p className={s.errorNote} role="alert">
          {tError(error)}
        </p>
      ) : null}

      <div className={s.doorBar}>
        <div className={s.doorActions}>
          <Link className={s.btn} href="/rooms">
            {t("app.notNow")}
          </Link>
          <button
            type="button"
            className={`${s.btn} ${s.primary}`}
            disabled={!canJoin}
            onClick={() => void enter()}
          >
            <Headphones size={17} aria-hidden="true" />
            {t("app.joinListen")}
          </button>
        </div>
        <p className={s.meta}>
          <MicOff size={13} aria-hidden="true" /> {t("app.micNote")}
        </p>
      </div>

      {readingRules ? (
        <Sheet title={t("rules.title")} onClose={() => setReadingRules(false)}>
          <p className={s.meta}>{t("rules.intro")}</p>
          <ul className={s.rules}>
            {(
              ["rules.1", "rules.2", "rules.3", "rules.4", "rules.5"] as const
            ).map(key => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          <p className={s.meta}>{t("rules.once")}</p>
          <button
            type="button"
            className={`${s.btn} ${s.primary} ${s.wide}`}
            onClick={() => {
              setAgreed(true);
              setReadingRules(false);
            }}
          >
            {t("rules.agree")}
          </button>
        </Sheet>
      ) : null}
    </div>
  );
}
