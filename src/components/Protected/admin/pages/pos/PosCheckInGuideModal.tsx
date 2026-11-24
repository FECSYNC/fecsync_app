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
    title: "What check-in is for",
    plain:
      "Check-in is the gate tool. Guests arrive with a ticket code, membership ID, QR, or NFC tag. You scan or type it here to redeem their entry. This is not where tickets are sold — selling happens on the Sell tab.",
    bullets: [
      "Always pick a park first (header or the park picker in this window).",
      "Then scan / type a code and press Redeem.",
      "Use Membership lookup when you need to confirm a photo before redeeming.",
    ],
    tip: "If you see “select a park”, nothing is wrong with check-in — the station just needs a park context.",
  },
  {
    id: "before",
    title: "Create these before guests arrive",
    plain:
      "Check-in redeems things that already exist. If redeem fails with “not found”, create the ticket or membership elsewhere first, then come back.",
    elsewhere: [
      {
        label: "Park (venue)",
        href: "/admin/venues",
        note: "Create the site under Venues. Then select it on the terminal header so check-in knows which park’s tickets to redeem.",
      },
      {
        label: "Tickets & sessions",
        href: "/admin/ticketing",
        note: "Online / desk tickets are sold or issued from Ticketing. Guests bring that ticket code (or QR) to this screen.",
      },
      {
        label: "Memberships",
        href: "/admin/memberships/members",
        note: "Issue or look up guest memberships under Memberships. Then use Membership lookup here to confirm the guest photo.",
      },
      {
        label: "Waivers",
        href: "/admin/waivers",
        note: "Guests sign waivers on the waiver desk / kiosk — not inside check-in. Use the Waivers search here only to verify status.",
      },
    ],
  },
  {
    id: "scan",
    title: "How to redeem a ticket",
    plain:
      "Focus the code field (it focuses automatically). Scan with a barcode wedge, camera QR, NFC tag, or type the code. Press Redeem. Success clears the field so you are ready for the next guest.",
    fields: [
      {
        name: "Code field",
        how: "Ticket public code, QR payload, membership id, or NFC text. Keep the cursor here for continuous scanning.",
      },
      {
        name: "Redeem",
        how: "Sends the code for this park. If the visit is late or needs override, you will be asked for a manager PIN.",
      },
      {
        name: "Camera QR",
        how: "Turns on the device camera. Supported browsers auto-detect barcodes; otherwise type or use a wedge scanner.",
      },
      {
        name: "NFC",
        how: "On supported Chrome/Android devices, tapping a tag fills the code field. No extra button needed when NFC is armed.",
      },
    ],
    tip: "Manager PIN overrides are for past-date or late redemptions when policy requires them — set the PIN under POS Setup → Policies.",
  },
  {
    id: "membership",
    title: "Membership lookup & photo check",
    plain:
      "Type or scan a membership identifier, then Membership lookup. Confirm the photo matches the guest before Confirm & redeem. Print card opens a simple printable badge with a QR.",
    fields: [
      {
        name: "Membership lookup",
        how: "Loads name, photo, and ids for the code in the field — does not redeem until you confirm.",
      },
      {
        name: "Confirm & redeem",
        how: "Uses one visit / admission from that membership for this park.",
      },
    ],
  },
  {
    id: "waivers-custom",
    title: "Waivers search & custom ticket IDs",
    plain:
      "Waivers search checks whether a guest already signed. Custom IDs let you map an internal credential to a guest-facing ticket id for printing or scanners.",
    fields: [
      {
        name: "Guest email or booking id",
        how: "Search text for waiver records tied to this park. Results show status and expiry.",
      },
      {
        name: "Credential id / Custom ticket id",
        how: "Advanced desk mapping. Fill both, then Save. Only needed if your park prints custom ticket numbers.",
      },
    ],
    elsewhere: [
      {
        label: "Waiver desk",
        href: "/admin/waivers",
        note: "Send guests here (or to the waiver kiosk) to sign. Check-in only verifies — it does not collect signatures.",
      },
    ],
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function PosCheckInGuideModal({ open, onClose }: Props) {
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
      aria-label="Check-in guide"
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
              <h2 className="font-serif text-xl">Check-in guide</h2>
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
            <motion.div
              className="h-full rounded-full bg-[#D4AF37]"
              animate={{ width: `${progress}%` }}
            />
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
