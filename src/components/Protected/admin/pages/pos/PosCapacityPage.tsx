"use client";

import Link from "next/link";
import PosCapacityPanel from "./PosCapacityPanel";
import { usePosParkScope } from "./usePosParkScope";

export default function PosCapacityPage() {
  const { locationId, setLocationId, venues, parkLocked, venuesLoading } =
    usePosParkScope();

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50">
      <header className="flex gap-3 border-b border-stone-200 bg-white px-4 py-3">
        <Link href="/admin/pos" className="text-sm text-stone-600">
          ← Terminal
        </Link>
        <Link href="/admin" className="text-sm text-stone-600">
          Admin
        </Link>
        <select
          className="ml-auto rounded-lg border border-stone-300 px-2 py-1 text-sm"
          value={locationId}
          disabled={parkLocked && venues.length <= 1}
          onChange={(e) => setLocationId(e.target.value)}
        >
          {!locationId ? <option value="">Select park</option> : null}
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </header>
      {locationId ? (
        <PosCapacityPanel locationId={locationId} />
      ) : (
        <p className="p-4 text-sm text-stone-600">
          {venuesLoading
            ? "Loading parks…"
            : venues.length
              ? "Select a park to view capacity."
              : "Create a park under Venues first."}
        </p>
      )}
    </div>
  );
}
