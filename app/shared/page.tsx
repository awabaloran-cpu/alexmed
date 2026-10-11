"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  BookOpen,
  Check,
  Inbox,
  Loader2,
  ShieldBan,
  Users,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { StudentAvatar } from "@/components/sharing/StudentAvatar";
import { UsernameCard } from "@/components/sharing/UsernameCard";

// 📤 مشترك معي — incoming share requests (accept / decline / block), the
// Study Packs other students shared with me, and sharing notifications.
// Everything here is the caller's own data; the server scopes every list.

type Tab = "requests" | "library" | "notifications";

type Contents = {
  chapters: number;
  flashcards: number;
  questions: number;
  examFocus: number | null;
};

const dateFormat = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  day: "numeric",
  month: "short",
});

function ContentsChips({ contents }: { contents: Contents }) {
  const chips = [
    contents.chapters > 0 && `📘 ${contents.chapters} أجزاء ملخّصة`,
    contents.flashcards > 0 && `🃏 ${contents.flashcards} بطاقة`,
    contents.questions > 0 && `❓ ${contents.questions} سؤال`,
    contents.chapters > 0 && "🧠 خريطة ذهنية",
    contents.examFocus != null && `🔥 ${contents.examFocus} Exam Focus`,
  ].filter(Boolean) as string[];
  if (!chips.length) {
    return (
      <p className="sh-hint">الملف جاهز للقراءة، ولم يُولَّد محتوى بعد.</p>
    );
  }
  return (
    <ul className="sh-chips" aria-label="محتوى الملف">
      {chips.map(chip => (
        <li key={chip}>
          <bdi>{chip}</bdi>
        </li>
      ))}
    </ul>
  );
}

function ownerLabel(name: string | null, username: string | null) {
  return name || (username ? `@${username}` : "طالب");
}

export default function SharedWithMePage() {
  const utils = trpc.useUtils();
  const incoming = trpc.sharing.incoming.useQuery();
  const library = trpc.sharing.sharedWithMe.useQuery();
  const summary = trpc.sharing.homeSummary.useQuery();
  const [tab, setTab] = useState<Tab | null>(null);
  const activeTab: Tab =
    tab ?? ((incoming.data?.length ?? 0) > 0 ? "requests" : "library");

  const notifications = trpc.sharing.notifications.useQuery(undefined, {
    enabled: activeTab === "notifications",
  });
  const markRead = trpc.sharing.markNotificationsRead.useMutation({
    onSuccess: () => utils.sharing.homeSummary.invalidate(),
  });
  const { mutate: markReadMutate } = markRead;
  const unread = summary.data?.unread ?? 0;
  useEffect(() => {
    if (activeTab === "notifications" && unread > 0) markReadMutate();
  }, [activeTab, unread, markReadMutate]);

  const respond = trpc.sharing.respond.useMutation({
    onSuccess: () => {
      utils.sharing.incoming.invalidate();
      utils.sharing.sharedWithMe.invalidate();
      utils.sharing.homeSummary.invalidate();
    },
  });

  const tabs: { id: Tab; label: string; icon: typeof Inbox; count?: number }[] =
    [
      {
        id: "requests",
        label: "الطلبات",
        icon: Inbox,
        count: incoming.data?.length,
      },
      { id: "library", label: "مشترك معي", icon: BookOpen },
      { id: "notifications", label: "الإشعارات", icon: Bell, count: unread },
    ];

  return (
    <section className="sh-page">
      <header className="sh-hero">
        <h1>
          <Users size={24} aria-hidden="true" /> مشترك معي
        </h1>
        <p>ملفات دراسية جاهزة شاركها معك زملاؤك — تقدّمك فيها خاص بك.</p>
      </header>

      <UsernameCard compact />

      <div className="sh-tabs" role="tablist" aria-label="أقسام المشاركة">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={activeTab === id ? "sh-tab is-active" : "sh-tab"}
            onClick={() => setTab(id)}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
            {!!count && <span className="sh-count">{count}</span>}
          </button>
        ))}
      </div>

      {activeTab === "requests" && (
        <div role="tabpanel" className="sh-list">
          {incoming.isLoading ? (
            <Loader2 size={22} className="spin" />
          ) : !incoming.data?.length ? (
            <div className="sh-empty">
              <Inbox size={28} aria-hidden="true" />
              <strong>لا توجد طلبات جديدة</strong>
              <span>عندما يشارك زميل ملفًا معك سيظهر طلبه هنا.</span>
            </div>
          ) : (
            incoming.data.map(request => {
              const busy =
                respond.isPending &&
                respond.variables?.shareId === request.shareId;
              return (
                <article key={request.shareId} className="sh-request">
                  <div className="sh-request-from">
                    <StudentAvatar
                      name={request.ownerName}
                      username={request.ownerUsername ?? ""}
                    />
                    <span>
                      <strong dir="auto">
                        {ownerLabel(request.ownerName, request.ownerUsername)}
                      </strong>{" "}
                      يريد مشاركة ملف معك
                      <small>
                        {dateFormat.format(new Date(request.createdAt))}
                      </small>
                    </span>
                  </div>
                  <h3 dir="auto">{request.bookTitle}</h3>
                  <p className="sh-hint">{request.pageCount} صفحة</p>
                  <ContentsChips contents={request.contents} />
                  <div className="sh-actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy}
                      onClick={() =>
                        respond.mutate({
                          shareId: request.shareId,
                          decision: "accept",
                        })
                      }
                    >
                      {busy && respond.variables?.decision === "accept" ? (
                        <Loader2 size={15} className="spin" />
                      ) : (
                        <Check size={15} />
                      )}
                      قبول
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        respond.mutate({
                          shareId: request.shareId,
                          decision: "decline",
                        })
                      }
                    >
                      <X size={15} /> رفض
                    </button>
                    <button
                      type="button"
                      className="sh-block"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `رفض الطلب وحظر ${ownerLabel(request.ownerName, request.ownerUsername)}؟ لن يتمكن من إيجادك أو مشاركة ملفات معك.`
                          )
                        ) {
                          respond.mutate({
                            shareId: request.shareId,
                            decision: "decline",
                            block: true,
                          });
                        }
                      }}
                    >
                      <ShieldBan size={15} /> رفض وحظر
                    </button>
                  </div>
                </article>
              );
            })
          )}
          {respond.error && (
            <p className="sh-error" role="alert">
              {respond.error.message}
            </p>
          )}
        </div>
      )}

      {activeTab === "library" && (
        <div role="tabpanel" className="sh-list">
          {library.isLoading ? (
            <Loader2 size={22} className="spin" />
          ) : !library.data?.length ? (
            <div className="sh-empty">
              <BookOpen size={28} aria-hidden="true" />
              <strong>لا توجد ملفات مشتركة بعد</strong>
              <span>
                الملفات التي تقبلها تظهر هنا وتفتح بنفس أدوات الدراسة.
              </span>
            </div>
          ) : (
            library.data.map(pack => (
              <Link
                key={pack.shareId}
                href={`/books/${pack.bookId}`}
                className="sh-pack"
              >
                <span className="sh-pack-icon" aria-hidden="true">
                  📘
                </span>
                <span className="sh-pack-body">
                  <strong dir="auto">{pack.bookTitle}</strong>
                  <span className="sh-hint">
                    من{" "}
                    <bdi>{ownerLabel(pack.ownerName, pack.ownerUsername)}</bdi>
                    {pack.sharedAt &&
                      ` · ${dateFormat.format(new Date(pack.sharedAt))}`}
                  </span>
                  <ContentsChips contents={pack.contents} />
                </span>
              </Link>
            ))
          )}
        </div>
      )}

      {activeTab === "notifications" && (
        <div role="tabpanel" className="sh-list">
          {notifications.isLoading ? (
            <Loader2 size={22} className="spin" />
          ) : !notifications.data?.length ? (
            <div className="sh-empty">
              <Bell size={28} aria-hidden="true" />
              <strong>لا توجد إشعارات</strong>
            </div>
          ) : (
            <ul className="sh-notes">
              {notifications.data.map(note => {
                const data = note.data as {
                  bookTitle?: string;
                  text?: string;
                  // question_set_ready (lib/db-question-sets.ts)
                  setId?: string;
                  title?: string;
                  needsReview?: number;
                  failed?: number;
                };
                const who = ownerLabel(note.actorName, note.actorUsername);
                const title = data.bookTitle ?? "";
                const text =
                  note.type === "share_request"
                    ? `${who} أرسل لك طلب مشاركة «${title}»`
                    : note.type === "share_accepted"
                      ? `${who} قبل ملفك «${title}»`
                      : note.type === "share_declined"
                        ? `${who} رفض طلب مشاركة «${title}»`
                        : note.type === "billing"
                          ? (data.text ?? "")
                          : note.type === "question_set_ready"
                            ? `مجموعتك «${data.title ?? ""}» جاهزة للمراجعة والنشر${
                                data.needsReview
                                  ? ` · ${data.needsReview} سؤالًا يحتاج مراجعتك`
                                  : ""
                              }${
                                data.failed ? ` · تعذّر شرح ${data.failed}` : ""
                              }`
                            : title;
                return (
                  <li
                    key={note.id}
                    className={note.readAt ? "sh-note" : "sh-note is-unread"}
                  >
                    {note.type === "question_set_ready" && data.setId ? (
                      <Link href={`/doctor/sets/${data.setId}`} dir="auto">
                        {text}
                      </Link>
                    ) : (
                      <span dir="auto">{text}</span>
                    )}
                    <small>{dateFormat.format(new Date(note.createdAt))}</small>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
