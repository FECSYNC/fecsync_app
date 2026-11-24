"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type GuideAction = "setup" | "tills" | "sales" | "guest";

type GuideStep = {
  id: string;
  title: string;
  plain: string;
  bullets?: string[];
  fields?: Array<{ name: string; how: string }>;
  elsewhere?: Array<{ label: string; action?: GuideAction; note: string }>;
  tip?: string;
};

const STEPS: GuideStep[] = [
  {
    id: "welcome",
    title: "What this checkout column is for",
    plain:
      "This right-hand rail finishes a sale. Products are chosen on the left; here you review the cart, add a discount or tip, and take payment.",
    bullets: [
      "Empty cart → tap products in the catalog first.",
      "Lines appear here with Remove if you need to change the basket.",
      "Pay with Cash, Card, gift, pay link, or other tenders at the bottom.",
    ],
    tip: "Nothing to charge at $0.00 until at least one product is on the cart.",
  },
  {
    id: "before",
    title: "Before you can sell",
    plain:
      "If the catalog is empty or pay buttons fail, finish station setup first.",
    elsewhere: [
      {
        label: "POS Setup",
        action: "setup",
        note: "Use the Setup tab: park, device, products. Catalog tiles appear after you add products.",
      },
      {
        label: "Open a till (for cash)",
        action: "tills",
        note: "If Policies require an open till, open one for this device before taking cash.",
      },
      {
        label: "Guest tab (if required)",
        action: "guest",
        note: "Use the Guest station tool when Policies require a guest or postcode on sale.",
      },
    ],
  },
  {
    id: "cart",
    title: "Cart & discount",
    plain:
      "The dark Cart header shows item count and subtotal. Lines list qty × name. Discount code applies a code created under Setup → Tools.",
    fields: [
      {
        name: "Cart lines / Remove",
        how: "Each line is on the current open cart. Remove deletes that line and updates the total.",
      },
      {
        name: "Discount code",
        how: "Optional. Enter a saved POS code before paying. Manager PIN may be required by policy.",
      },
      {
        name: "Postcode",
        how: "Shows when capture/required is on in Policies. Fill it before checkout if required.",
      },
    ],
  },
  {
    id: "pay",
    title: "Tips & payment",
    plain:
      "Amount due = cart subtotal + tip. Choose a tip chip, then Cash or Card. Gift card needs a gift code first. Pay link emails/opens a Stripe link for the guest.",
    fields: [
      {
        name: "Tip chips",
        how: "15% / 18% / 20% or No tip. Tip percents come from Policies.",
      },
      {
        name: "Cash",
        how: "Records a cash tender. Usually needs an open till on this device.",
      },
      {
        name: "Card",
        how: "Starts in-browser card confirm (Stripe Elements). Finish the card modal before walking away.",
      },
      {
        name: "Gift card / Pay link / Split",
        how: "Enter gift code then Gift card. Pay link creates a URL. Split tender mixes amounts (manager PIN may apply).",
      },
    ],
    elsewhere: [
      {
        label: "Sales history",
        action: "sales",
        note: "Find completed sales and resume unpaid card confirms.",
      },
    ],
    tip: "After a successful pay, the cart clears and a new empty cart opens for the next guest.",
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenSetup?: () => void;
  onOpenTills?: () => void;
  onOpenSales?: () => void;
  onOpenGuest?: () => void;
};

export default function PosSellGuideModal({
  open,
  onClose,
  onOpenSetup,
  onOpenTills,
  onOpenSales,
  onOpenGuest,
}: Props) {
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
      aria-label="Sell checkout guide"
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
              <h2 className="font-serif text-xl">Checkout guide</h2>
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
              {current.elsewhere?.map((e) => {
                const openAction =
                  e.action === "setup"
                    ? onOpenSetup
                    : e.action === "tills"
                      ? onOpenTills
                      : e.action === "sales"
                        ? onOpenSales
                        : e.action === "guest"
                          ? onOpenGuest
                          : undefined;
                return (
                  <div
                    key={e.label}
                    className="rounded-xl border border-dashed border-[#D4AF37]/50 bg-[#D4AF37]/10 px-3 py-2.5"
                  >
                    <p className="text-sm font-semibold text-stone-900">{e.label}</p>
                    <p className="mt-1 text-sm text-stone-700">{e.note}</p>
                    {openAction ? (
                      <button
                        type="button"
                        className="mt-2 inline-flex text-sm font-semibold text-[#6b5a12] underline"
                        onClick={() => {
                          onClose();
                          openAction();
                        }}
                      >
                        Open →
                      </button>
                    ) : null}
                  </div>
                );
              })}
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
              Got it — start selling
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
