/**
 * Phase 4 Online Booking / Ticketing smoke — control plane sync.
 *   yarn smoke:ticketing:p4          — full
 *   yarn smoke:ticketing:p4:fast     — lean (same gates, fewer remote round-trips)
 *
 * Slow because DATABASE_URL is remote Supabase (~10m full). Prefer local Postgres
 * or :fast for day-to-day. Fast mode parallelizes setup and skips confirmBooking
 * credential churn (inserts a credential row for search coverage instead).
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
  console.log(FAST ? "Phase 4 smoke (FAST)\n" : "Phase 4 smoke (full)\n");
  process.env.TICKETING_PAYMENT_LINK_STUB = "1";
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.NOTIFICATION_EMAIL_USER;

  const { createOrganizationWithPlatformAdmin } = await import(
    "../src/lib/orgRegistration.ts"
  );
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { createCapacityResource } = await import(
    "../src/lib/ticketing/resources.ts"
  );
  const { createAdmissionProduct } = await import(
    "../src/lib/ticketing/products.ts"
  );
  const { createTicketSession } = await import(
    "../src/lib/ticketing/sessions.ts"
  );
  const { createBooking, holdBooking, listBookings, confirmBooking } =
    await import("../src/lib/ticketing/bookingEngine.ts");
  const {
    settleVenueBookingStripePayment,
    failVenueBookingStripePayment,
  } = await import("../src/lib/ticketing/payments.ts");
  const { applyVenueBookingStripeRefundEvent } = await import(
    "../src/lib/ticketing/refunds.ts"
  );
  const { expireBookingHolds, expireBookingPaymentLinks, runBookingExpiryMaintenance } = await import(
    "../src/lib/ticketing/expireHolds.ts"
  );
  const {
    collectBookingsForExport,
    rowsToCsv,
    BOOKING_EXPORT_COLUMNS,
  } = await import("../src/lib/ticketing/bookingExport.ts");
  const { buildCompanyWorkspaceExport } = await import(
    "../src/lib/companyExport.ts"
  );
  const { createPaymentLink } = await import(
    "../src/lib/ticketing/paymentLinks.ts"
  );
  const { resolvePublicBookingVenue } = await import(
    "../src/lib/ticketing/publicVenue.ts"
  );
  const { setHqLocationContext } = await import(
    "../src/lib/hqLocationContext.ts"
  );
  const { assertNotDemoPlanLocked } = await import(
    "../src/lib/demoPlanAssert.ts"
  );
  const { P } = await import("../src/lib/auth/permissions.ts");

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-tix-p4-${stamp}@test.local`,
      password: "x",
      username: `smoketixp4${stamp}`,
      firstName: "P4",
      lastName: "Smoke",
    },
  });

  const reg = await createOrganizationWithPlatformAdmin({
    name: `P4 Book Co ${stamp}`,
    slug: `p4-book-${stamp}`,
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

  const [venueA, venueB] = await Promise.all([
    createVenueLocation(actor, {
      name: `Park A ${stamp}`,
      slug: `park-a-${stamp}`,
    }),
    createVenueLocation(actor, {
      name: `Park B ${stamp}`,
      slug: `park-b-${stamp}`,
    }),
  ]);
  await Promise.all([
    enablePublicBooking(venueA.id),
    enablePublicBooking(venueB.id),
  ]);

  const [resA, resB] = await Promise.all([
    createCapacityResource(actor, {
      name: `Lane A ${stamp}`,
      type: "session",
      locationId: venueA.id,
      defaultCapacity: 20,
    }),
    createCapacityResource(actor, {
      name: `Lane B ${stamp}`,
      type: "session",
      locationId: venueB.id,
      defaultCapacity: 10,
    }),
  ]);

  const [prodA, prodB] = await Promise.all([
    createAdmissionProduct(actor, {
      type: "timed_session",
      name: `Timed A ${stamp}`,
      locationId: venueA.id,
      published: true,
      prices: [{ code: "adult", amount: 10 }],
    }),
    createAdmissionProduct(actor, {
      type: "timed_session",
      name: `Timed B ${stamp}`,
      locationId: venueB.id,
      published: true,
      prices: [{ code: "adult", amount: 12 }],
    }),
  ]);

  const start = new Date(Date.now() + 2 * 3600_000);
  const end = new Date(start.getTime() + 3600_000);
  const [sessionA, sessionB] = await Promise.all([
    createTicketSession(actor, {
      locationId: venueA.id,
      productId: prodA.id,
      resourceId: resA.id,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      capacity: 20,
    }),
    createTicketSession(actor, {
      locationId: venueB.id,
      productId: prodB.id,
      resourceId: resB.id,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      capacity: 10,
    }),
  ]);

  // --- Hold expiry ---
  const sessionBeforeHold = await prisma.ticketSession.findFirst({
    where: { id: sessionA.id },
    select: { remaining: true, capacity: true },
  });
  const remainBefore = Number(sessionBeforeHold?.remaining ?? 0);
  const holdBk = await createBooking(actor, {
    locationId: venueA.id,
    channel: "phone",
    createMode: "hold",
    primaryContactName: "Hold Guest",
    primaryContactEmail: `hold-${stamp}@test.local`,
    primaryContactPhone: "5550100",
    lines: [
      {
        productId: prodA.id,
        priceBandCode: "adult",
        qty: 1,
        sessionId: sessionA.id,
      },
    ],
  });
  await holdBooking(actor, holdBk.id);
  const sessionWhileHeld = await prisma.ticketSession.findFirst({
    where: { id: sessionA.id },
    select: { remaining: true },
  });
  const remainHeld = Number(sessionWhileHeld?.remaining ?? 0);
  await prisma.booking.update({
    where: { id: holdBk.id },
    data: { holdExpiresAt: new Date(Date.now() - 60_000) },
  });
  const exp = await expireBookingHolds({ orgId, limit: 50 });
  const afterExp = await prisma.booking.findFirst({ where: { id: holdBk.id } });
  const sessionAfterExp = await prisma.ticketSession.findFirst({
    where: { id: sessionA.id },
    select: { remaining: true },
  });
  const remainAfter = Number(sessionAfterExp?.remaining ?? 0);
  check(
    "hold expires via expireBookingHolds",
    exp.expired >= 1 && afterExp?.status === "expired",
    `expired=${exp.expired} status=${afterExp?.status}`
  );
  check(
    "hold expiry releases session capacity",
    remainHeld === remainBefore - 1 && remainAfter === remainBefore,
    `before=${remainBefore} held=${remainHeld} after=${remainAfter}`
  );

  // Shared cron maintenance helper (HTTP route + CLI both call this).
  const cronMaint = await runBookingExpiryMaintenance({ orgId, holdLimit: 50, linkLimit: 50 });
  check(
    "cron maintenance helper wired",
    "expired" in cronMaint.bookingHolds && "expired" in cronMaint.paymentLinks
  );

  // --- Live bookings (park A + B) in parallel ---
  const [liveBk, bkB] = await Promise.all([
    createBooking(actor, {
      locationId: venueA.id,
      channel: "phone",
      createMode: "hold",
      primaryContactName: "Export Guest",
      primaryContactEmail: `export-${stamp}@test.local`,
      primaryContactPhone: "5550200",
      lines: [
        {
          productId: prodA.id,
          priceBandCode: "adult",
          qty: 1,
          sessionId: sessionA.id,
        },
      ],
    }),
    createBooking(actor, {
      locationId: venueB.id,
      channel: "walk_in",
      createMode: "hold",
      primaryContactName: "Park B Guest",
      primaryContactEmail: `parkb-${stamp}@test.local`,
      lines: [
        {
          productId: prodB.id,
          priceBandCode: "adult",
          qty: 1,
          sessionId: sessionB.id,
        },
      ],
    }),
  ]);
  await Promise.all([
    holdBooking(actor, liveBk.id),
    holdBooking(actor, bkB.id),
  ]);

  const link = await createPaymentLink(actor, liveBk.id, {
    amount: 10,
    sendVia: [],
  });
  await prisma.bookingPaymentLink.update({
    where: { id: link.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const linksExp = await expireBookingPaymentLinks({ orgId, limit: 50 });
  const linkGone = await prisma.bookingPaymentLink.findFirst({
    where: { id: link.id },
  });
  check(
    "payment links expire via expireBookingPaymentLinks",
    linksExp.expired >= 1 && !linkGone,
    `expired=${linksExp.expired}`
  );

  await setHqLocationContext(actor, null);
  const allList = await listBookings(actor, { take: 50 });
  check(
    "HQ all-locations search sees both parks",
    allList.bookings.some((b) => b.id === liveBk.id) &&
      allList.bookings.some((b) => b.id === bkB.id)
  );

  await setHqLocationContext(actor, venueA.id);
  const scoped = await listBookings(actor, { take: 50 });
  check(
    "HQ locationScoped filters to selected park",
    scoped.bookings.every((b) => b.locationId === venueA.id) &&
      scoped.bookings.some((b) => b.id === liveBk.id) &&
      !scoped.bookings.some((b) => b.id === bkB.id)
  );
  await setHqLocationContext(actor, null);

  // Credentials for search: full confirm is slow on remote — fast inserts a row.
  let credCode = `T-FAST-${stamp.toString(36).toUpperCase()}`;
  if (FAST) {
    await prisma.booking.update({
      where: { id: liveBk.id },
      data: { status: "confirmed" },
    });
    await prisma.ticketCredential.create({
      data: {
        orgId,
        locationId: venueA.id,
        bookingId: liveBk.id,
        code: credCode,
        qrPayload: `qr-${stamp}`,
        status: "unused",
      },
    });
  } else {
    await confirmBooking(actor, liveBk.id, {
      allowUnpaid: true,
      autoReview: true,
    });
    const cred = await prisma.ticketCredential.findFirst({
      where: { bookingId: liveBk.id },
    });
    credCode = cred?.code ?? credCode;
  }

  const pay = await prisma.bookingPayment.create({
    data: {
      orgId,
      locationId: venueA.id,
      bookingId: liveBk.id,
      tender: "card",
      amount: 10,
      status: "completed",
      stripePaymentIntentId: `pi_smoke_${stamp}`,
      cardFingerprint: `fp_smoke_${stamp}`,
    },
  });

  const [byFp, byPi, byCode, byName, byEmail, byPhone] = await Promise.all([
    listBookings(actor, { q: `fp_smoke_${stamp}` }),
    listBookings(actor, { q: `pi_smoke_${stamp}` }),
    listBookings(actor, { q: credCode }),
    listBookings(actor, { q: "Export Guest" }),
    listBookings(actor, { q: `export-${stamp}@test.local` }),
    listBookings(actor, { q: "5550200" }),
  ]);
  check(
    "card fingerprint search staff-only field",
    byFp.bookings.some((b) => b.id === liveBk.id)
  );
  check(
    "PaymentIntent id search",
    byPi.bookings.some((b) => b.id === liveBk.id)
  );
  check(
    "credential code search",
    byCode.bookings.some((b) => b.id === liveBk.id),
    credCode
  );
  check(
    "guest name/email/phone search",
    byName.bookings.some((b) => b.id === liveBk.id) &&
      byEmail.bookings.some((b) => b.id === liveBk.id) &&
      byPhone.bookings.some((b) => b.id === liveBk.id)
  );

  const rows = await collectBookingsForExport(actor, {});
  const csv = rowsToCsv(rows);
  check(
    "export includes required columns",
    rows.some((r) => r.publicId === liveBk.publicId) &&
      BOOKING_EXPORT_COLUMNS.every((c) => csv.includes(c))
  );
  check(
    "export omits secrets",
    !csv.includes("viewToken") &&
      !csv.includes("fp_smoke_") &&
      !csv.includes("pi_smoke_") &&
      !csv.includes("/booking/pay/")
  );
  check("bookings:export permission key", P.BookingsExport === "bookings:export");

  const workspace = await buildCompanyWorkspaceExport(orgId);
  const rc = workspace.resourceCounts as Record<string, unknown>;
  check(
    "company export includes redacted booking counts",
    typeof rc.bookingsByStatus === "object" &&
      typeof rc.admissionProductsByType === "object" &&
      typeof rc.bookingInvoicesByStatus === "object" &&
      !JSON.stringify(workspace).includes("pi_smoke_") &&
      !JSON.stringify(workspace).includes("fp_smoke_")
  );

  // Demo lock — fast: stamp plan on a throwaway org without full catalog create path.
  if (FAST) {
    const demoUser = await prisma.user.create({
      data: {
        email: `smoke-tix-p4-demo-${stamp}@test.local`,
        password: "x",
        username: `smoketixp4d${stamp}`,
        firstName: "Demo",
        lastName: "Smoke",
      },
    });
    const demoReg = await createOrganizationWithPlatformAdmin({
      name: `P4 Demo ${stamp}`,
      slug: `p4-demo-${stamp}`,
      userId: demoUser.id,
    });
    await prisma.organization.update({
      where: { id: demoReg.organization.id },
      data: {
        status: "active",
        subscriptionPlan: "demo",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 10 * 86400000),
      },
    });
    let demoDenied = false;
    try {
      await assertNotDemoPlanLocked(demoReg.organization.id);
    } catch (err) {
      demoDenied =
        err instanceof ForbiddenError ||
        /DEMO|demo|locked/i.test(
          err instanceof Error ? err.message : String(err)
        );
    }
    check("Demo plan locks ticketing catalog create", demoDenied);
  } else {
    const demoUser = await prisma.user.create({
      data: {
        email: `smoke-tix-p4-demo-${stamp}@test.local`,
        password: "x",
        username: `smoketixp4d${stamp}`,
        firstName: "Demo",
        lastName: "Smoke",
      },
    });
    const demoReg = await createOrganizationWithPlatformAdmin({
      name: `P4 Demo ${stamp}`,
      slug: `p4-demo-${stamp}`,
      userId: demoUser.id,
    });
    await prisma.organization.update({
      where: { id: demoReg.organization.id },
      data: {
        status: "active",
        subscriptionPlan: "demo",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 10 * 86400000),
      },
    });
    const demoActor = {
      sub: demoUser.id,
      orgId: demoReg.organization.id,
      rolePreset: "platform_admin" as const,
    };
    let demoDenied = false;
    try {
      const dv = await createVenueLocation(demoActor, {
        name: `Demo Park ${stamp}`,
        slug: `demo-park-${stamp}`,
      });
      await createAdmissionProduct(demoActor, {
        type: "day_pass",
        name: `Demo Prod ${stamp}`,
        locationId: dv.id,
        published: true,
        prices: [{ code: "adult", amount: 5 }],
      });
    } catch (err) {
      demoDenied =
        err instanceof ForbiddenError ||
        /DEMO|demo|locked/i.test(
          err instanceof Error ? err.message : String(err)
        );
    }
    check("Demo plan locks ticketing catalog create", demoDenied);
  }

  await prisma.venueLocation.update({
    where: { id: venueA.id },
    data: { status: "archived" },
  });
  let archiveDenied = false;
  try {
    await createBooking(actor, {
      locationId: venueA.id,
      channel: "phone",
      lines: [
        {
          productId: prodA.id,
          priceBandCode: "adult",
          qty: 1,
          sessionId: sessionA.id,
        },
      ],
    });
  } catch {
    archiveDenied = true;
  }
  check("archived venue blocks new bookings", archiveDenied);
  await prisma.venueLocation.update({
    where: { id: venueA.id },
    data: { status: "active" },
  });

  // Soft-hold (past_due + null endsAt) and suspended org deny creates.
  const prevSub = await prisma.organization.findFirst({
    where: { id: orgId },
    select: {
      status: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
    },
  });
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      subscriptionStatus: "past_due",
      subscriptionEndsAt: null,
    },
  });
  let softHoldDenied = false;
  try {
    await createBooking(actor, {
      locationId: venueA.id,
      channel: "phone",
      lines: [
        {
          productId: prodA.id,
          priceBandCode: "adult",
          qty: 1,
          sessionId: sessionA.id,
        },
      ],
    });
  } catch (err) {
    softHoldDenied =
      err instanceof ForbiddenError ||
      /billing|entitled|past.?due|payment/i.test(
        err instanceof Error ? err.message : String(err)
      );
  }
  check("soft-hold denies new bookings", softHoldDenied);

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "suspended",
      subscriptionStatus: prevSub?.subscriptionStatus ?? "active",
      subscriptionEndsAt: prevSub?.subscriptionEndsAt ?? new Date(Date.now() + 30 * 86400000),
    },
  });
  let suspendDenied = false;
  try {
    await createBooking(actor, {
      locationId: venueA.id,
      channel: "phone",
      lines: [
        {
          productId: prodA.id,
          priceBandCode: "adult",
          qty: 1,
          sessionId: sessionA.id,
        },
      ],
    });
  } catch (err) {
    suspendDenied =
      err instanceof ForbiddenError ||
      /suspend|active|inactive/i.test(
        err instanceof Error ? err.message : String(err)
      );
  }
  check("suspended org denies new bookings", suspendDenied);
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: prevSub?.status ?? "active",
      subscriptionStatus: prevSub?.subscriptionStatus ?? "active",
      subscriptionEndsAt:
        prevSub?.subscriptionEndsAt ?? new Date(Date.now() + 30 * 86400000),
    },
  });

  let public404 = false;
  try {
    await resolvePublicBookingVenue("no-such-org", "no-such-venue");
  } catch {
    public404 = true;
  }
  check("public unknown venue fails closed", public404);

  const settle1 = await settleVenueBookingStripePayment({
    paymentId: pay.id,
    bookingId: liveBk.id,
    stripePaymentIntentId: pay.stripePaymentIntentId,
  });
  const settle2 = await settleVenueBookingStripePayment({
    paymentId: pay.id,
    bookingId: liveBk.id,
    stripePaymentIntentId: pay.stripePaymentIntentId,
  });
  check(
    "webhook settle idempotent",
    settle1.ok === true && settle2.ok === true
  );

  const failPay = await prisma.bookingPayment.create({
    data: {
      orgId,
      locationId: venueA.id,
      bookingId: liveBk.id,
      tender: "card",
      amount: 1,
      status: "pending",
      stripePaymentIntentId: `pi_fail_${stamp}`,
    },
  });
  const f1 = await failVenueBookingStripePayment({
    paymentId: failPay.id,
    bookingId: liveBk.id,
    reason: "test",
  });
  const f2 = await failVenueBookingStripePayment({
    paymentId: failPay.id,
    bookingId: liveBk.id,
    reason: "test",
  });
  check("webhook fail idempotent", f1.ok && f2.ok);

  const refundPay = await prisma.bookingPayment.create({
    data: {
      orgId,
      locationId: venueA.id,
      bookingId: liveBk.id,
      tender: "card",
      amount: 5,
      status: "completed",
      stripePaymentIntentId: `pi_ref_${stamp}`,
      stripeChargeId: `ch_ref_${stamp}`,
    },
  });
  await prisma.booking.update({
    where: { id: liveBk.id },
    data: { amountPaid: 15, amountDue: 0 },
  });
  const r1 = await applyVenueBookingStripeRefundEvent({
    paymentId: refundPay.id,
    bookingId: liveBk.id,
    amount: 5,
    cumulativeRefunded: 5,
    reason: "charge.refunded",
  });
  const r2 = await applyVenueBookingStripeRefundEvent({
    paymentId: refundPay.id,
    bookingId: liveBk.id,
    amount: null,
    cumulativeRefunded: 5,
    reason: "charge.refund.updated",
  });
  check(
    "webhook refund idempotent",
    r1.ok && r2.ok && Boolean(r2.idempotent)
  );

  console.log(failed ? `\nFAILED ${failed}` : "\nAll Phase 4 checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
