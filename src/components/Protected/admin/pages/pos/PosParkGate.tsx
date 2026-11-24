"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

type VenueOption = { id: string; name: string };

type Props = {
  toolLabel: string;
  venues: VenueOption[];
  venuesLoading: boolean;
  parkLocked?: boolean;
  /** When parks exist but none selected — park picker. */
  onSelectPark: (locationId: string) => void;
  /** Slim create-park CTA (no device checklist). */
  createParkCta?: ReactNode;
  heroGlyph?: string;
};

/**
 * Shared empty / loading / choose-park gate for POS station-tool modals.
 * Never treat “venues still loading” as “you have no parks.”
 */
export default function PosParkGate({
  toolLabel,
  venues,
  venuesLoading,
  parkLocked,
  onSelectPark,
  createParkCta,
  heroGlyph = "P",
}: Props) {
  if (venuesLoading && !venues.length) {
    return (
      <div className="py-10 text-center">
        <div className="mx-auto h-10 w-10 animate-pulse rounded-2xl bg-[#D4AF37]/20 ring-1 ring-[#D4AF37]/30" />
        <p className="mt-3 font-serif text-xl text-stone-900">Loading parks…</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
          Matching {toolLabel} to your company venues.
        </p>
      </div>
    );
  }

  if (venues.length) {
    return (
      <div className="space-y-5 py-1">
        <div className="text-center">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#D4AF37]/25 to-[#D4AF37]/5 ring-1 ring-[#D4AF37]/40"
          >
            <span className="font-serif text-2xl text-[#8a7320]">{heroGlyph}</span>
          </motion.div>
          <p className="mt-3 font-serif text-xl text-stone-900">Choose a park</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            {toolLabel} needs a park — same context as the terminal header.
          </p>
        </div>
        <label className="mx-auto block max-w-sm text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Park
          <select
            className="mt-1.5 w-full rounded-xl bg-stone-50 px-3.5 py-2.5 text-sm font-medium normal-case tracking-normal text-stone-900 ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55"
            value=""
            disabled={parkLocked && venues.length <= 1}
            onChange={(e) => {
              const loc = e.target.value;
              if (loc) onSelectPark(loc);
            }}
          >
            <option value="">Select park…</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 ring-1 ring-stone-200">
        <span className="font-serif text-2xl text-stone-500">+</span>
      </div>
      <div>
        <p className="font-serif text-xl text-stone-900">Create a park</p>
        <p className="mt-1 text-sm text-stone-500">
          {toolLabel} needs an active venue under Venues. A POS device is only required for the
          sell pad.
        </p>
      </div>
      {createParkCta}
    </div>
  );
}
