"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import StudyShell from "@/components/study/StudyShell";
import { useAdBreak } from "@/components/ads/useAdBreak";
import ExamFocusCard from "@/components/exam-focus/ExamFocusCard";
import ExamFocusProgress from "@/components/exam-focus/ExamFocusProgress";
import {
  EXAM_FOCUS_CATEGORY_INFO,
  shouldPrefetch,
  stepIndex,
  swipeDirection,
  visibleCategoryFilters,
  type ExamFocusCategory,
} from "@/lib/exam-focus-categories";

const POLL_MS = 3000;
const RESUME_MS = 60_000;
const PAGE_SIZE = 40;

// 🔥 Exam Focus — the whole file as a stream of swipeable high-yield cards.
// Opening it the first time starts the (server-side, queued) generation;
// every later visit loads the saved deck — never regenerates on its own.
export default function ExamFocusPage() {
  const params = useParams<{ bookId: string }>();
  const router = useRouter();
  const bookId = params.bookId;
  const utils = trpc.useUtils();

  const deckQuery = trpc.examFocus.get.useQuery(
    { bookId },
    {
      retry: false,
      refetchInterval: query => {
        const status = query.state.data?.deck.status;
        return status === "processing" || status === "finalizing"
          ? POLL_MS
          : false;
      },
    }
  );
  const refreshDeck = () => {
    utils.examFocus.get.invalidate({ bookId });
    utils.examFocus.cards.invalidate({ bookId });
  };
  const start = trpc.examFocus.start.useMutation({ onSuccess: refreshDeck });
  const regenerate = trpc.examFocus.regenerate.useMutation({
    onSuccess: refreshDeck,
  });
  const retryFailed = trpc.examFocus.retryFailed.useMutation({
    onSuccess: refreshDeck,
  });
  const { mutate: resumeMutate } = trpc.examFocus.resume.useMutation();
  const setBookmark = trpc.examFocus.setBookmark.useMutation();

  const deckData = deckQuery.data;
  // 📤 A share recipient reads the owner's deck; (re)generating is owner-only.
  const isShared = deckData?.access.role === "shared";
  const status = deckData?.deck.status;
  const processing = status === "processing" || status === "finalizing";
  const ready = status === "complete" || status === "partial_failed";

  // First open → start. The tile click on the book page is the student's
  // explicit choice; the server returns the existing deck if there is one.
  const { mutate: startMutate } = start;
  const startedRef = useRef(false);
  useEffect(() => {
    if (deckQuery.isSuccess && deckData === null && !startedRef.current) {
      startedRef.current = true;
      startMutate({ bookId });
    }
  }, [deckQuery.isSuccess, deckData, bookId, startMutate]);

  // Safety net while processing: re-queue anything that stopped moving.
  useEffect(() => {
    if (!processing || isShared) return;
    const timer = setInterval(() => resumeMutate({ bookId }), RESUME_MS);
    return () => clearInterval(timer);
  }, [processing, isShared, bookId, resumeMutate]);

  // The moment processing finishes, load the fresh cards.
  const wasProcessing = useRef(false);
  useEffect(() => {
    if (processing) wasProcessing.current = true;
    else if (wasProcessing.current && ready) {
      wasProcessing.current = false;
      utils.examFocus.cards.invalidate({ bookId });
    }
  }, [processing, ready, bookId, utils]);

  // ── Filters + search (server-side, over the whole deck) ──
  const [category, setCategory] = useState<ExamFocusCategory | null>(null);
  const [savedOnly, setSavedOnly] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const cardsQuery = trpc.examFocus.cards.useInfiniteQuery(
    {
      bookId,
      category: category ?? undefined,
      bookmarkedOnly: savedOnly || undefined,
      search: search || undefined,
      limit: PAGE_SIZE,
    },
    { enabled: ready, getNextPageParam: last => last.nextCursor }
  );
  const items = useMemo(
    () => cardsQuery.data?.pages.flatMap(page => page.items) ?? [],
    [cardsQuery.data]
  );
  const total = cardsQuery.data?.pages[0]?.total ?? 0;

  // ── Position (remembered for the unfiltered deck) ──
  const filterKey = `${category ?? "all"}|${savedOnly}|${search}`;
  const unfiltered = filterKey === "all|false|";
  const positionKey = `exam-focus-pos-${bookId}`;
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "previous">("next");
  useEffect(() => {
    let restored = 0;
    if (unfiltered) {
      try {
        restored = Number(localStorage.getItem(positionKey)) || 0;
      } catch {
        // Storage unavailable — start from the first card.
      }
    }
    setIndex(restored);
  }, [filterKey, unfiltered, positionKey]);
  useEffect(() => {
    if (total && index > total - 1) setIndex(total - 1);
  }, [index, total]);
  useEffect(() => {
    if (!unfiltered) return;
    try {
      localStorage.setItem(positionKey, String(index));
    } catch {
      // Ignore storage failures.
    }
  }, [index, unfiltered, positionKey]);

  // Keep a page of cards ahead of the student (also fills in up to a
  // restored position deep in the deck).
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = cardsQuery;
  useEffect(() => {
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      shouldPrefetch(index, items.length, total)
    ) {
      fetchNextPage();
    }
  }, [
    index,
    items.length,
    total,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);

  // 📣 A pause after every group of cards on a free plan (lib/ads).
  const { advance: advanceWithAds, node: adNode } = useAdBreak(bookId);
  const adShowing = adNode !== null;
  const go = useCallback(
    (dir: "next" | "previous") => {
      if (adShowing) return; // the break's own button continues
      const move = () => {
        setDirection(dir);
        setIndex(current => stepIndex(current, dir, total));
      };
      if (dir === "next") advanceWithAds(index + 1, total, move);
      else move();
    },
    [total, index, adShowing, advanceWithAds]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if (event.key === "ArrowRight") go("next");
      else if (event.key === "ArrowLeft") go("previous");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // ── Swipe (touch + mouse, via pointer events) ──
  const dragRef = useRef<{ x: number; y: number; active: boolean } | null>(
    null
  );
  const [dragX, setDragX] = useState(0);

  // ── Bookmarks ("راجعها لاحقًا") — optimistic ──
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  function toggleBookmark(cardId: string, current: boolean) {
    const next = !current;
    setOverrides(o => ({ ...o, [cardId]: next }));
    setBookmark.mutate(
      { cardId, bookmarked: next },
      {
        onSuccess: () => utils.examFocus.get.invalidate({ bookId }),
        onError: () => setOverrides(o => ({ ...o, [cardId]: current })),
      }
    );
  }

  const back = () => router.push(`/books/${bookId}`);
  const shellTitle = "Exam Focus";

  // ── States ──
  const startError = start.error?.message ?? regenerate.error?.message;
  if (startError && !deckData) {
    return (
      <StudyShell tone="focus" title={shellTitle} onBack={back}>
        <div className="study-empty">
          <CircleAlert size={30} aria-hidden="true" />
          <h3>ما قدرنا نبدأ Exam Focus</h3>
          <p>{startError}</p>
          <button
            type="button"
            className="primary-button"
            disabled={start.isPending}
            onClick={() => start.mutate({ bookId })}
          >
            حاول مرة ثانية
          </button>
        </div>
      </StudyShell>
    );
  }

  // No access, or a shared file whose owner never created a deck (the
  // server explains; a recipient can't start one).
  if (deckQuery.error) {
    return (
      <StudyShell tone="focus" title={shellTitle} onBack={back}>
        <div className="study-empty">
          <CircleAlert size={30} aria-hidden="true" />
          <h3>Exam Focus غير متاح</h3>
          <p>
            {deckQuery.error.data?.code === "PRECONDITION_FAILED"
              ? deckQuery.error.message
              : "تعذر فتح هذا الملف."}
          </p>
        </div>
      </StudyShell>
    );
  }

  if (deckQuery.isLoading || !deckData) {
    return (
      <StudyShell
        tone="focus"
        title={shellTitle}
        subtitle="أهم معلومات الامتحان"
        onBack={back}
      >
        <div className="study-empty" aria-live="polite">
          <Loader2 size={28} className="spin" aria-hidden="true" />
          <p>نجهّز Exam Focus…</p>
        </div>
      </StudyShell>
    );
  }

  const { deck, units, categoryCounts, bookmarkedCount } = deckData;

  if (processing) {
    return (
      <StudyShell
        tone="focus"
        title={shellTitle}
        subtitle="أهم معلومات الامتحان"
        onBack={back}
      >
        <ExamFocusProgress deckStatus={deck.status} units={units} />
      </StudyShell>
    );
  }

  const failedUnits = units.filter(unit => unit.status === "failed");
  const confirmRegenerate = () => {
    if (
      window.confirm(
        "إعادة توليد Exam Focus من جديد؟ البطاقات الحالية والمحفوظة رح تنحذف."
      )
    ) {
      // Refused while still generating or right after a regenerate — say why.
      regenerate.mutate(
        { bookId },
        { onError: error => window.alert(error.message) }
      );
    }
  };

  if (status === "failed" || deck.totalCards === 0) {
    return (
      <StudyShell
        tone="focus"
        title={shellTitle}
        subtitle="أهم معلومات الامتحان"
        onBack={back}
      >
        <div className="study-empty">
          <CircleAlert size={30} aria-hidden="true" />
          <h3>
            {failedUnits.length
              ? "تعذر تحليل الملف"
              : "لم نجد معلومات امتحانية واضحة 🤔"}
          </h3>
          <p>{deck.errorMessage ?? "جرّب إعادة التوليد."}</p>
          {isShared ? null : failedUnits.length ? (
            <button
              type="button"
              className="primary-button"
              disabled={retryFailed.isPending}
              onClick={() => retryFailed.mutate({ bookId })}
            >
              <RotateCcw size={16} aria-hidden="true" /> إعادة المحاولة
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={regenerate.isPending}
              onClick={confirmRegenerate}
            >
              <RotateCcw size={16} aria-hidden="true" /> إعادة التوليد
            </button>
          )}
        </div>
      </StudyShell>
    );
  }

  const coverage = deck.coverage;
  const filters = visibleCategoryFilters(categoryCounts);
  const baseCard = items[index];
  const card = baseCard
    ? {
        ...baseCard,
        bookmarked: overrides[baseCard.id] ?? baseCard.bookmarked,
      }
    : undefined;
  const progress = total ? ((index + 1) / total) * 100 : 0;

  const notice =
    status === "partial_failed" && failedUnits.length ? (
      <span className="ef-notice">
        ⚠️ تعذر تحليل{" "}
        {failedUnits
          .map(unit => `ص ${unit.pageStart}–${unit.pageEnd}`)
          .join("، ")}
        .{" "}
        {!isShared && (
          <button
            type="button"
            onClick={() => retryFailed.mutate({ bookId })}
            disabled={retryFailed.isPending}
          >
            إعادة المحاولة
          </button>
        )}
      </span>
    ) : coverage && coverage.status !== "COMPLETE" ? (
      <span className="ef-notice">
        📊 البطاقات غطّت {coverage.coveredContentPages}/{coverage.contentPages}{" "}
        صفحة محتوى
        {coverage.pagesWithoutText.length
          ? ` · ${coverage.pagesWithoutText.length} صفحة بدون نص مقروء`
          : ""}
      </span>
    ) : undefined;

  return (
    <StudyShell
      tone="focus"
      title={shellTitle}
      subtitle={`${deck.totalCards} معلومة مركّزة`}
      onBack={back}
      notice={notice}
      actions={
        <>
          <button
            type="button"
            className="study-icon-button"
            onClick={() => setSearchOpen(open => !open)}
            aria-label="بحث في البطاقات"
            aria-expanded={searchOpen}
          >
            <Search size={20} />
          </button>
          {!isShared && (
            <button
              type="button"
              className="study-icon-button"
              onClick={confirmRegenerate}
              disabled={regenerate.isPending}
              aria-label="إعادة توليد Exam Focus"
            >
              <RotateCcw size={19} />
            </button>
          )}
        </>
      }
      footer={
        <div className="ef-nav" dir="ltr">
          <button
            type="button"
            className="ef-nav-btn"
            onClick={() => go("previous")}
            disabled={index === 0}
            aria-label="البطاقة السابقة"
          >
            <ChevronLeft size={20} aria-hidden="true" /> السابق
          </button>
          <span className="ef-nav-count" aria-live="polite">
            {total ? `${index + 1} / ${total}` : "0 / 0"}
          </span>
          <button
            type="button"
            className="ef-nav-btn is-next"
            onClick={() => go("next")}
            disabled={!total || index >= total - 1}
            aria-label="البطاقة التالية"
          >
            التالي <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      }
    >
      <div className="ef-viewer">
        {searchOpen && (
          <div className="ef-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={searchInput}
              onChange={event => setSearchInput(event.target.value)}
              placeholder="ابحث: chemical burns، 15–30 minutes…"
              aria-label="ابحث في كل بطاقات Exam Focus"
              autoFocus
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                aria-label="مسح البحث"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}

        <div className="ef-filters" role="toolbar" aria-label="تصفية البطاقات">
          <button
            type="button"
            className={`ef-chip ${!category && !savedOnly ? "is-on" : ""}`}
            aria-pressed={!category && !savedOnly}
            onClick={() => {
              setCategory(null);
              setSavedOnly(false);
            }}
          >
            <span aria-hidden="true">🔥</span> الكل · {deck.totalCards}
          </button>
          {(bookmarkedCount > 0 || savedOnly) && (
            <button
              type="button"
              className={`ef-chip ${savedOnly ? "is-on" : ""}`}
              aria-pressed={savedOnly}
              onClick={() => {
                setSavedOnly(on => !on);
                setCategory(null);
              }}
            >
              <span aria-hidden="true">🔖</span> راجعها لاحقًا ·{" "}
              {bookmarkedCount}
            </button>
          )}
          {filters.map(filter => {
            const info = EXAM_FOCUS_CATEGORY_INFO[filter.category];
            const on = category === filter.category;
            return (
              <button
                key={filter.category}
                type="button"
                className={`ef-chip ${on ? "is-on" : ""}`}
                aria-pressed={on}
                onClick={() => {
                  setCategory(on ? null : filter.category);
                  setSavedOnly(false);
                }}
              >
                <span aria-hidden="true">{info.emoji}</span> {info.label} ·{" "}
                {filter.count}
              </button>
            );
          })}
        </div>

        <div
          className="ef-progress-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={total ? index + 1 : 0}
          aria-label="تقدّمك في البطاقات"
        >
          <span style={{ width: `${progress}%` }} />
        </div>

        <div
          className="ef-stage"
          onPointerDown={event => {
            if ((event.target as HTMLElement).closest("a, button")) return;
            dragRef.current = {
              x: event.clientX,
              y: event.clientY,
              active: false,
            };
          }}
          onPointerMove={event => {
            const drag = dragRef.current;
            if (!drag) return;
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            if (!drag.active) {
              if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
                drag.active = true;
                event.currentTarget.setPointerCapture(event.pointerId);
              } else if (Math.abs(dy) > 10) {
                dragRef.current = null; // vertical: let the card scroll
                return;
              }
            }
            if (drag.active) setDragX(dx);
          }}
          onPointerUp={event => {
            const drag = dragRef.current;
            dragRef.current = null;
            setDragX(0);
            if (!drag?.active) return;
            const dir = swipeDirection(
              event.clientX - drag.x,
              event.clientY - drag.y
            );
            if (dir) go(dir);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setDragX(0);
          }}
        >
          {adNode ? (
            <div className="ef-card-wrap">{adNode}</div>
          ) : cardsQuery.isLoading || (!card && total > 0) ? (
            <div className="study-empty">
              <Loader2 size={26} className="spin" aria-hidden="true" />
            </div>
          ) : !card ? (
            <div className="study-empty">
              <h3>ما في بطاقات تطابق 🔎</h3>
              <p>جرّب كلمة ثانية أو اختر &quot;الكل&quot;.</p>
            </div>
          ) : (
            <div
              key={card.id}
              className={`ef-card-wrap ef-enter-${direction} ${dragX ? "is-dragging" : ""}`}
              style={
                dragX
                  ? {
                      transform: `translateX(${dragX}px) rotate(${dragX / 40}deg)`,
                    }
                  : undefined
              }
            >
              <ExamFocusCard
                card={card}
                bookId={bookId}
                position={index + 1}
                total={total}
                onToggleBookmark={() =>
                  toggleBookmark(card.id, card.bookmarked)
                }
              />
            </div>
          )}
        </div>
        <p className="ef-hint" aria-hidden="true">
          ← اسحب للتنقل →
        </p>
      </div>
    </StudyShell>
  );
}
