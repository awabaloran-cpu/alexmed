"use client";

// A sheet over the page: from the bottom on a phone, a centred panel on a
// wide screen. Closes on Escape, on its backdrop and on its ✕, and puts the
// focus back where it was.
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import s from "./sheet.module.css";

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!panel.current?.contains(document.activeElement)) {
      panel.current?.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [onClose]);

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div
        ref={panel}
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
      >
        <header className={s.head}>
          <h2>{title}</h2>
          <button
            type="button"
            className={s.close}
            aria-label="إغلاق"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className={s.body}>{children}</div>
      </div>
    </div>
  );
}
