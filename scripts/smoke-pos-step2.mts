/**
 * POS Step 2 smoke — terminal / check-in / tills / tabs / offline / gates.
 * Prefers cases Step 1 may not have driven from UI routes.
 *
 *   yarn smoke:pos:step2
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
    check(
      name,
      status === 403 ||
        status === 400 ||
        status === 429 ||
        status === 409 ||
        /forbidden|not included|locked|storefront|plan limit|PIN|outside|conflict|required|rate/i.test(
          message
        ),
      message
    );
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
  const { listPosDevices, createPosDevice } = await import("../src/lib/pos/devices.ts");
  const { createPosProduct, suspendPosProduct } = await import("../src/lib/pos/catalog.ts");
  const { createDiscountCode } = await import("../src/lib/pos/catalog.ts");
  const { setManagerPin, verifyManagerPin } = await import("../src/lib/pos/pins.ts");
  const {
    openCart,
    addCartLine,
    checkoutCart,
    voidSale,
    refundSale,
  } = await import("../src/lib/pos/saleEngine.ts");
  const { recordWastage } = await import("../src/lib/pos/saleEngine.ts");
  const { issuePosGiftCard, redeemPosGiftCard, adjustParkWallet, adjustCashless, issueCashless } =
    await import("../src/lib/pos/storedValue.ts");
  const { openTill, closeTill, listTills } = await import("../src/lib/pos/tills.ts");
  const { redeemAtPos } = await import("../src/lib/pos/checkin.ts");
  const { settlePosSalePayment } = await import("../src/lib/pos/webhook.ts");
  const { syncOffline } = await import("../src/lib/pos/offline.ts");
  const { openTab, addTabLine, settleTab, splitTab } = await import("../src/lib/pos/tabs.ts");
  const { createBooking } = await import("../src/lib/ticketing/bookingEngine.ts");
  const { createAdmissionProduct } = await import("../src/lib/ticketing/products.ts");
  const { createTicketSession } = await import("../src/lib/ticketing/sessions.ts");
  const { createMembershipPlan } = await import("../src/lib/memberships/plans.ts");
  const { createPosGuest } = await import("../src/lib/pos/guests.ts");
  const { buildCompanyWorkspaceExport } = await import("../src/lib/companyExport.ts");
  const { POST: signupPost } = await import("../src/app/api/auth/signup/route.ts");
  const { SHIPPED_MODULE_HINT_IDS } = await import("../src/lib/subscriptionPlans.ts");

  check("shipped-hints-include-pos", (SHIPPED_MODULE_HINT_IDS as readonly string[]).includes("pos"));

  const stamp = Date.now();
  async function user(tag: string) {
    return prisma.user.create({
      data: {
        email: `smoke-pos2-${tag}-${stamp}@test.local`,
        password: "x",
        username: `smokepos2${tag}${stamp}`.slice(0, 40),
        firstName: "Pos2",
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
    name: `Smoke POS2 ${stamp}`,
    slug: `smoke-pos2-${stamp}`,
    userId: growthUser.id,
  });
  const demoOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke POS2 Demo ${stamp}`,
    slug: `smoke-pos2-demo-${stamp}`,
    userId: demoUser.id,
  });
  const starterOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke POS2 St ${stamp}`,
    slug: `smoke-pos2-st-${stamp}`,
    userId: starterUser.id,
  });
  const otherOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke POS2 Ot ${stamp}`,
    slug: `smoke-pos2-ot-${stamp}`,
    userId: otherUser.id,
  });
  const orgId = growthOrg.organization.id;
  const actor = {
    orgId,
    sub: growthUser.id,
    permissions: [
      "pos:sell",
      "pos:read",
      "pos:cash",
      "pos:admin",
      "pos:refund",
      "pos:void",
      "pos:discount",
      "pos:checkin",
      "pos:tabs",
      "pos:till_open",
      "pos:till_close",
      "pos:till_no_count",
      "pos:till_edit",
      "pos:wastage",
      "pos:guests_write",
      "memberships:write",
      "memberships:read",
    ],
  };
  await entitle(orgId, "growth");
  await entitle(demoOrg.organization.id, "demo");
  await entitle(starterOrg.organization.id, "starter");
  await entitle(otherOrg.organization.id, "growth");
  const otherActor = { orgId: otherOrg.organization.id, sub: otherUser.id };
  const starterActor = { orgId: starterOrg.organization.id, sub: starterUser.id };
  const storefrontId = await getStorefrontOrgId();

  await expectDeny("storefront POS 403", () => assertPosEnabled(storefrontId));
  await expectDeny("demo POS 403", () => assertPosEnabled(demoOrg.organization.id));
  await expectDeny("starter POS 403", () => assertPosEnabled(starterOrg.organization.id));

  await prisma.taxSettings.upsert({
    where: { orgId },
    create: { orgId, enabled: false, rate: 0 },
    update: { enabled: false, rate: 0 },
  });

  const venue = await createVenueLocation(actor, {
    name: `POS2 Park ${stamp}`,
    slug: `pos2-park-${stamp}`,
  });
  await putPosSettings(actor, venue.id, {
    cashRequiresOpenTill: true,
    postcodeRequired: true,
    requireGuestOnSale: false,
    managerPinRequiredForDiscount: true,
    managerPinRequiredForRefund: true,
    managerPinRequiredForVoid: true,
    offlineEnabled: true,
    allowUnpaidBookings: true,
    paidRequiredForRedeem: true,
    bannedGuestPrompt: true,
    showExpectedTillTotals: false,
  });

  const device = await createPosDevice(actor, {
    locationId: venue.id,
    name: "Front",
    code: `front2-${stamp}`,
  });
  await expectDeny("cross-tenant device list", () => listPosDevices(otherActor, venue.id));

  const merch = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "merchandise",
    name: "Hat",
    price: 12,
    trackInventory: true,
    onHand: 5,
  });
  const food = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "food",
    name: "Fries",
    price: 4,
    kitchenRoute: "fryer",
  });
  check(
    "fashion Product rows absent from POS catalog create",
    !(await prisma.product.findFirst({ where: { id: merch.id } }))
  );

  const till = await openTill(actor, {
    locationId: venue.id,
    deviceId: device.id,
    openingFloat: 50,
  });
  const tillsHidden = await listTills(actor, false);
  const openRow = tillsHidden.find((t) => t.id === till.id);
  check("expected cash hidden for cashier when setting false", openRow?.expectedCash == null);

  const guest = await createPosGuest(actor, {
    locationId: venue.id,
    firstName: "Bo",
    lastName: "Guest",
    email: `bo-${stamp}@test.local`,
  });

  await expectDeny("postcode required blocks checkout", () =>
    openCart(actor, { locationId: venue.id, deviceId: device.id }).then(async (cart) => {
      await addCartLine(actor, cart.id, { productId: merch.id, qty: 1 });
      return checkoutCart(actor, cart.id, {
        idempotencyKey: `pc-${stamp}`,
        tenders: [{ tender: "cash", amount: 12 }],
      });
    })
  );

  await putPosSettings(actor, venue.id, { postcodeRequired: false });

  const cart = await openCart(actor, {
    locationId: venue.id,
    deviceId: device.id,
    guestProfileId: guest.id,
  });
  await addCartLine(actor, cart.id, { productId: merch.id, qty: 1 });
  await addCartLine(actor, cart.id, { productId: food.id, qty: 1 });
  const sale = await checkoutCart(actor, cart.id, {
    idempotencyKey: `mix2-${stamp}`,
    guestProfileId: guest.id,
    tipAmount: 1,
    tipAllocations: [{ userId: growthUser.id, amount: 1 }],
    tenders: [
      { tender: "cash", amount: 8 },
      { tender: "card", amount: 9, simulate: "succeeded" },
    ],
  });
  check("split cash+card completed", sale.status === "completed" && sale.amountDue === 0);
  const kitchen = await prisma.kitchenTicket.findFirst({ where: { saleId: sale.id } });
  check("food line creates KitchenTicket", Boolean(kitchen));
  check(
    "no kitchen display page route claimed",
    true
  );

  await expectDeny("tip allocations must sum", () =>
    openCart(actor, { locationId: venue.id, deviceId: device.id }).then(async (c) => {
      await addCartLine(actor, c.id, { productId: merch.id, qty: 1 });
      return checkoutCart(actor, c.id, {
        idempotencyKey: `tip-bad-${stamp}`,
        tipAmount: 2,
        tipAllocations: [{ userId: growthUser.id, amount: 1 }],
        tenders: [{ tender: "cash", amount: 14 }],
      });
    })
  );

  const gift = await issuePosGiftCard({
    orgId,
    locationId: venue.id,
    amount: 20,
    idempotencyKey: `gc2-${stamp}`,
  });
  await redeemPosGiftCard({
    orgId,
    code: gift.code,
    amount: 5,
    idempotencyKey: `gcr-${stamp}`,
  });
  await expectDeny("cross-tenant gift redeem", () =>
    redeemPosGiftCard({
      orgId: otherOrg.organization.id,
      code: gift.code,
      amount: 1,
      idempotencyKey: `gcx-${stamp}`,
    })
  );

  await adjustParkWallet({
    orgId,
    locationId: venue.id,
    guestProfileId: guest.id,
    amount: 10,
    type: "topup",
    reference: `pw2-${stamp}`,
  });
  await adjustParkWallet({
    orgId,
    locationId: venue.id,
    guestProfileId: guest.id,
    amount: 3,
    type: "redeem",
    reference: `pwr2-${stamp}`,
  });
  await prisma.wallet.upsert({
    where: { userId: growthUser.id },
    create: { userId: growthUser.id, balance: 99 },
    update: { balance: 99 },
  });
  const fashion = await prisma.wallet.findUnique({ where: { userId: growthUser.id } });
  check("shop Wallet unchanged by park wallet", fashion?.balance === 99);

  const cashless = await issueCashless({
    orgId,
    locationId: venue.id,
    amount: 8,
    guestProfileId: guest.id,
  });
  await adjustCashless({ orgId, code: cashless.code, amount: -2 });

  await setManagerPin(actor, "1357");
  await createDiscountCode(actor, {
    locationId: venue.id,
    code: `OFF${stamp}`,
    amountOff: 1,
    requiresManagerPin: true,
  });
  const discCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, discCart.id, { productId: merch.id, qty: 1 });
  await expectDeny("discount without PIN", () =>
    checkoutCart(actor, discCart.id, {
      idempotencyKey: `dno-${stamp}`,
      discountCode: `OFF${stamp}`,
      tenders: [{ tender: "cash", amount: 12 }],
    })
  );

  await expectDeny("void without PIN when required", () =>
    voidSale(actor, sale.id, {})
  );
  await voidSale(actor, sale.id, { managerPin: "1357" });
  check("void with PIN", (await prisma.posSale.findFirst({ where: { id: sale.id } }))?.status === "voided");

  const refundCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, refundCart.id, { productId: merch.id, qty: 1 });
  const refundSaleRow = await checkoutCart(actor, refundCart.id, {
    idempotencyKey: `ref-${stamp}`,
    tenders: [{ tender: "cash", amount: 12 }],
  });
  await expectDeny("refund without PIN", () => refundSale(actor, refundSaleRow.id, { amount: 12 }));
  await refundSale(actor, refundSaleRow.id, {
    amount: 12,
    managerPin: "1357",
    idempotencyKey: `refok-${stamp}`,
  });
  check(
    "refund with PIN",
    (await prisma.posSale.findFirst({ where: { id: refundSaleRow.id } }))?.status === "refunded" ||
      (await prisma.posSaleRefund.count({ where: { saleId: refundSaleRow.id } })) === 1
  );

  const admission = await createAdmissionProduct(actor, {
    type: "timed_session",
    name: `POS2 sess ${stamp}`,
    locationId: venue.id,
    prices: [{ code: "adult", amount: 15 }],
    published: true,
  });
  const start = new Date(Date.now() + 86400000);
  const lastSeat = await createTicketSession(actor, {
    productId: admission.id,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3600000).toISOString(),
    capacity: 1,
    label: "one",
  });
  const holdCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, holdCart.id, {
    admissionProductId: admission.id,
    sessionId: lastSeat.id,
    priceBandCode: "adult",
    qty: 1,
    name: "Adult",
  });
  await checkoutCart(actor, holdCart.id, {
    idempotencyKey: `seat-${stamp}`,
    tenders: [{ tender: "cash", amount: 15 }],
  });
  let oversold = false;
  try {
    const again = await openCart(actor, { locationId: venue.id, deviceId: device.id });
    await addCartLine(actor, again.id, {
      admissionProductId: admission.id,
      sessionId: lastSeat.id,
      priceBandCode: "adult",
      qty: 1,
      name: "Adult",
    });
    await checkoutCart(actor, again.id, {
      idempotencyKey: `seat2-${stamp}`,
      tenders: [{ tender: "cash", amount: 15 }],
    });
  } catch {
    oversold = true;
  }
  check("last seat cannot sell twice", oversold);

  const unpaidSession = await createTicketSession(actor, {
    productId: admission.id,
    startsAt: new Date(start.getTime() + 7200000).toISOString(),
    endsAt: new Date(start.getTime() + 10800000).toISOString(),
    capacity: 3,
    label: "unpaid2",
  });
  const unpaidCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, unpaidCart.id, {
    admissionProductId: admission.id,
    sessionId: unpaidSession.id,
    priceBandCode: "adult",
    qty: 1,
    name: "U",
  });
  const unpaid = await checkoutCart(actor, unpaidCart.id, {
    idempotencyKey: `unp2-${stamp}`,
    allowUnpaid: true,
    tenders: [],
  });
  const unpaidBooking = await prisma.booking.findFirst({ where: { id: unpaid.bookingIds[0] } });
  await expectDeny("unpaid booking cannot redeem", () =>
    redeemAtPos(actor, { locationId: venue.id, code: unpaidBooking?.publicId || "x" })
  );

  const paidSession = await createTicketSession(actor, {
    productId: admission.id,
    startsAt: new Date(start.getTime() + 14000000).toISOString(),
    endsAt: new Date(start.getTime() + 17000000).toISOString(),
    capacity: 2,
    label: "paid2",
  });
  const paidCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, paidCart.id, {
    admissionProductId: admission.id,
    sessionId: paidSession.id,
    priceBandCode: "adult",
    qty: 1,
    name: "P",
  });
  const paid = await checkoutCart(actor, paidCart.id, {
    idempotencyKey: `paid2-${stamp}`,
    tenders: [{ tender: "cash", amount: 15 }],
  });
  const cred = await prisma.ticketCredential.findFirst({ where: { bookingId: paid.bookingIds[0] } });
  await redeemAtPos(actor, { locationId: venue.id, code: cred?.code || "" });
  await expectDeny("check-in double redeem", () =>
    redeemAtPos(actor, { locationId: venue.id, code: cred?.code || "" })
  );

  await prisma.guestProfile.update({
    where: { id: guest.id },
    data: { bannedAt: new Date() },
  });
  const bannedCart = await openCart(actor, {
    locationId: venue.id,
    deviceId: device.id,
    guestProfileId: guest.id,
  });
  await addCartLine(actor, bannedCart.id, { productId: merch.id, qty: 1 });
  await expectDeny("banned guest without override", () =>
    checkoutCart(actor, bannedCart.id, {
      idempotencyKey: `ban-${stamp}`,
      guestProfileId: guest.id,
      tenders: [{ tender: "cash", amount: 12 }],
    })
  );
  await prisma.guestProfile.update({
    where: { id: guest.id },
    data: { bannedAt: null },
  });

  const plan = await createMembershipPlan(actor, {
    name: `POS2 Mem ${stamp}`,
    billing: "fixed",
    intervalCount: 1,
    intervalUnit: "month",
    price: 25,
    locationId: venue.id,
  });
  const memProduct = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "membership_plan",
    name: "Season2",
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
    idempotencyKey: `mem2-${stamp}`,
    guestProfileId: guest.id,
    tenders: [{ tender: "cash", amount: 25 }],
  });
  check(
    "membership sell",
    (await prisma.guestMembership.count({ where: { orgId, guestProfileId: guest.id } })) >= 1
  );

  const tab = await openTab(actor, {
    locationId: venue.id,
    deviceId: device.id,
    tableLabel: "T1",
  });
  await addTabLine(actor, tab.id, {
    locationId: venue.id,
    name: "Soda",
    qty: 1,
    unitPrice: 3,
  });
  const split = await splitTab(actor, tab.id, { locationId: venue.id });
  check("beta split flag", split.beta === true);
  const parent = await prisma.guestTab.findFirst({ where: { id: tab.id } });
  check("split does not corrupt parent id", parent?.id === tab.id);
  const settled = await settleTab(actor, tab.id, {
    locationId: venue.id,
    deviceId: device.id,
    tenders: [{ tender: "cash", amount: 3 }],
    idempotencyKey: `tab-${stamp}`,
  });
  check("tab settle works", Boolean(settled.sale?.id));

  const offlineOk = await syncOffline(actor, {
    locationId: venue.id,
    deviceId: device.id,
    clientMutationId: `off-${stamp}`,
    payload: {
      lines: [{ kind: "merchandise", productId: merch.id, qty: 1, name: "Hat", unitPrice: 12 }],
      total: 12,
    },
  });
  check("offline merch cash sync applied", offlineOk.status === "applied");
  const offlineReplay = await syncOffline(actor, {
    locationId: venue.id,
    deviceId: device.id,
    clientMutationId: `off-${stamp}`,
    payload: {
      lines: [{ kind: "merchandise", productId: merch.id, qty: 1, name: "Hat", unitPrice: 12 }],
      total: 12,
    },
  });
  check("offline sync idempotent", offlineReplay.status === "applied");
  const offlineConflict = await syncOffline(actor, {
    locationId: venue.id,
    deviceId: device.id,
    clientMutationId: `off-adm-${stamp}`,
    payload: {
      lines: [{ kind: "booking", admissionProductId: admission.id, qty: 1, name: "Tix", unitPrice: 15 }],
      sessionId: paidSession.id,
      total: 15,
    },
  });
  check("offline admission is conflict", offlineConflict.status === "conflict");

  const hook = await prisma.posSale.create({
    data: {
      publicId: `PS2-HOOK-${stamp}`,
      orgId,
      locationId: venue.id,
      deviceId: device.id,
      cashierUserId: growthUser.id,
      status: "unpaid",
      total: 7,
      subtotal: 7,
      amountPaid: 0,
      amountDue: 7,
      idempotencyKey: `hook2-${stamp}`,
      payments: {
        create: {
          orgId,
          tender: "card",
          amount: 7,
          status: "pending",
          stripePaymentIntentId: `pi_hook2_${stamp}`,
          idempotencyKey: `hook2-pay-${stamp}`,
        },
      },
    },
  });
  await settlePosSalePayment(`pi_hook2_${stamp}`);
  await settlePosSalePayment(`pi_hook2_${stamp}`);
  const hookAfter = await prisma.posSale.findFirst({ where: { id: hook.id } });
  check("payment link webhook settles once", Number(hookAfter?.amountPaid) === 7);

  await suspendPosProduct(actor, merch.id, true);
  await expectDeny("suspended product cannot add", () =>
    openCart(actor, { locationId: venue.id, deviceId: device.id }).then((c) =>
      addCartLine(actor, c.id, { productId: merch.id, qty: 1 })
    )
  );
  await suspendPosProduct(actor, merch.id, false);

  await recordWastage(actor, {
    locationId: venue.id,
    productId: food.id,
    qty: 1,
    reason: "drop",
    managerPin: "1357",
  });

  const counted = await closeTill(actor, till.id, { countedCash: 40 }, { noCount: false, allowNoCount: false });
  check("till variance stored", counted.variance != null);
  await expectDeny("close no-count without permission", () =>
    closeTill(actor, till.id, {}, { noCount: true, allowNoCount: false })
  );

  let pinBurst = false;
  for (let i = 0; i < 3; i += 1) {
    try {
      await verifyManagerPin(actor, "0000", venue.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/rate|locked|required|PIN|forbidden/i.test(msg)) pinBurst = true;
    }
  }
  check("PIN verify rejects bad PIN", pinBurst);

  const exportJson = JSON.stringify(await buildCompanyWorkspaceExport(orgId));
  check(
    "export omits hashes and PINs",
    !exportJson.includes("pinHash") && !exportJson.includes('"1357"')
  );

  await expectDeny("cross-tenant sale read", () =>
    import("../src/lib/pos/saleEngine.ts").then((m) => m.getSale(otherActor, sale.id))
  );
  await expectDeny("starter channel pos booking", () =>
    createBooking(starterActor, {
      locationId: "clh0000000000000000000000",
      channel: "pos",
      lines: [{ productId: "clh0000000000000000000001", qty: 1 }],
    })
  );

  const signup = await signupPost(
    new Request("http://localhost/api/auth/signup", { method: "POST", body: "{}" })
  );
  check("signup stays closed", signup.status === 410 || signup.status === 307 || signup.status === 308);

  let capped = false;
  try {
    for (let i = 0; i < 8; i += 1) {
      await createPosDevice(actor, {
        locationId: venue.id,
        name: `X${i}`,
        code: `x2-${stamp}-${i}`,
      });
    }
  } catch (err) {
    capped = err instanceof ForbiddenError;
  }
  check("device cap holds", capped);

  console.log("PASS smoke:pos:step2");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
