/**
 * Public BookingPackage checkout — destination charges to connected account.
 * Client may only supply email, name, idempotencyKey — never price/fee/org/account.
 *
 * Public not-found / unavailable paths throw ForbiddenError (same message) so
 * routes can map MARKETPLACE_PACKAGE_NOT_FOUND → 404 without a separate
 * NotFoundError type; this matches the project's public auth-error pattern.
 */

import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { resolveGuestPayoutDestination } from "@/lib/marketplace/guestPayoutDestination";
import { computePlatformFeeMinor } from "@/lib/marketplace/fees";
import { stripeConnectMarketplaceProvider } from "@/lib/marketplace/account";

export const MARKETPLACE_PACKAGE_NOT_FOUND =
  "Booking package not found or not available";
export const MARKETPLACE_CAPACITY_FULL =
  "This booking package is sold out";
export const MARKETPLACE_CHECKOUT_EMAIL_REQUIRED =
  "A valid email is required to checkout";

function normalizeEmail(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s || !s.includes("@") || s.length > 254) {
    throw new ForbiddenError(MARKETPLACE_CHECKOUT_EMAIL_REQUIRED);
  }
  return s;
}

function normalizeIdempotencyKey(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length < 8 || s.length > 128) {
    throw new ForbiddenError("idempotencyKey must be 8–128 characters");
  }
  return s;
}

/** Resolve registered company by public slug (never storefront as merchant). */
export async function resolvePublicMarketplaceOrg(publicOrgKey: string): Promise<{
  id: string;
  slug: string;
  name: string;
}> {
  const key = publicOrgKey.trim().toLowerCase();
  if (!key) throw new ForbiddenError(MARKETPLACE_PACKAGE_NOT_FOUND);
  const org = await prisma.organization.findFirst({
    where: {
      OR: [{ slug: key }, { id: key }],
      isDefault: false,
      status: "active",
    },
    select: { id: true, slug: true, name: true, isDefault: true },
  });
  if (!org || org.isDefault) {
    throw new ForbiddenError(MARKETPLACE_PACKAGE_NOT_FOUND);
  }
  return { id: org.id, slug: org.slug, name: org.name };
}

export async function getPublishedBookingPackagePublic(
  publicOrgKey: string,
  slug: string
) {
  const org = await resolvePublicMarketplaceOrg(publicOrgKey);
  const pkg = await prisma.bookingPackage.findFirst({
    where: {
      orgId: org.id,
      slug: slug.trim().toLowerCase(),
      published: true,
      active: true,
    },
  });
  if (!pkg) throw new ForbiddenError(MARKETPLACE_PACKAGE_NOT_FOUND);
  assertPackageSaleWindow(pkg);
  return {
    org: { slug: org.slug, name: org.name },
    package: {
      slug: pkg.slug,
      title: pkg.title,
      description: pkg.description,
      amountMinor: pkg.amountMinor,
      currency: pkg.currency,
      capacity: pkg.capacity,
      startsAt: pkg.startsAt?.toISOString() ?? null,
      endsAt: pkg.endsAt?.toISOString() ?? null,
    },
  };
}

/**
 * Count seats that hold capacity: open checkouts + paid / disputed /
 * partially_refunded (full refund / cancel / fail frees the seat).
 */
async function countCapacityUsed(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  packageId: string
): Promise<number> {
  return tx.marketplaceBooking.count({
    where: {
      packageId,
      status: {
        in: ["pending_payment", "paid", "disputed", "partially_refunded"],
      },
    },
  });
}

function assertPackageSaleWindow(pkg: {
  startsAt: Date | null;
  endsAt: Date | null;
}): void {
  const now = Date.now();
  if (pkg.startsAt && pkg.startsAt.getTime() > now) {
    throw new ForbiddenError(MARKETPLACE_PACKAGE_NOT_FOUND);
  }
  if (pkg.endsAt && pkg.endsAt.getTime() < now) {
    throw new ForbiddenError(MARKETPLACE_PACKAGE_NOT_FOUND);
  }
}

/** Lock package row so concurrent checkouts cannot oversell capacity. */
async function lockBookingPackageRow(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  packageId: string
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM booking_packages WHERE id = ${packageId} FOR UPDATE
  `;
}

export async function createMarketplaceBookingCheckout(opts: {
  publicOrgKey: string;
  packageSlug: string;
  email: unknown;
  name?: unknown;
  idempotencyKey: unknown;
  customerUserId?: string | null;
}): Promise<{ url: string; bookingId: string }> {
  const email = normalizeEmail(opts.email);
  const idempotencyKey = normalizeIdempotencyKey(opts.idempotencyKey);
  const customerName =
    typeof opts.name === "string" && opts.name.trim()
      ? opts.name.trim().slice(0, 120)
      : null;

  const org = await resolvePublicMarketplaceOrg(opts.publicOrgKey);

  const pkg = await prisma.bookingPackage.findFirst({
    where: {
      orgId: org.id,
      slug: opts.packageSlug.trim().toLowerCase(),
      published: true,
      active: true,
    },
  });
  if (!pkg) throw new ForbiddenError(MARKETPLACE_PACKAGE_NOT_FOUND);
  if (pkg.orgId !== org.id) {
    throw new ForbiddenError(MARKETPLACE_PACKAGE_NOT_FOUND);
  }
  assertPackageSaleWindow(pkg);

  // Destination from package.locationId — never client. Franchise parks fail
  // closed until park Connect is charge-ready; null/non-franchise → org Connect.
  const chargeReady = await resolveGuestPayoutDestination({
    orgId: org.id,
    locationId: pkg.locationId,
  });

  // Idempotent replay — return existing open session URL.
  const existing = await prisma.marketplaceBooking.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    if (existing.orgId !== org.id || existing.packageId !== pkg.id) {
      throw new ForbiddenError("idempotencyKey already used for another booking");
    }
    if (
      existing.status === "pending_payment" &&
      existing.stripeCheckoutSessionId
    ) {
      const { getCheckoutSession } = await import("@/lib/stripe");
      try {
        const session = await getCheckoutSession(existing.stripeCheckoutSessionId);
        if (session.url && session.status !== "expired") {
          return { url: session.url, bookingId: existing.id };
        }
      } catch {
        // fall through to recreate if session gone
      }
    }
    if (existing.status === "paid") {
      throw new ForbiddenError("This booking was already paid");
    }
    if (
      existing.status === "partially_refunded" ||
      existing.status === "refunded" ||
      existing.status === "disputed"
    ) {
      throw new ForbiddenError("This booking was already paid");
    }
  }

  const amountMinor = pkg.amountMinor;
  const currency = pkg.currency.toLowerCase();
  let platformFeeMinor: number;
  try {
    platformFeeMinor = computePlatformFeeMinor({
      amountMinor,
      platformFeeBpsOverride: chargeReady.platformFeeBpsOverride,
    });
  } catch (err) {
    throw new ForbiddenError(
      err instanceof Error ? err.message : "Invalid platform fee for this amount"
    );
  }
  const connectedAccountId = chargeReady.connectedAccountId;

  const booking = await prisma.$transaction(async (tx) => {
    // Reuse pending row (expired session recreate) or failed/cancelled retry
    // with the same idempotency key — never insert a duplicate unique key.
    if (
      existing &&
      (existing.status === "pending_payment" ||
        existing.status === "failed" ||
        existing.status === "cancelled")
    ) {
      await lockBookingPackageRow(tx, pkg.id);
      await tx.$queryRaw`
        SELECT id FROM marketplace_bookings WHERE id = ${existing.id} FOR UPDATE
      `;
      const live = await tx.marketplaceBooking.findUnique({
        where: { id: existing.id },
      });
      if (!live) {
        throw new ForbiddenError("Booking disappeared during checkout");
      }
      if (
        live.status === "paid" ||
        live.status === "partially_refunded" ||
        live.status === "refunded" ||
        live.status === "disputed"
      ) {
        throw new ForbiddenError("This booking was already paid");
      }
      if (
        live.status !== "pending_payment" &&
        live.status !== "failed" &&
        live.status !== "cancelled"
      ) {
        throw new ForbiddenError("This booking cannot be checked out");
      }
      if (pkg.capacity != null && live.status !== "pending_payment") {
        // pending already counted; failed/cancelled freed the seat — re-check.
        const used = await countCapacityUsed(tx, pkg.id);
        if (used >= pkg.capacity) {
          throw new ForbiddenError(MARKETPLACE_CAPACITY_FULL);
        }
      }
      const prevMeta =
        live.metadata &&
        typeof live.metadata === "object" &&
        !Array.isArray(live.metadata)
          ? (live.metadata as Record<string, unknown>)
          : {};
      const prevAttempt = Number(prevMeta.checkoutAttempt) || 0;
      return tx.marketplaceBooking.update({
        where: { id: live.id },
        data: {
          customerEmail: email,
          customerName,
          customerUserId: opts.customerUserId?.trim() || null,
          amountMinor,
          currency,
          platformFeeMinor,
          connectedAccountId,
          locationId: pkg.locationId,
          status: "pending_payment",
          // Keep prior session id until the new session is bound (webhook
          // session_mismatch rejects stale completions after replace).
          // Clear PI — a new Checkout Session creates a new PI.
          stripePaymentIntentId: null,
          paidAt: null,
          metadata: {
            ...prevMeta,
            checkoutAttempt: prevAttempt + 1,
            priorCheckoutSessionId:
              live.stripeCheckoutSessionId ||
              prevMeta.priorCheckoutSessionId ||
              null,
          },
        },
      });
    }

    // Serialize capacity checks across concurrent checkouts for this package.
    await lockBookingPackageRow(tx, pkg.id);
    if (pkg.capacity != null) {
      const used = await countCapacityUsed(tx, pkg.id);
      if (used >= pkg.capacity) {
        throw new ForbiddenError(MARKETPLACE_CAPACITY_FULL);
      }
    }
    return tx.marketplaceBooking.create({
      data: {
        orgId: org.id,
        locationId: pkg.locationId,
        packageId: pkg.id,
        customerUserId: opts.customerUserId?.trim() || null,
        customerEmail: email,
        customerName,
        amountMinor,
        currency,
        platformFeeMinor,
        status: "pending_payment",
        connectedAccountId,
        idempotencyKey,
        metadata: { checkoutAttempt: 1 },
      },
    });
  }).catch(async (err) => {
    // Concurrent first-insert with the same idempotencyKey — reuse the winner.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      const raced = await prisma.marketplaceBooking.findUnique({
        where: { idempotencyKey },
      });
      if (
        raced &&
        raced.orgId === org.id &&
        raced.packageId === pkg.id &&
        (raced.status === "pending_payment" ||
          raced.status === "failed" ||
          raced.status === "cancelled")
      ) {
        return raced;
      }
    }
    throw err;
  });

  // Expire a stale open session before creating a replacement so two live
  // Checkout Sessions cannot both settle the same booking.
  const staleSessionId = booking.stripeCheckoutSessionId?.trim() || null;
  const metaObj =
    booking.metadata &&
    typeof booking.metadata === "object" &&
    !Array.isArray(booking.metadata)
      ? (booking.metadata as Record<string, unknown>)
      : {};
  const checkoutAttempt = Number(metaObj.checkoutAttempt) || 1;

  // Live open session on first bind — return it (attempt stays 1 after create).
  // Recreate paths bump attempt and must mint a new Stripe session.
  if (staleSessionId && checkoutAttempt <= 1 && existing?.status === "pending_payment") {
    const { getCheckoutSession } = await import("@/lib/stripe");
    try {
      const session = await getCheckoutSession(staleSessionId);
      if (session.url && session.status !== "expired") {
        return { url: session.url, bookingId: booking.id };
      }
    } catch {
      /* recreate */
    }
  }

  if (staleSessionId) {
    try {
      const stripe = (await import("@/lib/stripe")).getStripe();
      await stripe.checkout.sessions.expire(staleSessionId);
    } catch {
      // Already expired / completed — webhook session_mismatch handles the rest.
    }
  }

  const base = publicAppBaseUrl();
  const successUrl = `${base}/book/${encodeURIComponent(org.slug)}/${encodeURIComponent(pkg.slug)}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${base}/book/${encodeURIComponent(org.slug)}/${encodeURIComponent(pkg.slug)}/cancel?bookingId=${booking.id}`;

  const metadata: Record<string, string> = {
    type: "marketplace_booking",
    orgId: org.id,
    bookingId: booking.id,
    packageId: pkg.id,
    amountMinor: String(amountMinor),
    platformFeeMinor: String(platformFeeMinor),
  };

  // Stripe idempotency must change per recreate; include prior session id so a
  // reused client key cannot return an expired Checkout Session for 24h.
  const stripeIdempotencyKey = `${idempotencyKey}:a${checkoutAttempt}:${staleSessionId || "new"}`;

  // Re-check before minting a session — concurrent settlement may have paid.
  const preCreate = await prisma.marketplaceBooking.findFirst({
    where: {
      id: booking.id,
      status: { in: ["pending_payment", "failed", "cancelled"] },
    },
    select: { id: true },
  });
  if (!preCreate) {
    throw new ForbiddenError("This booking was already paid");
  }

  let session;
  try {
    session =
      await stripeConnectMarketplaceProvider.createDestinationCheckoutSession({
        amountMinor,
        currency,
        applicationFeeMinor: platformFeeMinor,
        connectedAccountId,
        customerEmail: email,
        productName: pkg.title,
        productDescription: pkg.description || undefined,
        successUrl,
        cancelUrl,
        metadata,
        idempotencyKey: stripeIdempotencyKey,
      });
  } catch (err) {
    // Pending without a live session never gets checkout.session.expired —
    // free the capacity seat so retries are not permanently sold-out.
    await prisma.marketplaceBooking.updateMany({
      where: {
        id: booking.id,
        status: "pending_payment",
      },
      data: { status: "failed" },
    });
    throw err;
  }

  const bound = await prisma.marketplaceBooking.updateMany({
    where: {
      id: booking.id,
      status: { in: ["pending_payment", "failed", "cancelled"] },
    },
    data: {
      status: "pending_payment",
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : null,
    },
  });
  if (bound.count === 0) {
    try {
      const stripe = (await import("@/lib/stripe")).getStripe();
      await stripe.checkout.sessions.expire(session.id);
    } catch {
      /* orphan session — webhook session_mismatch will ignore */
    }
    throw new ForbiddenError("This booking was already paid");
  }

  if (!session.url) {
    try {
      const stripe = (await import("@/lib/stripe")).getStripe();
      await stripe.checkout.sessions.expire(session.id);
    } catch {
      /* best-effort */
    }
    await prisma.marketplaceBooking.updateMany({
      where: { id: booking.id, status: "pending_payment" },
      data: { status: "failed" },
    });
    throw new Error("Stripe Checkout session missing url");
  }
  return { url: session.url, bookingId: booking.id };
}

/** Admin list — redacted (no Connect account / PI secrets beyond presence flags). */
export async function listMarketplaceBookingsForOrg(
  orgId: string,
  opts?: {
    take?: number;
    locationId?: string | null;
    locationIds?: string[];
    parkLocked?: boolean;
  }
) {
  const id = requireId(orgId, "orgId");
  const take = Math.min(Math.max(opts?.take ?? 50, 1), 100);
  const where: {
    orgId: string;
    locationId?: string | { in: string[] };
  } = { orgId: id };
  if (opts?.parkLocked) {
    if (opts.locationId) {
      where.locationId = opts.locationId;
    } else if (opts.locationIds?.length) {
      where.locationId = { in: opts.locationIds };
    } else {
      where.locationId = { in: [] };
    }
  } else if (opts?.locationId) {
    where.locationId = opts.locationId;
  }
  const rows = await prisma.marketplaceBooking.findMany({
    where,
    include: {
      package: { select: { id: true, title: true, slug: true } },
      refunds: { select: { amountMinor: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((b) => {
    const refundedMinor = b.refunds.reduce((s, r) => s + r.amountMinor, 0);
    return {
      id: b.id,
      packageId: b.packageId,
      packageTitle: b.package.title,
      packageSlug: b.package.slug,
      locationId: b.locationId,
      customerEmail: b.customerEmail,
      customerName: b.customerName,
      amountMinor: b.amountMinor,
      currency: b.currency,
      platformFeeMinor: b.platformFeeMinor,
      status: b.status,
      paidAt: b.paidAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      refundedMinor,
      refundableMinor: Math.max(0, b.amountMinor - refundedMinor),
      hasPaymentIntent: Boolean(b.stripePaymentIntentId?.trim()),
    };
  });
}
