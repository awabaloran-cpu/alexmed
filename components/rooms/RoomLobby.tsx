"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { Avatar, SubjectLine } from "./parts";
import { RulesScreen } from "./RoomCreate";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// The lobby: who is inside and what they study, before stepping in. Every
// refusal (full, locked, ended, banned, not available) is said here.
export default function RoomLobby({
  roomId,
  invite: inviteProp,
}: {
  roomId?: string;
  invite?: string;
}) {
  const { t, tError } = useRooms();
  const router = useRouter();
  const invite = useSearchParams().get("i") ?? inviteProp ?? undefined;
  const [rules, setRules] = useState(false);
  const preview = trpc.rooms.preview.useQuery(
    roomId ? { roomId, invite } : { invite },
    { retry: false, refetchInterval: 8000 }
  );
  const join = trpc.rooms.join.useMutation({
    onSuccess: result => router.replace(`/rooms/${result.roomId}/live`),
    onError: error => {
      if (error.message === "rules_required") setRules(true);
    },
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
  if (rules && room.needsRules) {
    return (
      <RulesScreen
        onAccepted={() => {
          setRules(false);
          join.mutate({ roomId: room.id, invite });
        }}
      />
    );
  }

  const blocked = room.banned
    ? t("error.banned_from_room")
    : room.locked
      ? t("error.room_locked")
      : room.full
        ? t("error.room_full")
        : null;

  return (
    <div className={s.panel}>
      <div className={s.row}>
        <SubjectLine room={room} />
        <span className={s.tag}>
          {room.visibility === "private" ? t("card.private") : t("card.public")}
        </span>
      </div>
      <h1 dir="auto">{room.title}</h1>
      <p className={s.sub}>
        {t("lobby.inside")} ·{" "}
        {t("card.members", { n: room.memberCount, max: room.capacity })}
      </p>
      {room.members.length ? (
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
      ) : (
        <p className={s.meta}>{t("lobby.nobody")}</p>
      )}
      {room.womenOnly ? (
        <span
          className={`${s.chip} ${s.chipWomen}`}
          style={{ justifySelf: "start" }}
        >
          {t("filter.womenOnly")}
        </span>
      ) : null}
      {blocked ? (
        <p className={s.note} role="status">
          {blocked}
        </p>
      ) : null}
      {join.error && join.error.message !== "rules_required" ? (
        <p className={s.errorNote} role="alert">
          {tError(join.error)}
        </p>
      ) : null}
      <button
        type="button"
        className={`${s.btn} ${s.primary} ${s.wide}`}
        disabled={!!blocked || join.isPending}
        onClick={() => {
          if (room.needsRules) setRules(true);
          else join.mutate({ roomId: room.id, invite });
        }}
      >
        {t("lobby.join")}
      </button>
      {back}
    </div>
  );
}
