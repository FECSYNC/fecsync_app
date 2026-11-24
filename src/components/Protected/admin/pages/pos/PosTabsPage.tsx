"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getPosStation } from "./posStation";
import PosTabsPanel from "./PosTabsPanel";
import { settlePosCardFromStripeReturn } from "./posCardReturn";
import { usePosParkScope } from "./usePosParkScope";

/** Standalone /admin/pos/tabs route — mirrors terminal modal with park picker. */
export default function PosTabsPage() {
  const { locationId, setLocationId, venues, parkLocked, venuesLoading } =
    usePosParkScope();
  const [deviceId] = useState(() => getPosStation()?.deviceId ?? "");
  const [note, setNote] = useState("");

  useEffect(() => {
    void settlePosCardFromStripeReturn().then((message) => {
      if (message) setNote(message);
    });
  }, []);

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50">
      <header className="flex flex-wrap gap-3 border-b border-stone-200 bg-white px-4 py-3">
        <Link href="/admin/pos" className="text-sm text-stone-600">
          ← Terminal
        </Link>
        <select
          className="rounded-lg border border-stone-300 px-2 py-1 text-sm"
          value={locationId}
          disabled={parkLocked && venues.length <= 1}
          onChange={(e) => setLocationId(e.target.value)}
        >
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </header>
      <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <h1 className="text-xl font-semibold text-stone-900">Guest tabs</h1>
        {note ? <p className="text-sm text-stone-600">{note}</p> : null}
        {locationId ? (
          <PosTabsPanel locationId={locationId} deviceId={deviceId} />
        ) : (
          <p className="text-sm text-stone-600">
            {venuesLoading
              ? "Loading parks…"
              : venues.length
                ? "Select a park for guest tabs."
                : "Create a park under Venues first."}
          </p>
        )}
      </div>
    </div>
  );
}
