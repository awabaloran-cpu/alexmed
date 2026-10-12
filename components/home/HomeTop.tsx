"use client";

// The home's top bar: the NiroLearn wordmark in its corner, and facing it
// "إضافة زميل" and the bell. Each opens a sheet over the home — finding a
// student to add, and the notifications (what waits for an answer, the
// notices, the files received).
import { useCallback, useState } from "react";
import { Bell, UserPlus } from "lucide-react";
import { AddColleague } from "@/components/colleagues/AddColleague";
import {
  Notifications,
  useNotificationCount,
} from "@/components/colleagues/Notifications";
import { Sheet } from "@/components/colleagues/Sheet";
import s from "./HomeTop.module.css";

export function HomeTop() {
  const [open, setOpen] = useState<"add" | "notices" | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const count = useNotificationCount();

  return (
    <>
      <header className={s.bar}>
        <span className={s.brand} dir="ltr" translate="no">
          <span className={s.niro}>Niro</span>
          <span className={s.learn}>Learn</span>
        </span>
        <div className={s.acts}>
          <button
            type="button"
            className={s.add}
            aria-haspopup="dialog"
            onClick={() => setOpen("add")}
          >
            <UserPlus size={17} aria-hidden="true" />
            إضافة زميل
          </button>
          <button
            type="button"
            className={s.bell}
            aria-haspopup="dialog"
            aria-label={count ? `الإشعارات، ${count} جديدة` : "الإشعارات"}
            onClick={() => setOpen("notices")}
          >
            <Bell size={20} aria-hidden="true" />
            {count ? (
              <span className={s.count} aria-hidden="true">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      {open === "add" ? (
        <Sheet title="إضافة زميل" onClose={close}>
          <AddColleague onNavigate={close} />
        </Sheet>
      ) : null}
      {open === "notices" ? (
        <Sheet title="الإشعارات" onClose={close}>
          <Notifications onNavigate={close} />
        </Sheet>
      ) : null}
    </>
  );
}
