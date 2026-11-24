/**
 * Fast re-check of POS audit fixes only (not the full Step 1 suite).
 *   npx tsx scripts/smoke-pos-audit-fixes.mts
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
process.env.POS_SMOKE = "1";
// Simulated tenders are refused when NODE_ENV=production.
if (process.env.NODE_ENV === "production") process.env.NODE_ENV = "test";

const prisma = new PrismaClient();

function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    throw new Error(name);
  }
  console.log(`PASS ${name}`);
}

async function main() {
  const stamp = Date.now();
  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { createPosDevice, listPosDevices } = await import("../src/lib/pos/devices.ts");
  const { createPosProduct, listPosProducts } = await import("../src/lib/pos/catalog.ts");
  const {
    openCart,
    addCartLine,
    checkoutCart,
    getCart,
    getSale,
    confirmCardPayment,
    getPendingCardSecrets,
    voidSale,
  } = await import("../src/lib/pos/saleEngine.ts");
  const { openTill } = await import("../src/lib/pos/tills.ts");
  const { settlePosSalePayment } = await import("../src/lib/pos/webhook.ts");
  const { putPosSettings } = await import("../src/lib/pos/settings.ts");

  const user = await prisma.user.create({
    data: {
      email: `pos-audit-${stamp}@test.local`,
      password: "x",
      username: `posaudit${stamp}`.slice(0, 40),
      firstName: "Pos",
      lastName: "Audit",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const reg = await createOrganizationWithPlatformAdmin({
    name: `POS Audit ${stamp}`,
    slug: `pos-audit-${stamp}`,
    userId: user.id,
  });
  const orgId = reg.organization.id;
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      subscriptionPlan: "growth",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  await prisma.taxSettings.upsert({
    where: { orgId },
    create: { orgId, enabled: false, rate: 0 },
    update: { enabled: false, rate: 0 },
  });
  const actor = {
    orgId,
    sub: user.id,
    permissions: ["pos:sell", "pos:read", "pos:cash", "pos:admin"],
  };
  const venue = await createVenueLocation(actor, {
    name: `Audit Park ${stamp}`,
    slug: `audit-park-${stamp}`,
  });
  const venue2 = await createVenueLocation(actor, {
    name: `Audit Park B ${stamp}`,
    slug: `audit-park-b-${stamp}`,
  });
  await putPosSettings(actor, venue.id, {
    cashRequiresOpenTill: true,
    managerPinRequiredForVoid: false,
  });

  const device = await createPosDevice(actor, {
    locationId: venue.id,
    name: "A1",
    code: `a1-${stamp}`,
  });
  await createPosDevice(actor, {
    locationId: venue2.id,
    name: "B1",
    code: `b1-${stamp}`,
  });
  const filtered = await listPosDevices(actor, venue.id);
  check(
    "devices filtered by location",
    filtered.length === 1 && filtered[0].locationId === venue.id
  );

  const openPrice = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "open_price",
    name: "Open",
    openPrice: true,
    price: 0,
  });
  const giftProduct = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "gift_card",
    name: "Gift",
    giftCardDefaultAmount: 10,
    price: 10,
  });
  await openTill(actor, {
    locationId: venue.id,
    deviceId: device.id,
    openingFloat: 50,
    notes: "audit",
  });

  const cart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, cart.id, { productId: openPrice.id, unitPrice: 5, qty: 1 });
  const sale = await checkoutCart(actor, cart.id, {
    idempotencyKey: `cash-${stamp}`,
    tenders: [{ tender: "cash", amount: 5 }],
  });
  check("cash sale completed", sale.status === "completed" && sale.amountPaid === 5);
  let cartGone = false;
  try {
    await getCart(actor, cart.id);
  } catch {
    cartGone = true;
  }
  check("cart deleted after checkout", cartGone);

  const cart2 = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, cart2.id, { productId: giftProduct.id, qty: 1 });
  const pending = await checkoutCart(actor, cart2.id, {
    idempotencyKey: `pend-${stamp}`,
    tenders: [{ tender: "card", amount: 10, simulate: "pending" }],
  });
  check(
    "pending card unpaid",
    pending.status === "unpaid" && pending.amountPaid === 0 && pending.amountDue === 10
  );
  check("gift not issued while unpaid", pending.issuedGiftCodes.length === 0);
  const giftsBefore = await prisma.giftCard.count({ where: { orgId, issuedSaleId: pending.id } });
  check("no gift card row while unpaid", giftsBefore === 0);

  const payIntent = pending.payments.find((p) => p.status === "pending")?.stripePaymentIntentId;
  check("pending payment row exists", Boolean(payIntent));
  check(
    "pending checkout returns cardClientSecrets",
    Array.isArray(pending.cardClientSecrets) &&
      pending.cardClientSecrets.length === 1 &&
      pending.cardClientSecrets[0]?.paymentIntentId === payIntent
  );

  const cart3 = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, cart3.id, { productId: giftProduct.id, qty: 1 });
  const pending2 = await checkoutCart(actor, cart3.id, {
    idempotencyKey: `pend2-${stamp}`,
    tenders: [{ tender: "card", amount: 10, simulate: "pending" }],
  });
  const secrets = await getPendingCardSecrets(actor, pending2.id);
  check("card-secrets reload works", secrets.cardClientSecrets.length === 1);
  const confirmed = await confirmCardPayment(actor, pending2.id, {
    paymentIntentId: String(
      pending2.payments.find((p) => p.status === "pending")?.stripePaymentIntentId
    ),
  });
  check(
    "confirm-card completes sale",
    confirmed.status === "completed" && confirmed.amountPaid === 10
  );
  const confirmedAgain = await confirmCardPayment(actor, pending2.id, {
    paymentIntentId: String(
      pending2.payments.find((p) => p.stripePaymentIntentId)?.stripePaymentIntentId
    ),
  });
  check("confirm-card idempotent", confirmedAgain.status === "completed");

  // Void unpaid pending sale — confirm-card must refuse; secrets empty.
  const cartVoid = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, cartVoid.id, { productId: giftProduct.id, qty: 1 });
  const toVoid = await checkoutCart(actor, cartVoid.id, {
    idempotencyKey: `voidpend-${stamp}`,
    tenders: [{ tender: "card", amount: 10, simulate: "pending" }],
  });
  const voidPi = String(
    toVoid.payments.find((p) => p.status === "pending")?.stripePaymentIntentId || ""
  );
  await voidSale(actor, toVoid.id, {});
  check(
    "void unpaid sale",
    (await prisma.posSale.findFirst({ where: { id: toVoid.id } }))?.status === "voided"
  );
  const voidSecrets = await getPendingCardSecrets(actor, toVoid.id);
  check("voided sale has no card secrets", voidSecrets.cardClientSecrets.length === 0);
  let voidConfirmBlocked = false;
  try {
    await confirmCardPayment(actor, toVoid.id, { paymentIntentId: voidPi });
  } catch {
    voidConfirmBlocked = true;
  }
  check("confirm-card refuses voided sale", voidConfirmBlocked);

  await settlePosSalePayment(String(payIntent));
  await settlePosSalePayment(String(payIntent));
  const after = await getSale(actor, pending.id);
  check(
    "webhook completes sale once",
    after.status === "completed" && after.amountPaid === 10
  );
  const giftsAfter = await prisma.giftCard.count({ where: { orgId, issuedSaleId: pending.id } });
  check("webhook issues gift once", giftsAfter === 1);

  let blocked = false;
  try {
    await checkoutCart(actor, cart.id, {
      idempotencyKey: `again-${stamp}`,
      tenders: [{ tender: "cash", amount: 5 }],
    });
  } catch {
    blocked = true;
  }
  check("re-checkout deleted cart fails", blocked);

  const products = await listPosProducts(actor, venue.id);
  check(
    "products list for venue",
    products.some((product: { id: string }) => product.id === openPrice.id)
  );

  console.log("PASS smoke:pos:audit-fixes");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
