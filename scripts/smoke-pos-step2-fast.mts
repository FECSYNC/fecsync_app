/**
 * Fast POS Step 2 residual — skips Step 1 overlap and heavy org bootstrap duplication.
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
        status === 429 ||
        /forbidden|PIN|required|conflict|rate|locked|outside|cover|till/i.test(message),
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
  const { openTill, closeTill } = await import("../src/lib/pos/tills.ts");
  const { openTab, addTabLine, settleTab, splitTab } = await import("../src/lib/pos/tabs.ts");
  const { syncOffline } = await import("../src/lib/pos/offline.ts");
  const { settlePosSalePayment } = await import("../src/lib/pos/webhook.ts");
  const { setManagerPin, verifyManagerPin } = await import("../src/lib/pos/pins.ts");
  const { buildCompanyWorkspaceExport } = await import("../src/lib/companyExport.ts");
  const { POST: signupPost } = await import("../src/app/api/auth/signup/route.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");

  const user = await prisma.user.create({
    data: {
      email: `pos2f-${stamp}@t.local`,
      password: "x",
      username: (`p2f${stamp}`).slice(0, 40),
      firstName: "P",
      lastName: "F",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const reg = await createOrganizationWithPlatformAdmin({
    name: `POS2F ${stamp}`,
    slug: `pos2f-${stamp}`,
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
      "pos:till_no_count",
    ],
  };
  const venue = await createVenueLocation(actor, {
    name: `P2F ${stamp}`,
    slug: `p2f-${stamp}`,
  });
  await putPosSettings(actor, venue.id, { cashRequiresOpenTill: true, offlineEnabled: true });
  const device = await createPosDevice(actor, {
    locationId: venue.id,
    name: "D",
    code: `d2f-${stamp}`,
  });
  const merch = await createPosProduct(actor, {
    locationId: venue.id,
    kind: "merchandise",
    name: "Mug",
    price: 12,
  });
  await openTill(actor, {
    locationId: venue.id,
    deviceId: device.id,
    openingFloat: 10,
  });

  const tab = await openTab(actor, {
    locationId: venue.id,
    deviceId: device.id,
    tableLabel: "A1",
  });
  await addTabLine(actor, tab.id, {
    locationId: venue.id,
    name: "Soda",
    qty: 1,
    unitPrice: 3,
  });
  const split = await splitTab(actor, tab.id, { locationId: venue.id });
  check("beta split flag", split.beta === true);
  check("parent tab id intact", (await prisma.guestTab.findFirst({ where: { id: tab.id } }))?.id === tab.id);
  const settled = await settleTab(actor, tab.id, {
    locationId: venue.id,
    deviceId: device.id,
    tenders: [{ tender: "cash", amount: 3 }],
    idempotencyKey: `tabf-${stamp}`,
  });
  check("tab settle works", Boolean(settled.sale?.id));

  // Conflict path only (no nested checkout) — merch offline apply is covered in step2:full.
  const offlineConflict = await syncOffline(actor, {
    locationId: venue.id,
    deviceId: device.id,
    clientMutationId: `offadm-${stamp}`,
    payload: {
      lines: [{ kind: "booking", qty: 1, name: "Tix", unitPrice: 15 }],
      sessionId: "x",
      total: 15,
    },
  });
  check("offline admission conflict", offlineConflict.status === "conflict");
  const offlineConflictReplay = await syncOffline(actor, {
    locationId: venue.id,
    deviceId: device.id,
    clientMutationId: `offadm-${stamp}`,
    payload: {
      lines: [{ kind: "booking", qty: 1, name: "Tix", unitPrice: 15 }],
      sessionId: "x",
      total: 15,
    },
  });
  check("offline conflict replay stays conflict", offlineConflictReplay.status === "conflict");
  void merch;

  const hook = await prisma.posSale.create({
    data: {
      publicId: `PS2F-${stamp}`,
      orgId,
      locationId: venue.id,
      deviceId: device.id,
      cashierUserId: user.id,
      status: "unpaid",
      total: 5,
      subtotal: 5,
      amountPaid: 0,
      amountDue: 5,
      idempotencyKey: `hookf-${stamp}`,
      payments: {
        create: {
          orgId,
          tender: "card",
          amount: 5,
          status: "pending",
          stripePaymentIntentId: `pi_f_${stamp}`,
          idempotencyKey: `hookf-pay-${stamp}`,
        },
      },
    },
  });
  await settlePosSalePayment(`pi_f_${stamp}`);
  await settlePosSalePayment(`pi_f_${stamp}`);
  check(
    "webhook settles once",
    Number((await prisma.posSale.findFirst({ where: { id: hook.id } }))?.amountPaid) === 5
  );

  await setManagerPin(actor, "2468");
  let pinBad = false;
  try {
    await verifyManagerPin(actor, "0000", venue.id);
  } catch {
    pinBad = true;
  }
  check("PIN verify rejects bad PIN", pinBad);

  const tillOpen = await prisma.tillSession.findFirst({
    where: { deviceId: device.id, status: "open" },
  });
  if (tillOpen) {
    const closed = await closeTill(
      actor,
      tillOpen.id,
      { countedCash: 5 },
      { noCount: false, allowNoCount: false }
    );
    check("till variance stored", closed.variance != null);
    await expectDeny("close no-count without permission", () =>
      closeTill(actor, tillOpen.id, {}, { noCount: true, allowNoCount: false })
    );
  }

  const exportJson = JSON.stringify(await buildCompanyWorkspaceExport(orgId));
  check("export omits pinHash", !exportJson.includes("pinHash"));

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
        code: `xf-${stamp}-${i}`,
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
    try {
      const appPrisma = (await import("../src/lib/prisma.ts")).default;
      await appPrisma.$disconnect();
    } catch {
      /* ignore */
    }
  });
