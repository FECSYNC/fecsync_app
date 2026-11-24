"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import { fieldClass } from "@/components/Protected/admin/pages/ticketing/ticketingUi";
import {
  evaluateWaiverGuest,
  listPartyWaiverGaps,
  listWaiverTemplates,
  searchWaiverGuests,
  sendPartyWaiverChase,
  waiverDeskQueryOptions,
  waiverKeys,
} from "@/services/waivers";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import { listAdminVenueLocations, venueLocationKeys } from "@/services/venueLocations";
import WaiverStatusChip from "@/components/Protected/admin/pages/waivers/WaiverStatusChip";

export default function WaiverVerifyPage() {
  const filter = useHqLocationFilter();
  const [q, setQ] = useState("");
  const [guestId, setGuestId] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [chaseTemplateId, setChaseTemplateId] = useState("");
  const [chaseNote, setChaseNote] = useState("");
  const [admissionProductId, setAdmissionProductId] = useState("");
  const [membershipPlanId, setMembershipPlanId] = useState("");
  const venues = useQuery({
    queryKey: venueLocationKeys.list(),
    queryFn: () => listAdminVenueLocations(),
  });
  const templates = useQuery({
    queryKey: waiverKeys.templates("documents"),
    queryFn: () => listWaiverTemplates("documents"),
    ...waiverDeskQueryOptions,
  });
  const guests = useQuery({
    queryKey: ["waiver-verify-guests", q],
    queryFn: () => searchWaiverGuests(q),
    enabled: q.trim().length >= 2,
  });
  const products = useQuery({
    queryKey: ["waiver-targets", "admission_product"],
    queryFn: async () => {
      const raw = await api<MaybeWrapped<{ targets: { id: string; name: string }[] }>>(
        "/api/admin/waivers/targets?type=admission_product",
        { method: "GET", credentials: "include" }
      );
      return unwrap(raw)?.targets ?? [];
    },
  });
  const plans = useQuery({
    queryKey: ["waiver-targets", "membership_plan"],
    queryFn: async () => {
      const raw = await api<MaybeWrapped<{ targets: { id: string; name: string }[] }>>(
        "/api/admin/waivers/targets?type=membership_plan",
        { method: "GET", credentials: "include" }
      );
      return unwrap(raw)?.targets ?? [];
    },
  });
  const evaluation = useQuery({
    queryKey: ["waiver-evaluate", guestId, filter.locationId, admissionProductId, membershipPlanId],
    queryFn: () =>
      evaluateWaiverGuest(guestId, filter.locationId, {
        admissionProductId,
        membershipPlanId,
      }),
    enabled: Boolean(guestId && filter.locationId),
  });
  const result = evaluation.data?.evaluation;
  const block = result?.missingRequirements?.some((row) => row.enforcement === "block" && result.status !== "valid");
  const warn = result?.missingRequirements?.some((row) => row.enforcement === "warn");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-stone-900">Verify a waiver</h1>
      <p className="mt-1 text-sm text-stone-600">
        Front desk check for one guest. This is not the check-in scanner.
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
      <div className="mb-3 flex flex-wrap gap-2">
        <select className={fieldClass} value={admissionProductId} onChange={(e) => setAdmissionProductId(e.target.value)}>
          <option value="">Admission product (optional)</option>
          {(products.data ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        <select className={fieldClass} value={membershipPlanId} onChange={(e) => setMembershipPlanId(e.target.value)}>
          <option value="">Membership plan (optional)</option>
          {(plans.data ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </div>
      <input
        className={`${fieldClass} max-w-md`}
        placeholder="Search name, email, or phone"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="mt-3 text-sm">
        {(guests.data ?? []).map((guest) => (
          <li key={guest.id}>
            <button type="button" className="underline" onClick={() => setGuestId(guest.id)}>
              {guest.firstName} {guest.lastName}
              {guest.email ? ` · ${guest.email}` : ""}
            </button>
          </li>
        ))}
      </ul>
      {result ? (
        <div className="mt-6 rounded border border-stone-200 p-4">
          <WaiverStatusChip status={result.status} />
          {(result.missingRequirements ?? []).length ? (
            <ul className="mt-2 text-sm text-stone-700">
              {result.missingRequirements.map((row, index) => (
                <li key={`${row.reason}-${index}`}>{row.reason}</li>
              ))}
            </ul>
          ) : null}
          {block && result.status !== "valid" ? (
            <p className="mt-2 text-sm font-medium text-red-800">Do not admit</p>
          ) : null}
          {warn && !block ? (
            <p className="mt-2 text-sm text-amber-800">Warn — manager may continue</p>
          ) : null}
          <p className="mt-3 text-sm text-stone-600">
            A new signature still happens on Sign on-site or the kiosk. This screen does not sign for the guest.
          </p>
        </div>
      ) : null}
      <section className="mt-8 border-t border-stone-200 pt-6">
        <h2 className="text-lg font-semibold text-stone-900">Party guests still missing a waiver</h2>
        <p className="mt-1 text-sm text-stone-600">
          Looks up one booking. The signing link goes to the booking contact. This is not the party run sheet.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className={`${fieldClass} max-w-xs`}
            placeholder="Booking id"
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
          />
          <select
            className={fieldClass}
            value={chaseTemplateId}
            onChange={(e) => setChaseTemplateId(e.target.value)}
          >
            <option value="">Template</option>
            {(templates.data ?? [])
              .filter((row) => row.status === "published" && !row.archivedAt)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="rounded border border-stone-300 px-3 py-2 text-sm"
            onClick={() => {
              setChaseNote("");
              void listPartyWaiverGaps(bookingId.trim())
                .then((data) => {
                  if (!data?.available) {
                    setChaseNote("No party on this booking.");
                    return;
                  }
                  const missing = data.guests.filter((guest) => !guest.covered);
                  setChaseNote(
                    missing.length
                      ? `${missing.length} guest${missing.length === 1 ? "" : "s"} still need a waiver.`
                      : "Every listed guest has a current waiver."
                  );
                })
                .catch((err: unknown) => {
                  setChaseNote(err instanceof Error ? err.message : "Could not list party guests");
                });
            }}
          >
            List missing
          </button>
          <button
            type="button"
            className="rounded bg-[#D4AF37] px-3 py-2 text-sm text-stone-900"
            onClick={() => {
              setChaseNote("");
              void sendPartyWaiverChase(bookingId.trim(), chaseTemplateId)
                .then((data) => {
                  if (!data) {
                    setChaseNote("Could not send");
                    return;
                  }
                  if (data.sent) {
                    setChaseNote(
                      `Sent a link for ${data.missing ?? 0} missing guest${data.missing === 1 ? "" : "s"}.`
                    );
                    return;
                  }
                  if (data.url) {
                    window.prompt(data.skipped || "The link could not be delivered.", data.url);
                  }
                  setChaseNote(data.skipped || "Nothing was sent.");
                })
                .catch((err: unknown) => {
                  setChaseNote(err instanceof Error ? err.message : "Could not send");
                });
            }}
          >
            Send link
          </button>
        </div>
        {chaseNote ? <p className="mt-2 text-sm text-stone-700">{chaseNote}</p> : null}
      </section>
    </div>
  );
}
