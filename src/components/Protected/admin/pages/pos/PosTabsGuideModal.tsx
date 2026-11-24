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
    title: "What guest tabs are for",
    plain:
      "A tab is an open guest check — like a bar or café bill you keep open while they order, then settle once at the end. Lines go on the tab first; payment happens when you settle.",
    bullets: [
      "Pick a park and a POS device on the terminal before opening a tab.",
      "Open a tab → add lines → settle with Cash / Card / other tenders.",
      "Settling creates a real POS sale (same ledger as Sell), so Sales history stays in sync.",
    ],
    tip: "If you see “Choose a park”, create or select a venue first — tabs are always park-scoped.",
  },
  {
    id: "before",
    title: "Create these before using tabs",
    plain:
      "Tabs need the same station setup as selling. Fix these first if buttons fail.",
    elsewhere: [
      {
        label: "Park (venue)",
        href: "/admin/venues",
        note: "Create the site under Venues, then select it on the terminal (or in the park picker).",
      },
      {
        label: "POS device",
        href: "/admin/pos",
        note: "Open Setup on the terminal → Station → Save device. Without a device, tabs cannot open or settle.",
      },
      {
        label: "Open till (for cash)",
        href: "/admin/pos",
        note: "If cash requires an open till in Policies, use the Tills tab on the terminal for this device before settling cash.",
      },
      {
        label: "Growth+ POS plan",
        href: "/admin/billing",
        note: "POS (including tabs) is Growth+. Demo/Starter cannot run the live terminal until upgraded.",
      },
    ],
  },
  {
    id: "open",
    title: "Open a tab",
    plain:
      "Give the tab a table or guest label so staff can find it later. Press Open tab. The new tab appears in Open tabs and becomes the active check.",
    fields: [
      {
        name: "Table label",
        how: "e.g. Table 4, Patio A, or a guest name. Defaults to “Table” if left blank.",
      },
      {
        name: "Open tab",
        how: "Creates an open GuestTab for this park + device. You can leave and resume it from the Open tabs list.",
      },
    ],
    tip: "Need another check for the same table? Open a second tab with a clearer label (Table 4-B).",
  },
  {
    id: "lines",
    title: "Add lines to the tab",
    plain:
      "Each line is an item on the guest check. Add name and price, then Add. The running total updates for settle.",
    fields: [
      {
        name: "Line name",
        how: "What appears on the sale (e.g. Latte). Keep it short for receipts.",
      },
      {
        name: "Price",
        how: "Unit price for one quantity. Add multiple times for more of the same item, or raise qty later via API/tools.",
      },
    ],
    tip: "Catalog products from Sell are optional here — open tabs accept free-text lines for F&B speed.",
  },
  {
    id: "settle",
    title: "Settle (pay) the tab",
    plain:
      "When the guest is ready, use the pay pad. Cash, card (in-browser), gift, wallet, or split tenders create a POS sale linked to this tab. Card may open Confirm card — finish that before walking away.",
    fields: [
      {
        name: "Tip chips",
        how: "Optional tip on settle. With card preauth, tip must be a separate non-card tender.",
      },
      {
        name: "Card / Cash / etc.",
        how: "Same tender rules as Sell. Settled tabs show under Sales; unpaid card sales stay authorized until confirmed.",
      },
      {
        name: "Split tab / Card preauth",
        how: "Beta tools: split creates a child tab; preauth holds a card amount before final settle.",
      },
    ],
    elsewhere: [
      {
        label: "Sales history",
        href: "/admin/pos",
        note: "Use the Sales tab on the terminal to find settled tab sales and resume Confirm card if a guest left mid-payment.",
      },
    ],
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function PosTabsGuideModal({ open, onClose }: Props) {
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
      aria-label="Tabs guide"
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
              <h2 className="font-serif text-xl">Guest tabs guide</h2>
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
