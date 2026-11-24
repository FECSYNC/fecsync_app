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
    title: "Why attach a guest?",
    plain:
      "Attaching a guest links this sale to a person — for postcodes, ban checks, receipts, and memberships. The sell pad uses the attached guest when you check out.",
    bullets: [
      "Search by name, email, or phone — matches appear as you type.",
      "Tap a result (or Attach) to put them on the current sale.",
      "No record yet? Quick-create a walk-in, then continue selling.",
    ],
    tip: "If Policies require a guest on sale, checkout stays blocked until someone is attached here.",
  },
  {
    id: "search",
    title: "Search and attach",
    plain:
      "Type at least two characters. Results list live from your company guest profiles (same records Check-in waivers and Memberships use).",
    fields: [
      {
        name: "Search field",
        how: "Name, email, or phone. Results update automatically — no need to press Enter.",
      },
      {
        name: "Guest row / Attach",
        how: "Chooses that guest for this sale, copies postcode if stored, and flags bans so managers can override at pay.",
      },
      {
        name: "Clear guest",
        how: "Removes the attachment if you picked the wrong person.",
      },
    ],
  },
  {
    id: "walkin",
    title: "Quick-create walk-in",
    plain:
      "Creates a new guest profile for someone without an account. Use when the queue is moving and you still need a guest stamp for policies or receipts.",
    fields: [
      {
        name: "Quick-create walk-in guest",
        how: "Saves Walk-in / Guest with a unique placeholder email, attaches them, and closes this tool.",
      },
    ],
    elsewhere: [
      {
        label: "Full guest / membership records",
        href: "/admin/memberships/members",
        note: "For real memberships and rich profiles, create or edit under Memberships — then search here to attach.",
      },
    ],
    tip: "Walk-ins are real GuestProfile rows — they stay searchable next time.",
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function PosGuestGuideModal({ open, onClose }: Props) {
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
      aria-label="Guest guide"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        className="flex max-h-[min(92vh,800px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-stone-100 bg-gradient-to-r from-stone-900 to-stone-800 px-4 py-3 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#D4AF37]">
                Walkthrough
              </p>
              <h2 className="font-serif text-xl">Guest guide</h2>
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
