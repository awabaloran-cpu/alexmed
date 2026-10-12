"use client";

import { useCallback, useState } from "react";
import { Bell, UserPlus, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { AddColleague } from "@/components/colleagues/AddColleague";
import {
  Notifications,
  useNotificationCount,
} from "@/components/colleagues/Notifications";
import {
  Avatar,
  Busy,
  day,
  explain,
  nameOf,
  useColleagueRefresh,
  usePersonMenu,
} from "@/components/colleagues/parts";
import { Sheet } from "@/components/colleagues/Sheet";
import s from "@/components/colleagues/colleagues.module.css";

// 🤝 زملائي — the people a student studies with, and the requests they sent
// that still wait. Finding someone to add and everything that waits for
// this student's answer open as sheets (the same ones as the home's top
// bar); the blocked list is in حسابي. Every list is the caller's own; the
// server decides every rule and this page only shows its answer.
export default function ColleaguesPage() {
  const [open, setOpen] = useState<"add" | "notices" | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const waiting = useNotificationCount();
  const menu = usePersonMenu();
  const refresh = useColleagueRefresh();

  const colleagues = trpc.colleagues.list.useQuery();
  const requests = trpc.colleagues.requests.useQuery();
  const withdraw = trpc.colleagues.cancel.useMutation({ onSuccess: refresh });
  const failure = explain(withdraw.error ?? menu.error);
  const outgoing = requests.data?.outgoing ?? [];

  return (
    <section className={s.page}>
      <header className={s.head}>
        <h1>زملائي</h1>
        <p>
          أضف من تذاكر معهم، تبادلوا الملفات الجاهزة، وادعُهم إلى غرف الدراسة.
        </p>
      </header>

      <div className={s.acts}>
        <button
          type="button"
          className={`${s.btn} ${s.primary}`}
          aria-haspopup="dialog"
          onClick={() => setOpen("add")}
        >
          <UserPlus size={15} aria-hidden="true" /> إضافة زميل
        </button>
        <button
          type="button"
          className={s.btn}
          aria-haspopup="dialog"
          onClick={() => setOpen("notices")}
        >
          <Bell size={15} aria-hidden="true" /> الإشعارات
          {waiting ? <span className={s.count}>{waiting}</span> : null}
        </button>
      </div>

      {failure ? (
        <p className={s.error} role="alert">
          {failure}
        </p>
      ) : null}

      <div className={s.panel}>
        {colleagues.isLoading ? (
          <Busy />
        ) : !colleagues.data?.length ? (
          <div className={s.empty}>
            <Users size={28} aria-hidden="true" />
            <strong>لا زملاء بعد</strong>
            <span>
              اضغط «إضافة زميل» وابحث عنه باسمه. بعد قبوله تتبادلان الملفات
              ودعوات الغرف.
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
                    {menu.reported === person.id
                      ? "وصل بلاغك للإدارة"
                      : `زميلك منذ ${day(person.since)}`}
                  </span>
                </span>
                {menu.button(person)}
                {menu.panel(person, true)}
              </li>
            ))}
          </ul>
        )}

        {outgoing.length ? (
          <div className={s.group}>
            <h2>طلبات أرسلتها</h2>
            <ul className={s.list}>
              {outgoing.map(person => (
                <li key={person.connectionId} className={s.row}>
                  <Avatar person={person} />
                  <span className={s.who}>
                    <strong dir="auto">{nameOf(person.name)}</strong>
                    <span>بانتظار ردّه · {day(person.createdAt)}</span>
                  </span>
                  <button
                    type="button"
                    className={`${s.btn} ${s.quiet}`}
                    disabled={withdraw.isPending}
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
      </div>

      {open === "add" ? (
        <Sheet title="إضافة زميل" onClose={close}>
          <AddColleague />
        </Sheet>
      ) : null}
      {open === "notices" ? (
        <Sheet title="الإشعارات" onClose={close}>
          <Notifications onNavigate={close} />
        </Sheet>
      ) : null}
    </section>
  );
}
