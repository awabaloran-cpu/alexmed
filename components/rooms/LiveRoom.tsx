"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  Crown,
  Flag,
  ListChecks,
  LogOut,
  MessageCircle,
  MicOff,
  Settings,
  ShieldCheck,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { REPORT_REASONS, type ReportReason } from "@/lib/study-rooms/config";
import type { RoomsKey } from "@/lib/study-rooms/i18n";
import { trpc } from "@/lib/trpc-client";
import { Avatar, Sheet, SubjectLine } from "./parts";
import RoomChat, { useRoomChat } from "./RoomChat";
import { InviteBox } from "./RoomCreate";
import RoomDesk from "./RoomDesk";
import RoomFilePicker from "./RoomFilePicker";
import {
  QuizPanel,
  QuizResults,
  QuizStartSheet,
  useRoomQuiz,
} from "./RoomQuiz";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

const POLL_MS = 4000;

// 👥 Inside a room: who is here and who leads, the host's controls, and the
// way out. The room is read every few seconds — that reading is also the
// student's heartbeat. (The shared file, voice and chat join this screen in
// the next stages of docs/study-rooms.)
export default function LiveRoom({ roomId }: { roomId: string }) {
  const { t, tError } = useRooms();
  const router = useRouter();
  const utils = trpc.useUtils();
  const state = trpc.rooms.state.useQuery(
    { roomId },
    {
      refetchInterval: query => (query.state.error ? false : POLL_MS),
      // The reading is the heartbeat: it goes on while the tab is hidden
      // (the browser slows it down, which is enough to stay in the room).
      refetchIntervalInBackground: true,
      retry: (count, error) =>
        // A refusal is final; a network blip is tried again.
        !["not_available", "room_ended"].includes(error.message) && count < 3,
      refetchOnWindowFocus: true,
    }
  );
  const refresh = () => utils.rooms.state.invalidate({ roomId });
  // Away long enough to be taken out of the room (a sleeping phone, a lost
  // connection): coming back is rejoining, once, without being asked.
  const rejoin = trpc.rooms.join.useMutation({
    onSuccess: () => state.refetch(),
  });
  const triedRejoin = useRef(false);
  const stateError = state.error?.message;
  useEffect(() => {
    if (stateError === "not_available" && !triedRejoin.current) {
      triedRejoin.current = true;
      rejoin.mutate({ roomId });
    }
    // rejoin is a new object every render; the error is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateError, roomId]);
  const [sheet, setSheet] = useState<
    | { kind: "member"; userId: string }
    | { kind: "report"; userId: string | null }
    | { kind: "settings" }
    | { kind: "invite"; code: string }
    | { kind: "end" }
    | { kind: "file" }
    | { kind: "quiz" }
    | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The chat sits beside the file on a wide screen, and opens over it on a
  // phone.
  const [chatOpen, setChatOpen] = useState(false);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 960px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const [myPage, setMyPage] = useState<number | null>(null);
  const [jump, setJump] = useState<{ page: number } | null>(null);
  const onPage = useCallback((page: number) => setMyPage(page), []);
  const chat = useRoomChat(roomId, state.data?.room.seq ?? 0, wide || chatOpen);
  const quiz = useRoomQuiz(roomId, state.data?.room.seq ?? 0);

  const leave = trpc.rooms.leave.useMutation({
    onSuccess: () => router.replace(`/rooms/${roomId}/summary`),
    onError: () => router.replace("/rooms"),
  });
  const end = trpc.rooms.end.useMutation({
    onSuccess: () => router.replace(`/rooms/${roomId}/summary`),
  });
  const setMember = trpc.rooms.setMember.useMutation({ onSuccess: refresh });
  const remove = trpc.rooms.remove.useMutation({ onSuccess: refresh });
  const transfer = trpc.rooms.transferHost.useMutation({ onSuccess: refresh });
  const update = trpc.rooms.update.useMutation({ onSuccess: refresh });
  const rotate = trpc.rooms.rotateInvite.useMutation({
    onSuccess: result => setSheet({ kind: "invite", code: result.inviteCode }),
  });
  const mutationError =
    setMember.error ??
    remove.error ??
    transfer.error ??
    update.error ??
    rotate.error;

  // Leadership changed hands: say so to everyone, once.
  const data = state.data;
  const lastHost = useRef<{ id: string; name: string | null } | null>(null);
  useEffect(() => {
    if (!data) return;
    const host = data.members.find(
      member => member.userId === data.room.hostId
    );
    const before = lastHost.current;
    if (before && host && before.id !== host.userId) {
      const stillHere = data.members.some(
        member => member.userId === before.id
      );
      if (!stillHere) {
        setNotice(
          t("live.hostLeft", {
            left: before.name ?? "",
            next: host.name ?? "",
          })
        );
      }
    }
    if (host) lastHost.current = { id: host.userId, name: host.name };
  }, [data, t]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (state.isLoading || rejoin.isPending) {
    return <div className={s.skeleton} style={{ minHeight: 320 }} />;
  }
  if (!data) {
    const gone = ["not_available", "room_ended"].includes(
      state.error?.message ?? ""
    );
    return (
      <div className={s.empty} role="alert">
        <b>
          {state.error?.message === "room_ended"
            ? t("lobby.ended")
            : gone
              ? t("live.removed")
              : t("rooms.loadFailed")}
        </b>
        {gone ? null : (
          <button
            className={s.btn}
            type="button"
            onClick={() => state.refetch()}
          >
            {t("rooms.retry")}
          </button>
        )}
        {state.error?.message === "room_ended" ? (
          <Link
            className={`${s.btn} ${s.primary}`}
            href={`/rooms/${roomId}/summary`}
          >
            {t("live.seeSummary")}
          </Link>
        ) : null}
        <Link className={s.btn} href="/rooms">
          {t("lobby.toRooms")}
        </Link>
      </div>
    );
  }

  const { room, me, members } = data;
  const target =
    sheet?.kind === "member"
      ? members.find(member => member.userId === sheet.userId)
      : undefined;
  const close = () => setSheet(null);
  const roleLabel = (role: string) =>
    role === "host"
      ? t("live.host")
      : role === "cohost"
        ? t("live.cohost")
        : "";

  return (
    <>
      <AnimatePresence>
        {state.isRefetchError ? (
          <motion.div
            key="reconnect"
            className={s.bar}
            role="status"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {t("live.reconnecting")}
          </motion.div>
        ) : notice ? (
          <motion.div
            key="notice"
            className={s.bar}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {notice}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className={s.liveHead}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <SubjectLine room={room} />
          <h1 dir="auto">{room.title}</h1>
        </div>
        <span className={s.live}>
          <i />
          {t("live.present", { n: members.length })}
        </span>
      </div>

      <div
        className={s.seats}
        aria-label={t("live.present", { n: members.length })}
      >
        <AnimatePresence initial={false}>
          {members.map(member => (
            <motion.button
              key={member.userId}
              type="button"
              className={s.seat}
              layout
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 24 }}
              onClick={() =>
                member.userId === me.userId
                  ? undefined
                  : setSheet({ kind: "member", userId: member.userId })
              }
            >
              <Avatar person={member} size="lg" />
              <span dir="auto">
                {member.userId === me.userId ? t("live.you") : member.name}
              </span>
              <small>
                {roleLabel(member.role)}
                {member.mutedByHost ? " 🔇" : ""}
              </small>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      <div className={s.work}>
        {quiz.active ? (
          <QuizPanel
            roomId={roomId}
            quiz={quiz.active}
            memberCount={members.length}
            myUserId={me.userId}
            canLead={me.can.start_quiz}
            onChanged={() => void quiz.refetch()}
          />
        ) : quiz.finishedId ? (
          <QuizResults
            quizId={quiz.finishedId}
            myUserId={me.userId}
            onClose={quiz.dismiss}
          />
        ) : null}
        <div hidden={!!quiz.active || !!quiz.finishedId}>
          <RoomDesk
            roomId={roomId}
            bookId={room.bookId}
            sharedPage={room.sharedPage}
            canLead={me.can.lead_page}
            canMoveFreely={me.can.free_nav}
            canChoose={me.can.edit_room}
            onChoose={() => setSheet({ kind: "file" })}
            onPage={onPage}
            jump={jump}
            roomSeq={room.seq}
            myUserId={me.userId}
            canMark={me.can.mark}
            canDeleteAnyMark={me.can.delete_any_mark}
          />
        </div>
        {wide ? (
          <aside className={s.side} aria-label={t("chat.title")}>
            <h2>{t("live.chat")}</h2>
            <RoomChat
              roomId={roomId}
              chat={chat}
              myUserId={me.userId}
              page={room.bookId ? myPage : null}
              canChat={me.can.chat}
              canDeleteAny={me.can.delete_any_message}
              onGoToPage={page => setJump({ page })}
            />
          </aside>
        ) : null}
      </div>

      {mutationError ? (
        <p className={s.errorNote} role="alert">
          {tError(mutationError)}
        </p>
      ) : null}

      <div className={s.dock}>
        {wide ? null : (
          <button
            type="button"
            className={s.btn}
            aria-label={
              chat.unread
                ? t("live.chatUnread", { n: chat.unread })
                : t("live.chat")
            }
            onClick={() => setChatOpen(true)}
          >
            <MessageCircle size={17} aria-hidden="true" /> {t("live.chat")}
            {chat.unread ? (
              <span className={s.badge}>{chat.unread}</span>
            ) : null}
          </button>
        )}
        {me.can.start_quiz && !quiz.active ? (
          <button
            type="button"
            className={s.btn}
            onClick={() => setSheet({ kind: "quiz" })}
          >
            <ListChecks size={17} aria-hidden="true" /> {t("quiz.open")}
          </button>
        ) : null}
        {room.visibility === "private" && me.can.invite ? (
          <button
            type="button"
            className={s.btn}
            disabled={rotate.isPending}
            onClick={() => rotate.mutate({ roomId })}
          >
            <UserPlus size={17} aria-hidden="true" /> {t("live.invite")}
          </button>
        ) : null}
        {me.can.edit_room ? (
          <button
            type="button"
            className={s.btn}
            onClick={() => setSheet({ kind: "settings" })}
          >
            <Settings size={17} aria-hidden="true" /> {t("live.settings")}
          </button>
        ) : null}
        <button
          type="button"
          className={s.btn}
          onClick={() => setSheet({ kind: "report", userId: null })}
        >
          <Flag size={17} aria-hidden="true" /> {t("member.report")}
        </button>
        <button
          type="button"
          className={`${s.btn} ${s.danger}`}
          disabled={leave.isPending}
          onClick={() => leave.mutate({ roomId })}
        >
          <LogOut size={17} aria-hidden="true" /> {t("live.leave")}
        </button>
      </div>

      {!wide && chatOpen ? (
        <Sheet title={t("chat.title")} onClose={() => setChatOpen(false)}>
          <RoomChat
            roomId={roomId}
            chat={chat}
            myUserId={me.userId}
            page={room.bookId ? myPage : null}
            canChat={me.can.chat}
            canDeleteAny={me.can.delete_any_message}
            onGoToPage={page => {
              setJump({ page });
              setChatOpen(false);
            }}
          />
        </Sheet>
      ) : null}

      {sheet?.kind === "quiz" ? (
        <QuizStartSheet roomId={roomId} onClose={close} />
      ) : null}

      {sheet?.kind === "file" ? (
        <RoomFilePicker
          roomId={roomId}
          currentBookId={room.bookId}
          onClose={close}
        />
      ) : null}

      {sheet?.kind === "member" && target ? (
        <Sheet title={target.name ?? ""} onClose={close}>
          <div>
            {me.can.mute_member && target.role !== "host" ? (
              <button
                type="button"
                className={s.item}
                onClick={() => {
                  setMember.mutate({
                    roomId,
                    userId: target.userId,
                    muted: !target.mutedByHost,
                  });
                  close();
                }}
              >
                <MicOff size={18} aria-hidden="true" />
                {target.mutedByHost ? t("member.unmute") : t("member.mute")}
              </button>
            ) : null}
            {me.can.manage_roles ? (
              <>
                <button
                  type="button"
                  className={s.item}
                  onClick={() => {
                    transfer.mutate({ roomId, userId: target.userId });
                    close();
                  }}
                >
                  <Crown size={18} aria-hidden="true" /> {t("member.makeHost")}
                </button>
                <button
                  type="button"
                  className={s.item}
                  onClick={() => {
                    setMember.mutate({
                      roomId,
                      userId: target.userId,
                      role: target.role === "cohost" ? "member" : "cohost",
                    });
                    close();
                  }}
                >
                  <ShieldCheck size={18} aria-hidden="true" />
                  {target.role === "cohost"
                    ? t("member.removeCohost")
                    : t("member.makeCohost")}
                </button>
              </>
            ) : null}
            {me.can.kick_member && target.role !== "host" ? (
              <button
                type="button"
                className={s.item}
                onClick={() => {
                  remove.mutate({ roomId, userId: target.userId, ban: false });
                  close();
                }}
              >
                <UserMinus size={18} aria-hidden="true" />
                <span>
                  {t("member.kick")}
                  <small>{t("member.kickHint")}</small>
                </span>
              </button>
            ) : null}
            {me.can.ban_member ? (
              <button
                type="button"
                className={`${s.item} ${s.danger}`}
                onClick={() => {
                  remove.mutate({ roomId, userId: target.userId, ban: true });
                  close();
                }}
              >
                <Ban size={18} aria-hidden="true" />
                <span>
                  {t("member.ban")}
                  <small>{t("member.banHint")}</small>
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className={`${s.item} ${s.danger}`}
              onClick={() =>
                setSheet({ kind: "report", userId: target.userId })
              }
            >
              <Flag size={18} aria-hidden="true" /> {t("member.report")}
            </button>
          </div>
        </Sheet>
      ) : null}

      {sheet?.kind === "report" ? (
        <ReportSheet
          roomId={roomId}
          targetUserId={sheet.userId}
          womenOnly={room.womenOnly}
          onClose={close}
        />
      ) : null}

      {sheet?.kind === "invite" ? (
        <Sheet title={t("live.invite")} onClose={close}>
          <InviteBox roomId={roomId} code={sheet.code} />
        </Sheet>
      ) : null}

      {sheet?.kind === "settings" ? (
        <Sheet title={t("live.settings")} onClose={close}>
          <Toggle
            on={room.locked}
            label={t("live.lock")}
            hint={t("live.lockHint")}
            onChange={locked => update.mutate({ roomId, locked })}
          />
          <p className={s.sub}>{t("live.permissions")}</p>
          <Toggle
            on={room.settings.freeNav}
            label={t("perm.freeNav")}
            onChange={freeNav =>
              update.mutate({ roomId, settings: { freeNav } })
            }
          />
          <Toggle
            on={room.settings.marks}
            label={t("perm.marks")}
            onChange={marks => update.mutate({ roomId, settings: { marks } })}
          />
          <Toggle
            on={room.settings.chat}
            label={t("perm.chat")}
            onChange={chat => update.mutate({ roomId, settings: { chat } })}
          />
          <label className={s.field}>
            {t("perm.speak")}
            <select
              id="room-speak"
              className={s.input}
              value={room.settings.speak}
              onChange={event =>
                update.mutate({
                  roomId,
                  settings: {
                    speak: event.target.value as "open" | "request" | "host",
                  },
                })
              }
            >
              <option value="open">{t("perm.speak.open")}</option>
              <option value="request">{t("perm.speak.request")}</option>
              <option value="host">{t("perm.speak.host")}</option>
            </select>
          </label>
          {me.can.end_room ? (
            <button
              type="button"
              className={`${s.btn} ${s.danger} ${s.wide}`}
              onClick={() => setSheet({ kind: "end" })}
            >
              {t("live.end")}
            </button>
          ) : null}
        </Sheet>
      ) : null}

      {sheet?.kind === "end" ? (
        <Sheet title={t("live.endConfirm")} onClose={close}>
          <button
            type="button"
            className={`${s.btn} ${s.primary} ${s.wide}`}
            disabled={end.isPending}
            onClick={() => end.mutate({ roomId })}
          >
            {t("live.confirm")}
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.wide}`}
            onClick={close}
          >
            {t("live.cancel")}
          </button>
        </Sheet>
      ) : null}
    </>
  );
}

function Toggle({
  on,
  label,
  hint,
  onChange,
}: {
  on: boolean;
  label: string;
  hint?: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`${s.switch} ${on ? s.switchOn : ""}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className={s.tog} />
    </button>
  );
}

// About a member or about the room, with ready-made reasons.
function ReportSheet({
  roomId,
  targetUserId,
  womenOnly,
  onClose,
}: {
  roomId: string;
  targetUserId: string | null;
  womenOnly: boolean;
  onClose: () => void;
}) {
  const { t, tError, viewer } = useRooms();
  const [reason, setReason] = useState<ReportReason>("abuse");
  const [details, setDetails] = useState("");
  const report = trpc.rooms.report.useMutation();
  // Only the reasons that can be true here.
  const reasons = REPORT_REASONS.filter(value => {
    if (value === "not_female") return womenOnly && !!targetUserId;
    if (value === "looks_minor")
      return viewer.audience === "adult" && !!targetUserId;
    if (value === "adult_in_minor_room")
      return viewer.audience === "minor" && !!targetUserId;
    return true;
  });

  if (report.isSuccess) {
    return (
      <Sheet title={t("report.title")} onClose={onClose}>
        <p role="status">{t("report.sent")}</p>
        <button
          type="button"
          className={`${s.btn} ${s.wide}`}
          onClick={onClose}
        >
          {t("live.confirm")}
        </button>
      </Sheet>
    );
  }
  return (
    <Sheet
      title={`${t("report.title")} · ${targetUserId ? t("report.aboutMember") : t("report.aboutRoom")}`}
      onClose={onClose}
    >
      {reasons.map(value => (
        <button
          key={value}
          type="button"
          className={`${s.radio} ${reason === value ? s.radioOn : ""}`}
          role="radio"
          aria-checked={reason === value}
          onClick={() => setReason(value)}
        >
          {t(`report.${value}` as RoomsKey)}
        </button>
      ))}
      <label className={s.field}>
        {t("report.details")}
        <textarea
          id="report-details"
          className={s.input}
          dir="auto"
          rows={2}
          maxLength={500}
          value={details}
          onChange={event => setDetails(event.target.value)}
        />
      </label>
      {report.error ? (
        <p className={s.errorNote} role="alert">
          {tError(report.error)}
        </p>
      ) : null}
      <button
        type="button"
        className={`${s.btn} ${s.primary} ${s.wide}`}
        disabled={report.isPending}
        onClick={() =>
          report.mutate({
            roomId,
            targetUserId,
            reason,
            details: details.trim() || null,
          })
        }
      >
        {t("report.send")}
      </button>
      <p className={s.meta}>{t("report.anonymous")}</p>
    </Sheet>
  );
}
