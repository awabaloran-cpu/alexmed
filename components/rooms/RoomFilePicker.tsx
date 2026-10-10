"use client";

import Link from "next/link";
import { BookOpen, ClipboardList, Upload } from "lucide-react";
import { bookDisplayTitle } from "@/lib/book-title";
import { trpc } from "@/lib/trpc-client";
import { Sheet } from "./parts";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// 📄 The leader chooses the room's file from their own files. The server
// decides what may be opened (lib/study-rooms/rooms.ts: the leader's own
// file, never a doctor's protected set) — this only lists and asks.
export default function RoomFilePicker({
  roomId,
  currentBookId,
  onClose,
}: {
  roomId: string;
  currentBookId: string | null;
  onClose: () => void;
}) {
  const { t, tError } = useRooms();
  const utils = trpc.useUtils();
  const books = trpc.books.list.useQuery();
  const questionFiles = trpc.questionFiles.list.useQuery();
  const update = trpc.rooms.update.useMutation({
    onSuccess: async () => {
      await utils.rooms.state.invalidate({ roomId });
      onClose();
    },
  });

  // Only a file that has been read can be opened.
  const files = [
    ...(books.data ?? [])
      .filter(book => book.chapterCount > 0)
      .map(book => ({
        id: book.id,
        name: bookDisplayTitle(book.fileName),
        kind: "book" as const,
        pages: book.pageCount,
      })),
    ...(questionFiles.data ?? [])
      .filter(file => file.status === "complete")
      .map(file => ({
        id: file.id,
        name: bookDisplayTitle(file.fileName),
        kind: "questions" as const,
        pages: null as number | null,
      })),
  ];
  const loading = books.isLoading || questionFiles.isLoading;

  return (
    <Sheet title={t("file.pickTitle")} onClose={onClose}>
      <p className={s.meta}>{t("file.pickHint")}</p>
      {loading ? (
        <div className={s.skeleton} style={{ minHeight: 120 }} />
      ) : files.length === 0 ? (
        <p className={s.sub}>{t("file.none")}</p>
      ) : (
        <div className={s.fileList}>
          {files.map(file => {
            const current = file.id === currentBookId;
            return (
              <button
                key={file.id}
                type="button"
                className={`${s.item} ${current ? s.itemOn : ""}`}
                disabled={update.isPending}
                aria-pressed={current}
                onClick={() =>
                  current
                    ? onClose()
                    : update.mutate({ roomId, bookId: file.id })
                }
              >
                {file.kind === "book" ? (
                  <BookOpen size={18} aria-hidden="true" />
                ) : (
                  <ClipboardList size={18} aria-hidden="true" />
                )}
                <span dir="auto">
                  {file.name}
                  <small>
                    {file.kind === "book"
                      ? t("file.kindBook")
                      : t("file.kindQuestions")}
                    {file.pages
                      ? ` · ${t("file.pages", { n: file.pages })}`
                      : ""}
                    {current ? ` · ${t("file.current")}` : ""}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {update.error ? (
        <p className={s.errorNote} role="alert">
          {tError(update.error)}
        </p>
      ) : null}
      <Link className={`${s.btn} ${s.wide}`} href="/books/upload">
        <Upload size={17} aria-hidden="true" /> {t("file.upload")}
      </Link>
      {currentBookId ? (
        <button
          type="button"
          className={`${s.btn} ${s.danger} ${s.wide}`}
          disabled={update.isPending}
          onClick={() => update.mutate({ roomId, bookId: null })}
        >
          {t("file.remove")}
        </button>
      ) : null}
    </Sheet>
  );
}
