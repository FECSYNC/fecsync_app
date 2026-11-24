/**
 * Marketplace booking refunds (World B).
 * Application fee refunded by default (Stripe refund_application_fee).
 */

import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { assertActorOrgMatch } from "@/lib/staffOrg";
import { assertOrganizationAllowsWorkspaceLifecycle } from "@/lib/org";
import { stripeConnectMarketplaceProvider } from "@/lib/marketplace/account";
import {
  enqueueSource,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

export const MARKETPLACE_REFUND_NOT_FOUND = "Marketplace booking not found";
export const MARKETPLACE_REFUND_INVALID_STATUS =
  "Only paid or partially refunded bookings can be refunded";
export const MARKETPLACE_REFUND_AMOUNT_EXCEEDED =
  "Refund amount exceeds remaining refundable balance";
export const MARKETPLACE_REFUND_IN_PROGRESS =
  "A refund is already in progress for this booking";

const REFUND_CLAIM_TTL_MS = 2 * 60 * 1000;

function bookingMeta(
  raw: unknown
): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

async function clearRefundClaim(bookingId: string, claimId: string) {
  try {
    const row = await prisma.marketplaceBooking.findUnique({
      where: { id: bookingId },
      select: { metadata: true },
    });
    const meta = bookingMeta(row?.metadata);
    if (meta.refundClaimId !== claimId) return;
    const { refundClaimId: _a, refundClaimAmount: _b, refundClaimAt: _c, ...rest } =
      meta;
    await prisma.marketplaceBooking.update({
      where: { id: bookingId },
      data: { metadata: rest },
    });
  } catch (err) {
    console.warn(
      "[marketplace refund] failed to clear refund claim",
      bookingId,
      err instanceof Error ? err.message : err
    );
  }
}

export async function refundMarketplaceBooking(opts: {
  actorOrgId: string;
  bookingId: string;
  actorUserId: string;
  amountMinor?: number | null;
  reason?: string | null;
}): Promise<{
  bookingId: string;
  status: string;
  refundId: string;
  amountMinor: number;
}> {
  const orgId = requireId(opts.actorOrgId, "orgId");
  // Soft-hold / suspended (non ops_hold): still allow reversing paid money.
  // New checkout stays fail-closed via assertOrgMarketplaceChargeReady.
  await assertOrganizationAllowsWorkspaceLifecycle(orgId);

  const bookingId = requireId(opts.bookingId, "bookingId");

  // Validate outside the write tx (and before Stripe). Cross-tenant ids map to
  // the same not-found message so existence is not leaked across orgs.
  const booking = await prisma.marketplaceBooking.findUnique({
    where: { id: bookingId },
  });
  if (!booking || booking.orgId !== orgId) {
    throw new ForbiddenError(MARKETPLACE_REFUND_NOT_FOUND);
  }
  assertActorOrgMatch(orgId, booking.orgId);

  if (booking.status !== "paid" && booking.status !== "partially_refunded") {
    throw new ForbiddenError(MARKETPLACE_REFUND_INVALID_STATUS);
  }

  // Claim under row lock (pool-safe). Session advisory locks are unsafe with
  // Prisma's connection pool — lock/unlock may run on different connections.
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM marketplace_bookings WHERE id = ${booking.id} FOR UPDATE
    `;
    const live = await tx.marketplaceBooking.findUnique({
      where: { id: booking.id },
    });
    if (!live || live.orgId !== orgId) {
      throw new ForbiddenError(MARKETPLACE_REFUND_NOT_FOUND);
    }
    if (live.status !== "paid" && live.status !== "partially_refunded") {
      throw new ForbiddenError(MARKETPLACE_REFUND_INVALID_STATUS);
    }

    const meta = bookingMeta(live.metadata);
    const claimAtRaw = meta.refundClaimAt;
    const claimAt =
      typeof claimAtRaw === "string" ? Date.parse(claimAtRaw) : NaN;
    if (
      typeof meta.refundClaimId === "string" &&
      meta.refundClaimId &&
      Number.isFinite(claimAt) &&
      Date.now() - claimAt < REFUND_CLAIM_TTL_MS
    ) {
      throw new ForbiddenError(MARKETPLACE_REFUND_IN_PROGRESS);
    }

    const alreadyRefunded = await tx.marketplaceRefund.aggregate({
      where: { bookingId: live.id },
      _sum: { amountMinor: true },
    });
    const refundedSoFar = alreadyRefunded._sum.amountMinor ?? 0;
    const remaining = live.amountMinor - refundedSoFar;
    if (remaining <= 0) {
      throw new ForbiddenError(MARKETPLACE_REFUND_AMOUNT_EXCEEDED);
    }

    const amount =
      opts.amountMinor == null
        ? remaining
        : Math.floor(Number(opts.amountMinor));
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) {
      throw new ForbiddenError(MARKETPLACE_REFUND_AMOUNT_EXCEEDED);
    }

    const livePi = live.stripePaymentIntentId?.trim();
    if (!livePi) {
      throw new ForbiddenError("Booking has no payment intent to refund");
    }

    const claimId = `rc_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    await tx.marketplaceBooking.update({
      where: { id: live.id },
      data: {
        metadata: {
          ...meta,
          refundClaimId: claimId,
          refundClaimAmount: amount,
          refundClaimAt: new Date().toISOString(),
        },
      },
    });

    return {
      bookingId: live.id,
      currency: live.currency,
      amountMinor: live.amountMinor,
      amount,
      livePi,
      claimId,
    };
  });

  let stripeRefund;
  try {
    stripeRefund = await stripeConnectMarketplaceProvider.createRefund({
      paymentIntentId: prepared.livePi,
      amountMinor: prepared.amount,
      refundApplicationFee: true,
      reason: opts.reason || undefined,
      // Claim id makes concurrent different-amount attempts distinct at Stripe.
      idempotencyKey: `mkt-refund:${prepared.bookingId}:${prepared.claimId}`,
    });
  } catch (err) {
    await clearRefundClaim(prepared.bookingId, prepared.claimId);
    throw err;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM marketplace_bookings WHERE id = ${prepared.bookingId} FOR UPDATE
      `;
      const row = await tx.marketplaceBooking.findUnique({
        where: { id: prepared.bookingId },
      });
      if (!row || row.orgId !== orgId) {
        throw new ForbiddenError(MARKETPLACE_REFUND_NOT_FOUND);
      }
      if (row.status !== "paid" && row.status !== "partially_refunded") {
        throw new ForbiddenError(MARKETPLACE_REFUND_INVALID_STATUS);
      }

      const sum = await tx.marketplaceRefund.aggregate({
        where: { bookingId: row.id },
        _sum: { amountMinor: true },
      });
      const refundedNow = sum._sum.amountMinor ?? 0;
      if (refundedNow + prepared.amount > row.amountMinor) {
        throw new ForbiddenError(MARKETPLACE_REFUND_AMOUNT_EXCEEDED);
      }

      await tx.marketplaceRefund.create({
        data: {
          orgId: row.orgId,
          bookingId: row.id,
          amountMinor: prepared.amount,
          currency: row.currency,
          stripeRefundId: stripeRefund.id,
          reason: opts.reason?.trim()?.slice(0, 500) || null,
          actorUserId: opts.actorUserId,
          refundApplicationFee: true,
        },
      });

      const newTotal = refundedNow + prepared.amount;
      const status =
        newTotal >= row.amountMinor ? "refunded" : "partially_refunded";

      const meta = bookingMeta(row.metadata);
      const {
        refundClaimId: _a,
        refundClaimAmount: _b,
        refundClaimAt: _c,
        ...restMeta
      } = meta;

      await tx.marketplaceBooking.update({
        where: { id: row.id },
        data: { status, metadata: restMeta },
      });
      await enqueueSource(tx, {
        orgId: row.orgId,
        locationId: row.locationId,
        sourceType: "marketplace_refund",
        sourceId: row.id,
        sourceEvent: `refund:${newTotal}`,
      });

      return {
        bookingId: row.id,
        status,
        refundId: stripeRefund.id,
        amountMinor: prepared.amount,
      };
    });
    flushAccountingQueueSoon(orgId);
    return result;
  } catch (err) {
    // Idempotent replay: unique stripeRefundId already written.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      const existing = await prisma.marketplaceRefund.findUnique({
        where: { stripeRefundId: stripeRefund.id },
      });
      if (existing && existing.orgId === orgId) {
        await clearRefundClaim(prepared.bookingId, prepared.claimId);
        const row = await prisma.marketplaceBooking.findUnique({
          where: { id: existing.bookingId },
        });
        return {
          bookingId: existing.bookingId,
          status: row?.status ?? "partially_refunded",
          refundId: existing.stripeRefundId!,
          amountMinor: existing.amountMinor,
        };
      }
    }
    await clearRefundClaim(prepared.bookingId, prepared.claimId);
    console.error(
      "[marketplace refund] Stripe refund succeeded but ledger write failed",
      { bookingId: booking.id, stripeRefundId: stripeRefund.id, err }
    );
    throw err;
  }
}
