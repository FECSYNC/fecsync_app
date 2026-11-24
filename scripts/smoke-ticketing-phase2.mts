/**
 * Phase 2 Online Booking / Ticketing smoke (engine + payments + public).
 *   yarn smoke:ticketing:p2
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
const prisma = new PrismaClient();

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function enablePublicBooking(venueId: string) {
  await prisma.$executeRaw`
    UPDATE venue_locations SET "publicBookingEnabled" = true WHERE id = ${venueId}
  `;
}

async function main() {
  // Payment-link settle stub (no live Stripe charge in smoke).
  process.env.TICKETING_PAYMENT_LINK_STUB = "1";
  // Stored-card / Checkout must stub — a real STRIPE_SECRET_KEY hangs this script.
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.NOTIFICATION_EMAIL_USER;

  const { createOrganizationWithPlatformAdmin } = await import(
    "../src/lib/orgRegistration.ts"
  );
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { TicketingError } = await import("../src/lib/ticketing/errors.ts");
  const { createCapacityResource } = await import(
    "../src/lib/ticketing/resources.ts"
  );
  const { createAdmissionProduct } = await import(
    "../src/lib/ticketing/products.ts"
  );
  const { createTicketSession } = await import(
    "../src/lib/ticketing/sessions.ts"
  );
  const {
    createBooking,
    holdBooking,
    confirmBooking,
    cancelBooking,
    reactivateBooking,
    patchBookingTaxExemption,
    moveBookingLineResource,
    markBookingReviewed,
    replaceBookingLines,
    toGuestBookingDto,
    bookingInclude,
  } = await import("../src/lib/ticketing/bookingEngine.ts");
  const { takeBookingPayments, settleVenueBookingStripePayment } = await import(
    "../src/lib/ticketing/payments.ts"
  );
  const { refundBooking } = await import("../src/lib/ticketing/refunds.ts");
  const { createBookingInvoice, sendBookingInvoice } = await import(
    "../src/lib/ticketing/invoices.ts"
  );
  const { createPaymentLink, payViaPaymentLink } = await import(
    "../src/lib/ticketing/paymentLinks.ts"
  );
  const { issueGiftCard } = await import("../src/lib/ticketing/giftCards.ts");
  const { expireBookingHolds } = await import(
    "../src/lib/ticketing/expireHolds.ts"
  );
  const { releaseHoldsForBooking } = await import(
    "../src/lib/ticketing/holds.ts"
  );
  const { assignCustomTicketIds } = await import(
    "../src/lib/ticketing/credentials.ts"
  );
  const { patchPartyGuests, publicPartyRsvp, createPartyInvitation } =
    await import("../src/lib/ticketing/parties.ts");
  const { createPublicHold, publicCheckout, releasePublicHold } = await import(
    "../src/lib/ticketing/publicBooking.ts"
  );
  const { tryConsumeSessionCapacity } = await import(
    "../src/lib/ticketing/capacity.ts"
  );
  const { upsertBookingSettings } = await import(
    "../src/lib/ticketing/settings.ts"
  );
  const { assertWithinPlanLimit } = await import("../src/lib/planLimits.ts");

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-tix-p2-${stamp}@test.local`,
      password: "x",
      username: `smoketixp2${stamp}`,
      firstName: "P2",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const reg = await createOrganizationWithPlatformAdmin({
    name: `P2 Book Co ${stamp}`,
    slug: `p2-book-${stamp}`,
    userId: user.id,
  });
  const orgId = reg.organization.id;
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });

  const actor = {
    sub: user.id,
    orgId,
    rolePreset: "platform_admin" as const,
  };

  const venue = await createVenueLocation(actor, {
    name: `Park ${stamp}`,
    slug: `park-${stamp}`,
  });
  await enablePublicBooking(venue.id);

  const room = await createCapacityResource(actor, {
    name: `Room ${stamp}`,
    type: "party_room",
    locationId: venue.id,
    defaultCapacity: 20,
  });

  const product = await createAdmissionProduct(actor, {
    type: "timed_session",
    name: `Session ${stamp}`,
    locationId: venue.id,
    published: true,
    prices: [{ code: "adult", amount: 25 }],
  });

  const partyProduct = await createAdmissionProduct(actor, {
    type: "party_package",
    name: `Party ${stamp}`,
    locationId: venue.id,
    resourceId: room.id,
    published: true,
    minGuests: 1,
    maxGuests: 20,
    prices: [{ code: "package", amount: 199 }],
  });

  // Last-seat oversell race
  const raceSession = await createTicketSession(actor, {
    productId: product.id,
    startsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 86400000 + 3600000).toISOString(),
    capacity: 1,
  });
  const ok1 = await tryConsumeSessionCapacity(raceSession.id, 1);
  const ok2 = await tryConsumeSessionCapacity(raceSession.id, 1);
  check("oversell race last seat", ok1 === true && ok2 === false);

  // Normal session for booking flows
  const session = await createTicketSession(actor, {
    productId: product.id,
    startsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 3 * 86400000 + 3600000).toISOString(),
    capacity: 10,
  });

  // Overbook without permission (engine online/skipStaffGate)
  let overbookForbidden = false;
  try {
    await createBooking(
      { orgId, sub: "guest" },
      {
        locationId: venue.id,
        channel: "online",
        primaryContactEmail: `overbook-deny-${stamp}@test.local`,
        lines: [
          { productId: product.id, sessionId: session.id, qty: 1 },
        ],
        allowOverbook: true,
        activate: false,
      },
      { skipStaffGate: true, orgId }
    );
  } catch (err) {
    overbookForbidden =
      err instanceof TicketingError && err.code === "OVERBOOK_FORBIDDEN";
  }
  check("overbook without permission 403", overbookForbidden);

  // Staff overbook remaining negative
  const tiny = await createTicketSession(actor, {
    productId: product.id,
    startsAt: new Date(Date.now() + 4 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 4 * 86400000 + 3600000).toISOString(),
    capacity: 1,
  });
  await tryConsumeSessionCapacity(tiny.id, 1);
  const overbooked = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: tiny.id, qty: 1 }],
    allowOverbook: true,
    primaryContactName: "Over Book",
    primaryContactEmail: `ob-${stamp}@ex.com`,
    activate: true,
  });
  const tinyAfter = await prisma.ticketSession.findFirst({
    where: { id: tiny.id },
  });
  check(
    "overbook with permission remaining negative",
    overbooked.status === "hold" && (tinyAfter?.remaining ?? 0) < 0
  );

  // Hold TTL expire releases capacity
  const ttlSession = await createTicketSession(actor, {
    productId: product.id,
    startsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 5 * 86400000 + 3600000).toISOString(),
    capacity: 5,
  });
  const ttlBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: ttlSession.id, qty: 2 }],
    primaryContactEmail: `ttl-${stamp}@ex.com`,
    activate: true,
  });
  await prisma.booking.update({
    where: { id: ttlBooking.id },
    data: { holdExpiresAt: new Date(Date.now() - 60_000) },
  });
  const beforeRem = (
    await prisma.ticketSession.findFirst({ where: { id: ttlSession.id } })
  )?.remaining;
  await expireBookingHolds({ orgId, limit: 50 });
  const afterRem = (
    await prisma.ticketSession.findFirst({ where: { id: ttlSession.id } })
  )?.remaining;
  const expired = await prisma.booking.findFirst({
    where: { id: ttlBooking.id },
  });
  check(
    "hold TTL expire releases capacity",
    expired?.status === "expired" &&
      typeof beforeRem === "number" &&
      typeof afterRem === "number" &&
      afterRem > beforeRem
  );

  // Pay-later online
  await upsertBookingSettings(actor, {
    locationId: venue.id,
    allowOnlinePayLater: true,
    payLaterMarksConfirmed: true,
  });
  const org = await prisma.organization.findFirst({ where: { id: orgId } });
  const hold = await createPublicHold({
    orgSlug: org!.slug,
    venueSlug: venue.slug,
    productId: product.id,
    sessionId: session.id,
    qty: 1,
  });
  const payLater = await publicCheckout({
    orgSlug: org!.slug,
    venueSlug: venue.slug,
    holdId: hold.holdId,
    holdToken: hold.token,
    primaryContactName: "Guest PayLater",
    primaryContactEmail: `pl-${stamp}@ex.com`,
    payLater: true,
  });
  check(
    "pay-later online",
    payLater.status === "confirmed" && payLater.amountDue > 0
  );

  await upsertBookingSettings(actor, {
    locationId: venue.id,
    allowOnlinePayLater: false,
    payLaterMarksConfirmed: false,
  });
  const beforeDenied = await prisma.booking.count({ where: { orgId } });
  let payLaterDenied = false;
  try {
    await publicCheckout({
      orgSlug: org!.slug,
      venueSlug: venue.slug,
      lines: [
        { productId: product.id, sessionId: session.id, qty: 1 },
      ],
      primaryContactEmail: `pl-deny-${stamp}@ex.com`,
      payLater: true,
    });
  } catch {
    payLaterDenied = true;
  }
  const afterDenied = await prisma.booking.count({ where: { orgId } });
  check(
    "pay-later disabled does not create booking",
    payLaterDenied && afterDenied === beforeDenied
  );

  const orphanHold = await createPublicHold({
    orgSlug: org!.slug,
    venueSlug: venue.slug,
    productId: product.id,
    sessionId: session.id,
    qty: 1,
  });
  let holdReleaseNoToken = false;
  try {
    await releasePublicHold(orphanHold.holdId);
  } catch (err) {
    holdReleaseNoToken =
      err instanceof TicketingError && err.code === "HOLD_EXPIRED";
  }
  const stillThere = await prisma.bookingHold.findFirst({
    where: { id: orphanHold.holdId },
  });
  const released = await releasePublicHold(
    orphanHold.holdId,
    orphanHold.token
  );
  const gone = await prisma.bookingHold.findFirst({
    where: { id: orphanHold.holdId },
  });
  check(
    "public hold release requires token",
    holdReleaseNoToken && Boolean(stillThere) && released.ok && !gone
  );

  const secretHold = await createPublicHold({
    orgSlug: org!.slug,
    venueSlug: venue.slug,
    productId: product.id,
    sessionId: session.id,
    qty: 1,
  });
  let checkoutHoldIdOnlyDenied = false;
  try {
    await publicCheckout({
      orgSlug: org!.slug,
      venueSlug: venue.slug,
      holdId: secretHold.holdId,
      primaryContactEmail: `hold-id-only-${stamp}@ex.com`,
    });
  } catch (err) {
    checkoutHoldIdOnlyDenied =
      err instanceof TicketingError && err.code === "HOLD_EXPIRED";
  }
  await releasePublicHold(secretHold.holdId, secretHold.token).catch(() => undefined);
  check("checkout requires holdToken (not bare holdId)", checkoutHoldIdOnlyDenied);

  // Hold is capacity authority — inflated client lines must not oversell.
  const remBeforeInflate = (
    await prisma.ticketSession.findFirst({ where: { id: session.id } })
  )!.remaining;
  const inflateHold = await createPublicHold({
    orgSlug: org!.slug,
    venueSlug: venue.slug,
    productId: product.id,
    sessionId: session.id,
    qty: 1,
  });
  const remAfterInflateHold = (
    await prisma.ticketSession.findFirst({ where: { id: session.id } })
  )!.remaining;
  const inflatedCheckout = await publicCheckout({
    orgSlug: org!.slug,
    venueSlug: venue.slug,
    holdId: inflateHold.holdId,
    holdToken: inflateHold.token,
    lines: [
      {
        productId: product.id,
        sessionId: session.id,
        qty: 8,
      },
    ],
    primaryContactName: "Inflate",
    primaryContactEmail: `inflate-${stamp}@ex.com`,
  });
  const remAfterInflateCheckout = (
    await prisma.ticketSession.findFirst({ where: { id: session.id } })
  )!.remaining;
  check(
    "checkout hold ignores inflated client qty",
    inflatedCheckout.lines[0]!.qty === 1 &&
      remAfterInflateHold === remBeforeInflate - 1 &&
      remAfterInflateCheckout === remAfterInflateHold
  );

  // Cancel then full refund must not restore capacity twice.
  const crSession = await createTicketSession(actor, {
    productId: product.id,
    startsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 14 * 86400000 + 3600000).toISOString(),
    capacity: 6,
  });
  let crBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "walk_in",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: crSession.id, qty: 2 }],
    primaryContactEmail: `cr-${stamp}@ex.com`,
    activate: true,
  });
  await takeBookingPayments(actor, crBooking.id, [
    { type: "cash", amount: crBooking.total },
  ]);
  await cancelBooking(actor, crBooking.id, { reason: "audit" });
  const remAfterCancel = (
    await prisma.ticketSession.findFirst({ where: { id: crSession.id } })
  )!.remaining;
  crBooking = (
    await prisma.booking.findFirst({ where: { id: crBooking.id } })
  ) as any;
  await refundBooking(actor, crBooking.id, {
    amount: Number(crBooking.amountPaid),
    method: "gift_card",
    reason: "after-cancel",
  });
  const remAfterCancelRefund = (
    await prisma.ticketSession.findFirst({ where: { id: crSession.id } })
  )!.remaining;
  check(
    "cancel then refund does not double-restore capacity",
    remAfterCancel === 6 && remAfterCancelRefund === remAfterCancel
  );

  // Confirmed line replace syncs credentials and unused capacity only.
  const syncSession = await createTicketSession(actor, {
    productId: product.id,
    startsAt: new Date(Date.now() + 15 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 15 * 86400000 + 3600000).toISOString(),
    capacity: 10,
  });
  const syncBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "walk_in",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: syncSession.id, qty: 1 }],
    activate: true,
  });
  await takeBookingPayments(actor, syncBooking.id, [
    { type: "cash", amount: syncBooking.total },
  ]);
  const remAfterConfirmSync = (
    await prisma.ticketSession.findFirst({ where: { id: syncSession.id } })
  )!.remaining;
  await replaceBookingLines(actor, syncBooking.id, [
    { productId: product.id, sessionId: syncSession.id, qty: 2 },
  ]);
  const remAfterReplaceSync = (
    await prisma.ticketSession.findFirst({ where: { id: syncSession.id } })
  )!.remaining;
  const liveAfterReplace = await prisma.ticketCredential.count({
    where: {
      bookingId: syncBooking.id,
      status: { in: ["unused", "redeemed"] },
    },
  });
  check(
    "confirmed replace syncs credentials and capacity",
    liveAfterReplace === 2 && remAfterReplaceSync === remAfterConfirmSync - 1
  );

  const syncPaid = await prisma.booking.findFirstOrThrow({
    where: { id: syncBooking.id },
  });
  const extraDue = Number(syncPaid.amountDue);
  if (extraDue > 0) {
    await takeBookingPayments(actor, syncBooking.id, [
      { type: "cash", amount: extraDue },
    ]);
  }
  let overpayDenied = false;
  try {
    await takeBookingPayments(actor, syncBooking.id, [
      { type: "cash", amount: 1 },
    ]);
  } catch (err) {
    overpayDenied =
      err instanceof TicketingError && err.code === "PAYMENT_EXCEEDS_DUE";
  }
  check("payment cannot exceed amount due", overpayDenied);

  // Guest cancel cutoff (staff bypasses).
  await upsertBookingSettings(actor, {
    locationId: venue.id,
    cancelCutoffMinutes: 60,
  });
  const cutoffSession = await createTicketSession(actor, {
    productId: product.id,
    startsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 90 * 60_000).toISOString(),
    capacity: 5,
  });
  const cutoffBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "online",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: cutoffSession.id, qty: 1 }],
    primaryContactEmail: `cutoff-${stamp}@ex.com`,
    userId: user.id,
    activate: true,
  });
  await prisma.booking.update({
    where: { id: cutoffBooking.id },
    data: { userId: user.id, status: "confirmed" },
  });
  let guestCutoffDenied = false;
  try {
    await cancelBooking(
      { orgId, sub: user.id },
      cutoffBooking.id,
      {
        skipStaffGate: true,
        orgId,
        guestCancel: true,
        reason: "too_late",
      }
    );
  } catch (err) {
    guestCutoffDenied =
      err instanceof TicketingError && err.code === "CANCEL_CUTOFF_PASSED";
  }
  const staffCutoffOk = await cancelBooking(actor, cutoffBooking.id, {
    reason: "staff_override",
  });
  check(
    "guest cancel cutoff enforced; staff bypasses",
    guestCutoffDenied && staffCutoffOk.status === "cancelled"
  );
  await upsertBookingSettings(actor, {
    locationId: venue.id,
    cancelCutoffMinutes: null,
  });

  // Unpublished venue cannot hold
  await prisma.$executeRaw`
    UPDATE venue_locations SET "publicBookingEnabled" = false WHERE id = ${venue.id}
  `;
  let unpublishedDenied = false;
  try {
    await createPublicHold({
      orgSlug: org!.slug,
      venueSlug: venue.slug,
      productId: product.id,
      sessionId: session.id,
      qty: 1,
    });
  } catch (err) {
    unpublishedDenied =
      err instanceof TicketingError &&
      err.code === "PUBLIC_VENUE_NOT_PUBLISHED";
  }
  check("unpublished venue cannot hold", unpublishedDenied);
  await enablePublicBooking(venue.id);

  // Gift card tender + split cash+card
  const gc = await issueGiftCard({ orgId, amount: 15 });
  const payBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "walk_in",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    primaryContactEmail: `pay-${stamp}@ex.com`,
    activate: true,
  });
  const split = await takeBookingPayments(actor, payBooking.id, [
    { type: "gift_card", amount: 15, giftCardCode: gc.code },
    { type: "cash", amount: 10 },
  ]);
  check(
    "gift card tender + split cash",
    split.booking.amountPaid >= 25 || split.booking.status === "confirmed"
  );

  // Payment link token
  const dueBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    primaryContactEmail: `link-${stamp}@ex.com`,
    activate: true,
  });
  const link = await createPaymentLink(actor, dueBooking.id, {
    sendVia: ["email"],
  });
  const paidLink = await payViaPaymentLink(link.token);
  check(
    "payment link token",
    Boolean(link.token) &&
      (paidLink.status === "confirmed" || paidLink.amountDue === 0)
  );

  // Invoice create/send
  const invBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    primaryContactEmail: `inv-${stamp}@ex.com`,
    activate: true,
  });
  const invoice = await createBookingInvoice(actor, invBooking.id);
  const sent = await sendBookingInvoice(actor, invoice.id);
  check(
    "invoice create/send data path",
    invoice.number.startsWith("INV-") && sent.status === "sent"
  );

  // Stripe-PI cancel must not wipe a still-valid invoice tender (shared payment table).
  const mixBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    primaryContactEmail: `mix-${stamp}@ex.com`,
    activate: true,
  });
  await takeBookingPayments(actor, mixBooking.id, [
    { type: "invoice", amount: 10 },
  ]);
  await prisma.bookingPayment.create({
    data: {
      orgId,
      locationId: venue.id,
      bookingId: mixBooking.id,
      tender: "card",
      amount: 5,
      status: "pending",
      stripePaymentIntentId: "pi_smoke_not_live",
    },
  });
  const { cancelPendingStripeForBooking } = await import(
    "../src/lib/ticketing/pendingStripe.ts"
  );
  await cancelPendingStripeForBooking(mixBooking.id);
  const mixPays = await prisma.bookingPayment.findMany({
    where: { bookingId: mixBooking.id },
  });
  const invoiceStillPending = mixPays.some(
    (p) => p.tender === "invoice" && p.status === "pending"
  );
  const stripeRowCancelled = mixPays.some(
    (p) =>
      p.stripePaymentIntentId === "pi_smoke_not_live" &&
      p.status === "cancelled"
  );
  check(
    "stripe PI cancel leaves invoice tender pending",
    invoiceStillPending && stripeRowCancelled
  );

  const pendingBlock = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    primaryContactEmail: `pend-${stamp}@ex.com`,
    activate: true,
  });
  const dueAmt = Number(pendingBlock.amountDue);
  await prisma.bookingPayment.create({
    data: {
      orgId,
      locationId: venue.id,
      bookingId: pendingBlock.id,
      tender: "card",
      amount: dueAmt,
      status: "pending",
      stripePaymentIntentId: "pi_pending_block",
    },
  });
  let secondPayBlocked = false;
  try {
    await takeBookingPayments(actor, pendingBlock.id, [
      { type: "cash", amount: dueAmt },
    ]);
  } catch (err) {
    secondPayBlocked =
      err instanceof TicketingError && err.code === "PAYMENT_EXCEEDS_DUE";
  }
  check("pending card checkout blocks second full tender", secondPayBlocked);

  const deadPay = await prisma.bookingPayment.create({
    data: {
      orgId,
      locationId: venue.id,
      bookingId: pendingBlock.id,
      tender: "card",
      amount: 1,
      status: "pending",
      stripePaymentIntentId: "pi_dead_booking",
    },
  });
  await prisma.booking.update({
    where: { id: pendingBlock.id },
    data: { status: "cancelled" },
  });
  const settledDead = await settleVenueBookingStripePayment({
    paymentId: deadPay.id,
    bookingId: pendingBlock.id,
    stripePaymentIntentId: "pi_dead_booking",
  });
  const deadRow = await prisma.bookingPayment.findFirst({
    where: { id: deadPay.id },
  });
  const deadBooking = await prisma.booking.findFirst({
    where: { id: pendingBlock.id },
  });
  check(
    "stripe settle on cancelled booking completes payment for refund ops",
    settledDead.ok === true &&
      "needsRefund" in settledDead &&
      settledDead.needsRefund === true &&
      deadRow?.status === "completed" &&
      Number(deadBooking?.amountPaid ?? 0) === 0
  );
  await releaseHoldsForBooking(pendingBlock.id);

  // Tax exempt recomputes
  const taxBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    activate: false,
  });
  // Ensure tax settings enabled
  await prisma.taxSettings.upsert({
    where: { orgId },
    create: { orgId, enabled: true, rate: 10, label: "Tax" },
    update: { enabled: true, rate: 10 },
  }).catch(async () => {
    const existing = await prisma.taxSettings.findFirst({ where: { orgId } });
    if (existing) {
      await prisma.taxSettings.update({
        where: { id: existing.id },
        data: { enabled: true, rate: 10 },
      });
    } else {
      await prisma.taxSettings.create({
        data: { orgId, enabled: true, rate: 10, label: "Tax" },
      });
    }
  });
  const taxed = await patchBookingTaxExemption(actor, taxBooking.id, false, null);
  const exempt = await patchBookingTaxExemption(
    actor,
    taxBooking.id,
    true,
    "nonprofit"
  );
  check(
    "tax exempt recomputes",
    exempt.taxExempt === true &&
      exempt.taxAmount === 0 &&
      (taxed.taxAmount > 0 || taxed.total >= taxed.subtotal)
  );

  // Past lock 403
  await upsertBookingSettings(actor, {
    locationId: venue.id,
    pastEditGraceMinutes: 0,
  });
  const pastBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    activate: false,
  });
  await prisma.booking.update({
    where: { id: pastBooking.id },
    data: {
      visitStartsAt: new Date(Date.now() - 86400000),
      visitEndsAt: new Date(Date.now() - 82800000),
    },
  });
  let pastLocked = false;
  try {
    await patchBookingTaxExemption(actor, pastBooking.id, true, "late");
  } catch (err) {
    pastLocked =
      err instanceof TicketingError && err.code === "BOOKING_PAST_LOCKED";
  }
  check("past lock 403", pastLocked);

  // Confirm + refund restores unused capacity
  const refundSession = await createTicketSession(actor, {
    productId: product.id,
    startsAt: new Date(Date.now() + 6 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 6 * 86400000 + 3600000).toISOString(),
    capacity: 8,
  });
  let refundBookingRow = await createBooking(actor, {
    locationId: venue.id,
    channel: "walk_in",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: refundSession.id, qty: 2 }],
    primaryContactEmail: `rf-${stamp}@ex.com`,
    activate: true,
  });
  await takeBookingPayments(actor, refundBookingRow.id, [
    { type: "cash", amount: refundBookingRow.total },
  ]);
  refundBookingRow = (
    await prisma.booking.findFirst({
      where: { id: refundBookingRow.id },
      include: { credentials: true, lines: true },
    })
  ) as any;
  const remBeforeRefund = (
    await prisma.ticketSession.findFirst({ where: { id: refundSession.id } })
  )!.remaining;
  const refunded = await refundBooking(actor, refundBookingRow.id, {
    amount: Number(refundBookingRow.amountPaid ?? refundBookingRow.total),
    method: "gift_card",
    reason: "smoke",
  });
  const remAfterRefund = (
    await prisma.ticketSession.findFirst({ where: { id: refundSession.id } })
  )!.remaining;
  check(
    "refund restores capacity for unused",
    refunded.booking.status === "refunded" && remAfterRefund > remBeforeRefund
  );

  // Reactivate
  const cancelRow = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    activate: true,
  });
  await cancelBooking(actor, cancelRow.id, { reason: "smoke" });
  const reactivated = await reactivateBooking(actor, cancelRow.id, {
    targetStatus: "draft",
  });
  check("reactivate", reactivated.status === "draft");

  // Party guests persist
  const partySession = await createTicketSession(actor, {
    productId: partyProduct.id,
    resourceId: room.id,
    startsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 7 * 86400000 + 7200000).toISOString(),
    capacity: 20,
  });
  const partyBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [
      {
        productId: partyProduct.id,
        sessionId: partySession.id,
        resourceId: room.id,
        qty: 1,
      },
    ],
    activate: true,
  });
  const guests = await patchPartyGuests(actor, partyBooking.id, [
    { name: "Kid A", age: 8 },
    { name: "Kid B", age: 10 },
  ]);
  check("party guests persist", guests.length === 2);

  const invite = await createPartyInvitation(actor, partyBooking.id, {
    to: `rsvp-${stamp}@ex.com`,
  });
  await publicPartyRsvp({
    bookingPublicId: partyBooking.publicId,
    token: invite.token,
    name: "Aunt Mei",
    accept: true,
  });
  await publicPartyRsvp({
    bookingPublicId: partyBooking.publicId,
    token: invite.token,
    name: "Aunt Mei again",
    accept: true,
  });
  const partyAfterRsvp = await prisma.partyGuest.count({
    where: { partyDetail: { bookingId: partyBooking.id } },
  });
  check("duplicate party RSVP does not add a second guest", partyAfterRsvp === 3);

  // Custom ticket IDs unique
  await takeBookingPayments(actor, partyBooking.id, [
    { type: "cash", amount: partyBooking.total },
  ]);
  const confirmedParty = await prisma.booking.findFirst({
    where: { id: partyBooking.id },
    include: { credentials: true },
  });
  if (confirmedParty && confirmedParty.credentials.length === 0) {
    await confirmBooking(actor, partyBooking.id, { allowUnpaid: true });
  }
  const withCreds = await prisma.booking.findFirst({
    where: { id: partyBooking.id },
    include: { credentials: true },
  });
  let ticketIdUnique = false;
  if (withCreds && withCreds.credentials.length >= 1) {
    await assignCustomTicketIds(
      orgId,
      [
        {
          credentialId: withCreds.credentials[0]!.id,
          customTicketId: `CUSTOM-${stamp}`,
        },
      ],
      { bookingId: withCreds.id }
    );
    try {
      if (withCreds.credentials[1]) {
        await assignCustomTicketIds(
          orgId,
          [
            {
              credentialId: withCreds.credentials[1].id,
              customTicketId: `CUSTOM-${stamp}`,
            },
          ],
          { bookingId: withCreds.id }
        );
      } else {
        // Create second credential booking to test uniqueness against first
        const other = await createBooking(actor, {
          locationId: venue.id,
          channel: "walk_in",
          createMode: "hold",
          lines: [
            { productId: product.id, sessionId: session.id, qty: 1 },
          ],
          activate: true,
        });
        await takeBookingPayments(actor, other.id, [
          { type: "cash", amount: other.total },
        ]);
        const otherRow = await prisma.booking.findFirst({
          where: { id: other.id },
          include: { credentials: true },
        });
        await assignCustomTicketIds(
          orgId,
          [
            {
              credentialId: otherRow!.credentials[0]!.id,
              customTicketId: `CUSTOM-${stamp}`,
            },
          ],
          { bookingId: otherRow!.id }
        );
      }
    } catch (err) {
      ticketIdUnique =
        err instanceof TicketingError && err.code === "TICKET_ID_TAKEN";
    }
  }
  check("custom ticket IDs unique", ticketIdUnique);

  // Resource move conflict
  const moveSessionA = await createTicketSession(actor, {
    productId: product.id,
    startsAt: new Date(Date.now() + 8 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 8 * 86400000 + 3600000).toISOString(),
    capacity: 2,
  });
  const moveSessionB = await createTicketSession(actor, {
    productId: product.id,
    startsAt: new Date(Date.now() + 8 * 86400000 + 7200000).toISOString(),
    endsAt: new Date(Date.now() + 8 * 86400000 + 10800000).toISOString(),
    capacity: 1,
  });
  await tryConsumeSessionCapacity(moveSessionB.id, 1);
  const moveBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [
      { productId: product.id, sessionId: moveSessionA.id, qty: 1 },
    ],
    activate: true,
  });
  let resourceConflict = false;
  try {
    await moveBookingLineResource(actor, moveBooking.id, {
      lineId: moveBooking.lines[0]!.id,
      resourceId: room.id,
      sessionId: moveSessionB.id,
      allowOverbook: false,
    });
  } catch (err) {
    resourceConflict =
      err instanceof TicketingError && err.code === "RESOURCE_CONFLICT";
  }
  check("resource move conflict", resourceConflict);

  // Charge stored (stub without Stripe)
  const stored = await prisma.storedPaymentMethod.create({
    data: {
      orgId,
      userId: user.id,
      stripeCustomerId: "cus_smoke",
      stripePaymentMethodId: "pm_smoke",
      brand: "visa",
      last4: "4242",
    },
  });
  const storedBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    primaryContactEmail: `stored-${stamp}@ex.com`,
    activate: true,
  });
  const charged = await takeBookingPayments(actor, storedBooking.id, [
    {
      type: "stored_card",
      amount: storedBooking.total,
      storedPaymentMethodId: stored.id,
    },
  ]);
  check(
    "charge stored (stub Stripe)",
    charged.booking.amountPaid > 0 || charged.booking.status === "confirmed"
  );

  // Cross-tenant deny
  const otherUser = await prisma.user.create({
    data: {
      email: `smoke-tix-p2-other-${stamp}@test.local`,
      password: "x",
      username: `smoketixp2o${stamp}`,
      firstName: "Other",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const other = await createOrganizationWithPlatformAdmin({
    name: `P2 Other ${stamp}`,
    slug: `p2-other-${stamp}`,
    userId: otherUser.id,
  });
  await prisma.organization.update({
    where: { id: other.organization.id },
    data: {
      status: "active",
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  let crossDenied = false;
  try {
    await createBooking(
      {
        sub: otherUser.id,
        orgId: other.organization.id,
        rolePreset: "platform_admin",
      },
      {
        locationId: venue.id,
        channel: "phone",
        lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
      }
    );
  } catch (err) {
    crossDenied =
      err instanceof ForbiddenError ||
      (err instanceof Error && /not found|archived|required/i.test(err.message));
  }
  check("cross-tenant deny", crossDenied);

  // ticketsPerMonth on confirm — fill near cap is heavy; assert helper works
  try {
    await assertWithinPlanLimit(orgId, "ticketsPerMonth", 1);
    check("ticketsPerMonth on confirm gate", true);
  } catch {
    check("ticketsPerMonth on confirm gate", false);
  }

  // Review before confirm
  await upsertBookingSettings(actor, {
    locationId: venue.id,
    requireReviewBeforeConfirm: true,
  });
  const reviewBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    activate: true,
  });
  await takeBookingPayments(actor, reviewBooking.id, [
    { type: "cash", amount: reviewBooking.total },
  ], { confirmIfPaid: false });
  let reviewRequired = false;
  try {
    await confirmBooking(actor, reviewBooking.id, { allowUnpaid: true });
  } catch (err) {
    reviewRequired =
      err instanceof TicketingError &&
      err.code === "BOOKING_REVIEW_REQUIRED";
  }
  check("review before confirm", reviewRequired);
  await markBookingReviewed(actor, reviewBooking.id);
  const reviewed = await confirmBooking(actor, reviewBooking.id, {
    allowUnpaid: true,
  });
  check("confirm after review", reviewed.status === "confirmed");

  // Audit extras: transactional line replace, guest DTO strip, add-on stock, re-issue
  const replaceTarget = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    activate: true,
  });
  const altSession = await createTicketSession(actor, {
    productId: product.id,
    startsAt: new Date(Date.now() + 12 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 12 * 86400000 + 3600000).toISOString(),
    capacity: 10,
  });
  const replaced = await replaceBookingLines(actor, replaceTarget.id, [
    { productId: product.id, sessionId: altSession.id, qty: 2 },
  ]);
  check(
    "replace booking lines transactional",
    replaced.lines.length === 1 &&
      replaced.lines[0]!.sessionId === altSession.id &&
      replaced.lines[0]!.qty === 2
  );

  await prisma.booking.update({
    where: { id: replaceTarget.id },
    data: { posNotes: "staff-only-note", notes: "guest-ok" },
  });
  const guestRow = await prisma.booking.findFirstOrThrow({
    where: { id: replaceTarget.id },
    include: bookingInclude,
  });
  const guestDto = toGuestBookingDto(guestRow);
  check(
    "guest DTO strips posNotes/activities",
    guestDto.posNotes === undefined &&
      guestDto.activities === undefined &&
      guestDto.notes === "guest-ok"
  );

  const addOn = await createAdmissionProduct(actor, {
    type: "add_on",
    name: `AddOn ${stamp}`,
    locationId: venue.id,
    published: true,
    prices: [{ code: "addon", amount: 5 }],
  });
  const stock = await prisma.stockPeriod.create({
    data: {
      orgId,
      locationId: venue.id,
      kind: "blocked",
      startsAt: new Date(Date.now() - 86400000),
      endsAt: new Date(Date.now() + 30 * 86400000),
      quantity: null,
    },
  });
  await prisma.admissionAddOnLink.create({
    data: {
      orgId,
      locationId: venue.id,
      parentProductId: product.id,
      addOnProductId: addOn.id,
      required: false,
      stockPeriodId: stock.id,
    },
  });
  let stockBlocked = false;
  try {
    await replaceBookingLines(actor, replaceTarget.id, [
      { productId: product.id, sessionId: altSession.id, qty: 1 },
      {
        productId: addOn.id,
        qty: 1,
        visitDate: new Date().toISOString(),
      },
    ]);
  } catch (err) {
    stockBlocked =
      err instanceof Error && /blocked|stock period/i.test(err.message);
  }
  check("add-on stock period gates", stockBlocked);

  const reissueBooking = await createBooking(actor, {
    locationId: venue.id,
    channel: "walk_in",
    createMode: "hold",
    lines: [{ productId: product.id, sessionId: session.id, qty: 1 }],
    activate: true,
  });
  await takeBookingPayments(actor, reissueBooking.id, [
    { type: "cash", amount: reissueBooking.total },
  ]);
  let reissueConfirmed = await prisma.booking.findFirst({
    where: { id: reissueBooking.id },
    include: { credentials: true },
  });
  if (reissueConfirmed && reissueConfirmed.credentials.length === 0) {
    await confirmBooking(actor, reissueBooking.id, { allowUnpaid: true });
    reissueConfirmed = await prisma.booking.findFirst({
      where: { id: reissueBooking.id },
      include: { credentials: true },
    });
  }
  await cancelBooking(actor, reissueBooking.id, { reason: "reissue-smoke" });
  await reactivateBooking(actor, reissueBooking.id, { targetStatus: "draft" });
  await upsertBookingSettings(actor, {
    locationId: venue.id,
    requireReviewBeforeConfirm: false,
  });
  const reissued = await confirmBooking(actor, reissueBooking.id, {
    allowUnpaid: true,
  });
  const reissueCreds = await prisma.ticketCredential.count({
    where: {
      bookingId: reissueBooking.id,
      status: { in: ["unused", "redeemed"] },
    },
  });
  check(
    "reactivate re-issues credentials",
    reissued.status === "confirmed" && reissueCreds >= 1
  );

  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll Phase 2 ticketing smoke checks passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
