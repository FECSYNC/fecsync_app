/**
 * Staff bookings export (CSV / JSON) — redacted; no Stripe secrets / QR / pay-link tokens.
 * Export audit SSOT: `logStaffActivityEntry` on the export route (org-scoped).
 */
import type { AdmissionProductType, BookingChannel, BookingStatus } from "@prisma/client";
import type { TicketingActor } from "@/lib/ticketing/common";
import { listBookings } from "@/lib/ticketing/bookingEngine";

type BookingListItem = Awaited<
  ReturnType<typeof listBookings>
>["bookings"][number];

export type BookingExportFilters = {
  status?: BookingStatus;
  locationId?: string;
  q?: string;
  amountDueOnly?: boolean;
  amountDue?: boolean;
  sessionId?: string;
  accountId?: string;
  channel?: BookingChannel;
  partyOnly?: boolean;
  productType?: AdmissionProductType;
  visitDate?: string;
  visitFrom?: string;
  visitTo?: string;
  assignedStaffUserId?: string;
};

export type BookingExportRow = {
  publicId: string;
  venue: string;
  datetime: string;
  guest: string;
  email: string;
  phone: string;
  status: string;
  channel: string;
  products: string;
  qty: number;
  total: number;
  paid: number;
  due: number;
  staff: string;
  company: string;
};

function csvEscape(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function bookingToExportRow(b: BookingListItem): BookingExportRow {
  const products = (b.lines ?? [])
    .map((l) => `${l.productName}${l.priceBandCode ? ` (${l.priceBandCode})` : ""}`)
    .join("; ");
  const qty = (b.lines ?? []).reduce((s, l) => s + (l.qty || 0), 0);
  const staffName = b.assignedStaff?.name || b.assignedStaff?.email || "";
  return {
    publicId: b.publicId,
    venue: b.location?.name ?? "",
    datetime: b.visitStartsAt ?? "",
    guest: b.primaryContactName ?? "",
    email: b.primaryContactEmail ?? "",
    phone: b.primaryContactPhone ?? "",
    status: b.status,
    channel: b.channel,
    products,
    qty,
    total: b.total,
    paid: b.amountPaid,
    due: b.amountDue,
    staff: staffName,
    company: b.account?.name ?? "",
  };
}

export const BOOKING_EXPORT_COLUMNS: (keyof BookingExportRow)[] = [
  "publicId",
  "venue",
  "datetime",
  "guest",
  "email",
  "phone",
  "status",
  "channel",
  "products",
  "qty",
  "total",
  "paid",
  "due",
  "staff",
  "company",
];

export function rowsToCsv(rows: BookingExportRow[]): string {
  const header = BOOKING_EXPORT_COLUMNS.join(",");
  const lines = rows.map((r) =>
    BOOKING_EXPORT_COLUMNS.map((c) => csvEscape(r[c])).join(",")
  );
  return [header, ...lines].join("\n");
}

/** Collect up to maxRows matching filters (HQ scope applied inside listBookings). */
export async function collectBookingsForExport(
  actor: TicketingActor,
  filters: BookingExportFilters,
  maxRows = 5000
): Promise<BookingExportRow[]> {
  const all: BookingExportRow[] = [];
  let skip = 0;
  const pageSize = 200;
  for (;;) {
    const page = await listBookings(actor, {
      ...filters,
      skip,
      take: pageSize,
    });
    for (const b of page.bookings) {
      all.push(bookingToExportRow(b));
      if (all.length >= maxRows) return all;
    }
    if (page.bookings.length < pageSize || skip + pageSize >= page.total) break;
    skip += pageSize;
  }
  return all;
}
