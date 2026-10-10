"use client";

import { useEffect, useRef, useState } from "react";
import { Highlighter, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

export const MARK_COLORS = ["yellow", "green", "pink", "blue"] as const;
export type MarkColor = (typeof MARK_COLORS)[number];

type Rect = { x: number; y: number; w: number; h: number };

const newClientId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// The page's shared highlights, read again whenever the room moves on.
export function useRoomMarks(
  roomId: string,
  page: number,
  roomSeq: number,
  enabled: boolean
) {
  const marks = trpc.rooms.marks.useQuery(
    { roomId, page },
    { enabled, staleTime: Infinity }
  );
  const refetch = marks.refetch;
  useEffect(() => {
    if (enabled) void refetch();
  }, [roomSeq, enabled, refetch]);
  return marks;
}

// 🖍️ Shared highlights over the page: every member sees them, with the
// name of whoever made each one. With the highlighter on, a drag over the
// page marks that rectangle — which works the same on a scanned page as on
// one with text. Positions are fractions of the page, so they sit in the
// same place at any zoom and on any screen.
//
// The server decides who may highlight and who may remove (the maker, the
// leader and co-hosts) and limits how many (lib/study-rooms/live.ts).
export function MarkLayer({
  roomId,
  page,
  marks,
  drawing,
  color,
  selectedId,
  onSelect,
  onError,
}: {
  roomId: string;
  page: number;
  marks: ReturnType<typeof useRoomMarks>;
  drawing: boolean;
  color: MarkColor;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useRooms();
  const utils = trpc.useUtils();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const add = trpc.rooms.addMark.useMutation({
    onSuccess: async () => {
      await Promise.all([
        marks.refetch(),
        utils.rooms.state.invalidate({ roomId }),
      ]);
    },
    onError,
  });

  const point = (event: React.PointerEvent) => {
    const box = layerRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };

  return (
    <div
      ref={layerRef}
      className={`${s.markLayer} ${drawing ? s.markLayerOn : ""}`}
      onPointerDown={event => {
        if (!drawing) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = point(event);
        setDraft({ ...start.current, w: 0, h: 0 });
      }}
      onPointerMove={event => {
        if (!drawing || !start.current) return;
        const now = point(event);
        setDraft({
          x: Math.min(start.current.x, now.x),
          y: Math.min(start.current.y, now.y),
          w: Math.abs(now.x - start.current.x),
          h: Math.abs(now.y - start.current.y),
        });
      }}
      onPointerUp={() => {
        const rect = draft;
        start.current = null;
        setDraft(null);
        // A tap, or a slip of the finger, is not a highlight.
        if (!drawing || !rect || rect.w < 0.02 || rect.h < 0.008) return;
        add.mutate({
          roomId,
          page,
          color,
          rects: [rect],
          clientId: newClientId(),
        });
      }}
      onPointerCancel={() => {
        start.current = null;
        setDraft(null);
      }}
    >
      {(marks.data ?? []).flatMap(mark =>
        mark.rects.map((rect, index) => (
          <button
            key={`${mark.id}-${index}`}
            type="button"
            className={`${s.mark} ${s[`mark_${mark.color}`] ?? ""} ${
              selectedId === mark.id ? s.markOn : ""
            }`}
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
            }}
            aria-label={t("mark.by", { name: mark.name ?? t("chat.someone") })}
            // While drawing, a highlight is not in the way of the next one.
            tabIndex={drawing ? -1 : 0}
            onClick={() => onSelect(selectedId === mark.id ? null : mark.id)}
          />
        ))
      )}
      {draft ? (
        <span
          className={`${s.mark} ${s[`mark_${color}`] ?? ""}`}
          style={{
            left: `${draft.x * 100}%`,
            top: `${draft.y * 100}%`,
            width: `${draft.w * 100}%`,
            height: `${draft.h * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}

export function MarkTools({
  roomId,
  marks,
  canMark,
  canDeleteAny,
  myUserId,
  drawing,
  onDrawing,
  color,
  onColor,
  selectedId,
  onSelect,
  onError,
}: {
  roomId: string;
  marks: ReturnType<typeof useRoomMarks>;
  canMark: boolean;
  canDeleteAny: boolean;
  myUserId: string;
  drawing: boolean;
  onDrawing: (on: boolean) => void;
  color: MarkColor;
  onColor: (color: MarkColor) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useRooms();
  const utils = trpc.useUtils();
  const remove = trpc.rooms.deleteMark.useMutation({
    onSuccess: async () => {
      onSelect(null);
      await Promise.all([
        marks.refetch(),
        utils.rooms.state.invalidate({ roomId }),
      ]);
    },
    onError,
  });
  const selected = (marks.data ?? []).find(mark => mark.id === selectedId);

  return (
    <>
      {canMark ? (
        <div className={s.markTools}>
          <button
            type="button"
            className={`${s.btn} ${drawing ? s.primary : ""}`}
            aria-pressed={drawing}
            onClick={() => onDrawing(!drawing)}
          >
            <Highlighter size={17} aria-hidden="true" />
            {drawing ? t("mark.stop") : t("mark.start")}
          </button>
          {drawing
            ? MARK_COLORS.map(value => (
                <button
                  key={value}
                  type="button"
                  className={`${s.swatch} ${s[`mark_${value}`] ?? ""} ${
                    color === value ? s.swatchOn : ""
                  }`}
                  aria-label={t(`mark.color.${value}`)}
                  aria-pressed={color === value}
                  onClick={() => onColor(value)}
                />
              ))
            : null}
        </div>
      ) : null}
      {drawing ? <p className={s.meta}>{t("mark.hint")}</p> : null}
      {selected ? (
        <div className={s.markInfo} role="status">
          <span dir="auto">
            {selected.userId === myUserId
              ? t("mark.mine")
              : t("mark.by", { name: selected.name ?? t("chat.someone") })}
          </span>
          {selected.userId === myUserId || canDeleteAny ? (
            <button
              type="button"
              className={s.msgRetry}
              disabled={remove.isPending}
              onClick={() => remove.mutate({ roomId, markId: selected.id })}
            >
              <Trash2 size={13} aria-hidden="true" /> {t("mark.delete")}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
