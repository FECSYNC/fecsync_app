"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listPosDevices } from "@/services/pos";
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
import { getPosStation, setPosStation } from "./posStation";
import { usePosParkScope } from "./usePosParkScope";

export default function PosTillsPage() {
  const {
    locationId,
    setLocationId,
    venues,
    parkLocked,
    venuesLoading,
  } = usePosParkScope();
  const [deviceId, setDeviceId] = useState(() => getPosStation()?.deviceId ?? "");
  const [devices, setDevices] = useState<Array<{ id: string; name: string }>>([]);
  const [tills, setTills] = useState<PosTillDto[]>([]);
  const [showExpectedSetting, setShowExpectedSetting] = useState(true);
  const [floatAmt, setFloatAmt] = useState("200");
  const [counted, setCounted] = useState("");
  const [moveAmt, setMoveAmt] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [moveKind, setMoveKind] = useState<"cash_in" | "cash_out">("cash_in");
  const [editReason, setEditReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const openTill = tills.find((t) => t.deviceId === deviceId && t.status === "open");

  function refresh() {
    listPosTills()
      .then((r) => setTills(r.tills ?? []))
      .catch((e: Error) => setError(e.message));
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!locationId) return;
    getPosSettings(locationId).then((r) => setShowExpectedSetting(r.settings.showExpectedTillTotals));
    listPosDevices(locationId).then((r) => setDevices(r.devices.filter((d) => !d.archivedAt).map((d) => ({ id: d.id, name: d.name }))));
  }, [locationId]);

  async function onOpen() {
    setError("");
    await openPosTill({
      locationId,
      deviceId,
      openingFloat: parseFloat(floatAmt) || 0,
    });
    setMessage("Till opened.");
    refresh();
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50">
      <header className="flex flex-wrap gap-3 border-b border-stone-200 bg-white px-4 py-3">
        <Link href="/admin/pos" className="text-sm text-stone-600">
          ← Terminal
        </Link>
        <select
          value={locationId}
          className="rounded border px-2 py-1 text-sm"
          disabled={parkLocked && venues.length <= 1}
          onChange={(e) => setLocationId(e.target.value)}
        >
          {!locationId ? (
            <option value="">
              {venuesLoading ? "Loading parks…" : "Select park"}
            </option>
          ) : null}
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <select
          value={deviceId}
          className="rounded border px-2 py-1 text-sm"
          onChange={(e) => {
            setDeviceId(e.target.value);
            setPosStation({ deviceId: e.target.value });
          }}
        >
          <option value="">Device</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </header>
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <h1 className="text-xl font-semibold text-stone-900">Tills</h1>
        {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {!locationId ? (
          <p className="text-sm text-stone-600">
            {venuesLoading
              ? "Loading parks…"
              : venues.length
                ? "Select a park for tills."
                : "Create a park under Venues first."}
          </p>
        ) : !openTill ? (
          <div className="rounded-xl border border-stone-200 bg-white p-4 text-sm">
            <h2 className="font-semibold">Open till</h2>
            <input className="mt-2 w-full rounded border px-2 py-1" value={floatAmt} onChange={(e) => setFloatAmt(e.target.value)} />
            <button type="button" className="mt-2 rounded-lg bg-[#D4AF37] px-3 py-2 font-semibold text-stone-900" onClick={() => onOpen().catch((e: Error) => setError(e.message))}>
              Open with float
            </button>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 text-sm">
            <p>Open till on this device</p>
            {(showExpectedSetting || openTill.expectedCash != null) && openTill.expectedCash != null ? (
              <p className="font-medium">Expected cash: ${openTill.expectedCash.toFixed(2)}</p>
            ) : openTill.expectedCash == null && !showExpectedSetting ? (
              <p className="text-stone-500">Expected total hidden by settings.</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <select value={moveKind} onChange={(e) => setMoveKind(e.target.value as "cash_in" | "cash_out")} className="rounded border px-2">
                <option value="cash_in">Cash in</option>
                <option value="cash_out">Cash out</option>
              </select>
              <input className="rounded border px-2" value={moveAmt} onChange={(e) => setMoveAmt(e.target.value)} placeholder="Amount" />
              <input
                className="min-w-[10rem] flex-1 rounded border px-2"
                value={moveReason}
                onChange={(e) => setMoveReason(e.target.value)}
                placeholder="Reason (required)"
              />
              <button
                type="button"
                className="rounded border px-3"
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
                      refresh();
                    })
                    .catch((e: Error) => setError(e.message));
                }}
              >
                Record
              </button>
            </div>
            <input className="w-full rounded border px-2 py-1" placeholder="Counted cash" value={counted} onChange={(e) => setCounted(e.target.value)} />
            <button
              type="button"
              className="rounded-lg bg-stone-900 px-3 py-2 text-white"
              onClick={() =>
                closePosTill(openTill.id, {
                  countedCash: parseFloat(counted) || 0,
                  locationId,
                })
                  .then(() => {
                    setMessage("Till closed with count.");
                    refresh();
                  })
                  .catch((e: Error) => setError(e.message))
              }
            >
              Close with count
            </button>
            <button
              type="button"
              className="ml-2 rounded-lg border border-stone-300 px-3 py-2"
              onClick={() =>
                closePosTillNoCount(openTill.id, { locationId })
                  .then(() => refresh())
                  .catch((e: Error) => setError(e.message))
              }
            >
              Close without count
            </button>
          </div>
        )}
        <ul className="divide-y rounded-xl border border-stone-200 bg-white text-sm">
          {tills.slice(0, 20).map((t) => (
            <li key={t.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span>
                {t.status} · device {t.deviceId.slice(0, 6)}
              </span>
              {t.expectedCash != null ? <span>Expected ${t.expectedCash.toFixed(2)}</span> : null}
              {t.status.startsWith("closed") ? (
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() =>
                    editPosTill(t.id, {
                      editReason: editReason || "Correction",
                      countedCash: parseFloat(counted) || undefined,
                      locationId,
                    })
                      .then(() => refresh())
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  Edit
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <input
          className="w-full rounded border px-2 py-1 text-sm"
          placeholder="Edit reason (required for closed session edit)"
          value={editReason}
          onChange={(e) => setEditReason(e.target.value)}
        />
      </div>
    </div>
  );
}
