"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  addPosTillMovement,
  closePosTill,
  closePosTillNoCount,
  editPosTill,
  getPosSettings,
  listPosTills,
  openPosTill,
  type PosTillDto,
} from "@/services/pos";
import { emitPosEvent, onPosEvent } from "./posEvents";
import PosToolShell from "./PosToolShell";
import { posDarkBtn, posField, posPrimaryBtn } from "./posUi";
import Link from "next/link";
import { useAccountingSourceEntriesQuery } from "@/hooks/useAccounting";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";

function TillCloseJournalLink({ tillSessionId }: { tillSessionId: string }) {
  const can = useAuthStore((s) => s.can);
  const q = useAccountingSourceEntriesQuery(
    "till_close",
    tillSessionId,
    can(P.AccountingRead)
  );
  const rows =
    ((
      (q.data as { entries?: { id: string }[] } | undefined)?.entries ??
      (q.data as { items?: { id: string }[] } | undefined)?.items
    ) as { id: string }[] | undefined) ?? [];
  const entryId = rows[0]?.id;
  if (!entryId) return null;
  return (
    <p className="text-xs text-stone-600">
      Variance journal{" "}
      <Link
        href={`/admin/accounting/journals/${entryId}`}
        className="font-medium text-[#8a7320] underline"
      >
        View entry
      </Link>
    </p>
  );
}

type Props = {
  locationId: string;
  deviceId: string;
  parkName?: string;
  /** Reports whether this device currently has an open till (no parent re-fetch). */
  onTillOpenChange?: (open: boolean) => void;
};

export default function PosTillsPanel({
  locationId,
  deviceId,
  parkName,
  onTillOpenChange,
}: Props) {
  const [tills, setTills] = useState<PosTillDto[]>([]);
  const [closedTillJournalId, setClosedTillJournalId] = useState<string | null>(null);
  const [showExpectedSetting, setShowExpectedSetting] = useState(true);
  const [floatAmt, setFloatAmt] = useState("200");
  const [counted, setCounted] = useState("");
  const [moveAmt, setMoveAmt] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [moveKind, setMoveKind] = useState<"cash_in" | "cash_out">("cash_in");
  const [editReason, setEditReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const onTillOpenChangeRef = useRef(onTillOpenChange);
  onTillOpenChangeRef.current = onTillOpenChange;

  const openTill = tills.find((t) => t.deviceId === deviceId && t.status === "open");

  const refresh = useCallback(() => {
    listPosTills()
      .then((r) => {
        const rows = r.tills ?? [];
        setTills(rows);
        onTillOpenChangeRef.current?.(
          rows.some((t) => t.deviceId === deviceId && t.status === "open")
        );
      })
      .catch((e: Error) => setError(e.message));
  }, [deviceId]);

  useEffect(() => {
    refresh();
  }, [refresh, locationId, deviceId]);

  useEffect(() => {
    if (!locationId) return;
    getPosSettings(locationId)
      .then((r) => setShowExpectedSetting(r.settings.showExpectedTillTotals))
      .catch(() => undefined);
  }, [locationId]);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    const unsub = onPosEvent(
      ["pos:sale", "pos:tab", "pos:station", "pos:till"],
      (detail) => {
        if (detail.deviceId && detail.deviceId !== deviceId) return;
        if (detail.locationId && detail.locationId !== locationId) return;
        refresh();
      }
    );
    return () => {
      window.removeEventListener("focus", onFocus);
      unsub();
    };
  }, [refresh, deviceId, locationId]);

  function bumpTill() {
    // Refresh local list first, then broadcast so sister tabs/header catch up.
    refresh();
    emitPosEvent("pos:till", { locationId, deviceId });
  }

  async function onOpen() {
    if (!locationId || !deviceId) {
      setError("Select a park and device on the terminal first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await openPosTill({
        locationId,
        deviceId,
        openingFloat: parseFloat(floatAmt) || 0,
      });
      setMessage("Till opened — cash sales are unlocked.");
      bumpTill();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open till");
    } finally {
      setBusy(false);
    }
  }

  if (!deviceId) {
    return (
      <div className="rounded-2xl border border-dashed border-amber-300/80 bg-gradient-to-br from-amber-50 to-white px-5 py-8 text-center">
        <p className="font-serif text-lg text-stone-900">Choose a device</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
          Tills follow the terminal device. Pick one in the header, or register a station in Setup.
        </p>
      </div>
    );
  }

  return (
    <PosToolShell
      title="Tills"
      parkName={parkName}
      meta={
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${
            openTill
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-stone-100 text-stone-600 ring-stone-200"
          }`}
        >
          {openTill ? "Drawer open" : "Drawer closed"}
        </span>
      }
      onRefresh={refresh}
    >
      <div className="space-y-3 text-sm">
      <AnimatePresence mode="wait">
        {error ? (
          <motion.p
            key={error}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-800"
          >
            {error}
          </motion.p>
        ) : null}
        {message ? (
          <motion.p
            key={message}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900"
          >
            {message}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
        <div className="border-b border-stone-100 bg-gradient-to-r from-stone-50 to-white px-4 py-2.5">
          <h2 className="text-sm font-semibold text-stone-900">
            {openTill ? "Open till" : "Open a till"}
          </h2>
        </div>
        <div className="space-y-3 p-4">
          {!openTill ? (
            <>
              <label className="block text-[11px] font-medium text-stone-500">
                Opening float
                <input
                  className={`${posField} mt-1`}
                  value={floatAmt}
                  onChange={(e) => setFloatAmt(e.target.value)}
                />
              </label>
              <button
                type="button"
                className={posPrimaryBtn}
                disabled={busy}
                onClick={() => onOpen()}
              >
                {busy ? "Opening…" : "Open with float"}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-stone-500">Cash drawer is open on this device.</p>
              {(showExpectedSetting || openTill.expectedCash != null) && openTill.expectedCash != null ? (
                <p className="font-semibold tabular-nums text-stone-900">
                  Expected cash: ${openTill.expectedCash.toFixed(2)}
                </p>
              ) : !showExpectedSetting ? (
                <p className="text-stone-500">Expected total hidden by settings.</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <select
                  value={moveKind}
                  onChange={(e) => setMoveKind(e.target.value as "cash_in" | "cash_out")}
                  className="rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-200"
                >
                  <option value="cash_in">Cash in</option>
                  <option value="cash_out">Cash out</option>
                </select>
                <input
                  className="w-24 rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-200"
                  value={moveAmt}
                  onChange={(e) => setMoveAmt(e.target.value)}
                  placeholder="Amount"
                />
                <input
                  className="min-w-[8rem] flex-1 rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-200"
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  placeholder="Reason (required)"
                />
                <button
                  type="button"
                  className="rounded-xl bg-white px-3 py-2 font-medium ring-1 ring-stone-200"
                  onClick={() => {
                    if (!moveReason.trim()) {
                      setError("Reason is required for cash in/out.");
                      return;
                    }
                    addPosTillMovement(openTill.id, {
                      kind: moveKind,
                      amount: parseFloat(moveAmt) || 0,
                      reason: moveReason.trim(),
                      locationId,
                    })
                      .then(() => {
                        setMoveReason("");
                        setMoveAmt("");
                        setMessage("Movement recorded.");
                        bumpTill();
                      })
                      .catch((e: Error) => setError(e.message));
                  }}
                >
                  Record
                </button>
              </div>
              <input
                className={posField}
                placeholder="Counted cash"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={posDarkBtn}
                  onClick={() =>
                    closePosTill(openTill.id, {
                      countedCash: parseFloat(counted) || 0,
                      locationId,
                    })
                      .then(() => {
                        setMessage("Till closed with count.");
                        setClosedTillJournalId(openTill.id);
                        bumpTill();
                      })
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  Close with count
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-white px-4 py-2.5 font-medium ring-1 ring-stone-200"
                  onClick={() =>
                    closePosTillNoCount(openTill.id, { locationId })
                      .then(() => {
                        setMessage("Till closed.");
                        bumpTill();
                      })
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  Close without count
                </button>
              </div>
              {closedTillJournalId ? (
                <TillCloseJournalLink tillSessionId={closedTillJournalId} />
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
        <div className="border-b border-stone-100 bg-gradient-to-r from-stone-50 to-white px-4 py-2.5">
          <h2 className="text-sm font-semibold text-stone-900">Recent tills</h2>
        </div>
        <ul className="max-h-48 divide-y divide-stone-100 overflow-y-auto text-sm">
          {tills.slice(0, 20).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="text-stone-700">
                {t.status} · {t.deviceId.slice(0, 8)}…
              </span>
              {t.expectedCash != null ? (
                <span className="tabular-nums text-stone-500">${t.expectedCash.toFixed(2)}</span>
              ) : null}
              {t.status.startsWith("closed") ? (
                <button
                  type="button"
                  className="text-xs font-medium text-[#8a7320] underline"
                  onClick={() =>
                    editPosTill(t.id, {
                      editReason: editReason || "Correction",
                      countedCash: parseFloat(counted) || undefined,
                      locationId,
                    })
                      .then(() => bumpTill())
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  Edit
                </button>
              ) : null}
            </li>
          ))}
          {!tills.length ? (
            <li className="px-4 py-6 text-center text-xs text-stone-400">No till sessions yet.</li>
          ) : null}
        </ul>
        <div className="border-t border-stone-100 p-3">
          <input
            className={posField}
            placeholder="Edit reason (for closed session edit)"
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
          />
        </div>
      </div>
      </div>
    </PosToolShell>
  );
}
