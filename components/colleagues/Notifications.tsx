"use client";

// 🔔 The student's notifications: what waits for an answer first (room
// invitations, colleague requests, files sent), then the notices, and — in
// its own tab — the files received. Every list is the caller's own.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, BookOpen, Check, DoorOpen } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import {
  Avatar,
  Busy,
  Contents,
  day,
  explain,
  nameOf,
  useColleagueRefresh,
  usePersonMenu,
} from "./parts";
import s from "./colleagues.module.css";

type Tab = "notices" | "files";

// How many things wait for the student's answer, and how many notices are
// unread: the number on the bell.
export function useNotificationCount() {
  const summary = trpc.sharing.homeSummary.useQuery();
  const roomsOn = trpc.rooms.enabled.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
  });
  const invites = trpc.rooms.myInvites.useQuery(undefined, {
    enabled: !!roomsOn.data?.enabled,
    refetchInterval: 30_000,
  });
  const waiting =
    (summary.data?.pending ?? 0) +
    (summary.data?.colleagueRequests ?? 0) +
    (invites.data?.length ?? 0);
  // A request is also a notice: counted once, not twice.
  return Math.max(waiting, summary.data?.unread ?? 0);
}

function noticeText(note: {
  type: string;
  data: unknown;
  actorName: string | null;
  actorUsername: string | null;
}) {
  const data = note.data as {
    bookTitle?: string;
    text?: string;
    roomTitle?: string;
    // question_set_ready (lib/db-question-sets.ts)
    setId?: string;
    title?: string;
    needsReview?: number;
    failed?: number;
  };
  const who = nameOf(note.actorName, note.actorUsername);
  const title = data.bookTitle ?? "";
  const href =
    note.type === "question_set_ready" && data.setId
      ? `/doctor/sets/${data.setId}`
      : null;
  switch (note.type) {
    case "connection_request":
      return { href, text: `${who} أرسل لك طلب زمالة` };
    case "connection_accepted":
      return { href, text: `${who} قبل طلب الزمالة` };
    case "room_invite":
      return { href, text: `${who} دعاك إلى غرفة «${data.roomTitle ?? ""}»` };
    case "share_request":
      return { href, text: `${who} أرسل لك ملف «${title}»` };
    case "share_accepted":
      return { href, text: `${who} قبل ملفك «${title}»` };
    case "share_declined":
      return { href, text: `${who} رفض ملف «${title}»` };
    case "billing":
      return { href, text: data.text ?? "" };
    case "question_set_ready":
      return {
        href,
        text: `مجموعتك «${data.title ?? ""}» جاهزة للمراجعة والنشر${
          data.needsReview ? ` · ${data.needsReview} سؤالًا يحتاج مراجعتك` : ""
        }${data.failed ? ` · تعذّر شرح ${data.failed}` : ""}`,
      };
    default:
      return { href, text: title };
  }
}

export function Notifications({ onNavigate }: { onNavigate?: () => void }) {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("notices");
  const refresh = useColleagueRefresh();
  const menu = usePersonMenu();

  const requests = trpc.colleagues.requests.useQuery();
  const files = trpc.sharing.incoming.useQuery();
  const library = trpc.sharing.sharedWithMe.useQuery();
  const notices = trpc.sharing.notifications.useQuery();
  const summary = trpc.sharing.homeSummary.useQuery();
  const roomsOn = trpc.rooms.enabled.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
  });
  const invites = trpc.rooms.myInvites.useQuery(undefined, {
    enabled: !!roomsOn.data?.enabled,
    refetchInterval: 30_000,
  });

  // Seen once the list is on screen.
  const { mutate: markRead } = trpc.sharing.markNotificationsRead.useMutation({
    onSuccess: () => utils.sharing.homeSummary.invalidate(),
  });
  const unread = summary.data?.unread ?? 0;
  const shown = tab === "notices" && notices.isSuccess;
  useEffect(() => {
    if (shown && unread > 0) markRead();
  }, [shown, unread, markRead]);

  const answer = trpc.colleagues.respond.useMutation({ onSuccess: refresh });
  const answerFile = trpc.sharing.respond.useMutation({ onSuccess: refresh });
  const declineInvite = trpc.rooms.declineInvite.useMutation({
    onSuccess: refresh,
  });
  const busy =
    menu.busy ||
    answer.isPending ||
    answerFile.isPending ||
    declineInvite.isPending;
  const failure = explain(
    answer.error ?? answerFile.error ?? declineInvite.error ?? menu.error
  );

  const incoming = requests.data?.incoming ?? [];
  const waiting =
    incoming.length + (files.data?.length ?? 0) + (invites.data?.length ?? 0);
  const loading = requests.isLoading || files.isLoading || notices.isLoading;

  return (
    <div className={s.panel}>
      <div className={s.tabs} role="tablist" aria-label="أقسام الإشعارات">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "notices"}
          className={s.tab}
          onClick={() => setTab("notices")}
        >
          <Bell size={16} aria-hidden="true" />
          الإشعارات
          {waiting ? <span className={s.count}>{waiting}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "files"}
          className={s.tab}
          onClick={() => setTab("files")}
        >
          <BookOpen size={16} aria-hidden="true" />
          ملفات وصلتني
          {library.data?.length ? (
            <span className={s.count}>{library.data.length}</span>
          ) : null}
        </button>
      </div>

      {failure ? (
        <p className={s.error} role="alert">
          {failure}
        </p>
      ) : null}

      {tab === "notices" ? (
        <div role="tabpanel" className={s.panel}>
          {loading ? <Busy /> : null}

          {invites.data?.length ? (
            <div className={s.group}>
              <h2>دعوات إلى غرف الدراسة</h2>
              <ul className={s.list}>
                {invites.data.map(invite => (
                  <li key={invite.inviteId} className={s.row}>
                    <Avatar person={invite.inviter} />
                    <span className={s.who}>
                      <strong dir="auto">{invite.roomTitle}</strong>
                      <span>
                        دعوة من <bdi>{nameOf(invite.inviter.name)}</bdi> ·{" "}
                        {day(invite.createdAt)}
                      </span>
                    </span>
                    <span className={s.acts}>
                      <Link
                        href={`/rooms/${invite.roomId}`}
                        className={`${s.btn} ${s.primary}`}
                        onClick={onNavigate}
                      >
                        <DoorOpen size={15} aria-hidden="true" /> ادخل
                      </Link>
                      <button
                        type="button"
                        className={s.btn}
                        disabled={busy}
                        onClick={() =>
                          declineInvite.mutate({ inviteId: invite.inviteId })
                        }
                      >
                        اعتذر
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {incoming.length ? (
            <div className={s.group}>
              <h2>طلبات زمالة</h2>
              <ul className={s.list}>
                {incoming.map(person => (
                  <li key={person.connectionId} className={s.row}>
                    <Avatar person={person} />
                    <span className={s.who}>
                      <strong dir="auto">{nameOf(person.name)}</strong>
                      <span>يريد أن يكون زميلك · {day(person.createdAt)}</span>
                    </span>
                    <span className={s.acts}>
                      <button
                        type="button"
                        className={`${s.btn} ${s.primary}`}
                        disabled={busy}
                        onClick={() =>
                          answer.mutate({
                            connectionId: person.connectionId,
                            decision: "accept",
                          })
                        }
                      >
                        <Check size={15} aria-hidden="true" /> قبول
                      </button>
                      <button
                        type="button"
                        className={s.btn}
                        disabled={busy}
                        onClick={() =>
                          answer.mutate({
                            connectionId: person.connectionId,
                            decision: "decline",
                          })
                        }
                      >
                        رفض
                      </button>
                      {menu.button(person)}
                    </span>
                    {menu.panel(person, false)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {files.data?.length ? (
            <div className={s.group}>
              <h2>ملفات أرسلها زملاؤك</h2>
              <ul className={s.list}>
                {files.data.map(request => (
                  <li key={request.shareId} className={s.row}>
                    <Avatar
                      person={{ id: request.ownerId, name: request.ownerName }}
                    />
                    <span className={s.who}>
                      <strong dir="auto">{request.bookTitle}</strong>
                      <span>
                        من{" "}
                        <bdi>
                          {nameOf(request.ownerName, request.ownerUsername)}
                        </bdi>{" "}
                        · {request.pageCount} صفحة · {day(request.createdAt)}
                      </span>
                    </span>
                    <span className={s.acts}>
                      <button
                        type="button"
                        className={`${s.btn} ${s.primary}`}
                        disabled={busy}
                        onClick={() =>
                          answerFile.mutate({
                            shareId: request.shareId,
                            decision: "accept",
                          })
                        }
                      >
                        <Check size={15} aria-hidden="true" /> أضف لمكتبتي
                      </button>
                      <button
                        type="button"
                        className={s.btn}
                        disabled={busy}
                        onClick={() =>
                          answerFile.mutate({
                            shareId: request.shareId,
                            decision: "decline",
                          })
                        }
                      >
                        رفض
                      </button>
                    </span>
                    <Contents contents={request.contents} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {notices.data?.length ? (
            <div className={s.group}>
              {waiting ? <h2>ما سبق</h2> : null}
              <ul className={s.list}>
                {notices.data.map(note => {
                  const { href, text } = noticeText(note);
                  return (
                    <li
                      key={note.id}
                      className={note.readAt ? s.row : `${s.row} ${s.unread}`}
                    >
                      <span className={s.who}>
                        {href ? (
                          <Link href={href} dir="auto" onClick={onNavigate}>
                            {text}
                          </Link>
                        ) : (
                          <span className={s.say} dir="auto">
                            {text}
                          </span>
                        )}
                      </span>
                      <span className={s.when}>{day(note.createdAt)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {!loading && waiting === 0 && !notices.data?.length ? (
            <div className={s.empty}>
              <Bell size={28} aria-hidden="true" />
              <strong>لا إشعارات</strong>
              <span>
                طلبات الزمالة ودعوات الغرف والملفات التي يرسلها زملاؤك تظهر هنا.
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <div role="tabpanel" className={s.panel}>
          {library.isLoading ? (
            <Busy />
          ) : !library.data?.length ? (
            <div className={s.empty}>
              <BookOpen size={28} aria-hidden="true" />
              <strong>لم يصلك ملف بعد</strong>
              <span>
                الملفات التي تقبلها من زملائك تظهر هنا وتفتح بنفس أدوات الدراسة،
                وتقدّمك فيها خاص بك.
              </span>
            </div>
          ) : (
            <ul className={s.list}>
              {library.data.map(pack => (
                <li key={pack.shareId}>
                  <Link
                    href={`/books/${pack.bookId}`}
                    className={`${s.row} ${s.pack}`}
                    onClick={onNavigate}
                  >
                    <span className={s.who}>
                      <strong dir="auto">{pack.bookTitle}</strong>
                      <span>
                        من{" "}
                        <bdi>{nameOf(pack.ownerName, pack.ownerUsername)}</bdi>
                        {pack.sharedAt ? ` · ${day(pack.sharedAt)}` : ""}
                      </span>
                    </span>
                    <Contents contents={pack.contents} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
