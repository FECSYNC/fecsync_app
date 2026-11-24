"use client";

import Link from "next/link";
import PosCheckInPanel from "./PosCheckInPanel";
import { usePosParkScope } from "./usePosParkScope";

export default function PosCheckInPage() {
  const { locationId, setLocationId, venues, parkLocked, venuesLoading } =
    usePosParkScope();

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50">
      <header className="flex flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-4 py-3">
        <Link href="/admin/pos" className="text-sm text-stone-600 hover:text-stone-900">
          ← Terminal
        </Link>
        <Link href="/admin" className="text-sm text-stone-600 hover:text-stone-900">
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
        <PosCheckInPanel locationId={locationId} />
      ) : (
        <p className="p-4 text-sm text-stone-600">
          {venuesLoading
            ? "Loading parks…"
            : venues.length
              ? "Select a park to check in guests."
              : "Create a park under Venues — Check-in does not need a POS device."}
        </p>
      )}
    </div>
  );
}
