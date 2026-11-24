/**
 * Outstanding party balances. Balance = Booking.amountDue (single source).
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { partyStaffContext, type PartyActor } from "@/lib/parties/gate";
import { partyLocationWhere } from "@/lib/parties/scope";
import { toCents } from "@/lib/parties/deposits";

export async function listPartyBalances(
  actor: PartyActor,
  opts: {
    status?: string | null;
    locationId?: string | null;
    dueBefore?: string | null;
    depositUnpaidOnly?: boolean;
    take?: number;
    skip?: number;
  } = {}
) {
  const ctx = await partyStaffContext(actor);
  const where: Prisma.PartyBookingDetailWhereInput = {
    orgId: ctx.orgId,
    ...partyLocationWhere(ctx.scope, opts.locationId),
    booking: {
      amountDue: { gt: 0 },
      status: { in: ["hold", "reserved", "pending_payment", "confirmed"] },
    },
  };
  if (opts.dueBefore) {
    const d = new Date(opts.dueBefore);
    if (Number.isNaN(d.getTime())) throw new Error("dueBefore is invalid");
    where.balanceDueAt = { lt: d };
  }
  if (opts.depositUnpaidOnly) {
    where.AND = [{ depositRequiredCents: { gt: 0 } }, { depositPaidCents: { lt: prisma.partyBookingDetail.fields.depositRequiredCents } }];
  }
  const take = Math.min(Math.max(1, opts.take ?? 100), 500);
  const skip = Math.max(0, opts.skip ?? 0);
  const [rows, total, sum] = await Promise.all([
    prisma.partyBookingDetail.findMany({
      where,
      orderBy: [{ balanceDueAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take,
      skip,
      select: {
        bookingId: true,
        partyName: true,
        depositRequiredCents: true,
        depositPaidCents: true,
        depositDueAt: true,
        balanceDueAt: true,
        location: { select: { id: true, name: true, timezone: true } },
        booking: {
          select: {
            publicId: true,
            status: true,
            visitStartsAt: true,
            total: true,
            amountPaid: true,
            amountDue: true,
            primaryContactName: true,
            primaryContactEmail: true,
            primaryContactPhone: true,
          },
        },
      },
    }),
    prisma.partyBookingDetail.count({ where }),
    prisma.booking.aggregate({
      where: { partyDetail: { is: where } },
      _sum: { amountDue: true },
    }),
  ]);
  return {
    total,
    take,
    skip,
    outstandingCents: toCents(sum._sum.amountDue ?? 0),
    balances: rows.map((r) => ({
      bookingId: r.bookingId,
      publicId: r.booking.publicId,
      status: r.booking.status,
      partyName: r.partyName,
      location: { id: r.location.id, name: r.location.name },
      timezone: r.location.timezone,
      visitStartsAt: r.booking.visitStartsAt?.toISOString() ?? null,
      contactName: r.booking.primaryContactName,
      contactEmail: r.booking.primaryContactEmail,
      contactPhone: r.booking.primaryContactPhone,
      totalCents: toCents(r.booking.total),
      amountPaidCents: toCents(r.booking.amountPaid),
      amountDueCents: toCents(r.booking.amountDue),
      depositRequiredCents: r.depositRequiredCents,
      depositPaidCents: r.depositPaidCents,
      depositDueAt: r.depositDueAt?.toISOString() ?? null,
      balanceDueAt: r.balanceDueAt?.toISOString() ?? null,
    })),
  };
}
