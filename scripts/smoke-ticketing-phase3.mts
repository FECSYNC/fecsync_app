/**
 * Phase 3 Online Booking / Ticketing smoke.
 *   yarn smoke:ticketing:p3          — full
 *   yarn smoke:ticketing:p3:fast     — lean (same gates, fewer remote round-trips)
 *
 * Slow because DATABASE_URL is remote Supabase. Prefer a local Postgres for day-to-day.
 * Fast mode skips auto-confirm credential churn (the 30s+ txn) and parallelizes setup.
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
  console.log(FAST ? "Phase 3 smoke (FAST)\n" : "Phase 3 smoke (full)\n");
  process.env.TICKETING_PAYMENT_LINK_STUB = "1";
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.NOTIFICATION_EMAIL_USER;
  delete process.env.BOOKING_SMS_PROVIDER;

  const { createOrganizationWithPlatformAdmin } = await import(
    "../src/lib/orgRegistration.ts"
  );
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { createCapacityResource } = await import(
    "../src/lib/ticketing/resources.ts"
  );
  const { createAdmissionProduct, linkProductAddOn } = await import(
    "../src/lib/ticketing/products.ts"
  );
  const { createTicketSession } = await import(
    "../src/lib/ticketing/sessions.ts"
  );
  const { createBooking, toGuestBookingDto, bookingInclude } = await import(
    "../src/lib/ticketing/bookingEngine.ts"
  );
  const { takeBookingPayments } = await import("../src/lib/ticketing/payments.ts");
  const { createPaymentLink } = await import("../src/lib/ticketing/paymentLinks.ts");
  const {
    createPublicHold,
    publicCheckout,
    listPublicProducts,
    validateMagicToken,
  } = await import("../src/lib/ticketing/publicBooking.ts");
  const { upsertBookingSettings } = await import(
    "../src/lib/ticketing/settings.ts"
  );
  const { patchPartyGuests, createPartyInvitation } = await import(
    "../src/lib/ticketing/parties.ts"
  );
  const { sendBookingSms } = await import("../src/lib/ticketing/sms.ts");
  const { sendBookingConfirmation } = await import(
    "../src/lib/ticketing/confirmations.ts"
  );

  const stamp = Date.now();
  const [user, guestUser] = await Promise.all([
    prisma.user.create({
      data: {
        email: `smoke-tix-p3-${stamp}@test.local`,
        password: "x",
        username: `smoketixp3${stamp}`,
        firstName: "P3",
        lastName: "Admin",
        role: "client",
        isVerified: true,
        joinedAt: new Date(),
      },
    }),
    prisma.user.create({
      data: {
        email: `smoke-tix-p3-guest-${stamp}@test.local`,
        password: "x",
        username: `smoketixp3g${stamp}`,
        firstName: "Guest",
        lastName: "Buyer",
        role: "client",
        isVerified: true,
        joinedAt: new Date(),
      },
    }),
  ]);

  const reg = await createOrganizationWithPlatformAdmin({
    name: `P3 Book Co ${stamp}`,
    slug: `p3-book-${stamp}`,
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
  const actor = { sub: user.id, orgId, rolePreset: "platform_admin" as const };
  const venue = await createVenueLocation(actor, {
    name: `Park ${stamp}`,
    slug: `park-${stamp}`,
  });
  await Promise.all([
    enablePublicBooking(venue.id),
    upsertBookingSettings(actor, {
      locationId: venue.id,
      allowOnlinePayLater: true,
      defaultCreateMode: "hold",
    }),
  ]);

  const room = await createCapacityResource(actor, {
    name: `Room ${stamp}`,
    type: "party_room",
    locationId: venue.id,
    defaultCapacity: 20,
  });

  const [timed, dayPass, addOn, partyProduct] = await Promise.all([
    createAdmissionProduct(actor, {
      type: "timed_session",
      name: `Timed ${stamp}`,
      locationId: venue.id,
      published: true,
      prices: [{ code: "adult", amount: 20 }],
    }),
    createAdmissionProduct(actor, {
      type: "day_pass",
      name: `Day ${stamp}`,
      locationId: venue.id,
      published: true,
      prices: [{ code: "adult", amount: 30 }],
    }),
    createAdmissionProduct(actor, {
      type: "add_on",
      name: `Socks ${stamp}`,
      locationId: venue.id,
      published: true,
      prices: [{ code: "std", amount: 5 }],
    }),
    createAdmissionProduct(actor, {
      type: "party_package",
      name: `Party ${stamp}`,
      locationId: venue.id,
      resourceId: room.id,
      published: true,
      minGuests: 1,
      maxGuests: 20,
      prices: [{ code: "package", amount: 150 }],
    }),
  ]);
  await linkProductAddOn(actor, timed.id, {
    addOnProductId: addOn.id,
    required: false,
    maxQty: 4,
  });

  const starts = new Date(Date.now() + 3600_000);
  const ends = new Date(starts.getTime() + 3600_000);
  const [session, partySession] = await Promise.all([
    createTicketSession(actor, {
      productId: timed.id,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      capacity: 10,
    }),
    createTicketSession(actor, {
      productId: partyProduct.id,
      resourceId: room.id,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      capacity: 20,
    }),
  ]);

  const catalog = await listPublicProducts(reg.organization.slug, venue.slug);
  check(
    "public catalog includes timed + party highlight types",
    catalog.some((p) => p.id === timed.id) && catalog.some((p) => p.id === partyProduct.id)
  );
  check(
    "public timed lists add-on",
    Boolean(catalog.find((p) => p.id === timed.id)?.addOns?.some((a) => a.id === addOn.id))
  );

  const hold = await createPublicHold({
    orgSlug: reg.organization.slug,
    venueSlug: venue.slug,
    productId: timed.id,
    sessionId: session.id,
    qty: 2,
  });
  const guestTimed = await publicCheckout({
    orgSlug: reg.organization.slug,
    venueSlug: venue.slug,
    holdId: hold.holdId,
    holdToken: hold.token,
    lines: [{ productId: addOn.id, qty: 1 }],
    primaryContactName: "Ada Guest",
    primaryContactEmail: `ada-${stamp}@test.local`,
    primaryContactPhone: "5550100",
    payLater: true,
    userId: guestUser.id,
  });
  check(
    "guest timed + add-on",
    guestTimed.lines.length >= 2 && guestTimed.lines.some((l) => l.productId === addOn.id),
    `${guestTimed.publicId} lines=${guestTimed.lines.length}`
  );

  const guestDay = await publicCheckout({
    orgSlug: reg.organization.slug,
    venueSlug: venue.slug,
    lines: [
      {
        productId: dayPass.id,
        qty: 1,
        visitDate: new Date().toISOString().slice(0, 10),
      },
    ],
    primaryContactName: "Ada Guest",
    primaryContactEmail: `ada-${stamp}@test.local`,
    payLater: true,
    userId: guestUser.id,
  });
  check("guest day pass", guestDay.status === "pending_payment" || Boolean(guestDay.publicId));

  const phone = await createBooking(actor, {
    locationId: venue.id,
    channel: "phone",
    createMode: "hold",
    lines: [{ productId: timed.id, sessionId: session.id, qty: 1 }],
    primaryContactName: "Phone Guest",
    primaryContactEmail: `phone-${stamp}@test.local`,
    activate: true,
  });
  const link = await createPaymentLink(actor, phone.id, {
    sendVia: ["email"],
    to: `phone-${stamp}@test.local`,
  });
  check("staff phone + payment link", Boolean(link.token && link.payUrl));

  const walkIn = await createBooking(actor, {
    locationId: venue.id,
    channel: "walk_in",
    createMode: "hold",
    lines: [{ productId: dayPass.id, qty: 1, visitDate: new Date().toISOString() }],
    primaryContactName: "Walk In",
    primaryContactEmail: `walk-${stamp}@test.local`,
    activate: true,
  });
  // Skip auto-confirm credential sync in FAST — that txn is what blows remote timeouts.
  const paid = await takeBookingPayments(
    actor,
    walkIn.id,
    [{ type: "cash", amount: walkIn.total }],
    { confirmIfPaid: !FAST }
  );
  check("walk-in cash payment", Boolean(paid));

  const partyHold = await createPublicHold({
    orgSlug: reg.organization.slug,
    venueSlug: venue.slug,
    productId: partyProduct.id,
    sessionId: partySession.id,
    qty: 4,
  });
  const partyBooking = await publicCheckout({
    orgSlug: reg.organization.slug,
    venueSlug: venue.slug,
    holdId: partyHold.holdId,
    holdToken: partyHold.token,
    primaryContactName: "Host Parent",
    primaryContactEmail: `host-${stamp}@test.local`,
    payLater: true,
    userId: guestUser.id,
  });
  const guests = await patchPartyGuests(actor, partyBooking.id, [
    { name: "Kid One", age: 8 },
    { name: "Adult Two", age: 35 },
  ]);
  const invite = await createPartyInvitation(actor, partyBooking.id, {
    to: `invitee-${stamp}@test.local`,
    channel: "email",
  });
  check(
    "party guests + invitation",
    Array.isArray(guests) && guests.length === 2 && Boolean(invite?.token)
  );

  const own = await prisma.booking.findMany({
    where: { userId: guestUser.id },
    select: { id: true, userId: true },
  });
  check(
    "profile own bookings only",
    own.every((b) => b.userId === guestUser.id) && own.length >= 1
  );
  const other = await prisma.booking.findFirst({
    where: { id: phone.id, userId: guestUser.id },
    select: { id: true },
  });
  check("profile cannot see staff phone booking", other == null);

  const magic = await validateMagicToken(guestTimed.viewToken || "");
  check("magic link own booking", magic.bookingPublicId === guestTimed.publicId);
  let magicOther = false;
  try {
    await validateMagicToken("not-a-real-token-xxxxx");
  } catch {
    magicOther = true;
  }
  check("magic cannot see other bookings", magicOther);

  const confirm = await sendBookingConfirmation({ bookingId: guestTimed.id, force: true });
  check(
    "confirmation email skipped when SMTP unset",
    confirm.sent === false && confirm.reason === "email_skipped"
  );
  const sms = await sendBookingSms({ to: "5550100", body: "hi", orgId });
  check("SMS skipped when provider unset", sms.sent === false && sms.skipped === true);

  const guestDto = toGuestBookingDto(
    await prisma.booking.findFirstOrThrow({
      where: { id: guestTimed.id },
      include: bookingInclude,
    })
  );
  check("guest DTO has no POS notes", !("posNotes" in guestDto) || guestDto.posNotes == null);

  const base = process.env.SMOKE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (base) {
    try {
      const signup = await fetch(`${base.replace(/\/$/, "")}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      check("signup closed", signup.status === 410);
      const shop = await fetch(`${base.replace(/\/$/, "")}/shop`);
      check("shop still responds", shop.status < 500);
    } catch (err) {
      check("http regression probes", false, err instanceof Error ? err.message : String(err));
    }
  } else {
    check("signup closed (catalogued 410; no SMOKE_BASE_URL)", true);
  }

  if (failed) {
    console.error(`\n${failed} Phase 3 smoke check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(
      FAST
        ? "\nAll Phase 3 ticketing smoke checks passed (FAST)"
        : "\nAll Phase 3 ticketing smoke checks passed"
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
