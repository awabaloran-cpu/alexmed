"use client";

// What the colleague screens share: how a person, a date, a refusal and a
// file's contents are written, and the "⋯" beside a person (remove, block,
// report — each asked about once before it happens).
import { useEffect, useState } from "react";
import { Loader2, MoreHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ROOMS_MESSAGES } from "@/lib/study-rooms/i18n";
import { StudentAvatar } from "@/components/sharing/StudentAvatar";
import s from "./colleagues.module.css";

export type Person = { id: string; name: string | null };
type Drawer = { id: string; mode: "menu" | "remove" | "block" | "report" };

const dateFormat = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  day: "numeric",
  month: "short",
});
export const day = (value: Date | string | null) =>
  value ? dateFormat.format(new Date(value)) : "";

export const nameOf = (name: string | null, username?: string | null) =>
  name || (username ? `@${username}` : "طالب");

// A refusal's sentence: colleague and room reasons arrive as keys, the
// file-sharing ones already as sentences.
export function explain(error: { message: string } | null | undefined) {
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

export function Avatar({ person }: { person: Person }) {
  return <StudentAvatar name={person.name} username={person.id} />;
}

export function Busy() {
  return <Loader2 size={15} className="spin" aria-hidden="true" />;
}

export function Contents({
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

export function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// Everything a colleague action can change, asked for again.
export function useColleagueRefresh() {
  const utils = trpc.useUtils();
  return () => {
    utils.colleagues.invalidate();
    utils.sharing.invalidate();
    utils.rooms.myInvites.invalidate();
  };
}

export function usePersonMenu() {
  const refreshAll = useColleagueRefresh();
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [reason, setReason] = useState<string>("abuse");
  const [reported, setReported] = useState<string | null>(null);
  const refresh = () => {
    setDrawer(null);
    refreshAll();
  };
  const remove = trpc.colleagues.remove.useMutation({ onSuccess: refresh });
  const block = trpc.colleagues.block.useMutation({ onSuccess: refresh });
  const report = trpc.colleagues.report.useMutation({
    onSuccess: (_, input) => {
      setReported(input.userId);
      setDrawer(null);
    },
  });
  const busy = remove.isPending || block.isPending || report.isPending;

  const button = (person: Person) => (
    <button
      type="button"
      className={s.more}
      aria-label={`خيارات ${nameOf(person.name)}`}
      aria-expanded={drawer?.id === person.id}
      onClick={() =>
        setDrawer(current =>
          current?.id === person.id ? null : { id: person.id, mode: "menu" }
        )
      }
    >
      <MoreHorizontal size={18} aria-hidden="true" />
    </button>
  );

  const panel = (person: Person, isColleague: boolean) => {
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

  return {
    button,
    panel,
    busy,
    reported,
    error: remove.error ?? block.error ?? report.error,
  };
}
