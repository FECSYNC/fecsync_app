import { api, unwrap, type MaybeWrapped } from "@/utils/api";

const BASE = "/api/admin/booking-payments";

export type AdminPaymentTxnDto = {
  id: string;
  bookingId: string;
  bookingPublicId: string;
  guest: string | null;
  email: string | null;
  tender: string;
  amount: number;
  currency: string;
  status: string;
  stripePaymentIntentId: string | null;
  venue: { id: string; name: string } | null;
  staff: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
  createdAt: string;
};

export type AdminPaymentListParams = {
  q?: string;
  from?: string;
  to?: string;
  locationId?: string;
};

export const adminPaymentKeys = {
  all: ["admin", "booking-payments"] as const,
  list: (filters: AdminPaymentListParams = {}) =>
    [...adminPaymentKeys.all, "list", filters] as const,
};

export async function listAdminBookingPayments(
  params: AdminPaymentListParams = {}
): Promise<AdminPaymentTxnDto[]> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.locationId) sp.set("locationId", params.locationId);
  const qs = sp.toString();
  const raw = await api<MaybeWrapped<{ payments?: AdminPaymentTxnDto[] }>>(
    `${BASE}${qs ? `?${qs}` : ""}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return Array.isArray(data?.payments) ? data.payments : [];
}
