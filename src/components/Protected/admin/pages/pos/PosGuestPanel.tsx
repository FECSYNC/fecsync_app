"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  createPosGuest,
  searchPosGuests,
  type PosGuestDto,
} from "@/services/pos";
import PosGuestGuideModal from "./PosGuestGuideModal";
import { emitPosEvent } from "./posEvents";

export type AttachedGuest = {
  id: string;
  banned: boolean;
  postalCode: string;
  label: string;
};

type Props = {
  locationId: string;
  attachedGuestId: string | null;
  parkName?: string;
  requireGuest?: boolean;
  onAttached: (guest: AttachedGuest) => void;
  onCleared: () => void;
  onDone?: () => void;
};

const field =
  "w-full rounded-xl bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55";

function Section({
  title,
  children,
  delay = 0,
}: {
  title: string;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm shadow-stone-900/5"
    >
      <div className="border-b border-stone-100 bg-gradient-to-r from-stone-50 to-white px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-wide text-stone-900">{title}</h2>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </motion.section>
  );
}

function guestLabel(g: PosGuestDto) {
  const name = `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim() || "Guest";
  return name;
}

export default function PosGuestPanel({
  locationId,
  attachedGuestId,
  parkName,
  requireGuest,
  onAttached,
  onCleared,
  onDone,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosGuestDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<"attach" | "create" | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [attachedLabel, setAttachedLabel] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const searchGen = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const gen = ++searchGen.current;
    setSearching(true);
    const t = window.setTimeout(() => {
      searchPosGuests(q)
        .then((r) => {
          if (gen !== searchGen.current) return;
          setResults(r.guests ?? []);
          setError("");
        })
        .catch((e: Error) => {
          if (gen !== searchGen.current) return;
          setError(e.message);
          setResults([]);
        })
        .finally(() => {
          if (gen === searchGen.current) setSearching(false);
        });
    }, 280);
    return () => window.clearTimeout(t);
  }, [query]);

  function attach(g: PosGuestDto) {
    setBusy("attach");
    setError("");
    try {
      const label = guestLabel(g);
      onAttached({
        id: g.id,
        banned: Boolean(g.bannedAt),
        postalCode: g.postalCode ?? "",
        label,
      });
      setAttachedLabel(label);
      setNote(
        g.bannedAt
          ? `${label} attached — banned guest; manager may be required at pay.`
          : `${label} attached to this sale.`
      );
      setQuery("");
      setResults([]);
      emitPosEvent("pos:guest", { locationId });
      window.setTimeout(() => onDone?.(), 420);
    } finally {
      setBusy(null);
    }
  }

  async function createWalkIn() {
    setBusy("create");
    setError("");
    try {
      const { guest } = await createPosGuest({
        locationId: locationId || undefined,
        firstName: "Walk-in",
        lastName: "Guest",
        email: `walkin+${Date.now()}@pos.local`,
      });
      const label = guestLabel(guest);
      onAttached({
        id: guest.id,
        banned: Boolean(guest.bannedAt),
        postalCode: guest.postalCode ?? "",
        label,
      });
      setAttachedLabel(label);
      setNote(`${label} created and attached.`);
      emitPosEvent("pos:guest", { locationId });
      window.setTimeout(() => onDone?.(), 420);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create guest");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {parkName ? (
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600 ring-1 ring-stone-200">
              {parkName}
            </span>
          ) : null}
          {requireGuest ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200">
              Guest required
            </span>
          ) : null}
          {attachedGuestId ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">
              Attached
            </span>
          ) : (
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-500 ring-1 ring-stone-200">
              No guest
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="rounded-full bg-[#D4AF37] px-3.5 py-1.5 text-[11px] font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25"
        >
          Guide
        </button>
      </div>

      <AnimatePresence mode="wait">
        {error ? (
          <motion.p
            key={error}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-800"
          >
            {error}
          </motion.p>
        ) : null}
        {note ? (
          <motion.p
            key={note}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900"
          >
            {note}
          </motion.p>
        ) : null}
      </AnimatePresence>

      {attachedGuestId ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-[#D4AF37]/40 bg-gradient-to-br from-[#D4AF37]/10 to-white px-4 py-3"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#A6892A]">
            On this sale
          </p>
          <p className="mt-1 font-serif text-lg text-stone-900">
            {attachedLabel || `Guest ${attachedGuestId.slice(0, 10)}…`}
          </p>
          <button
            type="button"
            className="mt-2 text-xs font-medium text-stone-600 underline"
            onClick={() => {
              onCleared();
              setAttachedLabel("");
              setNote("Guest cleared from this sale.");
              emitPosEvent("pos:guest", { locationId });
            }}
          >
            Clear guest
          </button>
        </motion.div>
      ) : null}

      <Section title="Find a guest">
        <label className="block text-[11px] font-medium text-stone-500">
          Name, email, or phone
          <input
            ref={inputRef}
            className={`${field} mt-1`}
            placeholder="Search name, email, phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="flex items-center justify-between gap-2 text-[11px] text-stone-400">
          <span>
            {searching
              ? "Searching…"
              : query.trim().length < 2
                ? "Type at least 2 characters"
                : `${results.length} match${results.length === 1 ? "" : "es"}`}
          </span>
          {searching ? (
            <span
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-300 border-t-[#D4AF37]"
              aria-hidden
            />
          ) : null}
        </div>

        <AnimatePresence mode="popLayout">
          {results.length ? (
            <motion.ul
              layout
              className="max-h-52 space-y-1 overflow-y-auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {results.map((g, i) => (
                <motion.li
                  key={g.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.2) }}
                >
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => attach(g)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2.5 text-left ring-1 ring-stone-200 transition hover:ring-[#D4AF37]/60 disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-stone-900">
                        {guestLabel(g)}
                        {g.bannedAt ? (
                          <span className="ml-1.5 text-[10px] font-semibold uppercase text-red-700">
                            banned
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-[11px] text-stone-500">
                        {[g.email, g.phone].filter(Boolean).join(" · ") || "No contact on file"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-[#8a7320]">Attach</span>
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          ) : query.trim().length >= 2 && !searching ? (
            <p className="rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-3 py-5 text-center text-xs text-stone-500">
              No guests matched — try another spelling or create a walk-in.
            </p>
          ) : null}
        </AnimatePresence>
      </Section>

      <Section title="Walk-in" delay={0.05}>
        <p className="text-xs text-stone-500">
          No profile yet? Create a walk-in guest and attach them in one step.
        </p>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => createWalkIn()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-55"
        >
          {busy === "create" ? (
            <>
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                aria-hidden
              />
              Creating…
            </>
          ) : (
            "Quick-create walk-in guest"
          )}
        </button>
      </Section>

      <PosGuestGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
