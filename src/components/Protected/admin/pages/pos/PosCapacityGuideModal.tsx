"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type GuideStep = {
  id: string;
  title: string;
  plain: string;
  bullets?: string[];
  fields?: Array<{ name: string; how: string }>;
  elsewhere?: Array<{ label: string; href?: string; note: string }>;
  tip?: string;
};

const STEPS: GuideStep[] = [
  {
    id: "welcome",
    title: "What Capacity is for",
    plain:
      "Capacity shows how many seats are left on today’s timed sessions and resources for this park. Use it at the desk to see what is full, and to move a booking to a session that still has room.",
    bullets: [
      "Numbers come from the same ticketing sessions Sell uses for “Session seats”.",
      "Reschedule here updates the booking — Sell and Check-in see the new slot after refresh.",
      "Full or closed sessions cannot be chosen as a reschedule target.",
    ],
    tip: "If this window says “Choose a park”, pick or create a park first — capacity is always park-scoped.",
  },
  {
    id: "before",
    title: "Create sessions before you see numbers",
    plain:
      "Empty lists usually mean no Ticket sessions exist for this park yet. Create them in Ticketing, then reopen Capacity.",
    elsewhere: [
      {
        label: "Park (venue)",
        href: "/admin/venues",
        note: "Create the site under Venues, then select it on the terminal header or park picker.",
      },
      {
        label: "Sessions & products",
        href: "/admin/ticketing/sessions",
        note: "Build timed sessions with capacity. Without sessions, this screen has nothing to show.",
      },
      {
        label: "Ticketing products",
        href: "/admin/ticketing",
        note: "Admission products sell into sessions. Guests buy online or at POS; seats reduce remaining.",
      },
      {
        label: "Bookings",
        href: "/admin/bookings",
        note: "To reschedule, you need a booking id or public id from Bookings / Sales / confirmation email.",
      },
    ],
  },
  {
    id: "read",
    title: "Reading the session list",
    plain:
      "Each row is one session: label, start time, seats left vs total capacity. Green/amber/red chips show how full it is. Resources (lanes, rooms) appear below when configured.",
    fields: [
      {
        name: "Seats left",
        how: "Remaining saleable capacity for that session. Updates when bookings sell, cancel, or reschedule.",
      },
      {
        name: "Closed",
        how: "Session is closed to further sales — not offered for reschedule.",
      },
      {
        name: "Refresh",
        how: "Pull latest counts without closing the modal. The list also refreshes when you focus the window or close Capacity.",
      },
    ],
  },
  {
    id: "reschedule",
    title: "Move a booking to another session",
    plain:
      "Paste the booking id or public id, choose a session that still has seats, then Reschedule. The booking moves; capacity on both sessions updates.",
    fields: [
      {
        name: "Booking id",
        how: "Internal id or public confirmation id from Bookings. Wrong park → not found.",
      },
      {
        name: "Target session",
        how: "Only open sessions with remaining > 0. Full sessions stay hidden on purpose.",
      },
    ],
    tip: "After reschedule, the Sell pad session dropdown updates when you close this tool or when availability refreshes.",
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function PosCapacityGuideModal({ open, onClose }: Props) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const current = STEPS[step]!;
  const progress = ((step + 1) / STEPS.length) * 100;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-stone-900/55 p-2 backdrop-blur-[2px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Capacity guide"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        className="flex max-h-[min(92vh,840px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-stone-100 bg-gradient-to-r from-stone-900 to-stone-800 px-4 py-3 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#D4AF37]">
                Walkthrough
              </p>
              <h2 className="font-serif text-xl">Capacity guide</h2>
              <p className="mt-1 text-[11px] text-stone-300">
                Step {step + 1} of {STEPS.length}
              </p>
            </div>
            <button
              type="button"
              className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
            <motion.div className="h-full rounded-full bg-[#D4AF37]" animate={{ width: `${progress}%` }} />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              className="space-y-4"
            >
              <h3 className="font-serif text-2xl text-stone-900">{current.title}</h3>
              <p className="text-sm leading-relaxed text-stone-600">{current.plain}</p>
              {current.bullets?.map((b) => (
                <p
                  key={b}
                  className="rounded-xl bg-stone-50 px-3 py-2.5 text-sm text-stone-700 ring-1 ring-stone-200/80"
                >
                  {b}
                </p>
              ))}
              {current.fields?.map((f) => (
                <div key={f.name} className="rounded-xl border border-stone-200 px-3 py-2.5">
                  <p className="text-sm font-semibold text-stone-900">{f.name}</p>
                  <p className="mt-1 text-sm text-stone-600">{f.how}</p>
                </div>
              ))}
              {current.elsewhere?.map((e) => (
                <div
                  key={e.label}
                  className="rounded-xl border border-dashed border-[#D4AF37]/50 bg-[#D4AF37]/10 px-3 py-2.5"
                >
                  <p className="text-sm font-semibold text-stone-900">{e.label}</p>
                  <p className="mt-1 text-sm text-stone-700">{e.note}</p>
                  {e.href ? (
                    <Link
                      href={e.href}
                      className="mt-2 inline-flex text-sm font-semibold text-[#6b5a12] underline"
                      onClick={onClose}
                    >
                      Open →
                    </Link>
                  ) : null}
                </div>
              ))}
              {current.tip ? (
                <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-950">
                  <span className="font-semibold">Tip: </span>
                  {current.tip}
                </p>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-stone-100 bg-stone-50 px-4 py-3">
          <button
            type="button"
            disabled={step === 0}
            className="rounded-xl px-3 py-2 text-sm font-medium ring-1 ring-stone-200 disabled:opacity-35"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </button>
          {isLast ? (
            <button
              type="button"
              className="rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-900"
              onClick={onClose}
            >
              Got it
            </button>
          ) : (
            <button
              type="button"
              className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white"
              onClick={() => setStep((s) => Math.min(s + 1, STEPS.length - 1))}
            >
              Next
            </button>
          )}
        </footer>
      </motion.div>
    </div>
  );
}
