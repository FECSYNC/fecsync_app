/**
 * Booking invoices — INV-{orgSlug}-{seq}.
 */
import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import {
  assertTicketingStaffMutate,
  assertTicketingStaffRead,
  assertLocationInHqScope,
  locationScopeFilter,
  applyTicketingLocationScope,
  type TicketingActor,
} from "@/lib/ticketing/common";
import {
  TicketingError,
  BOOKING_NOT_FOUND,
  INVOICE_NOT_CANCELLABLE,
} from "@/lib/ticketing/errors";
import { logBookingActivity } from "@/lib/ticketing/activity";
import { toNum, money } from "@/lib/ticketing/bookingEngine";
import { isBookingStatusPayable } from "@/lib/ticketing/bookingPayable";

/**
 * Shared INV-{orgSlug}-{seq} generator for booking and accounting (manual /
 * credit note) invoices. Callers retry on P2002 (unique orgId+number).
 */
export async function nextInvoiceNumber(
  orgId: string,
  db: Pick<typeof prisma, "organization" | "bookingInvoice"> = prisma,
  attempt = 0
): Promise<string> {
  const org = await db.organization.findFirst({
    where: { id: orgId },
    select: { slug: true },
  });
  const slug = (org?.slug || "ORG").toUpperCase().slice(0, 12);
  const count = await db.bookingInvoice.count({ where: { orgId } });
  const seq = String(count + 1 + attempt).padStart(5, "0");
  return `INV-${slug}-${seq}`;
}

export function newInvoiceViewToken(): string {
  return randomBytes(24).toString("base64url");
}

export function toInvoiceDto(row: {
  id: string;
  orgId: string;
  locationId: string;
  bookingId: string | null;
  accountId: string | null;
  number: string;
  status: string;
  amount: Decimal;
  currency: string;
  dueAt: Date | null;
  sentAt: Date | null;
  voidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    bookingId: row.bookingId,
    accountId: row.accountId,
    number: row.number,
    status: row.status,
    amount: toNum(row.amount),
    currency: row.currency,
    dueAt: row.dueAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createBookingInvoice(
  actor: TicketingActor,
  bookingId: string
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const booking = await prisma.booking.findFirst({
    where: { id: requireId(bookingId, "bookingId"), orgId },
  });
  if (!booking) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  await assertLocationInHqScope(actor, booking.locationId);

  if (!isBookingStatusPayable(booking.status)) {
    throw new Error("Cannot create invoice for this booking status");
  }

  const due = toNum(booking.amountDue);
  if (!(due > 0)) {
    throw new Error("Cannot create invoice — booking has no amount due");
  }
  const amount = due;
  let invoice = null as Awaited<
    ReturnType<typeof prisma.bookingInvoice.create>
  > | null;
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const number = await nextInvoiceNumber(orgId, prisma, i);
      invoice = await prisma.bookingInvoice.create({
        data: {
          orgId,
          locationId: booking.locationId,
          bookingId: booking.id,
          accountId: booking.accountId,
          number,
          status: "draft",
          kind: "booking",
          amount: money(amount),
          subtotal: money(amount),
          amountDue: money(amount),
          issueDate: new Date(),
          customerName: booking.primaryContactName,
          customerEmail: booking.primaryContactEmail,
          customerUserId: booking.userId,
          viewToken: newInvoiceViewToken(),
          dueAt: new Date(Date.now() + 14 * 86400000),
        },
      });
      break;
    } catch (err) {
      lastErr = err;
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code !== "P2002") throw err;
    }
  }
  if (!invoice) throw lastErr instanceof Error ? lastErr : new Error("Invoice create failed");

  await logBookingActivity({
    orgId,
    locationId: booking.locationId,
    bookingId: booking.id,
    kind: "system",
    payload: { event: "invoice_created", invoiceId: invoice.id, number: invoice.number },
    actorUserId: actor.sub ?? null,
  });

  return toInvoiceDto(invoice);
}

export async function getBookingInvoice(
  actor: TicketingActor,
  invoiceId: string
) {
  const orgId = await assertTicketingStaffRead(actor);
  const invoice = await prisma.bookingInvoice.findFirst({
    where: { id: requireId(invoiceId, "invoiceId"), orgId },
  });
  if (!invoice) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  await assertLocationInHqScope(actor, invoice.locationId);
  return toInvoiceDto(invoice);
}

export async function patchBookingInvoice(
  actor: TicketingActor,
  invoiceId: string,
  patch: { amount?: number; dueAt?: string | null; status?: string }
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const invoice = await prisma.bookingInvoice.findFirst({
    where: { id: requireId(invoiceId, "invoiceId"), orgId },
  });
  if (!invoice) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  await assertLocationInHqScope(actor, invoice.locationId);

  if (invoice.status === "paid" || invoice.status === "cancelled") {
    throw new TicketingError(INVOICE_NOT_CANCELLABLE, 400);
  }

  const allowed = new Set(["draft", "sent", "overdue", "cancelled"]);
  if (patch.status && !allowed.has(patch.status)) {
    throw new Error("Invoice status cannot be set this way");
  }

  const updated = await prisma.bookingInvoice.update({
    where: { id: invoice.id },
    data: {
      ...(patch.amount != null
        ? {
            amount: money(Number(patch.amount)),
            subtotal: money(Number(patch.amount)),
            amountDue: money(Number(patch.amount)),
          }
        : {}),
      ...(patch.dueAt !== undefined
        ? { dueAt: patch.dueAt ? new Date(patch.dueAt) : null }
        : {}),
      ...(patch.status
        ? {
            status: patch.status as
              | "draft"
              | "sent"
              | "cancelled"
              | "overdue",
          }
        : {}),
    },
  });
  return toInvoiceDto(updated);
}

export async function sendBookingInvoice(
  actor: TicketingActor,
  invoiceId: string
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const invoice = await prisma.bookingInvoice.findFirst({
    where: { id: requireId(invoiceId, "invoiceId"), orgId },
    include: {
      booking: true,
      account: true,
    },
  });
  if (!invoice) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  await assertLocationInHqScope(actor, invoice.locationId);

  const to =
    invoice.booking?.primaryContactEmail ||
    invoice.account?.billingEmail ||
    null;
  if (!to) throw new Error("No email on booking or account");

  if (process.env.NOTIFICATION_EMAIL_USER?.trim()) {
    try {
      const { sendInvoiceMail } = await import("@/lib/sendInvoice");
      await sendInvoiceMail({
        to,
        subject: `Invoice ${invoice.number}`,
        orgId,
        data: {
          customerName:
            invoice.booking?.primaryContactName ||
            invoice.account?.name ||
            "Customer",
          invoiceId: invoice.number,
          items: [
            {
              product: {
                name: `Booking ${invoice.booking?.publicId || ""}`,
                price: toNum(invoice.amount),
              },
              quantity: 1,
            },
          ],
          totalAmount: toNum(invoice.amount),
          dueDate: invoice.dueAt?.toISOString().slice(0, 10) || "",
          date: new Date().toISOString().slice(0, 10),
          paymentMethod: "invoice",
        },
      });
    } catch (err) {
      console.warn("[booking invoice] send failed", err);
    }
  }

  const updated = await prisma.bookingInvoice.update({
    where: { id: invoice.id },
    data: {
      status: "sent",
      sentAt: new Date(),
      ...(invoice.viewToken ? {} : { viewToken: newInvoiceViewToken() }),
    },
  });

  if (invoice.bookingId) {
    await logBookingActivity({
      orgId,
      locationId: invoice.locationId,
      bookingId: invoice.bookingId,
      kind: "email",
      payload: {
        template: "invoice",
        to,
        invoiceId: invoice.id,
        number: invoice.number,
      },
      actorUserId: actor.sub ?? null,
    });
  }

  return toInvoiceDto(updated);
}

export async function cancelBookingInvoice(
  actor: TicketingActor,
  invoiceId: string
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const invoice = await prisma.bookingInvoice.findFirst({
    where: { id: requireId(invoiceId, "invoiceId"), orgId },
  });
  if (!invoice) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  if (invoice.status === "paid") {
    throw new TicketingError(INVOICE_NOT_CANCELLABLE, 400);
  }
  const updated = await prisma.bookingInvoice.update({
    where: { id: invoice.id },
    data: { status: "cancelled", voidedAt: new Date(), amountDue: money(0) },
  });
  return toInvoiceDto(updated);
}

export async function listBookingInvoices(
  actor: TicketingActor,
  filters: { bookingId?: string; accountId?: string } = {}
) {
  const scope = await locationScopeFilter(actor);
  await assertTicketingStaffRead(actor);
  const where: Prisma.BookingInvoiceWhereInput = { orgId: scope.orgId };
  applyTicketingLocationScope(scope, where);
  if (filters.bookingId && isValidId(filters.bookingId)) {
    where.bookingId = filters.bookingId;
  }
  if (filters.accountId && isValidId(filters.accountId)) {
    where.accountId = filters.accountId;
  }
  const rows = await prisma.bookingInvoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(toInvoiceDto);
}
