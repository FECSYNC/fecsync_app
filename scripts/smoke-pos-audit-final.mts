/**
 * Targeted retests for final POS Step 2 audit fixes.
 *   POS_SMOKE=1 npx tsx scripts/smoke-pos-audit-final.mts
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
process.env.POS_SMOKE = "1";
const prisma = new PrismaClient();

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    return;
  }
  console.log(`PASS ${name}`);
}

async function expectDeny(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "succeeded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status: number }).status)
        : 0;
    check(
      name,
      status === 403 ||
        status === 400 ||
        status === 404 ||
        /forbidden|outside|not found|PIN|required|invalid|credential/i.test(message),
      message
    );
  }
}

async function main() {
  const stamp = Date.now();
  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { putPosSettings } = await import("../src/lib/pos/settings.ts");
  const { createPosDevice } = await import("../src/lib/pos/devices.ts");
  const { createPosProduct } = await import("../src/lib/pos/catalog.ts");
  const { openTill } = await import("../src/lib/pos/tills.ts");
  const { openCart, addCartLine, checkoutCart, getSale, getCart } = await import(
    "../src/lib/pos/saleEngine.ts"
  );
  const { settlePosSalePayment } = await import("../src/lib/pos/webhook.ts");
  const { syncOffline } = await import("../src/lib/pos/offline.ts");
  const { setManagerPin, verifyManagerPin } = await import("../src/lib/pos/pins.ts");
  const { assignPosCustomIds } = await import("../src/lib/pos/checkin.ts");
  const { SHIPPED_MODULE_HINT_IDS } = await import("../src/lib/subscriptionPlans.ts");
  const { buildCompanyWorkspaceExport } = await import("../src/lib/companyExport.ts");
  const { POST: signupPost } = await import("../src/app/api/auth/signup/route.ts");
  const { kickDrawer } = await import("../src/lib/pos/devices.ts");

  check("SHIPPED_MODULE_HINT_IDS includes pos", (SHIPPED_MODULE_HINT_IDS as readonly string[]).includes("pos"));

  const user = await prisma.user.create({
    data: {
      email: `posaf-${stamp}@t.local`,
      password: "x",
      username: (`paf${stamp}`).slice(0, 40),
      firstName: "A",
      lastName: "F",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const reg = await createOrganizationWithPlatformAdmin({
    name: `POSAF ${stamp}`,
    slug: `posaf-${stamp}`,
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
    permissions: [
      "pos:sell",
      "pos:read",
      "pos:cash",
      "pos:admin",
      "pos:tabs",
      "pos:till_open",
      "pos:till_close",
      "pos:checkin",
    ],
  };
  const venue = await createVenueLocation(actor, {
    name: `PAF ${stamp}`,
    slug: `paf-${stamp}`,
  });
  const otherVenue = await createVenueLocation(actor, {
    name: `PAF2 ${stamp}`,
    slug: `paf2-${stamp}`,
  });
  await putPosSettings(actor, venue.id, { cashRequiresOpenTill: true, offlineEnabled: true });
  const device = await createPosDevice(actor, {
    locationId: venue.id,
    name: "D",
    code: `daf-${stamp}`,
  });
  const merch = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "merchandise",
    name: "Mug",
    price: 10,
  });
  const food = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "food",
    name: "Fries",
    price: 5,
  });
  await openTill(actor, {
    locationId: venue.id,
    deviceId: device.id,
    openingFloat: 10,
  });

  await setManagerPin(actor, "4242");
  const pinOk = await verifyManagerPin(actor, "4242", venue.id);
  check("manager PIN verify order (pin, locationId)", Boolean(pinOk.userId));

  const tipCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, tipCart.id, { productId: merch.id, qty: 1 });
  const tipped = await checkoutCart(actor, tipCart.id, {
    tenders: [{ tender: "cash", amount: 11.5 }],
    tipAmount: 1.5,
    idempotencyKey: `tip-${stamp}`,
  });
  const tipRows = await prisma.posTipAllocation.findMany({ where: { saleId: tipped.id } });
  check("tip auto-allocates without tipAllocations body", tipRows.length === 1 && Number(tipRows[0].amount) === 1.5);

  const foodCart = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await addCartLine(actor, foodCart.id, { productId: food.id, qty: 1 });
  const foodSale = await checkoutCart(actor, foodCart.id, {
    tenders: [{ tender: "cash", amount: 5 }],
    idempotencyKey: `food-${stamp}`,
  });
  check(
    "kitchen ticket for food",
    (await prisma.kitchenTicket.count({ where: { saleId: foodSale.id } })) >= 1
  );

  const sessionId = `cs_audit_${stamp}`;
  const piId = `pi_audit_${stamp}`;
  const linkSale = await prisma.posSale.create({
    data: {
      publicId: `PSA-${stamp}`,
      orgId,
      locationId: venue.id,
      deviceId: device.id,
      cashierUserId: user.id,
      status: "unpaid",
      total: 7,
      subtotal: 7,
      amountPaid: 0,
      amountDue: 7,
      idempotencyKey: `plink-sale-${stamp}`,
      payments: {
        create: {
          orgId,
          tender: "payment_link",
          amount: 7,
          status: "pending",
          stripePaymentIntentId: `cs:${sessionId}`,
          idempotencyKey: `plink-pay-${stamp}`,
        },
      },
    },
  });
  const ordersBefore = await prisma.order.count();
  const settled = await settlePosSalePayment(piId, {
    checkoutSessionId: sessionId,
    posSaleId: linkSale.id,
  });
  check("payment-link settle by cs:session + posSaleId", settled.ok === true && !("already" in settled && settled.already));
  const settledAgain = await settlePosSalePayment(piId, {
    checkoutSessionId: sessionId,
    posSaleId: linkSale.id,
  });
  check("payment-link settle idempotent", settledAgain.ok === true && settledAgain.already === true);
  check("shop Order count unchanged after payment-link settle", (await prisma.order.count()) === ordersBefore);
  check(
    "payment-link sale completed",
    (await prisma.posSale.findFirst({ where: { id: linkSale.id } }))?.status === "completed"
  );

  const mutId = `off-${stamp}`;
  const offline = await syncOffline(actor, {
    locationId: venue.id,
    deviceId: device.id,
    clientMutationId: mutId,
    payload: {
      lines: [{ productId: merch.id, kind: "merchandise", name: "Mug", qty: 1, unitPrice: 10 }],
      total: 10,
    },
  });
  check("offline merch cash applied", offline.status === "applied");
  const offlineReplay = await syncOffline(actor, {
    locationId: venue.id,
    deviceId: device.id,
    clientMutationId: mutId,
    payload: {
      lines: [{ productId: merch.id, kind: "merchandise", name: "Mug", qty: 1, unitPrice: 10 }],
      total: 10,
    },
  });
  check(
    "offline clientMutationId idempotent",
    offlineReplay.id === offline.id && offlineReplay.status === "applied"
  );
  const conflict = await syncOffline(actor, {
    locationId: venue.id,
    deviceId: device.id,
    clientMutationId: `adm-${stamp}`,
    payload: {
      lines: [{ kind: "booking", name: "Tix", qty: 1, unitPrice: 20 }],
      sessionId: "x",
      total: 20,
    },
  });
  check("offline refuses admissions", conflict.status === "conflict");

  await expectDeny("custom-ids flat body reaches credential helper", () =>
    assignPosCustomIds(actor, {
      locationId: venue.id,
      credentialId: "cred_missing_audit",
      customTicketId: "CUSTOM-1",
    })
  );

  const lockedUser = await prisma.user.create({
    data: {
      email: `poslk-${stamp}@t.local`,
      password: "x",
      username: (`plk${stamp}`).slice(0, 40),
      firstName: "L",
      lastName: "K",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const lockedMembership = await prisma.membership.create({
    data: {
      userId: lockedUser.id,
      orgId,
      rolePreset: "custom",
      status: "active",
      permissionsOverride: ["pos:sell", "pos:read", "pos:cash", "pos:admin"],
    },
  });
  await prisma.membershipVenueAssignment.create({
    data: {
      membershipId: lockedMembership.id,
      locationId: otherVenue.id,
      orgId,
    },
  });
  const lockedActor = {
    orgId,
    sub: lockedUser.id,
    permissions: ["pos:sell", "pos:read", "pos:cash", "pos:admin"],
  };
  await expectDeny("park-locked getSale other park", () => getSale(lockedActor, tipped.id));
  const openOther = await openCart(actor, { locationId: venue.id, deviceId: device.id });
  await expectDeny("park-locked getCart other park", () => getCart(lockedActor, openOther.id));

  const drawer = await kickDrawer(actor, device.id);
  check("drawer kick NO_DRAWER_AGENT when unset", drawer.kicked === false && drawer.reason === "NO_DRAWER_AGENT");

  const exportJson = JSON.stringify(await buildCompanyWorkspaceExport(orgId));
  check("export omits pinHash and gift code plaintext", !exportJson.includes("pinHash") && !/"code":\s*"[A-Z0-9]{8,}"/.test(exportJson));

  const signup = await signupPost(
    new Request("http://localhost/api/auth/signup", { method: "POST", body: "{}" })
  );
  check("signup stays closed", signup.status === 410 || signup.status === 307 || signup.status === 308);

  if (failed) {
    console.error(`FAIL smoke:pos:audit-final (${failed})`);
    process.exitCode = 1;
    return;
  }
  console.log("PASS smoke:pos:audit-final");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
