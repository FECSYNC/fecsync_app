"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import { fieldClass } from "@/components/Protected/admin/pages/ticketing/ticketingUi";
import { listWaiverTemplates, waiverDeskQueryOptions, waiverKeys, waiverSignageUrl } from "@/services/waivers";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import { listAdminVenueLocations, venueLocationKeys } from "@/services/venueLocations";

export default function WaiverSignagePage({ embedded = false }: { embedded?: boolean }) {
  const params = useSearchParams();
  const filter = useHqLocationFilter();
  const [templateId, setTemplateId] = useState(params.get("templateId") ?? "");
  const locationId = params.get("locationId") || filter.locationId;
  const venues = useQuery({
    queryKey: venueLocationKeys.list(),
    queryFn: () => listAdminVenueLocations(),
  });
  const templates = useQuery({
    queryKey: waiverKeys.templates("signage"),
    queryFn: () => listWaiverTemplates("documents"),
    ...waiverDeskQueryOptions,
  });
  const qr = useQuery({
    queryKey: ["waiver-qr", templateId, locationId],
    queryFn: () => waiverSignageUrl(templateId, locationId),
    enabled: Boolean(templateId && locationId),
  });
  const published = (templates.data ?? []).filter((row) => row.status === "published" && !row.archivedAt);
  const venue = (venues.data ?? []).find((row) => row.id === locationId);
  const template = published.find((row) => row.id === templateId);

  return (
    <div className={embedded ? "print:max-w-none" : "mx-auto max-w-3xl px-4 py-6 print:max-w-none"}>
      <div className="print:hidden">
        {embedded ? null : <h1 className="text-2xl font-semibold text-stone-900">Waiver signage</h1>}
        <p className="mt-1 text-sm text-stone-600">
          Standing link for this venue and agreement. Guests sign at the public form.
        </p>
        {embedded ? null : <WaiverSubnav />}
        <div className="mb-4 flex flex-wrap gap-2">
          <select
            className={fieldClass}
            value={locationId}
            onChange={(e) => filter.setLocationId(e.target.value)}
          >
            <option value="">Venue</option>
            {(venues.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <select className={fieldClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Template</option>
            {published.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <button type="button" className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => window.print()}>
            Print
          </button>
        </div>
        {qr.isError ? (
          <p className="text-sm text-red-700">
            {qr.error instanceof Error ? qr.error.message : "Could not create the sign"}
          </p>
        ) : null}
      </div>
      {qr.data?.url ? (
        <section className="rounded border-2 border-[#D4AF37] bg-stone-50 p-8 text-center">
          {qr.data.logoUrl ? (
            <img src={qr.data.logoUrl} alt="" className="mx-auto mb-4 h-16 w-16 object-contain" />
          ) : null}
          <p className="text-sm uppercase tracking-wide text-stone-500">
            {qr.data.venueName ?? venue?.name ?? "Venue"}
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-stone-900">{template?.name ?? "Waiver"}</h2>
          <p className="mt-4 text-lg text-stone-700">Scan or open this link to sign before you enter.</p>
          {qr.data.svg ? (
            <div
              className="mx-auto mt-6 w-56 bg-white p-2"
              dangerouslySetInnerHTML={{ __html: qr.data.svg }}
            />
          ) : null}
          <p className="mt-6 break-all font-mono text-sm text-stone-800">{qr.data.url}</p>
        </section>
      ) : null}
    </div>
  );
}
