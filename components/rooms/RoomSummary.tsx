"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Clock,
  Highlighter,
  ListChecks,
  MessageCircle,
  Users,
} from "lucide-react";
import { bookDisplayTitle } from "@/lib/book-title";
import { trpc } from "@/lib/trpc-client";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// 🧾 After a sitting: how long, who, the file and the page it stopped on,
// what was highlighted, and each quiz with the student's own result. Only
// what the room stored (lib/study-rooms/summary.ts).
export default function RoomSummary({ roomId }: { roomId: string }) {
  const { t, tError, viewer } = useRooms();
  const router = useRouter();
  const summary = trpc.rooms.summary.useQuery({ roomId }, { retry: 1 });
  const again = trpc.rooms.createForBook.useMutation({
    onSuccess: result => router.push(`/rooms/${result.roomId}`),
  });

  if (summary.isLoading) {
    return <div className={s.skeleton} style={{ minHeight: 320 }} />;
  }
  if (!summary.data) {
    return (
      <div className={s.empty} role="alert">
        <b>{summary.error ? tError(summary.error) : t("rooms.loadFailed")}</b>
        <Link className={s.btn} href="/rooms">
          {t("lobby.toRooms")}
        </Link>
      </div>
    );
  }

  const { room, minutes, myMinutes, participants, file, markedPages } =
    summary.data;
  const { quizzes, messages } = summary.data;
  const marks = markedPages.reduce((sum, row) => sum + row.marks, 0);
  const fileHref = file?.bookId
    ? file.kind === "questions"
      ? `/books/question-files/${file.bookId}`
      : `/books/${file.bookId}/read?page=${file.lastPage}`
    : null;

  return (
    <div className={s.summary}>
      <header className={s.summaryHead}>
        <p className={s.sub}>
          {room.ended ? t("sum.ended") : t("sum.stillOpen")}
        </p>
        <h1 dir="auto">{room.title}</h1>
      </header>

      <dl className={s.figures}>
        <div>
          <dt>
            <Clock size={15} aria-hidden="true" /> {t("sum.duration")}
          </dt>
          <dd>{t("sum.minutes", { n: minutes })}</dd>
          {myMinutes !== minutes ? (
            <small>{t("sum.myMinutes", { n: myMinutes })}</small>
          ) : null}
        </div>
        <div>
          <dt>
            <Users size={15} aria-hidden="true" /> {t("sum.people")}
          </dt>
          <dd>{participants.length}</dd>
        </div>
        <div>
          <dt>
            <Highlighter size={15} aria-hidden="true" /> {t("sum.marks")}
          </dt>
          <dd>{marks}</dd>
        </div>
        <div>
          <dt>
            <MessageCircle size={15} aria-hidden="true" /> {t("sum.messages")}
          </dt>
          <dd>{messages}</dd>
        </div>
      </dl>

      <section className={s.summaryBlock}>
        <h2>{t("sum.who")}</h2>
        <p className={s.names}>
          {participants.map(person => (
            <span key={person.userId} dir="auto">
              {person.userId === viewer.userId ? t("live.you") : person.name}
            </span>
          ))}
        </p>
      </section>

      {file ? (
        <section className={s.summaryBlock}>
          <h2>
            <BookOpen size={16} aria-hidden="true" /> {t("sum.file")}
          </h2>
          <p dir="auto">{bookDisplayTitle(file.name)}</p>
          <p className={s.meta}>
            {t("sum.stoppedAt", {
              page: file.lastPage,
              total: file.pageCount,
            })}
          </p>
          {markedPages.length ? (
            <p className={s.meta}>
              {t("sum.markedPages", {
                pages: markedPages.map(row => row.page).join("، "),
              })}
            </p>
          ) : null}
          {fileHref ? (
            <div className={s.summaryActions}>
              <Link className={`${s.btn} ${s.primary}`} href={fileHref}>
                {t("sum.continue")}
              </Link>
              <button
                type="button"
                className={s.btn}
                disabled={again.isPending}
                onClick={() => again.mutate({ bookId: file.bookId! })}
              >
                {t("sum.newRoom")}
              </button>
            </div>
          ) : (
            <p className={s.meta}>{t("sum.fileNotYours")}</p>
          )}
          {again.error ? (
            <p className={s.errorNote} role="alert">
              {tError(again.error)}
            </p>
          ) : null}
        </section>
      ) : null}

      {quizzes.length ? (
        <section className={s.summaryBlock}>
          <h2>
            <ListChecks size={16} aria-hidden="true" /> {t("sum.quizzes")}
          </h2>
          <ul className={s.board}>
            {quizzes.map(quiz => (
              <li key={quiz.id}>
                <b>
                  {quiz.me
                    ? t("sum.quizMine", {
                        correct: quiz.me.correct,
                        total: quiz.total,
                      })
                    : t("sum.quizSkipped", { total: quiz.total })}
                </b>
                <i>
                  {quiz.me
                    ? t("sum.quizRank", {
                        rank: quiz.me.rank,
                        players: quiz.players,
                      })
                    : t("sum.quizPlayers", { players: quiz.players })}
                </i>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={s.summaryActions}>
        {room.ended ? null : (
          <Link className={`${s.btn} ${s.primary}`} href={`/rooms/${room.id}`}>
            {t("sum.backIn")}
          </Link>
        )}
        <Link className={s.btn} href="/rooms">
          {t("lobby.toRooms")}
        </Link>
      </div>
    </div>
  );
}
