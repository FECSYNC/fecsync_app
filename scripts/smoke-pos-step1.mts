/**
 * POS Step 1 smoke. Fails on the first miss.
 *
 *   yarn smoke:pos:step1
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
process.env.POS_SMOKE = "1";

const prisma = new PrismaClient();

function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    throw new Error(name);
  }
  console.log(`PASS ${name}`);
}

async function expectDeny(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "call succeeded");
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status: number }).status)
        : 0;
    const message = err instanceof Error ? err.message : String(err);
    check(name, status === 403 || status === 400 || /forbidden|not included|locked|storefront|plan limit|PIN|outside/i.test(message), message);
  }
}

async function entitle(orgId: string, plan: "demo" | "starter" | "growth") {
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      subscriptionPlan: plan,
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
}

async function main() {
  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { getStorefrontOrgId } = await import("../src/lib/org.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { assertPosEnabled } = await import("../src/lib/pos/assertPosEnabled.ts");
  const { getPosSettings, putPosSettings } = await import("../src/lib/pos/settings.ts");
  const { listPosDevices, createPosDevice, updatePosDevice } = await import("../src/lib/pos/devices.ts");
  const { createPosProduct, updatePosProduct, suspendPosProduct } = await import("../src/lib/pos/catalog.ts");
  const { createDiscountCode } = await import("../src/lib/pos/catalog.ts");
  const { setManagerPin } = await import("../src/lib/pos/pins.ts");
  const {
    openCart,
    addCartLine,
    parkCart,
    checkoutCart,
    getCart,
  } = await import("../src/lib/pos/saleEngine.ts");
  const { recordWastage } = await import("../src/lib/pos/saleEngine.ts");
  const { issuePosGiftCard, redeemPosGiftCard } = await import("../src/lib/pos/storedValue.ts");
  const { adjustParkWallet } = await import("../src/lib/pos/storedValue.ts");
  const { openTill, closeTill } = await import("../src/lib/pos/tills.ts");
  const { redeemAtPos } = await import("../src/lib/pos/checkin.ts");
  const { settlePosSalePayment } = await import("../src/lib/pos/webhook.ts");
  const { createBooking } = await import("../src/lib/ticketing/bookingEngine.ts");
  const { createAdmissionProduct } = await import("../src/lib/ticketing/products.ts");
  const { createTicketSession } = await import("../src/lib/ticketing/sessions.ts");
  const { createMembershipPlan } = await import("../src/lib/memberships/plans.ts");
  const { createPosGuest } = await import("../src/lib/pos/guests.ts");
  const { SHIPPED_MODULE_HINT_IDS } = await import("../src/lib/subscriptionPlans.ts");
  const { POST: signupPost } = await import("../src/app/api/auth/signup/route.ts");

  check("shipped-hints-include-pos", (SHIPPED_MODULE_HINT_IDS as readonly string[]).includes("pos"));

  const storefrontId = await getStorefrontOrgId();
  await expectDeny("storefront POS 403", () => assertPosEnabled(storefrontId));

  const stamp = Date.now();
  async function user(tag: string) {
    return prisma.user.create({
      data: {
        email: `smoke-pos-${tag}-${stamp}@test.local`,
        password: "x",
        username: `smokepos${tag}${stamp}`.slice(0, 40),
        firstName: "Pos",
        lastName: tag,
        role: "client",
        isVerified: true,
        joinedAt: new Date(),
      },
    });
  }

  const growthUser = await user("g");
  const demoUser = await user("d");
  const starterUser = await user("s");
  const otherUser = await user("o");
  const growthOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke POS ${stamp}`,
    slug: `smoke-pos-${stamp}`,
    userId: growthUser.id,
  });
  const demoOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke POS Demo ${stamp}`,
    slug: `smoke-pos-demo-${stamp}`,
    userId: demoUser.id,
  });
  const starterOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke POS Starter ${stamp}`,
    slug: `smoke-pos-st-${stamp}`,
    userId: starterUser.id,
  });
  const otherOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke POS Other ${stamp}`,
    slug: `smoke-pos-ot-${stamp}`,
    userId: otherUser.id,
  });
  const orgId = growthOrg.organization.id;
  const actor = { orgId, sub: growthUser.id, permissions: ["pos:sell", "pos:read", "pos:cash", "pos:admin"] };
  await entitle(orgId, "growth");
  await entitle(demoOrg.organization.id, "demo");
  await entitle(starterOrg.organization.id, "starter");
  await entitle(otherOrg.organization.id, "growth");
  const otherActor = { orgId: otherOrg.organization.id, sub: otherUser.id };
  const starterActor = { orgId: starterOrg.organization.id, sub: starterUser.id };

  await expectDeny("demo POS 403", () => assertPosEnabled(demoOrg.organization.id));
  await expectDeny("starter POS 403", () => assertPosEnabled(starterOrg.organization.id));
  await expectDeny("starter channel pos booking 403", () =>
    createBooking(starterActor, {
      locationId: "clh0000000000000000000000",
      channel: "pos",
      lines: [{ productId: "clh0000000000000000000001", qty: 1 }],
    })
  );

  await prisma.taxSettings.upsert({
    where: { orgId },
    create: { orgId, enabled: false, rate: 0 },
    update: { enabled: false, rate: 0 },
  });

  const venue = await createVenueLocation(actor, {
    name: `POS Park ${stamp}`,
    slug: `pos-park-${stamp}`,
  });
  const otherVenue = await createVenueLocation(otherActor, {
    name: `Other POS Park ${stamp}`,
    slug: `pos-park-o-${stamp}`,
  });

  const settings = await getPosSettings(actor, venue.id);
  check("growth settings", Boolean(settings && !("managerOverridePinHash" in settings)));
  const devices = await listPosDevices(actor);
  check("growth device list", Array.isArray(devices) && !JSON.stringify(devices).includes("pinHash"));

  const device = await createPosDevice(actor, {
    locationId: venue.id,
    name: "Front",
    code: `front-${stamp}`,
  });
  await expectDeny("cross-tenant device", () =>
    updatePosDevice(otherActor, device.id, { name: "Stolen" })
  );

  const shopProductsBefore = await prisma.product.count();
  const ordersBefore = await prisma.order.count();
  const merch = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "merchandise",
    name: "Hat",
    price: 12,
    trackInventory: true,
    onHand: 4,
  });
  check("POS product is not a shop Product", (await prisma.product.count()) === shopProductsBefore);
  await expectDeny("cross-tenant product", () =>
    updatePosProduct(otherActor, merch.id, { name: "Stolen hat" })
  );

  const openPrice = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "open_price",
    name: "Open item",
    price: 0,
  });
  const giftProduct = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "gift_card",
    name: "Gift",
    giftCardDefaultAmount: 20,
    price: 20,
  });

  const till = await openTill(actor, {
    locationId: venue.id,
    deviceId: device.id,
    openingFloat: 100,
    notes: "open",
  });

  const cart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await expectDeny("cross-tenant cart", () => getCart(otherActor, cart.id));
  await addCartLine(actor, cart.id, { productId: merch.id, qty: 1 });
  await addCartLine(actor, cart.id, { productId: openPrice.id, unitPrice: 3, qty: 1 });
  await addCartLine(actor, cart.id, { productId: giftProduct.id, qty: 1 });
  const mixed = await checkoutCart(actor, cart.id, {
    idempotencyKey: `mixed-${stamp}`,
    tenders: [{ tender: "cash", amount: 12 + 3 + 20 }],
  });
  check("mixed checkout completed", mixed.status === "completed" && mixed.amountDue === 0);
  const cartAfterCheckout = await prisma.posCart.findFirst({ where: { id: cart.id } });
  check("cart consumed after checkout", cartAfterCheckout == null);
  const merchAfter = await prisma.posProduct.findFirst({ where: { id: merch.id } });
  check("inventory fell", merchAfter?.onHand === 3);
  const issueRow = await prisma.giftCardLedger.findFirst({
    where: { orgId, type: "issue", saleId: mixed.id },
  });
  check("gift ledger issue row", Boolean(issueRow));
  check("shop order count unchanged", (await prisma.order.count()) === ordersBefore);
  const issuedCode = mixed.issuedGiftCodes?.[0];
  check("gift code returned once", typeof issuedCode === "string" && issuedCode.length > 4);

  const admission = await createAdmissionProduct(actor, {
    type: "timed_session",
    name: `POS session ${stamp}`,
    locationId: venue.id,
    prices: [{ code: "adult", amount: 15 }],
    published: true,
  });
  const start = new Date(Date.now() + 86400000);
  const end = new Date(start.getTime() + 3600000);
  const lastSeat = await createTicketSession(actor, {
    productId: admission.id,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    capacity: 1,
    label: "last",
  });
  const holdCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, holdCart.id, {
    admissionProductId: admission.id,
    sessionId: lastSeat.id,
    priceBandCode: "adult",
    qty: 1,
    name: "Admission",
  });
  await parkCart(actor, holdCart.id);
  const held = await checkoutCart(actor, holdCart.id, {
    idempotencyKey: `hold-${stamp}`,
    tenders: [{ tender: "cash", amount: 15 }],
  });
  const seat = await prisma.ticketSession.findFirst({ where: { id: lastSeat.id } });
  check("admission checkout confirmed and remaining fell", held.status === "completed" && seat?.remaining === 0);

  let oversold = false;
  try {
    const again = await openCart(actor, { locationId: venue.id, deviceId: device.id });
    await addCartLine(actor, again.id, {
      admissionProductId: admission.id,
      sessionId: lastSeat.id,
      priceBandCode: "adult",
      qty: 1,
      name: "Admission",
    });
    await checkoutCart(actor, again.id, {
      idempotencyKey: `oversell-${stamp}`,
      tenders: [{ tender: "cash", amount: 15 }],
    });
  } catch {
    oversold = true;
  }
  check("second checkout does not oversell", oversold);
  const seatStill = await prisma.ticketSession.findFirst({ where: { id: lastSeat.id } });
  check("last seat remaining stays 0", seatStill?.remaining === 0);

  const sessionA = await createTicketSession(actor, {
    productId: admission.id,
    startsAt: new Date(start.getTime() + 7200000).toISOString(),
    endsAt: new Date(start.getTime() + 10800000).toISOString(),
    capacity: 5,
    label: "A",
  });
  const sessionB = await createTicketSession(actor, {
    productId: admission.id,
    startsAt: new Date(start.getTime() + 14400000).toISOString(),
    endsAt: new Date(start.getTime() + 18000000).toISOString(),
    capacity: 5,
    label: "B",
  });
  const multi = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, multi.id, {
    admissionProductId: admission.id,
    sessionId: sessionA.id,
    priceBandCode: "adult",
    qty: 1,
    name: "A",
  });
  await addCartLine(actor, multi.id, {
    admissionProductId: admission.id,
    sessionId: sessionB.id,
    priceBandCode: "adult",
    qty: 1,
    name: "B",
  });
  const multiSale = await checkoutCart(actor, multi.id, {
    idempotencyKey: `multi-${stamp}`,
    tenders: [{ tender: "cash", amount: 30 }],
  });
  const aLeft = await prisma.ticketSession.findFirst({ where: { id: sessionA.id } });
  const bLeft = await prisma.ticketSession.findFirst({ where: { id: sessionB.id } });
  check(
    "several sessions on one sale",
    multiSale.bookingIds.length >= 1 && aLeft?.remaining === 4 && bLeft?.remaining === 4
  );

  const splitCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, splitCart.id, { productId: merch.id, qty: 1 });
  const split = await checkoutCart(actor, splitCart.id, {
    idempotencyKey: `split-${stamp}`,
    tenders: [
      { tender: "cash", amount: 4 },
      { tender: "card", amount: 8, simulate: "succeeded" },
    ],
  });
  check("split cash and card amountDue zero", split.amountDue === 0 && split.payments.length === 2);

  const pendingCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, pendingCart.id, { productId: openPrice.id, unitPrice: 7, qty: 1 });
  const pendingSale = await checkoutCart(actor, pendingCart.id, {
    idempotencyKey: `pending-card-${stamp}`,
    tenders: [{ tender: "card", amount: 7, simulate: "pending" }],
  });
  check(
    "pending card not treated as paid",
    pendingSale.status === "unpaid" &&
      pendingSale.amountPaid === 0 &&
      pendingSale.amountDue === 7 &&
      pendingSale.payments.some((p) => p.status === "pending")
  );

  const gift = await issuePosGiftCard({ orgId, locationId: venue.id, amount: 10, idempotencyKey: `gc-${stamp}` });
  const beforeBalance = gift.giftCard.remainingBalance;
  await expectDeny("gift redeem above balance", () =>
    redeemPosGiftCard({ orgId, code: gift.code, amount: 11, idempotencyKey: `gc-over-${stamp}` })
  );
  const card = await prisma.giftCard.findFirst({ where: { id: gift.giftCard.id } });
  check("gift balance unchanged", Number(card?.remainingBalance) === beforeBalance);
  await expectDeny("cross-tenant gift redeem", () =>
    redeemPosGiftCard({
      orgId: otherOrg.organization.id,
      code: gift.code,
      amount: 1,
      idempotencyKey: `gc-x-${stamp}`,
    })
  );

  await setManagerPin(actor, "2468");
  await createDiscountCode(actor, {
    locationId: venue.id,
    code: `SAVE${stamp}`,
    amountOff: 1,
    requiresManagerPin: true,
  });
  const discountCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, discountCart.id, { productId: merch.id, qty: 1 });
  await expectDeny("discount without PIN", () =>
    checkoutCart(actor, discountCart.id, {
      idempotencyKey: `disc-no-${stamp}`,
      discountCode: `SAVE${stamp}`,
      tenders: [{ tender: "cash", amount: 12 }],
    })
  );
  const discounted = await checkoutCart(actor, discountCart.id, {
    idempotencyKey: `disc-yes-${stamp}`,
    discountCode: `SAVE${stamp}`,
    managerPin: "2468",
    tenders: [{ tender: "cash", amount: 11 }],
  });
  const saleRow = await prisma.posSale.findFirst({ where: { id: discounted.id } });
  const logs = await prisma.activityLog.findMany({
    where: { orgId, action: "pos.discount.override" },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  const blob = JSON.stringify({ saleRow, logs });
  check("discount with PIN", discounted.status === "completed" && !blob.includes("2468") && !blob.includes("pinHash"));

  const unpaidSession = await createTicketSession(actor, {
    productId: admission.id,
    startsAt: new Date(start.getTime() + 20000000).toISOString(),
    endsAt: new Date(start.getTime() + 23000000).toISOString(),
    capacity: 3,
    label: "unpaid",
  });
  const unpaidCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, unpaidCart.id, {
    admissionProductId: admission.id,
    sessionId: unpaidSession.id,
    priceBandCode: "adult",
    qty: 1,
    name: "Unpaid",
  });
  const unpaid = await checkoutCart(actor, unpaidCart.id, {
    idempotencyKey: `unpaid-${stamp}`,
    allowUnpaid: true,
    tenders: [],
  });
  check("unpaid booking amountDue", unpaid.amountDue > 0 && unpaid.status === "unpaid");
  const unpaidBooking = await prisma.booking.findFirst({ where: { id: unpaid.bookingIds[0] } });
  await expectDeny("unpaid redeem 403", () =>
    redeemAtPos(actor, { locationId: venue.id, code: unpaidBooking?.publicId || "missing" })
  );

  const paidSession = await createTicketSession(actor, {
    productId: admission.id,
    startsAt: new Date(start.getTime() + 25000000).toISOString(),
    endsAt: new Date(start.getTime() + 28000000).toISOString(),
    capacity: 2,
    label: "paid",
  });
  const paidCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, paidCart.id, {
    admissionProductId: admission.id,
    sessionId: paidSession.id,
    priceBandCode: "adult",
    qty: 1,
    name: "Paid",
  });
  const paid = await checkoutCart(actor, paidCart.id, {
    idempotencyKey: `paid-${stamp}`,
    tenders: [{ tender: "cash", amount: 15 }],
  });
  const credential = await prisma.ticketCredential.findFirst({
    where: { bookingId: paid.bookingIds[0] },
  });
  const firstRedeem = await redeemAtPos(actor, { locationId: venue.id, code: credential?.code || "" });
  check("paid credential redeems", firstRedeem.kind === "ticket");
  await expectDeny("second redeem 400", () =>
    redeemAtPos(actor, { locationId: venue.id, code: credential?.code || "" })
  );

  const plan = await createMembershipPlan(actor, {
    name: `POS Fixed ${stamp}`,
    billing: "fixed",
    intervalCount: 1,
    intervalUnit: "month",
    price: 25,
    locationId: venue.id,
  });
  const guest = await createPosGuest(actor, {
    locationId: venue.id,
    firstName: "Ada",
    lastName: "Guest",
    email: `ada-${stamp}@test.local`,
  });
  const staffBefore = await prisma.membership.count({ where: { orgId } });
  const memProduct = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "membership_plan",
    name: "Season",
    price: 25,
    membershipPlanId: plan.id,
  });
  const memCart = await openCart(actor, {
    locationId: venue.id,
    deviceId: device.id,
    guestProfileId: guest.id,
  });
  await addCartLine(actor, memCart.id, { productId: memProduct.id, qty: 1 });
  await checkoutCart(actor, memCart.id, {
    idempotencyKey: `mem-${stamp}`,
    guestProfileId: guest.id,
    tenders: [{ tender: "cash", amount: 25 }],
  });
  const guestMemberships = await prisma.guestMembership.count({ where: { orgId, guestProfileId: guest.id } });
  const staffAfter = await prisma.membership.count({ where: { orgId } });
  check("membership sell writes GuestMembership", guestMemberships === 1);
  check("membership sell does not create staff Membership", staffAfter === staffBefore);

  await suspendPosProduct(actor, merch.id, true);
  const suspendedCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await expectDeny("suspended product cannot be added", () =>
    addCartLine(actor, suspendedCart.id, { productId: merch.id, qty: 1 })
  );

  const stock = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "food",
    name: "Fries",
    price: 4,
    trackInventory: true,
    onHand: 5,
  });
  await recordWastage(actor, {
    locationId: venue.id,
    productId: stock.id,
    qty: 2,
    reason: "dropped",
    managerPin: "2468",
  });
  const stockAfter = await prisma.posProduct.findFirst({ where: { id: stock.id } });
  check("wastage decrements onHand", stockAfter?.onHand === 3);

  const bare = await createPosDevice(actor, {
    locationId: venue.id,
    name: "Bare",
    code: `bare-${stamp}`,
  });
  const bareCart = await openCart(actor, { locationId: venue.id, deviceId: bare.id });
  await addCartLine(actor, bareCart.id, { productId: openPrice.id, unitPrice: 2, qty: 1 });
  await expectDeny("cash without open till", () =>
    checkoutCart(actor, bareCart.id, {
      idempotencyKey: `notill-${stamp}`,
      tenders: [{ tender: "cash", amount: 2 }],
    })
  );

  const counted = await closeTill(actor, till.id, { countedCash: 100, notes: "count" }, { noCount: false, allowNoCount: false });
  check("till variance stored", counted.variance != null && counted.variance !== 0);
  await expectDeny("close without no-count permission", () =>
    closeTill(actor, till.id, {}, { noCount: true, allowNoCount: false })
  );

  const hookSale = await prisma.posSale.create({
    data: {
      publicId: `PS-HOOK-${stamp}`,
      orgId,
      locationId: venue.id,
      deviceId: device.id,
      cashierUserId: growthUser.id,
      status: "unpaid",
      total: 10,
      subtotal: 10,
      amountPaid: 0,
      amountDue: 10,
      idempotencyKey: `hook-${stamp}`,
      payments: {
        create: {
          orgId,
          tender: "card",
          amount: 10,
          status: "pending",
          stripePaymentIntentId: `pi_hook_${stamp}`,
          idempotencyKey: `hook-pay-${stamp}`,
        },
      },
    },
  });
  await settlePosSalePayment(`pi_hook_${stamp}`);
  await settlePosSalePayment(`pi_hook_${stamp}`);
  const hookAfter = await prisma.posSale.findFirst({ where: { id: hookSale.id } });
  const hookPays = await prisma.posSalePayment.count({
    where: { saleId: hookSale.id, status: "completed" },
  });
  check("webhook replay does not double-complete", Number(hookAfter?.amountPaid) === 10 && hookPays === 1);

  await prisma.wallet.upsert({
    where: { userId: growthUser.id },
    create: { userId: growthUser.id, balance: 40 },
    update: { balance: 40 },
  });
  await adjustParkWallet({
    orgId,
    locationId: venue.id,
    guestProfileId: guest.id,
    amount: 15,
    type: "topup",
    reference: `pw-${stamp}`,
  });
  const fashion = await prisma.wallet.findUnique({ where: { userId: growthUser.id } });
  check("fashion wallet unchanged by park wallet", fashion?.balance === 40);

  const signup = await signupPost(new Request("http://localhost/api/auth/signup", { method: "POST", body: "{}" }));
  check("signup stays closed", signup.status === 410 || signup.status === 307 || signup.status === 308);

  const settingsJson = JSON.stringify(await getPosSettings(actor, venue.id));
  const deviceJson = JSON.stringify(await listPosDevices(actor));
  check("PIN hash absent from settings and devices", !settingsJson.includes("pinHash") && !deviceJson.includes("pinHash"));

  let capped = false;
  try {
    for (let i = 0; i < 8; i += 1) {
      await createPosDevice(actor, {
        locationId: venue.id,
        name: `Extra ${i}`,
        code: `extra-${stamp}-${i}`,
      });
    }
  } catch (err) {
    capped = err instanceof ForbiddenError;
  }
  check("device create over cap 403", capped);

  console.log("PASS smoke:pos:step1");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    try {
      const appPrisma = (await import("../src/lib/prisma.ts")).default;
      await appPrisma.$disconnect();
    } catch {
      /* ignore */
    }
  });
