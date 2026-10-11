"use client";

// 🤝 Colleagues inside the rooms: inviting one by name from the invite
// sheet, the invitations waiting on the rooms' home, and "add to my
// colleagues" on a member's card. The server decides every rule
// (lib/colleagues.ts, lib/study-rooms/invites.ts); this shows its answer.
import { useState } from "react";
import Link from "next/link";
import { Check, DoorOpen, ShieldBan, UserCheck, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ROOMS_MESSAGES, type RoomsKey } from "@/lib/study-rooms/i18n";
import { Avatar } from "./parts";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// A colleague refusal carries its own reason key; a room one goes through
// the rooms' usual sentence.
function useExplain() {
  const { t, tError } = useRooms();
  return (error: { message: string } | null | undefined) => {
    if (!error) return null;
    const key = `col.${error.message}`;
    return key in ROOMS_MESSAGES.ar ? t(key as RoomsKey) : tError(error);
  };
}

const asPerson = (person: {
  id: string;
  name: string | null;
  image: string | null;
}) => ({
  userId: person.id,
  name: person.name,
  image: person.image,
  country: null,
});

// The invite sheet's first half: the inviter's own colleagues, one tap each.
export function InviteColleagues({ roomId }: { roomId: string }) {
  const { t, tError } = useRooms();
  const utils = trpc.useUtils();
  const candidates = trpc.rooms.inviteCandidates.useQuery({ roomId });
  const refresh = () => utils.rooms.inviteCandidates.invalidate({ roomId });
  const invite = trpc.rooms.inviteColleague.useMutation({ onSuccess: refresh });
  const cancel = trpc.rooms.cancelInvite.useMutation({ onSuccess: refresh });
  const error = invite.error ?? cancel.error ?? candidates.error;

  return (
    <>
      <p className={s.sub}>{t("invite.colleagues")}</p>
      {error ? (
        <p className={s.errorNote} role="alert">
          {tError(error)}
        </p>
      ) : null}
      {candidates.isLoading ? (
        <div className={s.skeleton} aria-busy="true" />
      ) : !candidates.data?.length ? (
        <p className={s.meta}>{t("invite.none")}</p>
      ) : (
        <ul className={s.people}>
          {candidates.data.map(person => (
            <li key={person.id}>
              <Avatar person={asPerson(person)} size="sm" />
              <b dir="auto">{person.name}</b>
              {person.state === "here" ? (
                <span className={s.soft}>{t("invite.here")}</span>
              ) : person.state === "invited" ? (
                <>
                  <span className={s.soft}>
                    <Check size={13} aria-hidden="true" /> {t("invite.sent")}
                  </span>
                  {person.inviteId ? (
                    <button
                      type="button"
                      className={s.chip}
                      disabled={cancel.isPending}
                      onClick={() =>
                        cancel.mutate({ inviteId: person.inviteId! })
                      }
                    >
                      {t("invite.undo")}
                    </button>
                  ) : null}
                </>
              ) : (
                <button
                  type="button"
                  className={`${s.chip} ${s.chipOn}`}
                  disabled={invite.isPending}
                  onClick={() => invite.mutate({ roomId, userId: person.id })}
                >
                  <UserPlus size={14} aria-hidden="true" /> {t("invite.send")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Link className={s.meta} href="/shared">
        {t("invite.manage")}
      </Link>
    </>
  );
}

// On the rooms' home: the invitations waiting for this student.
export function MyInvites() {
  const { t, tError } = useRooms();
  const utils = trpc.useUtils();
  const invites = trpc.rooms.myInvites.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const decline = trpc.rooms.declineInvite.useMutation({
    onSuccess: () => utils.rooms.myInvites.invalidate(),
  });
  if (!invites.data?.length) return null;
  return (
    <>
      <p className={s.sub}>{t("invites.title")}</p>
      {decline.error ? (
        <p className={s.errorNote} role="alert">
          {tError(decline.error)}
        </p>
      ) : null}
      <ul className={`${s.people} ${s.peopleCard}`}>
        {invites.data.map(invite => (
          <li key={invite.inviteId}>
            <Avatar person={asPerson(invite.inviter)} />
            <span className={s.personText}>
              <b dir="auto">{invite.roomTitle}</b>
              <small>
                {t("invites.from", { name: invite.inviter.name ?? "" })}
              </small>
            </span>
            <Link
              className={`${s.chip} ${s.chipOn}`}
              href={`/rooms/${invite.roomId}`}
            >
              <DoorOpen size={14} aria-hidden="true" /> {t("invites.enter")}
            </Link>
            <button
              type="button"
              className={s.chip}
              disabled={decline.isPending}
              onClick={() => decline.mutate({ inviteId: invite.inviteId })}
            >
              {t("invites.decline")}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// On a member's card: where the two stand, and the one step that is open.
export function ColleagueItems({
  userId,
  onBlocked,
}: {
  userId: string;
  onBlocked: () => void;
}) {
  const { t } = useRooms();
  const explain = useExplain();
  const utils = trpc.useUtils();
  // A block is asked about once: the first tap arms it, the second does it.
  const [armed, setArmed] = useState(false);
  const colleagues = trpc.colleagues.list.useQuery();
  const requests = trpc.colleagues.requests.useQuery();
  const refresh = () => utils.colleagues.invalidate();
  const ask = trpc.colleagues.request.useMutation({ onSuccess: refresh });
  const answer = trpc.colleagues.respond.useMutation({ onSuccess: refresh });
  const block = trpc.colleagues.block.useMutation({
    onSuccess: () => {
      refresh();
      onBlocked();
    },
  });

  const incoming = requests.data?.incoming.find(row => row.id === userId);
  const relation = colleagues.data?.some(row => row.id === userId)
    ? "colleague"
    : incoming
      ? "incoming"
      : requests.data?.outgoing.some(row => row.id === userId)
        ? "outgoing"
        : "none";
  const ready = !colleagues.isLoading && !requests.isLoading;
  const error = explain(ask.error ?? answer.error ?? block.error);

  return (
    <>
      {error ? (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      ) : null}
      {!ready ? null : relation === "colleague" ? (
        <p className={`${s.item} ${s.itemStill}`}>
          <UserCheck size={18} aria-hidden="true" /> {t("member.isColleague")}
        </p>
      ) : relation === "outgoing" ? (
        <p className={`${s.item} ${s.itemStill}`}>
          <UserCheck size={18} aria-hidden="true" />
          {t("member.colleaguePending")}
        </p>
      ) : (
        <button
          type="button"
          className={s.item}
          disabled={ask.isPending || answer.isPending}
          onClick={() =>
            incoming
              ? answer.mutate({
                  connectionId: incoming.connectionId,
                  decision: "accept",
                })
              : ask.mutate({ userId })
          }
        >
          <UserPlus size={18} aria-hidden="true" />
          <span>
            {incoming ? t("member.colleagueAccept") : t("member.addColleague")}
            {incoming ? null : <small>{t("member.addColleagueHint")}</small>}
          </span>
        </button>
      )}
      <button
        type="button"
        className={`${s.item} ${s.danger}`}
        disabled={block.isPending}
        onClick={() => (armed ? block.mutate({ userId }) : setArmed(true))}
      >
        <ShieldBan size={18} aria-hidden="true" />
        <span>
          {armed ? t("member.blockConfirm") : t("member.block")}
          <small>{t("member.blockHint")}</small>
        </span>
      </button>
    </>
  );
}
