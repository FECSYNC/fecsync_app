"use client";

import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
};

/**
 * Full-height desk panel — stays on /admin/marketing (no soft-nav / Turbopack leaf).
 */
export default function MarketingDeskModal({
  open,
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-stone-900/45 backdrop-blur-[2px]"
            aria-label="Close"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="marketing-desk-modal-title"
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className={`relative flex max-h-[92vh] w-full ${wide ? "max-w-[1360px]" : "max-w-4xl"} flex-col overflow-hidden rounded-t-2xl border border-stone-200/90 bg-white shadow-[0_24px_60px_-28px_rgba(28,25,23,0.45)] sm:rounded-2xl`}
          >
            <header className="relative flex shrink-0 items-start justify-between gap-3 border-b border-stone-200/80 px-5 py-4">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#D4AF37]/14 via-[#faf8f4] to-transparent"
              />
              <div className="relative min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6892A]">
                  Guest marketing
                </p>
                <h2
                  id="marketing-desk-modal-title"
                  className="mt-0.5 text-xl font-semibold tracking-tight text-stone-900"
                >
                  {title}
                </h2>
                {subtitle ? (
                  <p className="mt-1 text-sm text-stone-600">{subtitle}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="relative shrink-0 rounded-xl border border-stone-200 bg-white/90 px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50"
              >
                Close
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {children}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
