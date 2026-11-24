"use client";

import { useState } from "react";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import { fieldClass, btnPrimaryClass } from "@/components/Protected/admin/pages/ticketing/ticketingUi";
import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import { useQuery } from "@tanstack/react-query";
import { listAdminVenueLocations, venueLocationKeys } from "@/services/venueLocations";

export default function WaiverImportPage() {
  const filter = useHqLocationFilter();
  const [csv, setCsv] = useState(
    "firstName,lastName,email,phone,dob,signedAt,expiresAt,templateSlug,locale,externalRef,guardianName\n"
  );
  const [message, setMessage] = useState("");
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const venues = useQuery({
    queryKey: venueLocationKeys.list(),
    queryFn: () => listAdminVenueLocations(),
  });

  async function run(dryRun: boolean) {
    setMessage("");
    setRowErrors([]);
    const raw = await api<
      MaybeWrapped<{
        created: number;
        existing: number;
        failed: number;
        dryRun: boolean;
        results: { row: number; ok: boolean; error?: string }[];
      }>
    >("/api/admin/waivers/import", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ csv, locationId: filter.locationId, dryRun }),
    });
    const data = unwrap(raw);
    setRowErrors(
      (data?.results ?? [])
        .filter((row) => !row.ok && row.error)
        .map((row) => `Row ${row.row}: ${row.error}`)
    );
    setMessage(
      data
        ? `${data.dryRun ? "Preview" : "Imported"} · created ${data.created} · existing ${data.existing} · failed ${data.failed}`
        : "Could not import"
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-stone-900">Import signed waivers</h1>
      <p className="mt-1 text-sm text-stone-600">
        Historical signed guests only. A newer live signature is left in place. Preview before commit.
        Form questions are added in the template wizard, not from a spreadsheet.
      </p>
      <WaiverSubnav />
      <select
        className={`${fieldClass} mb-3 max-w-md`}
        value={filter.locationId}
        onChange={(e) => filter.setLocationId(e.target.value)}
      >
        <option value="">Choose a venue</option>
        {(venues.data ?? []).map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
      <textarea className={`${fieldClass} min-h-48 font-mono text-xs`} value={csv} onChange={(e) => setCsv(e.target.value)} />
      <div className="mt-3 flex gap-2">
        <button type="button" className="rounded border border-stone-300 px-3 py-2 text-sm" disabled={!filter.locationId} onClick={() => void run(true)}>
          Preview
        </button>
        <button type="button" className={btnPrimaryClass} disabled={!filter.locationId} onClick={() => void run(false)}>
          Import
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-stone-700">{message}</p> : null}
      {rowErrors.length ? (
        <ul className="mt-2 text-sm text-red-800">
          {rowErrors.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
