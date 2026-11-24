"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getPosAvailability, reschedulePosBooking } from "@/services/pos";
import PosCapacityGuideModal from "./PosCapacityGuideModal";
import { emitPosEvent, onPosEvent } from "./posEvents";

type SessionRow = {
  id: string;
  label: string | null;
  startsAt: string;
  endsAt: string;
  remaining: number;
  capacity: number;
  isClosed: boolean;
};

type Props = {
  locationId: string;
  compact?: boolean;
  parkName?: string;
  /** Fired after reschedule so the sell pad session list stays in sync. */
  onChanged?: () => void;
};

const field =
  "w-full rounded-xl bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55";
const primaryBtn =
  "rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25 transition hover:brightness-105 disabled:opacity-45";
const softBtn =
  "rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-stone-800 ring-1 ring-stone-200 transition hover:ring-[#D4AF37]/60";

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

function seatTone(remaining: number, capacity: number, closed: boolean) {
  if (closed || remaining <= 0) return "bg-red-50 text-red-800 ring-red-200";
  const ratio = capacity > 0 ? remaining / capacity : 0;
  if (ratio <= 0.2) return "bg-amber-50 text-amber-900 ring-amber-200";
  return "bg-emerald-50 text-emerald-800 ring-emerald-200";
}

function fillPct(remaining: number, capacity: number) {
  if (capacity <= 0) return 0;
  const sold = Math.max(0, capacity - remaining);
  return Math.min(100, Math.round((sold / capacity) * 100));
}

export default function PosCapacityPanel({
  locationId,
  compact,
  parkName,
  onChanged,
}: Props) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [resources, setResources] = useState<Array<{ id: string; name: string; remaining?: number }>>(
    []
  );
  const [bookingId, setBookingId] = useState("");
  const [targetSession, setTargetSession] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const load = useCallback(
    (silent = false) => {
      if (!locationId) return;
      if (!silent) setLoading(true);
      getPosAvailability(locationId)
        .then((data) => {
          setSessions(
            (data.sessions ?? []).map((s) => ({
              id: s.id,
              label: s.label,
              startsAt: s.startsAt,
              endsAt: s.endsAt,
              remaining: s.remaining,
              capacity: s.capacity,
              isClosed: Boolean(s.closed ?? s.isClosed),
            }))
          );
          setResources(data.resources ?? []);
          setLastSync(new Date());
          setError("");
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    },
    [locationId]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!locationId) return;
    const onFocus = () => load(true);
    window.addEventListener("focus", onFocus);
    const poll = window.setInterval(() => load(true), 25_000);
    const unsub = onPosEvent(["pos:checkin", "pos:sale", "pos:tab"], (detail) => {
      if (detail.locationId && detail.locationId !== locationId) return;
      load(true);
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(poll);
      unsub();
    };
  }, [locationId, load]);

  async function reschedule() {
    setError("");
    setMessage("");
    if (!bookingId.trim() || !targetSession) {
      setError("Enter a booking id and choose a session with seats.");
      return;
    }
    setBusy(true);
    try {
      await reschedulePosBooking(bookingId.trim(), {
        locationId,
        sessionId: targetSession,
      });
      setMessage("Booking rescheduled — seats updated for Sell and Check-in.");
      setTargetSession("");
      load(true);
      emitPosEvent("pos:capacity", { locationId });
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reschedule failed");
    } finally {
      setBusy(false);
    }
  }

  const selectable = sessions.filter((s) => !s.isClosed && s.remaining > 0);
  const openCount = sessions.filter((s) => !s.isClosed).length;
  const tightCount = sessions.filter(
    (s) => !s.isClosed && s.remaining > 0 && s.capacity > 0 && s.remaining / s.capacity <= 0.2
  ).length;

  return (
    <div className={compact ? "space-y-3" : "mx-auto max-w-3xl space-y-4 px-4 py-6"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!compact ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6892A]">
              Sessions
            </p>
            <h1 className="font-serif text-2xl text-stone-900">Capacity</h1>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {parkName ? (
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600 ring-1 ring-stone-200">
                {parkName}
              </span>
            ) : null}
            <span className="rounded-full bg-[#D4AF37]/15 px-2.5 py-1 text-[11px] font-medium tabular-nums text-[#6b5a12] ring-1 ring-[#D4AF37]/35">
              {openCount} open
            </span>
            {tightCount ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200">
                {tightCount} low
              </span>
            ) : null}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={softBtn} onClick={() => load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="rounded-full bg-[#D4AF37] px-3.5 py-1.5 text-[11px] font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25"
          >
            Guide
          </button>
        </div>
      </div>

      {lastSync ? (
        <p className="text-[10px] text-stone-400">
          Synced {lastSync.toLocaleTimeString()} · auto-refreshes about every 25s
        </p>
      ) : null}

      <AnimatePresence mode="wait">
        {error ? (
          <motion.p
            key={error}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </motion.p>
        ) : null}
        {message ? (
          <motion.p
            key={message}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          >
            {message}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <Section title="Sessions">
        {loading && !sessions.length ? (
          <div className="grid gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-stone-100" />
            ))}
          </div>
        ) : sessions.length ? (
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {sessions.map((s, i) => {
              const pct = fillPct(s.remaining, s.capacity);
              return (
                <motion.li
                  key={s.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.24) }}
                  className="rounded-xl bg-stone-50/90 px-3 py-2.5 ring-1 ring-stone-200/80"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-stone-900">
                        {s.label ?? s.id.slice(0, 8)}
                      </p>
                      <p className="text-[11px] text-stone-500">
                        {new Date(s.startsAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ${seatTone(
                        s.remaining,
                        s.capacity,
                        s.isClosed
                      )}`}
                    >
                      {s.isClosed ? "Closed" : `${s.remaining} / ${s.capacity}`}
                    </span>
                  </div>
                  {!s.isClosed && s.capacity > 0 ? (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200/80">
                      <motion.div
                        className="h-full rounded-full bg-[#D4AF37]"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.4 }}
                      />
                    </div>
                  ) : null}
                </motion.li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-4 py-8 text-center">
            <p className="font-serif text-lg text-stone-900">No upcoming sessions</p>
            <p className="mt-1 text-xs text-stone-500">
              Create timed sessions in Ticketing for this park, then refresh.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Link
                href="/admin/ticketing/sessions"
                className="rounded-full bg-stone-900 px-4 py-2 text-xs font-semibold text-white"
              >
                Open sessions
              </Link>
              <button
                type="button"
                className="text-xs font-semibold text-[#8a7320] underline"
                onClick={() => setGuideOpen(true)}
              >
                Guide
              </button>
            </div>
          </div>
        )}
      </Section>

      {resources.length ? (
        <Section title="Resources" delay={0.04}>
          <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl ring-1 ring-stone-200/70">
            {resources.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 px-3 py-2.5 text-sm text-stone-700">
                <span className="font-medium text-stone-900">{r.name}</span>
                {r.remaining != null ? (
                  <span className="tabular-nums text-stone-500">{r.remaining} left</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Reschedule booking" delay={0.06}>
        <label className="block text-[11px] font-medium text-stone-500">
          Booking id or public id
          <input
            className={`${field} mt-1`}
            placeholder="Booking id"
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
          />
        </label>
        <label className="block text-[11px] font-medium text-stone-500">
          Move to session
          <select
            className={`${field} mt-1`}
            value={targetSession}
            onChange={(e) => setTargetSession(e.target.value)}
          >
            <option value="">Choose session with seats</option>
            {selectable.map((s) => (
              <option key={s.id} value={s.id}>
                {(s.label ?? s.id.slice(0, 8)) + ` · ${s.remaining} left`}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || !bookingId.trim() || !targetSession}
          onClick={() => reschedule()}
        >
          {busy ? "Moving…" : "Reschedule"}
        </button>
      </Section>

      <PosCapacityGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
