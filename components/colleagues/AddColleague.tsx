"use client";

// 🤝 "إضافة زميل": find a student by the name they registered with and send
// the request. The server decides who can be found and who may be asked;
// this only shows its answer.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Search, UserPlus, Users, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import {
  Avatar,
  Busy,
  explain,
  nameOf,
  useColleagueRefresh,
  useDebounced,
} from "./parts";
import s from "./colleagues.module.css";

export function AddColleague({ onNavigate }: { onNavigate?: () => void }) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 300);
  const searching = debounced.length >= 2;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const search = trpc.colleagues.search.useQuery(
    { query: debounced },
    { enabled: searching, placeholderData: previous => previous }
  );
  const refresh = useColleagueRefresh();
  const ask = trpc.colleagues.request.useMutation({ onSuccess: refresh });
  const withdraw = trpc.colleagues.cancel.useMutation({ onSuccess: refresh });
  const busy = ask.isPending || withdraw.isPending;
  const failure = explain(
    (searching ? search.error : null) ?? ask.error ?? withdraw.error
  );

  return (
    <div className={s.panel}>
      <label className={s.search}>
        <Search size={18} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="اكتب اسم زميلك"
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

      <div className={s.group} aria-live="polite">
        {!searching ? (
          <p className={s.note}>
            اكتب الاسم كما سجّل به زميلك في NiroLearn. بعد أن يقبل طلبك تتبادلان
            الملفات ودعوات الغرف.
          </p>
        ) : search.isLoading ? (
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
        {searching && search.data?.more ? (
          <p className={s.note}>
            النتائج كثيرة — اكتب الاسم كاملًا لتصل إلى زميلك.
          </p>
        ) : null}
      </div>

      {onNavigate ? (
        <Link href="/shared" className={s.btn} onClick={onNavigate}>
          <Users size={15} aria-hidden="true" /> زملائي
        </Link>
      ) : null}
    </div>
  );
}
