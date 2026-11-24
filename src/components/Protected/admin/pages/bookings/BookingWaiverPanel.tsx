"use client";

import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import WaiverStatusChip from "@/components/Protected/admin/pages/waivers/WaiverStatusChip";
import { waiverDeskQueryOptions } from "@/services/waivers";

export default function BookingWaiverPanel({ bookingId }: { bookingId: string }) {
  const query = useQuery({
    queryKey: ["booking-waivers", bookingId],
    queryFn: async () => {
      const raw = await api<
        MaybeWrapped<{ waiver: { available: boolean; status: string; reason: string | null } }>
      >(`/api/admin/bookings/${encodeURIComponent(bookingId)}/waivers`, {
        method: "GET",
        credentials: "include",
      });
      return unwrap(raw)?.waiver ?? null;
    },
    enabled: Boolean(bookingId),
    ...waiverDeskQueryOptions,
  });
  const waiver = query.data;
  if (!waiver?.available) return null;
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <p className="text-xs font-semibold uppercase text-stone-500">Waiver</p>
      <div className="mt-1">
        <WaiverStatusChip status={waiver.status} />
      </div>
      {waiver.reason ? <p className="mt-1 text-stone-600">{waiver.reason}</p> : null}
      <p className="mt-2 text-stone-500">Same check as Waivers → Verify. This does not scan a ticket.</p>
    </div>
  );
}
