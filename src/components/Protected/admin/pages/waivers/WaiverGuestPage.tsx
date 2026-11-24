"use client";

import AdminPendingLink from "@/components/Protected/admin/components/AdminPendingLink";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import { waiverStatusLabel } from "@/components/Protected/admin/pages/waivers/WaiverStatusChip";
import { waiverDeskQueryOptions } from "@/services/waivers";

type GuestWaivers = {
  guest: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null };
  records: {
    id: string;
    publicRef: string;
    status: string;
    signedAt: string | null;
    expiresAt: string | null;
    templateName: string;
  }[];
};

export default function WaiverGuestPage() {
  const params = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ["waiver-guest", params.id],
    queryFn: async () => {
      const raw = await api<MaybeWrapped<GuestWaivers>>(
        `/api/admin/waivers/guests/${encodeURIComponent(params.id)}`,
        { method: "GET", credentials: "include" }
      );
      return unwrap(raw);
    },
    enabled: Boolean(params.id),
    ...waiverDeskQueryOptions,
  });
  const data = query.data;
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-stone-900">Guest waivers</h1>
      <WaiverSubnav />
      {query.isLoading ? <p className="text-sm text-stone-500">Loading…</p> : null}
      {query.isError ? (
        <p className="text-sm text-red-700">
          {query.error instanceof Error ? query.error.message : "Could not load this guest"}
        </p>
      ) : null}
      {data ? (
        <div className="space-y-3 text-sm text-stone-800">
          <p>
            {data.guest.firstName} {data.guest.lastName}
            {data.guest.email ? ` · ${data.guest.email}` : ""}
          </p>
          {data.records.length === 0 ? (
            <p className="text-stone-500">No waiver records in this park scope.</p>
          ) : (
            <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
              {data.records.map((row) => (
                <li key={row.id} className="px-3 py-2">
                  <AdminPendingLink className="text-[#D4AF37]" cornerSpinner={false} href={`/admin/waivers/records/${row.id}`}>
                    {row.publicRef}
                  </AdminPendingLink>
                  <span className="ml-2 font-semibold">{waiverStatusLabel(row.status)}</span>
                  <span className="ml-2 text-stone-500">{row.templateName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
