"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  BookOpen,
  Check,
  DoorOpen,
  Inbox,
  Loader2,
  MoreHorizontal,
  Search,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ROOMS_MESSAGES } from "@/lib/study-rooms/i18n";
import { StudentAvatar } from "@/components/sharing/StudentAvatar";
import s from "./colleagues.module.css";

// 🤝 الزملاء — the one place for the people a student studies with: finding
// and adding them, what waits for an answer (colleague requests, room
// invitations, files sent), the files received, and the notices. Every
// list is the caller's own; the server decides every rule and this page
// only shows its answer.

type Tab = "colleagues" | "requests" | "files" | "notices";
type Person = { id: string; name: string | null };
type Drawer = { id: string; mode: "menu" | "remove" | "block" | "report" };

const dateFormat = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  day: "numeric",
  month: "short",
});
const day = (value: Date | string | null) =>
  value ? dateFormat.format(new Date(value)) : "";

const nameOf = (name: string | null, username?: string | null) =>
  name || (username ? `@${username}` : "طالب");

// A refusal's sentence: colleague and room reasons arrive as keys, the
// file-sharing ones already as sentences.
function explain(error: { message: string } | null | undefined) {
  if (!error) return null;
  const words = ROOMS_MESSAGES.ar as Record<string, string>;
  return (
    words[`col.${error.message}`] ??
    words[`error.${error.message}`] ??
    (/\p{Script=Arabic}/u.test(error.message)
      ? error.message
      : words["error.unknown"])
  );
}

const REPORT_REASONS = [
  ["abuse", "إساءة أو كلام مؤذٍ"],
  ["spam", "إزعاج أو طلبات متكررة"],
  ["other", "سبب آخر"],
] as const;

function Avatar({ person }: { person: Person }) {
  return <StudentAvatar name={person.name} username={person.id} />;
}

function Busy() {
  return <Loader2 size={15} className="spin" aria-hidden="true" />;
}

function Contents({
  contents,
}: {
  contents: {
    chapters: number;
    flashcards: number;
    questions: number;
    examFocus: number | null;
  };
}) {
  const chips = [
    contents.chapters > 0 && `${contents.chapters} أجزاء ملخّصة`,
    contents.flashcards > 0 && `${contents.flashcards} بطاقة`,
    contents.questions > 0 && `${contents.questions} سؤال`,
    contents.examFocus != null && `${contents.examFocus} Exam Focus`,
  ].filter(Boolean) as string[];
  if (!chips.length) return null;
  return (
    <ul className={s.chips} aria-label="محتوى الملف">
      {chips.map(chip => (
        <li key={chip}>
          <bdi>{chip}</bdi>
        </li>
      ))}
    </ul>
  );
}

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export default function ColleaguesPage() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab | null>(null);
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [reason, setReason] = useState<string>("abuse");
  const [showBlocked, setShowBlocked] = useState(false);
  const [reported, setReported] = useState<string | null>(null);
  const debounced = useDebounced(query.trim(), 300);
  const searching = debounced.length >= 2;

  const colleagues = trpc.colleagues.list.useQuery();
  const requests = trpc.colleagues.requests.useQuery();
  const files = trpc.sharing.incoming.useQuery();
  const library = trpc.sharing.sharedWithMe.useQuery();
  const summary = trpc.sharing.homeSummary.useQuery();
  const roomsOn = trpc.rooms.enabled.useQuery();
  const invites = trpc.rooms.myInvites.useQuery(undefined, {
    enabled: !!roomsOn.data?.enabled,
    refetchInterval: 30_000,
  });
  const blocked = trpc.sharing.blocked.useQuery(undefined, {
    enabled: showBlocked,
  });
  const search = trpc.colleagues.search.useQuery(
    { query: debounced },
    { enabled: searching, placeholderData: previous => previous }
  );

  const waiting =
    (requests.data?.incoming.length ?? 0) +
    (files.data?.length ?? 0) +
    (invites.data?.length ?? 0);
  const activeTab: Tab = tab ?? (waiting > 0 ? "requests" : "colleagues");

  const notices = trpc.sharing.notifications.useQuery(undefined, {
    enabled: activeTab === "notices",
  });
  const { mutate: markRead } = trpc.sharing.markNotificationsRead.useMutation({
    onSuccess: () => utils.sharing.homeSummary.invalidate(),
  });
  const unread = summary.data?.unread ?? 0;
  useEffect(() => {
    if (activeTab === "notices" && unread > 0) markRead();
  }, [activeTab, unread, markRead]);

  const refresh = () => {
    setDrawer(null);
    utils.colleagues.invalidate();
    utils.sharing.invalidate();
    utils.rooms.myInvites.invalidate();
  };
  const ask = trpc.colleagues.request.useMutation({ onSuccess: refresh });
  const answer = trpc.colleagues.respond.useMutation({ onSuccess: refresh });
  const withdraw = trpc.colleagues.cancel.useMutation({ onSuccess: refresh });
  const remove = trpc.colleagues.remove.useMutation({ onSuccess: refresh });
  const block = trpc.colleagues.block.useMutation({ onSuccess: refresh });
  const unblock = trpc.sharing.unblock.useMutation({ onSuccess: refresh });
  const report = trpc.colleagues.report.useMutation({
    onSuccess: (_, input) => {
      setReported(input.userId);
      setDrawer(null);
    },
  });
  const answerFile = trpc.sharing.respond.useMutation({ onSuccess: refresh });
  const declineInvite = trpc.rooms.declineInvite.useMutation({
    onSuccess: refresh,
  });

  const failure = explain(
    (searching ? search.error : null) ??
      ask.error ??
      answer.error ??
      withdraw.error ??
      remove.error ??
      block.error ??
      unblock.error ??
      report.error ??
      answerFile.error ??
      declineInvite.error
  );
  const busy =
    ask.isPending ||
    answer.isPending ||
    withdraw.isPending ||
    remove.isPending ||
    block.isPending ||
    report.isPending ||
    answerFile.isPending ||
    declineInvite.isPending;

  const toggle = (id: string) =>
    setDrawer(current => (current?.id === id ? null : { id, mode: "menu" }));

  // The "⋯" of a person: remove (colleagues only), block, report — each
  // asked about once before it happens.
  const personDrawer = (person: Person, isColleague: boolean) => {
    if (drawer?.id !== person.id) return null;
    const who = nameOf(person.name);
    if (drawer.mode === "menu") {
      return (
        <div className={s.drawer}>
          {isColleague ? (
            <button
              type="button"
              className={s.btn}
              onClick={() => setDrawer({ id: person.id, mode: "remove" })}
            >
              إزالة من الزملاء
            </button>
          ) : null}
          <button
            type="button"
            className={`${s.btn} ${s.danger}`}
            onClick={() => setDrawer({ id: person.id, mode: "block" })}
          >
            حظر
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.danger}`}
            onClick={() => setDrawer({ id: person.id, mode: "report" })}
          >
            إبلاغ
          </button>
        </div>
      );
    }
    if (drawer.mode === "report") {
      return (
        <div className={s.drawer}>
          <p>
            ما سبب الإبلاغ عن <bdi>{who}</bdi>؟ يصل البلاغ للإدارة فقط.
          </p>
          <select
            value={reason}
            aria-label="سبب البلاغ"
            onChange={event => setReason(event.target.value)}
          >
            {REPORT_REASONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`${s.btn} ${s.primary}`}
            disabled={busy}
            onClick={() =>
              report.mutate({
                userId: person.id,
                reason: reason as "abuse" | "spam" | "other",
              })
            }
          >
            إرسال البلاغ
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.quiet}`}
            onClick={() => setDrawer(null)}
          >
            تراجع
          </button>
        </div>
      );
    }
    const removing = drawer.mode === "remove";
    return (
      <div className={s.drawer}>
        <p>
          {removing ? (
            <>
              إزالة <bdi>{who}</bdi> من زملائك؟ الملفات التي تبادلتماها تبقى كما
              هي.
            </>
          ) : (
            <>
              حظر <bdi>{who}</bdi>؟ لن يجدك في البحث ولن يصلك منه طلب أو دعوة أو
              ملف، وتُلغى الملفات المتبادلة بينكما.
            </>
          )}
        </p>
        <button
          type="button"
          className={`${s.btn} ${s.primary}`}
          disabled={busy}
          onClick={() =>
            removing
              ? remove.mutate({ userId: person.id })
              : block.mutate({ userId: person.id })
          }
        >
          {removing ? "إزالة" : "حظر"}
        </button>
        <button
          type="button"
          className={`${s.btn} ${s.quiet}`}
          onClick={() => setDrawer(null)}
        >
          تراجع
        </button>
      </div>
    );
  };

  const moreButton = (person: Person) => (
    <button
      type="button"
      className={s.more}
      aria-label={`خيارات ${nameOf(person.name)}`}
      aria-expanded={drawer?.id === person.id}
      onClick={() => toggle(person.id)}
    >
      <MoreHorizontal size={18} aria-hidden="true" />
    </button>
  );

  const tabs: { id: Tab; label: string; icon: typeof Users; count?: number }[] =
    [
      {
        id: "colleagues",
        label: "زملائي",
        icon: Users,
      },
      { id: "requests", label: "الطلبات", icon: Inbox, count: waiting },
      { id: "files", label: "ملفات وصلتني", icon: BookOpen },
      { id: "notices", label: "الإشعارات", icon: Bell, count: unread },
    ];

  return (
    <section className={s.page}>
      <header className={s.head}>
        <h1>الزملاء</h1>
        <p>
          أضف من تذاكر معهم، تبادلوا الملفات الجاهزة، وادعُهم إلى غرف الدراسة.
        </p>
      </header>

      <label className={s.search}>
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="ابحث عن طالب باسمه لتضيفه"
          aria-label="ابحث عن طالب باسمه"
          dir="auto"
          maxLength={64}
        />
        {search.isFetching ? <Busy /> : null}
        {query ? (
          <button
            type="button"
            className={s.clear}
            aria-label="مسح البحث"
            onClick={() => setQuery("")}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </label>

      {failure ? (
        <p className={s.error} role="alert">
          {failure}
        </p>
      ) : null}

      {searching ? (
        <div className={s.group} aria-live="polite">
          <h2>نتائج البحث</h2>
          {search.isLoading ? (
            <Busy />
          ) : !search.data?.items.length ? (
            <div className={s.empty}>
              <strong>لا يوجد طالب بهذا الاسم</strong>
              <span>اكتب الاسم كما سجّل به زميلك في NiroLearn.</span>
            </div>
          ) : (
            <ul className={s.list}>
              {search.data.items.map(person => (
                <li key={person.id} className={s.row}>
                  <Avatar person={person} />
                  <span className={s.who}>
                    <strong dir="auto">{nameOf(person.name)}</strong>
                  </span>
                  <span className={s.acts}>
                    {person.relation === "colleague" ? (
                      <span className={`${s.tag} ${s.tagOk}`}>
                        <Check size={13} aria-hidden="true" /> من زملائك
                      </span>
                    ) : person.relation === "outgoing" ? (
                      <>
                        <span className={s.tag}>بانتظار ردّه</span>
                        <button
                          type="button"
                          className={`${s.btn} ${s.quiet}`}
                          disabled={busy}
                          onClick={() =>
                            person.connectionId &&
                            withdraw.mutate({
                              connectionId: person.connectionId,
                            })
                          }
                        >
                          سحب الطلب
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={`${s.btn} ${s.primary}`}
                        disabled={busy}
                        onClick={() => ask.mutate({ userId: person.id })}
                      >
                        <UserPlus size={15} aria-hidden="true" />
                        {person.relation === "incoming"
                          ? "قبول طلبه"
                          : "أضف زميلًا"}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {search.data?.more ? (
            <p className={s.note}>
              النتائج كثيرة — اكتب الاسم كاملًا لتصل إلى زميلك.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={s.tabs} role="tablist" aria-label="أقسام الزملاء">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={s.tab}
            onClick={() => {
              setTab(id);
              setDrawer(null);
            }}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
            {count ? <span className={s.count}>{count}</span> : null}
          </button>
        ))}
      </div>

      {activeTab === "colleagues" ? (
        <div role="tabpanel" className={s.panel}>
          {colleagues.isLoading ? (
            <Busy />
          ) : !colleagues.data?.length ? (
            <div className={s.empty}>
              <Users size={28} aria-hidden="true" />
              <strong>لا زملاء بعد</strong>
              <span>
                ابحث عن زميلك باسمه في الأعلى وأرسل له طلبًا. بعد قبوله تتبادلان
                الملفات ودعوات الغرف.
              </span>
            </div>
          ) : (
            <ul className={s.list}>
              {colleagues.data.map(person => (
                <li key={person.id} className={s.row}>
                  <Avatar person={person} />
                  <span className={s.who}>
                    <strong dir="auto">{nameOf(person.name)}</strong>
                    <span>
                      {reported === person.id
                        ? "وصل بلاغك للإدارة"
                        : `زميلك منذ ${day(person.since)}`}
                    </span>
                  </span>
                  {moreButton(person)}
                  {personDrawer(person, true)}
                </li>
              ))}
            </ul>
          )}

          <div className={s.group}>
            <button
              type="button"
              className={s.fold}
              aria-expanded={showBlocked}
              onClick={() => setShowBlocked(value => !value)}
            >
              {showBlocked ? "إخفاء المحظورين" : "المحظورون"}
            </button>
            {showBlocked ? (
              blocked.isLoading ? (
                <Busy />
              ) : !blocked.data?.length ? (
                <p className={s.note}>لم تحظر أحدًا.</p>
              ) : (
                <ul className={s.list}>
                  {blocked.data.map(person => (
                    <li key={person.id} className={s.row}>
                      <Avatar person={person} />
                      <span className={s.who}>
                        <strong dir="auto">
                          {nameOf(person.name, person.username)}
                        </strong>
                      </span>
                      <button
                        type="button"
                        className={s.btn}
                        disabled={unblock.isPending}
                        onClick={() => unblock.mutate({ userId: person.id })}
                      >
                        إلغاء الحظر
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      {activeTab === "requests" ? (
        <div role="tabpanel" className={s.panel}>
          {requests.isLoading || files.isLoading ? <Busy /> : null}

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

          {requests.data?.incoming.length ? (
            <div className={s.group}>
              <h2>طلبات زمالة</h2>
              <ul className={s.list}>
                {requests.data.incoming.map(person => (
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
                      {moreButton(person)}
                    </span>
                    {personDrawer(person, false)}
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

          {requests.data?.outgoing.length ? (
            <div className={s.group}>
              <h2>طلبات أرسلتها</h2>
              <ul className={s.list}>
                {requests.data.outgoing.map(person => (
                  <li key={person.connectionId} className={s.row}>
                    <Avatar person={person} />
                    <span className={s.who}>
                      <strong dir="auto">{nameOf(person.name)}</strong>
                      <span>بانتظار ردّه · {day(person.createdAt)}</span>
                    </span>
                    <button
                      type="button"
                      className={`${s.btn} ${s.quiet}`}
                      disabled={busy}
                      onClick={() =>
                        withdraw.mutate({ connectionId: person.connectionId })
                      }
                    >
                      سحب الطلب
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!requests.isLoading &&
          !files.isLoading &&
          waiting === 0 &&
          !requests.data?.outgoing.length ? (
            <div className={s.empty}>
              <Inbox size={28} aria-hidden="true" />
              <strong>لا شيء بانتظار ردّك</strong>
              <span>
                طلبات الزمالة ودعوات الغرف والملفات التي يرسلها زملاؤك تظهر هنا.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "files" ? (
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
      ) : null}

      {activeTab === "notices" ? (
        <div role="tabpanel" className={s.panel}>
          {notices.isLoading ? (
            <Busy />
          ) : !notices.data?.length ? (
            <div className={s.empty}>
              <Bell size={28} aria-hidden="true" />
              <strong>لا إشعارات</strong>
            </div>
          ) : (
            <ul className={s.list}>
              {notices.data.map(note => {
                const data = note.data as {
                  bookTitle?: string;
                  text?: string;
                  roomId?: string;
                  roomTitle?: string;
                  // question_set_ready (lib/db-question-sets.ts)
                  setId?: string;
                  title?: string;
                  needsReview?: number;
                  failed?: number;
                };
                const who = nameOf(note.actorName, note.actorUsername);
                const title = data.bookTitle ?? "";
                const text =
                  note.type === "connection_request"
                    ? `${who} أرسل لك طلب زمالة`
                    : note.type === "connection_accepted"
                      ? `${who} قبل طلب الزمالة`
                      : note.type === "room_invite"
                        ? `${who} دعاك إلى غرفة «${data.roomTitle ?? ""}»`
                        : note.type === "share_request"
                          ? `${who} أرسل لك ملف «${title}»`
                          : note.type === "share_accepted"
                            ? `${who} قبل ملفك «${title}»`
                            : note.type === "share_declined"
                              ? `${who} رفض ملف «${title}»`
                              : note.type === "billing"
                                ? (data.text ?? "")
                                : note.type === "question_set_ready"
                                  ? `مجموعتك «${data.title ?? ""}» جاهزة للمراجعة والنشر${
                                      data.needsReview
                                        ? ` · ${data.needsReview} سؤالًا يحتاج مراجعتك`
                                        : ""
                                    }${
                                      data.failed
                                        ? ` · تعذّر شرح ${data.failed}`
                                        : ""
                                    }`
                                  : title;
                const href =
                  note.type === "question_set_ready" && data.setId
                    ? `/doctor/sets/${data.setId}`
                    : null;
                return (
                  <li
                    key={note.id}
                    className={note.readAt ? s.row : `${s.row} ${s.unread}`}
                  >
                    <span className={s.who}>
                      {href ? (
                        <Link href={href} dir="auto">
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
          )}
        </div>
      ) : null}
    </section>
  );
}
