"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { posGuideBtn, posSoftBtn } from "./posUi";

type Props = {
  eyebrow?: string;
  title: string;
  parkName?: string;
  meta?: ReactNode;
  live?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  onGuide?: () => void;
  children: ReactNode;
  /** Compact modal body (default) vs standalone page padding. */
  compact?: boolean;
};

/**
 * Consistent chrome for POS station-tool panels inside the terminal modal.
 */
export default function PosToolShell({
  eyebrow = "Station tool",
  title,
  parkName,
  meta,
  live = true,
  onRefresh,
  refreshing,
  onGuide,
  children,
  compact = true,
}: Props) {
  return (
    <div className={compact ? "space-y-3" : "mx-auto max-w-3xl space-y-4 px-4 py-6"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {!compact ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6892A]">
                {eyebrow}
              </p>
              <h1 className="font-serif text-2xl text-stone-900">{title}</h1>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {parkName ? (
                <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600 ring-1 ring-stone-200">
                  {parkName}
                </span>
              ) : null}
              {live ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Live
                </span>
              ) : null}
              {meta}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {onRefresh ? (
            <button
              type="button"
              className={posSoftBtn + " !rounded-full !px-3 !py-1.5 !text-[11px]"}
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
          {onGuide ? (
            <button type="button" className={posGuideBtn} onClick={onGuide}>
              Guide
            </button>
          ) : null}
        </div>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </div>
  );
}
