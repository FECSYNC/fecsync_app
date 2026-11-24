"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import { btnPrimaryClass, fieldClass } from "@/components/Protected/admin/pages/ticketing/ticketingUi";
import { listWaiverTemplates, searchWaiverGuests, sendWaiverRequest, waiverDeskQueryOptions, waiverKeys } from "@/services/waivers";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import { listAdminVenueLocations, venueLocationKeys } from "@/services/venueLocations";

export default function WaiverOnsitePage() {
  const { locationId, setLocationId } = useHqLocationFilter();
  const [templateId, setTemplateId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [q, setQ] = useState("");
  const [guestProfileId, setGuestProfileId] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const venues = useQuery({
    queryKey: venueLocationKeys.list(),
    queryFn: () => listAdminVenueLocations(),
  });
  const templates = useQuery({
    queryKey: waiverKeys.templates("published-sign"),
    queryFn: () => listWaiverTemplates("all"),
    ...waiverDeskQueryOptions,
  });
  const guests = useQuery({
    queryKey: ["waiver-guests", q],
    queryFn: () => searchWaiverGuests(q),
    enabled: q.trim().length >= 2,
  });

  const send = useMutation({
    mutationFn: (channel: "onsite" | "email_link" | "sms_link") =>
      sendWaiverRequest({
        templateId,
        locationId,
        toEmail: email || undefined,
        toPhone: phone || undefined,
        guestProfileId: guestProfileId || undefined,
        channel,
      }),
    onSuccess: (row) => {
      setLink(row.url);
      setStatus(row.status);
    },
  });

  function onSubmit(event: FormEvent, channel: "onsite" | "email_link" | "sms_link") {
    event.preventDefault();
    if (!locationId || !templateId) return;
    send.mutate(channel);
  }

  const published = (templates.data ?? []).filter((row) => row.status === "published" && !row.archivedAt);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-stone-900">Sign on-site</h1>
      <p className="mt-1 text-sm text-stone-600">
        Open the link on this device or send it to the guest. Staff are not the legal signer.
      </p>
      <WaiverSubnav />
      <form className="space-y-3" onSubmit={(e) => onSubmit(e, "onsite")}>
        <label className="block text-sm">
          Venue
          <select
            className={`${fieldClass} mt-1`}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">Select a venue</option>
            {(venues.data ?? []).map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Agreement
          <select
            className={`${fieldClass} mt-1`}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">Select a published template</option>
            {published.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <input
          className={fieldClass}
          placeholder="Search guest name, email, or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {guests.data && guests.data.length > 0 ? (
          <select
            className={fieldClass}
            value={guestProfileId}
            onChange={(e) => setGuestProfileId(e.target.value)}
          >
            <option value="">No saved guest</option>
            {guests.data.map((guest) => (
              <option key={guest.id} value={guest.id}>
                {guest.firstName} {guest.lastName}
                {guest.email ? ` · ${guest.email}` : ""}
              </option>
            ))}
          </select>
        ) : null}
        <input
          className={fieldClass}
          placeholder="Guest email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className={fieldClass}
          placeholder="Guest phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {send.isError ? (
          <p className="text-sm text-red-700">
            {send.error instanceof Error ? send.error.message : "Could not create a link"}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimaryClass} type="submit" disabled={send.isPending}>
            Open on this device
          </button>
          <button
            className="rounded border border-stone-300 px-3 py-2 text-sm"
            type="button"
            disabled={send.isPending}
            onClick={(e) => onSubmit(e, "email_link")}
          >
            Email link
          </button>
          <button
            className="rounded border border-stone-300 px-3 py-2 text-sm"
            type="button"
            disabled={send.isPending}
            onClick={(e) => onSubmit(e, "sms_link")}
          >
            Text link
          </button>
        </div>
      </form>
      {link ? (
        <div className="mt-4 rounded border border-[#D4AF37] bg-amber-50 p-3 text-sm">
          <p className="font-medium text-stone-900">Signing link ({status})</p>
          <a className="mt-1 block break-all underline" href={link}>
            {link}
          </a>
        </div>
      ) : null}
    </div>
  );
}
