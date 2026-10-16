"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  ChevronDown,
  Crown,
  FileText,
  Flag,
  Hand,
  Headphones,
  LayoutList,
  ListChecks,
  LogOut,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Smile,
  UserMinus,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import { REPORT_REASONS, type ReportReason } from "@/lib/study-rooms/config";
import type { RoomsKey } from "@/lib/study-rooms/i18n";
import { isTap, REACTION_KINDS } from "@/lib/study-rooms/reactions";
import { trpc } from "@/lib/trpc-client";
import { IDLE_VOICE, useActiveRoom } from "./ActiveRoom";
import { Avatar, Sheet, SubjectLine } from "./parts";
import RoomChat, { useRoomChat } from "./RoomChat";
import { ColleagueItems, InviteColleagues } from "./RoomColleagues";
import { InviteBox } from "./RoomCreate";
import RoomDesk, { type DeskInfo } from "./RoomDesk";
import RoomFilePicker from "./RoomFilePicker";
import RoomVideo from "./RoomVideo";
import RoomVideoAdd from "./RoomVideoAdd";
import RoomVoice from "./RoomVoice";
import {
  QuizPanel,
  QuizResults,
  QuizStartSheet,
  useRoomQuiz,
} from "./RoomQuiz";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

const POLL_MS = 4000;
// Over the file, the room's controls step aside after this long untouched
// (design ح) and come back with a tap.
const CHROME_HIDE_MS = 4000;

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
    | { kind: "invite"; code: string | null }
    | { kind: "end" }
    | { kind: "file" }
    | { kind: "quiz" }
    | { kind: "video" }
    | { kind: "videoRemove" }
    | { kind: "more" }
    | { kind: "members" }
    | { kind: "leave" }
    | { kind: "switch"; from: string }
    | null
  >(null);
  // 🎧 The room lives above the pages (ActiveRoom.tsx): this page makes it
  // the active one. Another room the student is in is left only if they
  // say so; otherwise they go back to it.
  const active = useActiveRoom();
  const { enter, autoJoin } = active;
  const otherRoom =
    active.roomId && active.roomId !== roomId ? active.roomId : null;
  const leaveOther = trpc.rooms.leave.useMutation();
  const leaveThis = trpc.rooms.leave.useMutation();
  const asked = useRef(false);
  useEffect(() => {
    if (otherRoom) {
      if (!asked.current) {
        asked.current = true;
        setSheet({ kind: "switch", from: otherRoom });
      }
      return;
    }
    enter(roomId);
  }, [otherRoom, roomId, enter]);
  // This room is the active one (not still the other one, while the
  // student is asked): only then is the voice on this page this room's.
  const here = active.roomId === roomId;
  // Joining is listening: the voice is joined by itself, once per entry
  // into the room (ActiveRoom.autoJoin); otherwise they press "join".
  useEffect(() => {
    if (here) autoJoin();
  }, [here, autoJoin]);
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
  // 🧭 A quiz of the Discover catalogue brought to this room ("play with
  // friends" there lands here with ?quiz=<slug>): it waits, named, until
  // the one who brought it starts it — friends first get the link.
  const readySlug = useSearchParams().get("quiz");
  const readyQuiz = trpc.discover.quiz.useQuery(
    { slug: readySlug ?? "" },
    {
      enabled: !!readySlug,
      // A quiz that is not there will not be there next time either; a
      // dropped request is tried again.
      retry: (count, error) => error.message !== "not_found" && count < 2,
      staleTime: Infinity,
    }
  );
  const dropReady = () => router.replace(`/rooms/${roomId}/live`);
  const startCatalog = trpc.rooms.startCatalogQuiz.useMutation({
    onSuccess: () => {
      dropReady();
      void quiz.refetch();
      return utils.rooms.state.invalidate({ roomId });
    },
  });
  // 🎬 The room's video: where the player is (for a chat message to
  // carry), "go to this second" from the chat, and the side panel folded
  // away to give the video the width.
  const videoTimeRef = useRef<number | null>(null);
  const [videoSeek, setVideoSeek] = useState<{ seconds: number } | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  // 🖥 The presentation: whenever the room has a file or a video, that is
  // the screen — edge to edge, the rest of the room one tap away. Nobody
  // presses anything to get it: it is where a member lands, and where a
  // new file or video puts everyone. "Back" shows the room's own page.
  const [focus, setFocus] = useState(true);
  const [deskInfo, setDeskInfo] = useState<DeskInfo | null>(null);
  const onDeskInfo = useCallback((info: DeskInfo) => setDeskInfo(info), []);
  const live = state.data;
  const liveVideo =
    !!live &&
    live.video.contentType === "youtube" &&
    !!live.video.videoId &&
    !!live.video.state;
  const contentKey = !live
    ? ""
    : liveVideo
      ? `video:${live.video.videoId}`
      : `file:${live.room.bookId ?? ""}`;
  useEffect(() => {
    setFocus(true);
  }, [contentKey]);
  // A quiz waiting to start is shown on the room's own page, with the
  // seats and the invite beside it.
  const presenting =
    focus && !readySlug && !!live && (liveVideo || !!live.room.bookId);
  // The page behind does not scroll under the presentation.
  useEffect(() => {
    if (!presenting) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [presenting]);
  const setContent = trpc.rooms.setContent.useMutation({
    onSuccess: () => utils.rooms.state.invalidate({ roomId }),
  });
  const clearContent = trpc.rooms.clearContent.useMutation({
    onSuccess: () => {
      setSheet(null);
      return utils.rooms.state.invalidate({ roomId });
    },
  });
  const voice = here ? active.voice : IDLE_VOICE;
  const memberList = state.data?.members;
  const names = useMemo(
    () => new Map((memberList ?? []).map(m => [m.userId, m.name])),
    [memberList]
  );

  const leave = trpc.rooms.leave.useMutation({
    onSuccess: () => router.replace(`/rooms/${roomId}/summary`),
    onError: () => router.replace("/rooms"),
    // Out of the room: its voice and its reading stop here too.
    onSettled: () => active.forget(),
  });
  const end = trpc.rooms.end.useMutation({
    onSuccess: () => {
      active.forget();
      router.replace(`/rooms/${roomId}/summary`);
    },
  });

  // ✋ The controls over the file (design ح): the header, the desk's tools
  // and the dock step aside after a few quiet seconds; a tap on the file
  // brings them back, and any touch or key on them keeps them. Never while
  // something on them is in use (see `chromeHeld` below).
  const [chromeShown, setChromeShown] = useState(true);
  const [deskBusy, setDeskBusy] = useState(false);
  const [reacting, setReacting] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const holdRef = useRef(false);
  const wakeChrome = useCallback(() => {
    setChromeShown(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!holdRef.current) setChromeShown(false);
    }, CHROME_HIDE_MS);
  }, []);
  useEffect(
    () => () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      if (tapWait.current !== null) window.clearTimeout(tapWait.current);
    },
    []
  );
  // A second tap soon after the first is a double tap (zoom), not two.
  const tapWait = useRef<number | null>(null);
  const tapDown = useRef<{ x: number; y: number; at: number } | null>(null);
  const onStagePointerDown = useCallback((event: React.PointerEvent) => {
    if (tapWait.current !== null) {
      window.clearTimeout(tapWait.current);
      tapWait.current = null;
      tapDown.current = null;
      return;
    }
    tapDown.current = { x: event.clientX, y: event.clientY, at: Date.now() };
  }, []);
  const onStagePointerUp = useCallback(
    (event: React.PointerEvent) => {
      const down = tapDown.current;
      tapDown.current = null;
      if (
        !down ||
        !isTap(down, { x: event.clientX, y: event.clientY, at: Date.now() })
      ) {
        return;
      }
      tapWait.current = window.setTimeout(() => {
        tapWait.current = null;
        if (chromeShownRef.current && !holdRef.current) {
          if (hideTimer.current !== null)
            window.clearTimeout(hideTimer.current);
          setChromeShown(false);
        } else {
          wakeChrome();
        }
      }, 280);
    },
    [wakeChrome]
  );
  const chromeShownRef = useRef(chromeShown);
  chromeShownRef.current = chromeShown;
  // In use, so in sight: a menu, the chat, the reactions, a highlight being
  // drawn, the quiz, or a raised hand waiting for whoever may allow it. A
  // video keeps them too: a tap on YouTube's player never reaches the page,
  // so nothing could bring them back.
  const chromeHeld =
    liveVideo ||
    !!sheet ||
    chatOpen ||
    reacting ||
    deskBusy ||
    !!quiz.active ||
    !!quiz.finishedId ||
    (!!state.data?.me.can.edit_room && voice.hands.length > 0);
  holdRef.current = chromeHeld;
  // One object while nothing in it changes: the desk does not redo its
  // work on every reading of the room or every word spoken.
  const deskChrome = useMemo(
    () => ({
      shown: chromeShown,
      wake: wakeChrome,
      onStagePointerDown,
      onStagePointerUp,
      onBusy: setDeskBusy,
    }),
    [chromeShown, wakeChrome, onStagePointerDown, onStagePointerUp]
  );
  useEffect(() => {
    if (!presenting || chromeHeld) {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      setChromeShown(true);
      return;
    }
    wakeChrome();
  }, [presenting, chromeHeld, wakeChrome]);
  const setMember = trpc.rooms.setMember.useMutation({ onSuccess: refresh });
  const remove = trpc.rooms.remove.useMutation({ onSuccess: refresh });
  const transfer = trpc.rooms.transferHost.useMutation({ onSuccess: refresh });
  const update = trpc.rooms.update.useMutation({ onSuccess: refresh });
  const rotate = trpc.rooms.rotateInvite.useMutation({
    onSuccess: result => setSheet({ kind: "invite", code: result.inviteCode }),
  });
  const mutationError =
    setContent.error ??
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

  const { room, me, members, video } = data;
  const watching =
    video.contentType === "youtube" && !!video.videoId && !!video.state;
  const videoTime = () => (watching ? videoTimeRef.current : null);
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
              className={`${s.seat} ${
                voice.speaking.has(member.userId) ? s.seatSpeaking : ""
              }`}
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
                {voice.inVoice.has(member.userId) ? (
                  <span
                    className={s.seatVoice}
                    title={
                      voice.speaking.has(member.userId)
                        ? t("voice.speaking")
                        : t("voice.inVoice")
                    }
                  >
                    {" 🎧"}
                  </span>
                ) : null}
              </small>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      {here ? (
        <RoomVoice roomId={roomId} canGrant={me.can.edit_room} names={names} />
      ) : null}

      {me.can.edit_room || video.videoId ? (
        <div className={s.contentBar}>
          {/* Which of the two the room looks at. Members see what was
              chosen; only who may edit the room chooses. */}
          <div
            className={s.segment}
            role="group"
            aria-label={t("video.contentChoice")}
          >
            <button
              type="button"
              className={`${s.segmentBtn} ${watching ? "" : s.segmentOn}`}
              aria-pressed={!watching}
              disabled={!me.can.edit_room || setContent.isPending}
              onClick={() =>
                watching && setContent.mutate({ roomId, contentType: "pdf" })
              }
            >
              <FileText size={16} aria-hidden="true" /> {t("video.tabFile")}
            </button>
            <button
              type="button"
              className={`${s.segmentBtn} ${watching ? s.segmentOn : ""}`}
              aria-pressed={watching}
              disabled={!me.can.edit_room || setContent.isPending}
              onClick={() => {
                if (watching) return;
                if (video.videoId) {
                  setContent.mutate({ roomId, contentType: "youtube" });
                } else {
                  setSheet({ kind: "video" });
                }
              }}
            >
              <Video size={16} aria-hidden="true" /> {t("video.tabVideo")}
            </button>
          </div>
          {me.can.edit_room ? (
            <>
              <button
                type="button"
                className={s.btn}
                onClick={() => setSheet({ kind: "video" })}
              >
                <Video size={16} aria-hidden="true" />
                {video.videoId ? t("video.change") : t("video.addButton")}
              </button>
              {video.videoId ? (
                <button
                  type="button"
                  className={s.btn}
                  onClick={() => setSheet({ kind: "videoRemove" })}
                >
                  {t("video.remove")}
                </button>
              ) : null}
            </>
          ) : null}
          {wide ? (
            <button
              type="button"
              className={`${s.btn} ${s.sideToggle}`}
              aria-pressed={sideOpen}
              onClick={() => setSideOpen(open => !open)}
            >
              {sideOpen ? (
                <PanelLeftClose size={16} aria-hidden="true" />
              ) : (
                <PanelLeftOpen size={16} aria-hidden="true" />
              )}
              {sideOpen ? t("video.hideSide") : t("video.showSide")}
              {!sideOpen && chat.unread ? (
                <span className={s.badge}>{chat.unread}</span>
              ) : null}
            </button>
          ) : null}
        </div>
      ) : null}

      {readySlug && !quiz.active ? (
        <section className={s.ready} aria-label={t("catalog.readyTitle")}>
          <ListChecks size={26} aria-hidden="true" />
          <div>
            <small>{t("catalog.readyTitle")}</small>
            <b dir="auto">
              {readyQuiz.data?.title ??
                (readyQuiz.error?.message === "not_found"
                  ? t("catalog.gone")
                  : readyQuiz.isError
                    ? t("catalog.loadFailed")
                    : "…")}
            </b>
            <p>{t("catalog.readyHint")}</p>
          </div>
          {startCatalog.error ? (
            <p className={s.errorNote} role="alert">
              {tError(startCatalog.error)}
            </p>
          ) : null}
          <div className={s.readyActions}>
            {me.can.start_quiz && readyQuiz.data ? (
              <button
                type="button"
                className={`${s.btn} ${s.primary}`}
                disabled={startCatalog.isPending}
                onClick={() => startCatalog.mutate({ roomId, slug: readySlug })}
              >
                {t("catalog.start")}
              </button>
            ) : null}
            {room.visibility === "public" || me.can.invite ? (
              <button
                type="button"
                className={s.btn}
                onClick={() => setSheet({ kind: "invite", code: null })}
              >
                <UserPlus size={17} aria-hidden="true" /> {t("live.invite")}
              </button>
            ) : null}
            {readyQuiz.isError && readyQuiz.error.message !== "not_found" ? (
              <button
                type="button"
                className={s.btn}
                onClick={() => readyQuiz.refetch()}
              >
                {t("rooms.retry")}
              </button>
            ) : null}
            <button type="button" className={s.btn} onClick={dropReady}>
              {t("catalog.dismiss")}
            </button>
          </div>
        </section>
      ) : null}

      {!presenting && !readySlug && (watching || room.bookId) ? (
        <button
          type="button"
          className={`${s.btn} ${s.primary} ${s.wide}`}
          onClick={() => setFocus(true)}
        >
          <Maximize2 size={17} aria-hidden="true" /> {t("present.open")}
        </button>
      ) : null}

      <div
        className={
          presenting
            ? `${s.present} ${wide && sideOpen ? s.presentSide : ""}`
            : `${s.work} ${wide && !sideOpen ? s.workWide : ""} ${
                watching ? s.workVideo : ""
              }`
        }
        data-present={presenting ? "" : undefined}
      >
        {presenting ? (
          <header
            className={`${s.pHead} ${chromeShown ? "" : s.chromeAway}`}
            // Away, the header is out of the way of the finger and the keys.
            inert={!chromeShown}
            onPointerDown={wakeChrome}
            onFocus={wakeChrome}
          >
            <button
              type="button"
              className={s.pHeadBtn}
              aria-label={t("app.minimize")}
              title={t("app.minimize")}
              // The page goes, the room stays (its card on every page).
              onClick={() => router.push("/rooms")}
            >
              <ChevronDown size={22} aria-hidden="true" />
            </button>
            <div className={s.pHeadInfo}>
              <b dir="auto">
                {watching
                  ? (video.title ?? t("video.untitled"))
                  : deskInfo?.pageCount
                    ? t("desk.pageOf", {
                        page: deskInfo.page,
                        total: deskInfo.pageCount,
                      })
                    : room.title}
              </b>
              <small
                className={
                  state.isRefetchError || (!watching && deskInfo?.away)
                    ? s.pHeadWarn
                    : ""
                }
                role="status"
                dir="auto"
              >
                {state.isRefetchError
                  ? t("live.reconnecting")
                  : watching
                    ? room.title
                    : deskInfo?.away
                      ? t("present.away")
                      : t("present.synced")}
              </small>
            </div>
            <button
              type="button"
              className={s.pHeadBtn}
              aria-label={
                chat.unread
                  ? t("live.chatUnread", { n: chat.unread })
                  : t("live.chat")
              }
              aria-pressed={wide ? sideOpen : undefined}
              onClick={() =>
                wide ? setSideOpen(open => !open) : setChatOpen(true)
              }
            >
              {wide && sideOpen ? (
                <PanelLeftClose size={20} aria-hidden="true" />
              ) : (
                <MessageCircle size={20} aria-hidden="true" />
              )}
              {chat.unread && !(wide && sideOpen) ? (
                <span className={s.pHeadBadge}>{chat.unread}</span>
              ) : null}
            </button>
            <button
              type="button"
              className={s.pHeadBtn}
              aria-label={t("present.more")}
              title={t("present.more")}
              onClick={() => setSheet({ kind: "more" })}
            >
              <MoreVertical size={20} aria-hidden="true" />
            </button>
            {mutationError ? (
              <p className={`${s.errorNote} ${s.pHeadNote}`} role="alert">
                {tError(mutationError)}
              </p>
            ) : null}
          </header>
        ) : null}
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
        <div
          hidden={!!quiz.active || !!quiz.finishedId}
          className={presenting ? s.presentMain : undefined}
        >
          {watching ? (
            <RoomVideo
              roomId={roomId}
              video={{
                videoId: video.videoId!,
                title: video.title,
                state: video.state!,
                serverNow: video.serverNow,
              }}
              canControl={me.can.control_video}
              online={!state.isRefetchError}
              timeRef={videoTimeRef}
              localSeek={videoSeek}
            />
          ) : null}
          <div
            hidden={watching}
            className={presenting ? s.presentMain : undefined}
          >
            <RoomDesk
              present={presenting}
              onInfo={onDeskInfo}
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
              chrome={presenting ? deskChrome : undefined}
            />
          </div>
        </div>
        {wide && sideOpen ? (
          <aside className={s.side} aria-label={t("chat.title")}>
            <h2>{t("live.chat")}</h2>
            <RoomChat
              roomId={roomId}
              chat={chat}
              myUserId={me.userId}
              page={room.bookId ? myPage : null}
              canChat={me.can.chat}
              canDeleteAny={me.can.delete_any_message}
              videoTime={videoTime}
              onGoToVideoTime={
                watching ? seconds => setVideoSeek({ seconds }) : undefined
              }
              onGoToPage={page => setJump({ page })}
            />
          </aside>
        ) : null}
        {presenting && me.can.edit_room && voice.hands.length ? (
          // The first raised hand, for whoever may let it speak (design ز4).
          <HandCard
            // A fresh card per hand: no state carried from the one before.
            key={voice.hands[0]}
            roomId={roomId}
            userId={voice.hands[0]}
            name={names.get(voice.hands[0]) ?? t("chat.someone")}
          />
        ) : null}
        {presenting ? (
          <nav
            className={`${s.pDock} ${chromeShown ? "" : s.chromeAway}`}
            aria-label={t("app.more")}
            inert={!chromeShown}
            onPointerDown={wakeChrome}
            onFocus={wakeChrome}
          >
            {reacting ? (
              <div className={s.reactPicker} role="group">
                {REACTION_KINDS.map(kind => (
                  <button
                    key={kind}
                    type="button"
                    className={`${s.reactBtn} ${s[`react-${kind}`]}`}
                    onClick={() => {
                      active.react(kind);
                      setReacting(false);
                    }}
                  >
                    {t(`react.${kind}` as RoomsKey)}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={s.pDockRow}>
              {here ? <VoiceMainButton /> : null}
              <button
                type="button"
                className={s.pDockItem}
                aria-label={
                  chat.unread
                    ? t("live.chatUnread", { n: chat.unread })
                    : t("live.chat")
                }
                onClick={() =>
                  wide ? setSideOpen(open => !open) : setChatOpen(true)
                }
              >
                <MessageCircle size={21} aria-hidden="true" />
                <span>{t("live.chat")}</span>
                {chat.unread && !(wide && sideOpen) ? (
                  <i className={s.pDockBadge}>{chat.unread}</i>
                ) : null}
              </button>
              {voice.phase === "live" ? (
                <button
                  type="button"
                  className={`${s.pDockItem} ${reacting ? s.pDockOn : ""}`}
                  aria-pressed={reacting}
                  onClick={() => setReacting(open => !open)}
                >
                  <Smile size={21} aria-hidden="true" />
                  <span>{t("app.react")}</span>
                </button>
              ) : null}
              {me.can.start_quiz && !quiz.active ? (
                <button
                  type="button"
                  className={s.pDockItem}
                  onClick={() => setSheet({ kind: "quiz" })}
                >
                  <ListChecks size={21} aria-hidden="true" />
                  <span>{t("app.quiz")}</span>
                </button>
              ) : null}
              <button
                type="button"
                className={s.pDockItem}
                onClick={() => setSheet({ kind: "more" })}
              >
                <MoreVertical size={21} aria-hidden="true" />
                <span>{t("app.more")}</span>
              </button>
            </div>
          </nav>
        ) : null}
      </div>

      {here && active.reactions.length ? (
        <div className={s.reactToasts} aria-live="polite">
          {active.reactions.map(reaction => (
            <span key={reaction.id} className={s.reactToast}>
              <b dir="auto">
                {reaction.userId === me.userId
                  ? t("live.you")
                  : (names.get(reaction.userId) ?? t("chat.someone"))}
              </b>
              {t(`react.${reaction.kind}` as RoomsKey)}
            </span>
          ))}
        </div>
      ) : null}

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
        {room.visibility === "public" || me.can.invite ? (
          <button
            type="button"
            className={s.btn}
            onClick={() => setSheet({ kind: "invite", code: null })}
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
          onClick={() => setSheet({ kind: "leave" })}
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
            videoTime={videoTime}
            onGoToVideoTime={
              watching ? seconds => setVideoSeek({ seconds }) : undefined
            }
            onGoToPage={page => {
              setJump({ page });
              setChatOpen(false);
            }}
          />
        </Sheet>
      ) : null}

      {sheet?.kind === "video" ? (
        <RoomVideoAdd
          roomId={roomId}
          replacing={!!video.videoId}
          othersPresent={members.length > 1}
          onClose={close}
        />
      ) : null}

      {sheet?.kind === "videoRemove" ? (
        <Sheet title={t("video.removeConfirm")} onClose={close}>
          <p className={s.meta}>{t("video.removeHint")}</p>
          {clearContent.error ? (
            <p className={s.errorNote} role="alert">
              {tError(clearContent.error)}
            </p>
          ) : null}
          <button
            type="button"
            className={`${s.btn} ${s.danger} ${s.wide}`}
            disabled={clearContent.isPending}
            onClick={() => clearContent.mutate({ roomId })}
          >
            {t("video.remove")}
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

      {sheet?.kind === "more" ? (
        <Sheet title={room.title} onClose={close}>
          <div>
            <button
              type="button"
              className={s.item}
              onClick={() => {
                setFocus(false);
                close();
              }}
            >
              <LayoutList size={18} aria-hidden="true" />
              <span>
                {t("present.back")}
                <small>{t("present.backHint")}</small>
              </span>
            </button>
            <button
              type="button"
              className={s.item}
              onClick={() => setSheet({ kind: "members" })}
            >
              <Users size={18} aria-hidden="true" />
              {t("live.present", { n: members.length })}
            </button>
            {wide ? null : (
              <button
                type="button"
                className={s.item}
                onClick={() => {
                  close();
                  setChatOpen(true);
                }}
              >
                <MessageCircle size={18} aria-hidden="true" />
                {t("live.chat")}
                {chat.unread ? (
                  <span className={s.badge}>{chat.unread}</span>
                ) : null}
              </button>
            )}
            <button
              type="button"
              className={s.item}
              onClick={() => {
                setFocus(false);
                close();
              }}
            >
              <Headphones size={18} aria-hidden="true" />
              <span>
                {t("present.voice")}
                <small>{t("present.voiceHint")}</small>
              </span>
            </button>
            {me.can.edit_room ? (
              <>
                {watching && room.bookId ? (
                  <button
                    type="button"
                    className={s.item}
                    disabled={setContent.isPending}
                    onClick={() => {
                      setContent.mutate({ roomId, contentType: "pdf" });
                      close();
                    }}
                  >
                    <FileText size={18} aria-hidden="true" />
                    {t("present.showFile")}
                  </button>
                ) : null}
                {!watching && video.videoId ? (
                  <button
                    type="button"
                    className={s.item}
                    disabled={setContent.isPending}
                    onClick={() => {
                      setContent.mutate({ roomId, contentType: "youtube" });
                      close();
                    }}
                  >
                    <Video size={18} aria-hidden="true" />
                    {t("present.showVideo")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={s.item}
                  onClick={() => setSheet({ kind: "file" })}
                >
                  <FileText size={18} aria-hidden="true" />
                  {room.bookId ? t("file.change") : t("file.choose")}
                </button>
                <button
                  type="button"
                  className={s.item}
                  onClick={() => setSheet({ kind: "video" })}
                >
                  <Video size={18} aria-hidden="true" />
                  {video.videoId ? t("video.change") : t("video.addButton")}
                </button>
                {video.videoId ? (
                  <button
                    type="button"
                    className={s.item}
                    onClick={() => setSheet({ kind: "videoRemove" })}
                  >
                    <Video size={18} aria-hidden="true" />
                    {t("video.remove")}
                  </button>
                ) : null}
              </>
            ) : null}
            {me.can.start_quiz && !quiz.active ? (
              <button
                type="button"
                className={s.item}
                onClick={() => setSheet({ kind: "quiz" })}
              >
                <ListChecks size={18} aria-hidden="true" /> {t("quiz.open")}
              </button>
            ) : null}
            {room.visibility === "public" || me.can.invite ? (
              <button
                type="button"
                className={s.item}
                onClick={() => setSheet({ kind: "invite", code: null })}
              >
                <UserPlus size={18} aria-hidden="true" /> {t("live.invite")}
              </button>
            ) : null}
            {me.can.edit_room ? (
              <button
                type="button"
                className={s.item}
                onClick={() => setSheet({ kind: "settings" })}
              >
                <Settings size={18} aria-hidden="true" /> {t("live.settings")}
              </button>
            ) : null}
            <button
              type="button"
              className={s.item}
              onClick={() => setSheet({ kind: "report", userId: null })}
            >
              <Flag size={18} aria-hidden="true" /> {t("member.report")}
            </button>
            <button
              type="button"
              className={`${s.item} ${s.danger}`}
              disabled={leave.isPending}
              onClick={() => setSheet({ kind: "leave" })}
            >
              <LogOut size={18} aria-hidden="true" /> {t("live.leave")}
            </button>
          </div>
        </Sheet>
      ) : null}

      {sheet?.kind === "members" ? (
        <Sheet title={t("live.present", { n: members.length })} onClose={close}>
          <div>
            {members.map(member => (
              <button
                key={member.userId}
                type="button"
                className={s.item}
                disabled={member.userId === me.userId}
                onClick={() =>
                  setSheet({ kind: "member", userId: member.userId })
                }
              >
                <Avatar person={member} size="sm" />
                <span dir="auto">
                  {member.userId === me.userId ? t("live.you") : member.name}
                  <small>
                    {roleLabel(member.role)}
                    {member.mutedByHost ? " 🔇" : ""}
                    {voice.inVoice.has(member.userId) ? " 🎧" : ""}
                  </small>
                </span>
              </button>
            ))}
          </div>
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
            <ColleagueItems userId={target.userId} onBlocked={close} />
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
          <InviteColleagues roomId={roomId} />
          {room.visibility !== "private" ? null : sheet.code ? (
            <InviteBox roomId={roomId} code={sheet.code} />
          ) : (
            <>
              <p className={s.sub}>{t("invite.link")}</p>
              {rotate.error ? (
                <p className={s.errorNote} role="alert">
                  {tError(rotate.error)}
                </p>
              ) : null}
              <button
                type="button"
                className={`${s.btn} ${s.wide}`}
                disabled={rotate.isPending}
                onClick={() => rotate.mutate({ roomId })}
              >
                {t("invite.makeLink")}
              </button>
            </>
          )}
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
          <Toggle
            on={room.settings.videoControl === "members"}
            label={t("perm.videoControl")}
            hint={t("perm.videoControlHint")}
            onChange={members =>
              update.mutate({
                roomId,
                settings: { videoControl: members ? "members" : "host" },
              })
            }
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

      {sheet?.kind === "switch" ? (
        <SwitchSheet
          from={sheet.from}
          busy={leaveOther.isPending || leaveThis.isPending}
          onLeaveIt={() => {
            const from = sheet.from;
            // Out of the other room, then in this one — whatever the
            // server said about the other (it tidies up anyway).
            leaveOther.mutate(
              { roomId: from },
              {
                onSettled: () => {
                  enter(roomId);
                  close();
                },
              }
            );
          }}
          onStay={() => {
            // Staying in the other room: out of this one, which the lobby
            // already joined, so no seat is kept here.
            const from = sheet.from;
            leaveThis.mutate(
              { roomId },
              { onSettled: () => router.replace(`/rooms/${from}/live`) }
            );
          }}
        />
      ) : null}

      {sheet?.kind === "leave" ? (
        // Leaving is only ever on purpose (the arrow at the top only
        // minimises the room).
        <Sheet title={t("live.leave")} onClose={close}>
          <p className={s.meta}>{t("app.leaveConfirm")}</p>
          {leave.error ? (
            <p className={s.errorNote} role="alert">
              {tError(leave.error)}
            </p>
          ) : null}
          <button
            type="button"
            className={`${s.btn} ${s.danger} ${s.wide}`}
            disabled={leave.isPending}
            onClick={() => leave.mutate({ roomId })}
          >
            <LogOut size={17} aria-hidden="true" /> {t("live.leave")}
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

// Entering a room while in another (design: one room at a time).
function SwitchSheet({
  from,
  busy,
  onLeaveIt,
  onStay,
}: {
  from: string;
  busy: boolean;
  onLeaveIt: () => void;
  onStay: () => void;
}) {
  const { t } = useRooms();
  // Already read for the room's card: no new request.
  const other = trpc.rooms.state.useQuery({ roomId: from }, { retry: false });
  return (
    <Sheet title={t("app.switchTitle")} onClose={onStay}>
      <p className={s.meta}>
        {t("app.switchBody", { room: other.data?.room.title ?? "…" })}
      </p>
      <button
        type="button"
        className={`${s.btn} ${s.primary} ${s.wide}`}
        disabled={busy}
        onClick={onLeaveIt}
      >
        {t("live.confirm")}
      </button>
      <button type="button" className={`${s.btn} ${s.wide}`} onClick={onStay}>
        {t("live.cancel")}
      </button>
    </Sheet>
  );
}

// The voice's big button in the dock: join, open / close the microphone,
// or ask to speak — whichever fits the student now.
function VoiceMainButton() {
  const { t } = useRooms();
  const active = useActiveRoom();
  const voice = active.voice;
  if (voice.unavailable) return null;
  const connected = voice.phase === "live" || voice.phase === "reconnecting";
  // Not on a half-connected line (as on the room's own page).
  const mic =
    voice.phase === "reconnecting" ? null : () => void active.toggleMic();
  const [Icon, label, tone, onClick]: [
    typeof Mic,
    string,
    string,
    (() => void) | null,
  ] =
    voice.phase === "connecting"
      ? [Headphones, t("voice.joining"), "", null]
      : !connected
        ? [
            Headphones,
            voice.phase === "lost" ? t("voice.rejoin") : t("voice.join"),
            "",
            () => void active.join(),
          ]
        : voice.maySpeak
          ? voice.micOn
            ? [Mic, t("voice.micOn"), s.pVoiceOn, mic]
            : [MicOff, t("voice.micOff"), "", mic]
          : voice.asked
            ? [Hand, t("voice.asked"), s.pVoiceAsked, null]
            : [Hand, t("voice.ask"), "", () => void active.raiseHand()];
  return (
    <button
      type="button"
      className={`${s.pVoice} ${tone}`}
      aria-label={label}
      title={label}
      aria-pressed={connected && voice.maySpeak ? voice.micOn : undefined}
      disabled={!onClick || voice.micBusy}
      onClick={onClick ?? undefined}
    >
      <Icon size={24} aria-hidden="true" />
    </button>
  );
}

// The first raised hand over the file, for whoever may let it speak.
function HandCard({
  roomId,
  userId,
  name,
}: {
  roomId: string;
  userId: string;
  name: string;
}) {
  const { t, tError } = useRooms();
  const active = useActiveRoom();
  const utils = trpc.useUtils();
  const allow = trpc.rooms.setMember.useMutation({
    onSuccess: () => {
      active.dropHand(userId);
      return utils.rooms.state.invalidate({ roomId });
    },
  });
  return (
    <div className={s.pHand} role="status">
      <Hand size={18} aria-hidden="true" />
      <span dir="auto">{t("voice.wantsToSpeak", { name })}</span>
      <button
        type="button"
        className={s.pHandLater}
        onClick={() => active.dropHand(userId)}
      >
        {t("app.later")}
      </button>
      <button
        type="button"
        className={s.pHandAllow}
        disabled={allow.isPending}
        onClick={() =>
          allow.mutate({ roomId, userId, grants: { speak: true } })
        }
      >
        {t("voice.allow")}
      </button>
      {allow.error ? <small role="alert">{tError(allow.error)}</small> : null}
    </div>
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
