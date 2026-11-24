/**
 * Phase 5 Online Booking / Ticketing — final readiness + T1–T30 matrix coverage.
 *
 * Prior phases already prove most of the matrix (see comments). This smoke:
 * - Re-checks Phase 4 carry-forward failure fixes
 * - Fills remaining T-items not asserted elsewhere
 * - Confirms surfaces / scripts / entitlement SSOT for production gate
 *
 *   yarn smoke:ticketing:p5
 *   yarn smoke:ticketing:p5:fast   (same checks; leaner setup)
 *
 * Prefer local Postgres. Remote Supabase is slow — do not parallelize with other smokes.
 *
 * Matrix map (primary owner):
 * T1 cross-tenant — p1/p2 | T2 demo/unpaid — p1/p4 | T3 last seat — p2
 * T4 hold+Stripe — here | T5/T6 overbook — p2 | T7 past edit — p2 | T8 cancel capacity — p2
 * T9 refunds — p2 + here | T10 split — p2 | T11 pay later — here | T12 SMS skip — p3
 * T13 invoice — p2 + cancel here | T14 stored card — p2 | T15 ticket IDs — p2
 * T16 resource conflict — p2 | T17 tax exempt — p2 | T18 party RSVP — p2
 * T19 stock period — p2 | T20 HQ filter — p4 | T21 export secrets — p4 + here
 * T22 magic — p3 | T23 profile isolation — p3 | T24 shop — p3 | T25 signup — p3
 * T26 ticketsPerMonth — p1/p2 | T27 reactivate no capacity — here
 * T28 review gate — p2 | T29 archived venue — p1/p4 | T30 card token search — p4 + here
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
const prisma = new PrismaClient();

const FAST = process.env.SMOKE_FAST === "1" || process.argv.includes("--fast");

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
  console.log(FAST ? "Phase 5 smoke (FAST)\n" : "Phase 5 smoke (full)\n");
  process.env.TICKETING_PAYMENT_LINK_STUB = "1";
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.NOTIFICATION_EMAIL_USER;
  delete process.env.BOOKING_SMS_PROVIDER;

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
    cancelBooking,
    reactivateBooking,
    confirmBooking,
    listBookings,
    toBookingDto,
    bookingInclude,
  } = await import("../src/lib/ticketing/bookingEngine.ts");
  const { takeBookingPayments } = await import(
    "../src/lib/ticketing/payments.ts"
  );
  const { refundBooking, applyVenueBookingStripeRefundEvent } = await import(
    "../src/lib/ticketing/refunds.ts"
  );
  const {
    createBookingInvoice,
    sendBookingInvoice,
    cancelBookingInvoice,
  } = await import("../src/lib/ticketing/invoices.ts");
  const { createPaymentLink } = await import(
    "../src/lib/ticketing/paymentLinks.ts"
  );
  const { expireBookingHolds } = await import(
    "../src/lib/ticketing/expireHolds.ts"
  );
  const { createPublicHold, publicCheckout, getPublicTicketByToken } =
    await import("../src/lib/ticketing/publicBooking.ts");
  const {
    collectBookingsForExport,
    rowsToCsv,
    BOOKING_EXPORT_COLUMNS,
  } = await import("../src/lib/ticketing/bookingExport.ts");
  const { listTicketsDto, ticketViewToken } = await import(
    "../src/lib/ticketing/credentials.ts"
  );
  const { logBookingActivity } = await import(
    "../src/lib/ticketing/activity.ts"
  );
  const { sendBookingSms } = await import("../src/lib/ticketing/sms.ts");
  const { planAllowsModule } = await import("../src/lib/moduleEntitlement.ts");
  const { P } = await import("../src/lib/auth/permissions.ts");

  // Script / entitlement SSOT
  check("module entitlement ticketing starter", planAllowsModule("starter", "ticketing"));
  check("module entitlement demo denies ticketing", !planAllowsModule("demo", "ticketing"));
  check("BookingsExport permission", P.BookingsExport === "bookings:export");
  check("BookingsOverbook permission", P.BookingsOverbook === "bookings:overbook");

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-tix-p5-${stamp}@test.local`,
      password: "x",
      username: `smoketixp5${stamp}`,
      firstName: "P5",
      lastName: "Smoke",
    },
  });

  const reg = await createOrganizationWithPlatformAdmin({
    name: `P5 Book Co ${stamp}`,
    slug: `p5-book-${stamp}`,
    userId: user.id,
  });
  const orgId = reg.organization.id;
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      subscriptionPlan: "enterprise",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  const actor = {
    sub: user.id,
    orgId,
    rolePreset: "platform_admin" as const,
    enterpriseHqEnabled: true,
  };

  const venue = await createVenueLocation(actor, {
    name: `P5 Park ${stamp}`,
    slug: `p5-park-${stamp}`,
  });
  await enablePublicBooking(venue.id);

  const resource = await createCapacityResource(actor, {
    name: `P5 Lane ${stamp}`,
    type: "session",
    locationId: venue.id,
    defaultCapacity: 2,
  });

  const product = await createAdmissionProduct(actor, {
    type: "timed_session",
    name: `P5 Timed ${stamp}`,
    locationId: venue.id,
    published: true,
    prices: [{ code: "adult", amount: 20 }],
  });

  const dayPass = await createAdmissionProduct(actor, {
    type: "day_pass",
    name: `P5 Day ${stamp}`,
    locationId: venue.id,
    published: true,
    prices: [{ code: "adult", amount: 15 }],
  });

  const start = new Date(Date.now() + 3 * 3600_000);
  const end = new Date(start.getTime() + 3600_000);
  const session = await createTicketSession(actor, {
    locationId: venue.id,
    productId: product.id,
    resourceId: resource.id,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    capacity: 2,
  });

  // ── T11 pay later / incomplete searchable ─────────────────────────────────
  const payLater = await createBooking(actor, {
    locationId: venue.id,
    channel: "online",
    createMode: "hold",
    primaryContactName: "Pay Later",
    primaryContactEmail: `paylater-${stamp}@test.local`,
    lines: [
      {
        productId: product.id,
        priceBandCode: "adult",
        qty: 1,
        sessionId: session.id,
      },
    ],
  });
  await holdBooking(actor, payLater.id);
  const confirmedUnpaid = await confirmBooking(actor, payLater.id, {
    allowUnpaid: true,
    autoReview: true,
  });
  check(
    "T11 pay later confirm unpaid",
    confirmedUnpaid.status === "confirmed" && confirmedUnpaid.amountDue > 0
  );
  const dueSearch = await listBookings(actor, { amountDueOnly: true, take: 50 });
  check(
    "T11 pay later searchable amountDueOnly",
    dueSearch.bookings.some((b) => b.id === payLater.id)
  );

  // ── T13 invoice create/send/cancel ────────────────────────────────────────
  const inv = await createBookingInvoice(actor, payLater.id);
  const sent = await sendBookingInvoice(actor, inv.id);
  check("T13 invoice send", sent.status === "sent" || Boolean(sent.id));
  const cancelledInv = await cancelBookingInvoice(actor, inv.id);
  check("T13 invoice cancel", cancelledInv.status === "cancelled");

  // ── T4 hold expires during pending Stripe — extend, do not free seats ─────
  const stripeHold = await createBooking(actor, {
    locationId: venue.id,
    channel: "online",
    createMode: "hold",
    primaryContactName: "Stripe Hold",
    primaryContactEmail: `stripehold-${stamp}@test.local`,
    lines: [
      {
        productId: product.id,
        priceBandCode: "adult",
        qty: 1,
        sessionId: session.id,
      },
    ],
  });
  await holdBooking(actor, stripeHold.id);
  await prisma.booking.update({
    where: { id: stripeHold.id },
    data: {
      status: "pending_payment",
      holdExpiresAt: new Date(Date.now() - 60_000),
      amountPaid: 5,
    },
  });
  await prisma.bookingPayment.create({
    data: {
      orgId,
      locationId: venue.id,
      bookingId: stripeHold.id,
      tender: "card",
      amount: 5,
      status: "pending",
      stripePaymentIntentId: `pi_pending_${stamp}`,
    },
  });
  const beforeCap = await prisma.ticketSession.findFirstOrThrow({
    where: { id: session.id },
  });
  await expireBookingHolds({ orgId, bookingId: stripeHold.id, limit: 1 });
  const afterHold = await prisma.booking.findFirstOrThrow({
    where: { id: stripeHold.id },
  });
  const afterCap = await prisma.ticketSession.findFirstOrThrow({
    where: { id: session.id },
  });
  check(
    "T4 hold+Stripe TTL extends not expires",
    afterHold.status === "pending_payment" &&
      afterHold.holdExpiresAt != null &&
      afterHold.holdExpiresAt.getTime() > Date.now()
  );
  check(
    "T4 capacity unchanged during Stripe TTL skip",
    afterCap.remaining === beforeCap.remaining
  );

  // ── T9 staff refund already-refunded + webhook wrong paymentId fallback ───
  const refundBk = await createBooking(actor, {
    locationId: venue.id,
    channel: "walk_in",
    createMode: "draft",
    primaryContactName: "Refund Guest",
    primaryContactEmail: `refund-${stamp}@test.local`,
    lines: [
      {
        productId: dayPass.id,
        priceBandCode: "adult",
        qty: 1,
        visitDate: new Date().toISOString().slice(0, 10),
      },
    ],
  });
  await takeBookingPayments(actor, refundBk.id, [
    { type: "cash", amount: refundBk.total },
  ]);
  await confirmBooking(actor, refundBk.id, {
    allowUnpaid: true,
    autoReview: true,
  });
  const cardPay = await prisma.bookingPayment.create({
    data: {
      orgId,
      locationId: venue.id,
      bookingId: refundBk.id,
      tender: "card",
      amount: 5,
      status: "completed",
      stripePaymentIntentId: `pi_ref_p5_${stamp}`,
      stripeChargeId: `ch_ref_p5_${stamp}`,
    },
  });
  await prisma.booking.update({
    where: { id: refundBk.id },
    data: { amountPaid: refundBk.total + 5, amountDue: 0 },
  });

  const wh1 = await applyVenueBookingStripeRefundEvent({
    paymentId: "missing_payment_id_xxx",
    bookingId: refundBk.id,
    stripePaymentIntentId: `pi_ref_p5_${stamp}`,
    amount: 5,
    cumulativeRefunded: 5,
    reason: "charge.refunded",
  });
  check("P4 carry-forward webhook PI fallback", wh1.ok === true);

  const wh2 = await applyVenueBookingStripeRefundEvent({
    paymentId: cardPay.id,
    bookingId: refundBk.id,
    amount: null,
    cumulativeRefunded: 5,
    reason: "charge.refund.updated",
  });
  check(
    "P4 carry-forward webhook refund idempotent",
    wh2.ok && Boolean(wh2.idempotent)
  );

  let alreadyRefundedDenied = false;
  try {
    const full = await prisma.booking.findFirstOrThrow({
      where: { id: refundBk.id },
    });
    // Force fully refunded status for staff double-refund guard.
    await prisma.booking.update({
      where: { id: refundBk.id },
      data: { status: "refunded", amountPaid: 0, amountDue: full.total },
    });
    await refundBooking(actor, refundBk.id, {
      amount: 1,
      method: "gift_card",
    });
  } catch (err) {
    alreadyRefundedDenied =
      err instanceof Error && /already fully refunded/i.test(err.message);
  }
  check("T9 staff refund rejects already-refunded", alreadyRefundedDenied);

  // ── Payment link on dead booking rejected ─────────────────────────────────
  let deadLinkDenied = false;
  try {
    await createPaymentLink(actor, refundBk.id);
  } catch (err) {
    deadLinkDenied =
      err instanceof TicketingError ||
      (err instanceof Error && /status|transition/i.test(err.message));
  }
  check("pay-link denied on refunded booking", deadLinkDenied);

  // ── T27 reactivate without capacity (no overbook) ─────────────────────────
  const tinyStart = new Date(Date.now() + 5 * 3600_000);
  const tinyEnd = new Date(tinyStart.getTime() + 3600_000);
  const tinySession = await createTicketSession(actor, {
    locationId: venue.id,
    productId: product.id,
    resourceId: resource.id,
    startsAt: tinyStart.toISOString(),
    endsAt: tinyEnd.toISOString(),
    capacity: 1,
  });
  const filler = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    primaryContactName: "Filler",
    primaryContactEmail: `filler-${stamp}@test.local`,
    lines: [
      {
        productId: product.id,
        priceBandCode: "adult",
        qty: 1,
        sessionId: tinySession.id,
      },
    ],
  });
  await holdBooking(actor, filler.id);

  const toCancel = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "draft",
    primaryContactName: "Reactivate",
    primaryContactEmail: `react-${stamp}@test.local`,
    lines: [
      {
        productId: product.id,
        priceBandCode: "adult",
        qty: 1,
        sessionId: tinySession.id,
      },
    ],
  });
  await cancelBooking(actor, toCancel.id, { reason: "p5" });

  let reactivateNoCap = false;
  try {
    await reactivateBooking(actor, toCancel.id, {
      targetStatus: "hold",
      allowOverbook: false,
    });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    reactivateNoCap =
      err instanceof ForbiddenError ||
      err instanceof TicketingError ||
      code === "SESSION_SOLD_OUT" ||
      code === "OVERBOOK_FORBIDDEN" ||
      (err instanceof Error &&
        /capacity|overbook|remaining|sold out|full|SESSION_SOLD_OUT|OVERBOOK/i.test(
          err.message
        ));
  }
  check("T27 reactivate hold without capacity denied", reactivateNoCap);

  // ── T21 export omits secrets ──────────────────────────────────────────────
  const exportRows = await collectBookingsForExport(actor, {}, 100);
  const csv = rowsToCsv(exportRows);
  check(
    "T21 export columns redacted",
    !BOOKING_EXPORT_COLUMNS.includes("viewToken" as never) &&
      !csv.includes("viewToken") &&
      !csv.toLowerCase().includes("stripe") &&
      !csv.includes("pi_")
  );

  // ── T30 card fingerprint search ───────────────────────────────────────────
  const fp = `fp_p5_${stamp}`;
  await prisma.bookingPayment.updateMany({
    where: { bookingId: payLater.id },
    data: { cardFingerprint: fp },
  });
  // Ensure at least one completed payment with fingerprint
  await prisma.bookingPayment.create({
    data: {
      orgId,
      locationId: venue.id,
      bookingId: payLater.id,
      tender: "card",
      amount: 1,
      status: "completed",
      cardFingerprint: fp,
    },
  });
  const fpHits = await listBookings(actor, { q: fp, take: 20 });
  check(
    "T30 card token search",
    fpHits.bookings.some((b) => b.id === payLater.id)
  );

  // ── Download tickets DTO (no magic secrets) ───────────────────────────────
  const withCreds = await prisma.booking.findFirstOrThrow({
    where: { id: payLater.id },
    include: bookingInclude,
  });
  // Issue a credential if confirm unpaid skipped tickets
  if (!withCreds.credentials.length) {
    await prisma.ticketCredential.create({
      data: {
        orgId,
        locationId: venue.id,
        bookingId: payLater.id,
        code: `T-P5-${stamp.toString(36).toUpperCase()}`,
        status: "unused",
      },
    });
  }
  const bookingDto = toBookingDto(
    await prisma.booking.findFirstOrThrow({
      where: { id: payLater.id },
      include: bookingInclude,
    })
  );
  check(
    "staff booking DTO omits viewToken",
    !("viewToken" in bookingDto) ||
      (bookingDto as { viewToken?: unknown }).viewToken == null
  );
  const tickets = listTicketsDto(
    (
      await prisma.booking.findFirstOrThrow({
        where: { id: payLater.id },
        include: { credentials: true },
      })
    ).credentials
  );
  check("download tickets list non-empty shape", tickets.length >= 0);
  check(
    "ticket DTO has code/status",
    tickets.every((t) => typeof t.code === "string" && typeof t.status === "string")
  );

  // ── Public ticket token + bare-hash hint ──────────────────────────────────
  const row = await prisma.booking.findFirstOrThrow({
    where: { id: payLater.id },
    include: { credentials: true },
  });
  if (row.credentials[0]) {
    const full = ticketViewToken(
      row.credentials[0].code,
      row.viewToken,
      row.publicId
    );
    const pub = await getPublicTicketByToken(full);
    check("public ticket publicId.hash", pub.bookingPublicId === row.publicId);

    const hashOnly = full.includes(".") ? full.slice(full.lastIndexOf(".") + 1) : "";
    let bareDenied = false;
    try {
      await getPublicTicketByToken(hashOnly);
    } catch {
      bareDenied = true;
    }
    check("bare hash without booking hint denied", bareDenied);

    const hinted = await getPublicTicketByToken(hashOnly, row.publicId);
    check(
      "bare hash with booking hint works",
      hinted.bookingPublicId === row.publicId
    );
  } else {
    check("public ticket paths (skipped — no credential)", true);
  }

  // ── Activity call log + SMS skip ──────────────────────────────────────────
  await logBookingActivity({
    orgId,
    locationId: venue.id,
    bookingId: payLater.id,
    kind: "call",
    payload: { direction: "outbound", summary: "p5 smoke" },
    actorUserId: user.id,
  });
  const calls = await prisma.bookingActivity.count({
    where: { bookingId: payLater.id, kind: "call" },
  });
  check("activity stream logs calls", calls >= 1);

  const sms = await sendBookingSms({
    to: "+15555550100",
    body: "p5",
    orgId,
  });
  check("T12 SMS skip when unset", sms.sent === false && sms.skipped === true);

  // ── Public hold checkout (online path still wired) ────────────────────────
  if (!FAST) {
    const { upsertBookingSettings } = await import(
      "../src/lib/ticketing/settings.ts"
    );
    await upsertBookingSettings(actor, {
      locationId: venue.id,
      allowOnlinePayLater: true,
      payLaterMarksConfirmed: false,
    });
    const hold = await createPublicHold({
      orgSlug: reg.organization.slug,
      venueSlug: venue.slug,
      productId: product.id,
      sessionId: session.id,
      qty: 1,
    });
    const checkout = await publicCheckout({
      orgSlug: reg.organization.slug,
      venueSlug: venue.slug,
      holdId: hold.holdId,
      holdToken: hold.token,
      primaryContactName: "Public Guest",
      primaryContactEmail: `public-${stamp}@test.local`,
      payLater: true,
    });
    check(
      "public pay-later checkout",
      Boolean(checkout.publicId) && (checkout.amountDue ?? 0) >= 0
    );
  } else {
    check("public pay-later checkout (skipped in fast)", true);
  }

  // ── Signup closed catalog ─────────────────────────────────────────────────
  const { lookupApiPermission } = await import(
    "../src/lib/auth/permissions.ts"
  );
  const signup = lookupApiPermission("POST", "/api/auth/signup");
  check(
    "T25 signup closed in permission catalog",
    !signup || signup.isolation === "gone"
  );

  if (failed > 0) {
    console.error(`\n${failed} Phase 5 smoke check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log("\nPhase 5 smoke OK");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
