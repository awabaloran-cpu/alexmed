"use client";

import Link from "next/link";
import { Bell, ChevronLeft, Inbox, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// 🤝 Home (/subjects) entry to الزملاء (app/shared): what waits for an
// answer first (colleague requests, files sent), then packs shared in the
// last two weeks, else a quiet row. Real counts from sharing.homeSummary —
// nothing shown that the server didn't return.
export function SharedHomeWidget() {
  const summary = trpc.sharing.homeSummary.useQuery();
  if (!summary.data) return null;
  const { unread, recent, colleagueRequests } = summary.data;
  const pending = summary.data.pending + colleagueRequests;

  return (
    <div className="sh-home">
      {pending > 0 ? (
        <Link href="/shared" className="sh-home-row is-pending">
          <span className="sh-home-icon">
            <Inbox size={18} aria-hidden="true" />
          </span>
          <span className="sh-home-text">
            <strong>
              {pending === 1
                ? "لديك طلب جديد من زميل"
                : `لديك ${pending} طلبات جديدة من زملائك`}
            </strong>
            <span>
              {colleagueRequests > 0
                ? "طلب زمالة بانتظار ردّك"
                : "زميلك أرسل لك ملفًا دراسيًا جاهزًا"}
            </span>
          </span>
          <ChevronLeft size={18} aria-hidden="true" />
        </Link>
      ) : (
        <Link href="/shared" className="sh-home-row">
          <span className="sh-home-icon">
            <Users size={18} aria-hidden="true" />
          </span>
          <span className="sh-home-text">
            <strong>الزملاء</strong>
            <span>أضف زملاءك وتبادلوا الملفات والدعوات</span>
          </span>
          {unread > 0 && (
            <span className="sh-count" aria-label={`${unread} إشعارات جديدة`}>
              <Bell size={11} aria-hidden="true" /> {unread}
            </span>
          )}
          <ChevronLeft size={18} aria-hidden="true" />
        </Link>
      )}
      {recent.map(pack => (
        <Link
          key={pack.bookId}
          href={`/books/${pack.bookId}`}
          className="sh-home-row is-recent"
        >
          <span className="sh-home-icon" aria-hidden="true">
            📘
          </span>
          <span className="sh-home-text">
            <strong dir="auto">{pack.bookTitle}</strong>
            <span>
              مشترك من{" "}
              <bdi>
                {pack.ownerName ||
                  (pack.ownerUsername ? `@${pack.ownerUsername}` : "زميل")}
              </bdi>
            </span>
          </span>
          <ChevronLeft size={18} aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
