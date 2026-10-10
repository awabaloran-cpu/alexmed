"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw, Send, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

const MESSAGE_MAX = 500;

type Message = {
  id: string;
  // null once the writer's account is gone.
  userId: string | null;
  name: string | null;
  body: string;
  page: number | null;
  seq: number;
  deleted: boolean;
};

// A message this member has written that the server has not confirmed yet.
type Outgoing = {
  clientId: string;
  body: string;
  page: number | null;
  failed: boolean;
  // The server's id once it has the message.
  sentId?: string;
};

// A deletion changes a message already shown: the whole list is read again
// when the room moved on and nothing new came, at most this often.
const FULL_REFRESH_MS = 20_000;

const newClientId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// 💬 The room's chat. Messages are read from the room's sequence number on
// (only what is new), every time the room's state says something changed —
// so nothing is missed after a lost connection, and a second tab shows the
// same thing. A message carries the page its writer was on; pressing it
// goes there.
//
// Sending is safe to repeat: each message has its own id, and the server
// keeps one copy however many times it arrives. A message that could not be
// sent stays in place with "try again".
export function useRoomChat(roomId: string, roomSeq: number, open: boolean) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [readSeq, setReadSeq] = useState(0);
  const lastSeq = messages.length ? messages[messages.length - 1].seq : 0;
  const lastSeqRef = useRef(0);
  lastSeqRef.current = lastSeq;
  const utils = trpc.useUtils();
  const loaded = useRef(false);
  const lastFull = useRef(0);

  // Asked again whenever the room moves on (a message, a deletion, a page).
  useEffect(() => {
    let cancelled = false;
    const first = !loaded.current;
    void utils.rooms.messages
      .fetch({ roomId, afterSeq: first ? 0 : lastSeqRef.current })
      .then(rows => {
        if (cancelled) return;
        loaded.current = true;
        if (first) lastFull.current = Date.now();
        if (!rows.length) {
          if (!first && Date.now() - lastFull.current > FULL_REFRESH_MS) {
            lastFull.current = Date.now();
            void utils.rooms.messages
              .fetch({ roomId, afterSeq: 0 })
              .then(all => {
                if (!cancelled) setMessages(all);
              })
              .catch(() => undefined);
          }
          return;
        }
        setMessages(before => {
          const known = new Set(before.map(message => message.id));
          const fresh = rows.filter(row => !known.has(row.id));
          return fresh.length ? [...before, ...fresh] : before;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [roomId, roomSeq, utils]);

  // A deletion changes a message already on screen: read the lot again,
  // rarely (when the room moved on without anything new arriving).
  const refreshAll = () =>
    utils.rooms.messages.fetch({ roomId, afterSeq: 0 }).then(rows => {
      setMessages(rows);
    });

  useEffect(() => {
    if (open) setReadSeq(lastSeq);
  }, [open, lastSeq]);

  const unread = messages.filter(message => message.seq > readSeq).length;
  return { messages, unread, refreshAll };
}

export default function RoomChat({
  roomId,
  chat,
  myUserId,
  page,
  canChat,
  canDeleteAny,
  onGoToPage,
}: {
  roomId: string;
  chat: ReturnType<typeof useRoomChat>;
  myUserId: string;
  // The page this member is on, attached to what they write (null: no file).
  page: number | null;
  canChat: boolean;
  canDeleteAny: boolean;
  onGoToPage: (page: number) => void;
}) {
  const { t, tError } = useRooms();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState("");
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const send = trpc.rooms.sendMessage.useMutation();
  const remove = trpc.rooms.deleteMessage.useMutation({
    onSuccess: () => chat.refreshAll(),
  });

  const deliver = (message: Outgoing) => {
    setError(null);
    setOutgoing(list =>
      list.map(item =>
        item.clientId === message.clientId ? { ...item, failed: false } : item
      )
    );
    send.mutate(
      {
        roomId,
        body: message.body,
        page: message.page,
        clientId: message.clientId,
      },
      {
        onSuccess: async sent => {
          setOutgoing(list =>
            list.map(item =>
              item.clientId === message.clientId
                ? { ...item, sentId: sent.id }
                : item
            )
          );
          await utils.rooms.state.invalidate({ roomId });
        },
        onError: failure => {
          setError(tError(failure));
          setOutgoing(list =>
            list.map(item =>
              item.clientId === message.clientId
                ? { ...item, failed: true }
                : item
            )
          );
        },
      }
    );
  };

  // What the server now shows is no longer "being sent".
  const shown = useMemo(
    () => new Set(chat.messages.map(message => message.id)),
    [chat.messages]
  );
  const waiting = outgoing.filter(
    item => item.failed || !item.sentId || !shown.has(item.sentId)
  );

  const count = chat.messages.length + waiting.length;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count]);

  const submit = () => {
    const body = draft.replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX);
    if (!body) return;
    const message: Outgoing = {
      clientId: newClientId(),
      body,
      page,
      failed: false,
    };
    setOutgoing(list => [...list.slice(-20), message]);
    setDraft("");
    deliver(message);
  };

  return (
    <div className={s.chat}>
      <div
        ref={listRef}
        className={s.chatList}
        role="log"
        aria-live="polite"
        aria-label={t("chat.title")}
      >
        {count === 0 ? <p className={s.chatEmpty}>{t("chat.empty")}</p> : null}
        {chat.messages.map(message => {
          const mine = message.userId === myUserId;
          return (
            <div
              key={message.id}
              className={`${s.msg} ${mine ? s.msgMine : ""}`}
            >
              {mine ? null : (
                <b dir="auto">{message.name ?? t("chat.someone")}</b>
              )}
              {message.deleted ? (
                <i>{t("chat.deleted")}</i>
              ) : (
                <span dir="auto">{message.body}</span>
              )}
              <span className={s.msgFoot}>
                {message.page && !message.deleted ? (
                  <button
                    type="button"
                    className={s.msgPage}
                    onClick={() => onGoToPage(message.page!)}
                  >
                    {t("chat.page", { page: message.page })}
                  </button>
                ) : null}
                {!message.deleted && (mine || canDeleteAny) ? (
                  <button
                    type="button"
                    className={s.msgDelete}
                    aria-label={t("chat.delete")}
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate({ roomId, messageId: message.id })
                    }
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
        {waiting.map(message => (
          <div
            key={message.clientId}
            className={`${s.msg} ${s.msgMine} ${s.msgWaiting}`}
          >
            <span dir="auto">{message.body}</span>
            <span className={s.msgFoot}>
              {message.failed ? (
                <button
                  type="button"
                  className={s.msgRetry}
                  onClick={() => deliver(message)}
                >
                  <RotateCw size={13} aria-hidden="true" />
                  {t("chat.retry")}
                </button>
              ) : (
                t("chat.sending")
              )}
            </span>
          </div>
        ))}
      </div>

      {error ? (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      ) : null}

      {canChat ? (
        <form
          className={s.chatForm}
          onSubmit={event => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            className={s.input}
            dir="auto"
            value={draft}
            maxLength={MESSAGE_MAX}
            placeholder={
              page ? t("chat.placeholderPage", { page }) : t("chat.placeholder")
            }
            aria-label={t("chat.title")}
            enterKeyHint="send"
            onChange={event => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className={`${s.iconBtn} ${s.chatSend}`}
            aria-label={t("chat.send")}
            disabled={!draft.trim()}
          >
            <Send size={18} aria-hidden="true" />
          </button>
        </form>
      ) : (
        <p className={s.meta}>{t("chat.closed")}</p>
      )}
    </div>
  );
}
