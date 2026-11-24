"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import {
  btnPrimaryClass,
  fieldClass,
} from "@/components/Protected/admin/pages/ticketing/ticketingUi";
import { getWaiverSettings, putWaiverSettings, waiverKeys } from "@/services/waivers";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import { listAdminVenueLocations, venueLocationKeys } from "@/services/venueLocations";
import { notifyMarketingChange } from "@/lib/marketingSync";

export default function WaiverSettingsPage({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const { locationId, setLocationId, parkLocked } = useHqLocationFilter();
  const venues = useQuery({
    queryKey: venueLocationKeys.list(),
    queryFn: () => listAdminVenueLocations(),
  });
  const settings = useQuery({
    queryKey: waiverKeys.settings(locationId || "org"),
    queryFn: () => getWaiverSettings(locationId || null),
    enabled: !parkLocked || Boolean(locationId),
  });

  const [form, setForm] = useState({
    jurisdictionCode: "US-FL",
    ageOfMajorityYears: "18",
    expiryRule: "calendar_year",
    expiryDays: "",
    retentionYears: "7",
    remindBeforeDays: "14,3",
    defaultLocale: "en",
    kioskSessionMinutes: "5",
    maxMinorsPerGuardianSession: "8",
    requireGuardianForMinors: true,
    allowAdultSelfSign: true,
    allowGroupSigning: true,
    requireIntentCheckbox: true,
    allowTypedSignature: true,
    allowDrawnSignature: true,
    optionalWitness: false,
    blockCheckInWhenMissing: true,
    kioskRequireStaffPin: true,
    notifyEmail: "",
  });

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setForm({
      jurisdictionCode: s.jurisdictionCode,
      ageOfMajorityYears: String(s.ageOfMajorityYears),
      expiryRule: s.expiryRule,
      expiryDays: s.expiryDays != null ? String(s.expiryDays) : "",
      retentionYears: String(s.retentionYears),
      remindBeforeDays: s.remindBeforeDays.join(","),
      defaultLocale: s.defaultLocale,
      kioskSessionMinutes: String(s.kioskSessionMinutes),
      maxMinorsPerGuardianSession: String(s.maxMinorsPerGuardianSession),
      requireGuardianForMinors: s.requireGuardianForMinors,
      allowAdultSelfSign: s.allowAdultSelfSign,
      allowGroupSigning: s.allowGroupSigning,
      requireIntentCheckbox: s.requireIntentCheckbox,
      allowTypedSignature: s.allowTypedSignature,
      allowDrawnSignature: s.allowDrawnSignature,
      optionalWitness: s.optionalWitness,
      blockCheckInWhenMissing: s.blockCheckInWhenMissing,
      kioskRequireStaffPin: s.kioskRequireStaffPin,
      notifyEmail: s.notifyEmail ?? "",
    });
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      putWaiverSettings({
        locationId: locationId || null,
        jurisdictionCode: form.jurisdictionCode,
        ageOfMajorityYears: Number(form.ageOfMajorityYears),
        expiryRule: form.expiryRule,
        expiryDays: form.expiryDays ? Number(form.expiryDays) : null,
        retentionYears: Number(form.retentionYears),
        remindBeforeDays: form.remindBeforeDays
          .split(",")
          .map((n) => Number(n.trim()))
          .filter((n) => Number.isFinite(n)),
        defaultLocale: form.defaultLocale,
        kioskSessionMinutes: Number(form.kioskSessionMinutes),
        maxMinorsPerGuardianSession: Number(form.maxMinorsPerGuardianSession),
        requireGuardianForMinors: form.requireGuardianForMinors,
        allowAdultSelfSign: form.allowAdultSelfSign,
        allowGroupSigning: form.allowGroupSigning,
        requireIntentCheckbox: form.requireIntentCheckbox,
        allowTypedSignature: form.allowTypedSignature,
        allowDrawnSignature: form.allowDrawnSignature,
        optionalWitness: form.optionalWitness,
        blockCheckInWhenMissing: form.blockCheckInWhenMissing,
        kioskRequireStaffPin: form.kioskRequireStaffPin,
        notifyEmail: form.notifyEmail,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: waiverKeys.settings(locationId || "org") });
      // Marketing overview Waivers bridge (remind windows / 30d sends) stays live.
      notifyMarketingChange(qc);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <div className={embedded ? "" : "mx-auto max-w-3xl px-4 py-6"}>
      {embedded ? null : <h1 className="text-2xl font-semibold text-stone-900">Waiver settings</h1>}
      <p className="mt-1 text-sm text-stone-600">
        Company default applies until you save a row for a specific venue. Age of majority must be 16–21.
      </p>
      {embedded ? null : <WaiverSubnav />}
      <label className="mb-4 block text-sm font-medium text-stone-800">
        Venue
        <select
          className={`${fieldClass} mt-1`}
          value={locationId || ""}
          onChange={(e) => setLocationId(e.target.value)}
        >
          {parkLocked ? null : <option value="">Company default</option>}
          {(venues.data ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      {settings.isError ? (
        <p className="mb-3 text-sm text-red-700">
          {settings.error instanceof Error ? settings.error.message : "Could not load settings"}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="grid gap-3">
        <label className="text-sm">
          Jurisdiction
          <select className={`${fieldClass} mt-1`} value={form.jurisdictionCode} onChange={(e) => setForm({ ...form, jurisdictionCode: e.target.value })}>
            {["US-FL", "US-TX", "US-CA", "US-NY", "US-OTHER", "OTHER"].map((code) => (
              <option key={code}>{code}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Age of majority
          <input className={`${fieldClass} mt-1`} value={form.ageOfMajorityYears} onChange={(e) => setForm({ ...form, ageOfMajorityYears: e.target.value })} />
        </label>
        <label className="text-sm">
          Expiry rule
          <select className={`${fieldClass} mt-1`} value={form.expiryRule} onChange={(e) => setForm({ ...form, expiryRule: e.target.value })}>
            <option value="calendar_year">Calendar year</option>
            <option value="days">Days after signing</option>
            <option value="never">Never</option>
            <option value="visit">Visit day only</option>
            <option value="until_date">Until a date set at signing</option>
          </select>
        </label>
        <label className="text-sm">
          Expiry days
          <input className={`${fieldClass} mt-1`} value={form.expiryDays} onChange={(e) => setForm({ ...form, expiryDays: e.target.value })} />
        </label>
        <label className="text-sm">
          Remind before days (comma separated)
          <input className={`${fieldClass} mt-1`} value={form.remindBeforeDays} onChange={(e) => setForm({ ...form, remindBeforeDays: e.target.value })} />
        </label>
        <label className="text-sm">
          Retention years
          <input className={`${fieldClass} mt-1`} value={form.retentionYears} onChange={(e) => setForm({ ...form, retentionYears: e.target.value })} />
        </label>
        <label className="text-sm">
          Default locale
          <input className={`${fieldClass} mt-1`} value={form.defaultLocale} onChange={(e) => setForm({ ...form, defaultLocale: e.target.value })} />
        </label>
        <label className="text-sm">
          Max minors per guardian session
          <input className={`${fieldClass} mt-1`} value={form.maxMinorsPerGuardianSession} onChange={(e) => setForm({ ...form, maxMinorsPerGuardianSession: e.target.value })} />
        </label>
        <label className="text-sm">
          Staff notification email
          <input
            className={`${fieldClass} mt-1`}
            type="email"
            value={form.notifyEmail}
            placeholder="Optional"
            onChange={(e) => setForm({ ...form, notifyEmail: e.target.value })}
          />
          <span className="mt-1 block text-xs text-stone-500">
            One staff email after a successful sign. This venue address is used when it is set; otherwise the company default is used. The message includes the signer, minors, accepted clauses, fill method, reference, and venue name. It does not include a signature image or an ID photo. Leave blank to send no staff copy.
          </span>
        </label>
        <label className="text-sm">
          Kiosk session minutes
          <input className={`${fieldClass} mt-1`} value={form.kioskSessionMinutes} onChange={(e) => setForm({ ...form, kioskSessionMinutes: e.target.value })} />
        </label>
        {(
          [
            ["requireGuardianForMinors", "Require a guardian for minors"],
            ["allowAdultSelfSign", "Allow adults to sign for themselves"],
            ["allowGroupSigning", "Allow one adult to cover a group"],
            ["requireIntentCheckbox", "Require an intent checkbox"],
            ["allowTypedSignature", "Allow a typed signature"],
            ["allowDrawnSignature", "Allow a drawn signature"],
            ["optionalWitness", "Optional witness name"],
            ["blockCheckInWhenMissing", "Save a check-in block preference for when the scanner ships"],
            ["kioskRequireStaffPin", "Kiosk requires a staff PIN"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
        {parkLocked && !locationId ? (
          <p className="text-sm text-stone-600">Choose one of your assigned venues to edit settings.</p>
        ) : null}
        <button className={btnPrimaryClass} type="submit" disabled={save.isPending || (parkLocked && !locationId)}>
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
        {save.isError ? (
          <p className="text-sm text-red-700">{save.error instanceof Error ? save.error.message : "Save failed"}</p>
        ) : null}
        {save.isSuccess ? <p className="text-sm text-stone-700">Saved.</p> : null}
      </form>
    </div>
  );
}
