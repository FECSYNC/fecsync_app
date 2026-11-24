"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type AccountingTabRailItem = {
  key: string;
  label: string;
  active: boolean;
  href?: string;
  onSelect: (e?: MouseEvent) => void;
  onWarm?: () => void;
};

/**
 * Scroll the rail so `el` is visible — only mutates this scroller's scrollLeft
 * (never scrollIntoView, which jumps parent layouts / jumps to the end).
 */
export function scrollRailChildIntoView(
  scroller: HTMLElement,
  el: HTMLElement,
  behavior: ScrollBehavior = "smooth"
) {
  const left = el.offsetLeft;
  const right = left + el.offsetWidth;
  const viewLeft = scroller.scrollLeft;
  const viewRight = viewLeft + scroller.clientWidth;
  const pad = 12;
  let next = viewLeft;
  if (left < viewLeft + pad) next = Math.max(0, left - pad);
  else if (right > viewRight - pad)
    next = Math.max(0, right - scroller.clientWidth + pad);
  if (Math.abs(next - viewLeft) < 1) return;
  scroller.scrollTo({ left: next, behavior });
}

export default function AccountingTabRail({
  items,
  activeKey,
  /** When true, keep scroll pinned (e.g. after closing a modal). */
  freezeScroll = false,
  trailing,
  ariaLabel = "Accounting features",
}: {
  items: AccountingTabRailItem[];
  activeKey: string | null;
  freezeScroll?: boolean;
  trailing?: ReactNode;
  ariaLabel?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const savedScrollRef = useRef(0);
  const wasFrozenRef = useRef(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateOverflow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(max - el.scrollLeft > 2);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateOverflow();
    const onScroll = () => {
      if (!freezeScroll) savedScrollRef.current = el.scrollLeft;
      updateOverflow();
    };
    // Vertical mouse wheel / trackpad → horizontal scroll when the rail overflows.
    const onWheel = (e: WheelEvent) => {
      const dx =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (dx === 0) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = Math.min(max, Math.max(0, el.scrollLeft + dx));
      if (next === el.scrollLeft) return;
      e.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(() => updateOverflow());
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [updateOverflow, freezeScroll, items.length]);

  // Freeze: remember position while a modal is open; restore on close.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (freezeScroll) {
      if (!wasFrozenRef.current) {
        savedScrollRef.current = el.scrollLeft;
        wasFrozenRef.current = true;
      }
      return;
    }
    if (wasFrozenRef.current) {
      wasFrozenRef.current = false;
      el.scrollLeft = savedScrollRef.current;
      updateOverflow();
    }
  }, [freezeScroll, updateOverflow]);

  // Keep the active / retained tab visible (contained scroll only — no scrollIntoView).
  useEffect(() => {
    if (freezeScroll) return;
    const root = scrollerRef.current;
    if (!root || !activeKey) return;
    const active = root.querySelector<HTMLElement>(
      `[data-tab-key="${activeKey.replace(/"/g, "")}"]`
    );
    if (!active) return;
    scrollRailChildIntoView(root, active, "smooth");
    updateOverflow();
  }, [activeKey, freezeScroll, updateOverflow]);

  const nudge = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.55), behavior: "smooth" });
  };

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <button
        type="button"
        aria-label="Scroll tabs left"
        disabled={!canLeft}
        onClick={() => nudge(-1)}
        className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 transition enabled:hover:bg-stone-50 disabled:cursor-default disabled:opacity-30 sm:inline-flex"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="relative min-w-0 flex-1">
        {canLeft ? (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-2 left-0 top-0 z-[1] w-6 bg-gradient-to-r from-white to-transparent sm:w-8"
          />
        ) : null}
        {canRight ? (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-2 right-0 top-0 z-[1] w-6 bg-gradient-to-l from-white to-transparent sm:w-8"
          />
        ) : null}
        <div
          ref={scrollerRef}
          role="tablist"
          aria-label={ariaLabel}
          className="flex gap-1.5 overflow-x-auto overscroll-x-contain px-0.5 pb-1.5 pt-1 touch-pan-x [scrollbar-width:thin] [scrollbar-color:rgb(168_162_158)_rgb(245_245_244)] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-400/80 hover:[&::-webkit-scrollbar-thumb]:bg-stone-500 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-stone-100"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              data-tab-key={item.key}
              aria-selected={item.active}
              onMouseEnter={() => item.onWarm?.()}
              onFocus={() => item.onWarm?.()}
              onClick={(e) => item.onSelect(e)}
              className={`shrink-0 snap-start whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition sm:px-3.5 ${
                item.active
                  ? "bg-[#D4AF37]/20 text-[#6b5a12] ring-1 ring-[#D4AF37]/55"
                  : "bg-stone-50 text-stone-600 ring-1 ring-stone-200/80 hover:bg-stone-100 hover:text-stone-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        aria-label="Scroll tabs right"
        disabled={!canRight}
        onClick={() => nudge(1)}
        className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 transition enabled:hover:bg-stone-50 disabled:cursor-default disabled:opacity-30 sm:inline-flex"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
