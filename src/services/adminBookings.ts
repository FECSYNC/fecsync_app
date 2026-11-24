import { api, unwrap, type MaybeWrapped } from "@/utils/api";

const BASE = "/api/admin/bookings";

export type AdminBookingLineDto = {
  id: string;
  productId: string;
  productName: string;
  productType: string;
  priceBandCode: string | null;
  qty: number;
  unitPrice: number;
  taxAmount: number;
  lineTotal: number;
  resourceId: string | null;
  sessionId: string | null;
  visitDate: string | null;
  passExpiresAt: string | null;
};

export type AdminBookingPaymentDto = {
  id: string;
  tender: string;
  amount: number;
  currency: string;
  status: string;
  splitGroupId: string | null;
  createdAt: string;
};

export type AdminBookingActivityDto = {
  id: string;
  kind: string;
  payload: unknown;
  actorUserId: string | null;
  createdAt: string;
};

export type AdminBookingDto = {
  id: string;
  publicId: string;
  orgId: string;
  locationId: string;
  status: string;
  channel: string;
  createMode: string;
  userId: string | null;
  accountId: string | null;
  account: { id: string; name: string } | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  assignedStaffUserId: string | null;
  assignedStaff: { id: string; name: string; email: string } | null;
  taxExempt: boolean;
  taxExemptReason: string | null;
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  notes: string | null;
  posNotes: string | null;
  reviewedAt: string | null;
  holdExpiresAt: string | null;
  reservedUntil: string | null;
  visitStartsAt: string | null;
  visitEndsAt: string | null;
  cancelledAt: string | null;
  reactivatedAt: string | null;
  confirmationSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  location: { id: string; name: string; slug?: string; timezone?: string | null } | null;
  lines: AdminBookingLineDto[];
  guests: unknown[];
  credentials: unknown[];
  payments: AdminBookingPaymentDto[];
  activities: AdminBookingActivityDto[];
  partyDetail: {
    id: string;
    partyName?: string | null;
    packageName?: string | null;
    roomResourceId?: string | null;
    roomName?: string | null;
  } | null;
};

export type AdminBookingListParams = {
  status?: string;
  locationId?: string;
  q?: string;
  amountDueOnly?: boolean;
  sessionId?: string;
  accountId?: string;
  channel?: string;
  partyOnly?: boolean;
  visitDate?: string;
  visitFrom?: string;
  visitTo?: string;
  staffId?: string;
  includeClosed?: boolean;
  skip?: number;
  take?: number;
};

export type AdminBookingListResult = {
  bookings: AdminBookingDto[];
  total: number;
  take: number;
  skip: number;
};

/** Strip empty filters so prefetch keys match the list page. */
export function normalizeAdminBookingListParams(
  filters: AdminBookingListParams = {}
): AdminBookingListParams {
  const next: AdminBookingListParams = {};
  if (filters.status?.trim()) next.status = filters.status.trim();
  if (filters.locationId?.trim()) next.locationId = filters.locationId.trim();
  if (filters.q?.trim()) next.q = filters.q.trim();
  if (filters.amountDueOnly) next.amountDueOnly = true;
  if (filters.sessionId?.trim()) next.sessionId = filters.sessionId.trim();
  if (filters.accountId?.trim()) next.accountId = filters.accountId.trim();
  if (filters.channel?.trim()) next.channel = filters.channel.trim();
  if (filters.partyOnly) next.partyOnly = true;
  if (filters.visitDate?.trim()) next.visitDate = filters.visitDate.trim();
  if (filters.visitFrom?.trim()) next.visitFrom = filters.visitFrom.trim();
  if (filters.visitTo?.trim()) next.visitTo = filters.visitTo.trim();
  if (filters.staffId?.trim()) next.staffId = filters.staffId.trim();
  if (filters.includeClosed) next.includeClosed = true;
  if (filters.skip != null) next.skip = filters.skip;
  if (filters.take != null) next.take = filters.take;
  return next;
}

export const adminBookingKeys = {
  all: ["admin", "bookings"] as const,
  list: (filters: AdminBookingListParams = {}) =>
    [
      ...adminBookingKeys.all,
      "list",
      normalizeAdminBookingListParams(filters),
    ] as const,
  detail: (id: string) => [...adminBookingKeys.all, "detail", id] as const,
};

function queryString(params: AdminBookingListParams): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.locationId) sp.set("locationId", params.locationId);
  if (params.q) sp.set("q", params.q);
  if (params.amountDueOnly) sp.set("amountDueOnly", "true");
  if (params.sessionId) sp.set("sessionId", params.sessionId);
  if (params.accountId) sp.set("accountId", params.accountId);
  if (params.channel) sp.set("channel", params.channel);
  if (params.partyOnly) sp.set("partyOnly", "true");
  if (params.visitDate) sp.set("visitDate", params.visitDate);
  if (params.visitFrom) sp.set("visitFrom", params.visitFrom);
  if (params.visitTo) sp.set("visitTo", params.visitTo);
  if (params.staffId) sp.set("staffId", params.staffId);
  if (params.includeClosed) sp.set("includeClosed", "true");
  if (params.skip != null) sp.set("skip", String(params.skip));
  if (params.take != null) sp.set("take", String(params.take));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export async function listAdminBookings(
  params: AdminBookingListParams = {}
): Promise<AdminBookingListResult> {
  const normalized = normalizeAdminBookingListParams(params);
  const raw = await api<
    MaybeWrapped<{
      bookings?: AdminBookingDto[];
      total?: number;
      take?: number;
      skip?: number;
    }>
  >(`${BASE}${queryString(normalized)}`, {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  const bookings = Array.isArray(data?.bookings) ? data.bookings : [];
  return {
    bookings,
    total: Number(data?.total ?? bookings.length),
    take: Number(data?.take ?? bookings.length),
    skip: Number(data?.skip ?? 0),
  };
}

export async function getAdminBooking(id: string): Promise<AdminBookingDto> {
  const raw = await api<MaybeWrapped<{ booking: AdminBookingDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Could not load booking");
  return data.booking;
}

async function postBookingAction(
  id: string,
  path: string,
  body: Record<string, unknown> = {}
): Promise<AdminBookingDto> {
  const raw = await api<MaybeWrapped<{ booking: AdminBookingDto }>>(
    `${BASE}/${encodeURIComponent(id)}${path}`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(body),
    }
  );
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Booking action failed");
  return data.booking;
}

export function confirmAdminBooking(id: string, allowUnpaid = false) {
  return postBookingAction(id, "/confirm", { allowUnpaid });
}

export function holdAdminBooking(id: string, allowOverbook = false) {
  return postBookingAction(id, "/hold", { allowOverbook });
}

export function reserveAdminBooking(id: string, allowOverbook = false) {
  return postBookingAction(id, "/reserve", { allowOverbook });
}

export async function patchAdminBookingTaxExemption(
  id: string,
  taxExempt: boolean,
  reason?: string | null
) {
  const raw = await api<MaybeWrapped<{ booking: AdminBookingDto }>>(
    `${BASE}/${encodeURIComponent(id)}/tax-exemption`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ taxExempt, reason: reason ?? null }),
    }
  );
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Could not update tax exemption");
  return data.booking;
}

export function cancelAdminBooking(id: string, reason?: string) {
  return postBookingAction(id, "/cancel", reason ? { reason } : {});
}

export function reactivateAdminBooking(id: string) {
  return postBookingAction(id, "/reactivate", { targetStatus: "hold" });
}

export function reviewAdminBooking(id: string) {
  return postBookingAction(id, "/review");
}

export async function patchAdminBookingNotes(
  id: string,
  notes: string | null
): Promise<AdminBookingDto> {
  const raw = await api<MaybeWrapped<{ booking: AdminBookingDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ notes }),
    }
  );
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Could not save notes");
  return data.booking;
}

export async function patchAdminBookingPosNotes(
  id: string,
  posNotes: string | null
): Promise<AdminBookingDto> {
  const raw = await api<MaybeWrapped<{ booking: AdminBookingDto }>>(
    `${BASE}/${encodeURIComponent(id)}/pos-notes`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ posNotes }),
    }
  );
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Could not save POS notes");
  return data.booking;
}

export async function refundAdminBooking(
  id: string,
  opts: { amount: number; method: "original" | "gift_card"; reason?: string }
): Promise<unknown> {
  const raw = await api<MaybeWrapped<unknown>>(
    `${BASE}/${encodeURIComponent(id)}/refunds`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(opts),
    }
  );
  return unwrap(raw);
}

export async function createAdminBookingPaymentLink(
  id: string,
  opts?: { amount?: number; to?: string; sendVia?: Array<"email" | "sms"> }
): Promise<{ id: string; token: string; amountDue: number; expiresAt: string; payUrl?: string }> {
  const raw = await api<
    MaybeWrapped<{
      link: {
        id: string;
        token: string;
        amountDue: number;
        expiresAt: string;
        payUrl?: string;
      };
    }>
  >(`${BASE}/${encodeURIComponent(id)}/payment-link`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({
      amount: opts?.amount,
      sendVia: opts?.sendVia ?? ["email"],
      to: opts?.to,
    }),
  });
  const data = unwrap(raw);
  if (!data?.link) throw new Error("Could not create payment link");
  return data.link;
}

export async function createAdminBooking(body: Record<string, unknown>) {
  const raw = await api<MaybeWrapped<{ booking: AdminBookingDto }>>(BASE, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Could not create booking");
  return data.booking;
}

export async function patchAdminBookingLines(
  id: string,
  lines: Array<Record<string, unknown>>,
  allowOverbook = false
) {
  const raw = await api<MaybeWrapped<{ booking: AdminBookingDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ lines, allowOverbook }),
    }
  );
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Could not update booking");
  return data.booking;
}

export function assignAdminBookingStaff(id: string, staffUserId: string) {
  return postBookingAction(id, "/assign-staff", { staffUserId });
}

export async function resendAdminBookingConfirmation(id: string) {
  const raw = await api<MaybeWrapped<{ sent?: boolean; reason?: string }>>(
    `${BASE}/${encodeURIComponent(id)}/resend-confirmation`,
    { method: "POST", credentials: "include", body: JSON.stringify({}) }
  );
  return unwrap(raw) ?? {};
}

export async function overbookAdminBooking(id: string) {
  return postBookingAction(id, "/overbook", {});
}

export async function getAdminBookingTickets(id: string) {
  const raw = await api<
    MaybeWrapped<{
      tickets?: Array<{
        id: string;
        code: string;
        qrPayload: string;
        status: string;
        customTicketId: string | null;
        passExpiresAt?: string | null;
      }>;
    }>
  >(`${BASE}/${encodeURIComponent(id)}/tickets`, {
    method: "GET",
    credentials: "include",
  });
  return unwrap(raw)?.tickets ?? [];
}

export async function assignAdminBookingTicketIds(
  id: string,
  assignments: Array<{ credentialId: string; customTicketId: string }>
) {
  const raw = await api<MaybeWrapped<{ credentials?: unknown[] }>>(
    `${BASE}/${encodeURIComponent(id)}/ticket-ids`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ assignments }),
    }
  );
  return unwrap(raw)?.credentials ?? [];
}

export async function patchAdminBookingPassExpiry(
  id: string,
  credentialId: string,
  passExpiresAt: string | null
) {
  const raw = await api<MaybeWrapped<{ credential?: unknown }>>(
    `${BASE}/${encodeURIComponent(id)}/pass-expiry`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ credentialId, passExpiresAt }),
    }
  );
  return unwrap(raw)?.credential;
}

export async function logAdminBookingCall(
  id: string,
  payload: { summary?: string; direction?: string }
) {
  const raw = await api<MaybeWrapped<{ activity?: unknown }>>(
    `${BASE}/${encodeURIComponent(id)}/activity`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ kind: "call", payload }),
    }
  );
  return unwrap(raw);
}

export async function takeAdminBookingTenders(
  id: string,
  tenders: Array<{
    type: string;
    amount: number;
    giftCardCode?: string;
    storedPaymentMethodId?: string;
  }>
): Promise<{ booking?: AdminBookingDto; checkoutUrl?: string | null }> {
  const raw = await api<
    MaybeWrapped<{ booking?: AdminBookingDto; checkoutUrl?: string | null }>
  >(`${BASE}/${encodeURIComponent(id)}/payments`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ tenders }),
  });
  return unwrap(raw) ?? {};
}
