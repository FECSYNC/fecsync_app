import { api, unwrap, type MaybeWrapped } from "@/utils/api";

const BASE = "/api/admin/booking-invoices";

export type AdminBookingInvoiceDto = {
  id: string;
  orgId: string;
  locationId: string;
  bookingId: string | null;
  accountId: string | null;
  number: string;
  status: string;
  amount: number;
  currency: string;
  dueAt: string | null;
  sentAt: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminInvoiceListParams = {
  bookingId?: string;
  accountId?: string;
};

export const adminInvoiceKeys = {
  all: ["admin", "booking-invoices"] as const,
  list: (filters: AdminInvoiceListParams = {}) =>
    [...adminInvoiceKeys.all, "list", filters] as const,
  detail: (id: string) => [...adminInvoiceKeys.all, "detail", id] as const,
};

export async function listAdminBookingInvoices(
  params: AdminInvoiceListParams = {}
): Promise<AdminBookingInvoiceDto[]> {
  const sp = new URLSearchParams();
  if (params.bookingId) sp.set("bookingId", params.bookingId);
  if (params.accountId) sp.set("accountId", params.accountId);
  const qs = sp.toString();
  const raw = await api<MaybeWrapped<{ invoices?: AdminBookingInvoiceDto[] }>>(
    `${BASE}${qs ? `?${qs}` : ""}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return Array.isArray(data?.invoices) ? data.invoices : [];
}

export async function getAdminBookingInvoice(
  id: string
): Promise<AdminBookingInvoiceDto> {
  const raw = await api<MaybeWrapped<{ invoice: AdminBookingInvoiceDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.invoice) throw new Error("Could not load invoice");
  return data.invoice;
}

export async function createAdminBookingInvoice(
  bookingId: string
): Promise<AdminBookingInvoiceDto> {
  const raw = await api<MaybeWrapped<{ invoice: AdminBookingInvoiceDto }>>(
    BASE,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ bookingId }),
    }
  );
  const data = unwrap(raw);
  if (!data?.invoice) throw new Error("Could not create invoice");
  return data.invoice;
}

export async function sendAdminBookingInvoice(
  id: string
): Promise<AdminBookingInvoiceDto> {
  const raw = await api<MaybeWrapped<{ invoice: AdminBookingInvoiceDto }>>(
    `${BASE}/${encodeURIComponent(id)}/send`,
    { method: "POST", credentials: "include", body: JSON.stringify({}) }
  );
  const data = unwrap(raw);
  if (!data?.invoice) throw new Error("Could not send invoice");
  return data.invoice;
}

export async function cancelAdminBookingInvoice(
  id: string
): Promise<AdminBookingInvoiceDto> {
  const raw = await api<MaybeWrapped<{ invoice: AdminBookingInvoiceDto }>>(
    `${BASE}/${encodeURIComponent(id)}/cancel`,
    { method: "POST", credentials: "include", body: JSON.stringify({}) }
  );
  const data = unwrap(raw);
  if (!data?.invoice) throw new Error("Could not cancel invoice");
  return data.invoice;
}

export async function patchAdminBookingInvoice(
  id: string,
  patch: { dueAt?: string | null; amount?: number }
): Promise<AdminBookingInvoiceDto> {
  const raw = await api<MaybeWrapped<{ invoice: AdminBookingInvoiceDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    { method: "PATCH", credentials: "include", body: JSON.stringify(patch) }
  );
  const data = unwrap(raw);
  if (!data?.invoice) throw new Error("Could not update invoice");
  return data.invoice;
}
