"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import {
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
} from "@/components/Protected/admin/pages/ticketing/ticketingUi";
import {
  createKioskDevice,
  listKioskDevices,
  listWaiverTemplates,
  patchKioskDevice,
  rotateKioskDevice,
  waiverDeskQueryOptions,
  waiverKeys,
} from "@/services/waivers";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import { listAdminVenueLocations, venueLocationKeys } from "@/services/venueLocations";

export default function WaiverKioskPage({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const { locationId, setLocationId } = useHqLocationFilter();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [onceToken, setOnceToken] = useState<string | null>(null);

  const venues = useQuery({
    queryKey: venueLocationKeys.list(),
    queryFn: () => listAdminVenueLocations(),
  });
  const devices = useQuery({
    queryKey: waiverKeys.kiosks(),
    queryFn: listKioskDevices,
  });
  const templates = useQuery({
    queryKey: waiverKeys.templates("all-kiosk"),
    queryFn: () => listWaiverTemplates("all"),
    ...waiverDeskQueryOptions,
  });

  const create = useMutation({
    mutationFn: () =>
      createKioskDevice({
        name,
        locationId,
        pin: pin || undefined,
        templateIds: templateId ? [templateId] : [],
      }),
    onSuccess: async (device) => {
      setOnceToken(device.deviceToken ?? null);
      setName("");
      setPin("");
      await qc.invalidateQueries({ queryKey: waiverKeys.kiosks() });
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => patchKioskDevice(id, { status: "archived" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: waiverKeys.kiosks() });
    },
  });

  const rotate = useMutation({
    mutationFn: (id: string) => rotateKioskDevice(id),
    onSuccess: async (device) => {
      setOnceToken(device.deviceToken ?? null);
      await qc.invalidateQueries({ queryKey: waiverKeys.kiosks() });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!locationId) return;
    create.mutate();
  }

  return (
    <div className={embedded ? "" : "mx-auto max-w-3xl px-4 py-6"}>
      {embedded ? null : <h1 className="text-2xl font-semibold text-stone-900">Waiver kiosk</h1>}
      <p className="mt-1 text-sm text-stone-600">
        Station setup only. The device token is shown once and is not a ticket-sales kiosk. After a guest signs on this device, they can continue at this park for 90 minutes, or choose New guest. That pass does not mark another ticket as signed.
      </p>
      {embedded ? null : <WaiverSubnav />}
      {onceToken ? (
        <div className="mb-4 rounded-md border border-[#D4AF37] bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-stone-900">Copy this device token now. It will not be shown again.</p>
          <p className="mt-1 break-all font-mono text-xs">{onceToken}</p>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="mb-6 grid gap-3">
        <label className="text-sm">
          Venue
          <select className={`${fieldClass} mt-1`} value={locationId || ""} onChange={(e) => setLocationId(e.target.value)} required>
            <option value="">Select a venue</option>
            {(venues.data ?? [])
              .filter((v) => v.status !== "archived")
              .map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <input className={fieldClass} placeholder="Station name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className={fieldClass} placeholder="Optional staff PIN (4–8 digits)" value={pin} onChange={(e) => setPin(e.target.value)} />
        <select className={fieldClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Allowed published template (optional)</option>
          {(templates.data ?? [])
            .filter((t) => t.status === "published" && !t.archivedAt)
            .filter((t) => !locationId || !t.locationId || t.locationId === locationId)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
        <button className={btnPrimaryClass} type="submit" disabled={create.isPending || !locationId}>
          Create device
        </button>
        {create.isError ? (
          <p className="text-sm text-red-700">{create.error instanceof Error ? create.error.message : "Create failed"}</p>
        ) : null}
      </form>
      {devices.isError ? (
        <p className="text-sm text-red-700">{devices.error instanceof Error ? devices.error.message : "Could not load devices"}</p>
      ) : null}
      {rotate.isError ? (
        <p className="mb-2 text-sm text-red-700">
          {rotate.error instanceof Error ? rotate.error.message : "Could not rotate the token"}
        </p>
      ) : null}
      <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200">
        {(devices.data ?? []).map((device) => (
          <li key={device.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <p className="font-medium">{device.name}</p>
              <p className="text-xs text-stone-500">
                {device.code} · {device.status}
              </p>
            </div>
            {device.status !== "archived" ? (
              <div className="flex gap-2">
                <button className={btnSecondaryClass} type="button" onClick={() => rotate.mutate(device.id)}>
                  Rotate token
                </button>
                <button className={btnSecondaryClass} type="button" onClick={() => archive.mutate(device.id)}>
                  Archive
                </button>
              </div>
            ) : null}
          </li>
        ))}
        {!devices.isLoading && (devices.data ?? []).length === 0 ? (
          <li className="px-4 py-6 text-sm text-stone-500">No kiosk devices yet.</li>
        ) : null}
      </ul>
    </div>
  );
}
