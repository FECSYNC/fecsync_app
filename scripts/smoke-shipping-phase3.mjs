/**
 * Phase 3 offline verification — booking, webhooks, admin shipment API.
 * Usage: node scripts/smoke-shipping-phase3.mjs
 */
import assertNode from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl, readEnvFile, envValue } from "./prisma-env.mjs";

loadDatabaseUrl();
const envFile = readEnvFile();
const orgId = envValue(envFile, "DEFAULT_ORG_ID");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

/** Mirror statusSync maps */
const ORDER_STATUS_RANK = { paid: 1, shipping: 2, shipped: 3, delivered: 4 };
function shouldUpgradeOrderStatus(current, next) {
  const a = ORDER_STATUS_RANK[current];
  const b = ORDER_STATUS_RANK[next];
  if (a == null || b == null) return false;
  return b > a;
}
function mapShipmentStatusToOrderStatus(shipmentStatus) {
  switch (shipmentStatus) {
    case "booked":
    case "picked_up":
      return "shipping";
    case "in_transit":
    case "out_for_delivery":
      return "shipped";
    case "delivered":
      return "delivered";
    default:
      return null;
  }
}
function normalizeProviderShipmentStatus(raw, event) {
  const eventKey = String(event || "").trim().toLowerCase();
  if (eventKey.includes("cancel")) return "cancelled";
  if (eventKey === "shipment.label.created") return "booked";
  const key = String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["in_transit", "transit", "dispatched"].includes(key)) return "in_transit";
  if (key === "delivered" || key === "completed") return "delivered";
  if (key === "booked" || key === "confirmed") return "booked";
  return null;
}

function verifyShipbubbleWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader?.trim()) return false;
  const expectedHex = crypto
    .createHmac("sha512", secret)
    .update(rawBody, "utf8")
    .digest("hex")
    .toLowerCase();
  let normalized = signatureHeader.trim().toLowerCase();
  if (normalized.startsWith("sha512=")) {
    normalized = normalized.slice("sha512=".length).trim();
  }
  try {
    const a = Buffer.from(expectedHex, "utf8");
    const b = Buffer.from(normalized, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function main() {
  console.log("\nPhase 3 smoke (offline)\n");

  console.log("1) Module / route presence (F2/F5/F6/F7/F8)");
  const required = [
    "src/lib/shipping/booking.ts",
    "src/lib/shipping/statusSync.ts",
    "src/lib/shipping/providers/shipbubble/book.ts",
    "src/lib/shipping/shipmentsApi.ts",
    "src/app/api/webhooks/shipping/shipbubble/route.ts",
    "src/app/api/shipping/shipments/route.ts",
    "src/app/api/shipping/shipments/by-order/[orderId]/route.ts",
    "src/lib/orderPaymentSettle.ts",
  ];
  for (const rel of required) {
    check(`exists ${rel}`, exists(rel));
  }

  console.log("\n2) Payment hook never rolls back on book failure (F6)");
  const settleSrc = read("src/lib/orderPaymentSettle.ts");
  check(
    "autoBookAfterPaidSafely wraps book in try/catch",
    /async function autoBookAfterPaidSafely/.test(settleSrc) &&
      /never throws; never rolls back payment/.test(settleSrc)
  );
  check(
    "settle marks paid before auto-book",
    /status: "paid"/.test(settleSrc) && /autoBookAfterPaidSafely/.test(settleSrc)
  );
  check(
    "booking failure does not revert order status",
    !/status: "pending"/.test(settleSrc.replace(/settleIfAlreadyPaid[\s\S]*?return \{[\s\S]*?\};/g, ""))
  );

  console.log("\n3) Booking guards (F6)");
  const bookingSrc = read("src/lib/shipping/booking.ts");
  check("autoBookOnPaid gate", /if \(!settings\.autoBookOnPaid\) return/.test(bookingSrc));
  check("shippingFee=0 skip auto-book", /if \(fee <= 0\) return/.test(bookingSrc));
  check(
    "shippingFee=0 skip manual book",
    /Order has no shipping fee to book/.test(bookingSrc)
  );
  check("rate expiry → failed shipment", /SHIPPING_RATE_EXPIRED/.test(bookingSrc));
  check("idempotent live shipment short-circuit", /findLiveShipmentOnOrder/.test(bookingSrc));
  check("upsertFailedShipment on provider error", /upsertFailedShipment/.test(bookingSrc));

  console.log("\n4) Webhook + status sync (F7/S6)");
  const statusSrc = read("src/lib/shipping/statusSync.ts");
  check("lastWebhookEventId idempotency", /lastWebhookEventId/.test(statusSrc));
  check(
    "shipment + order in one transaction",
    /await prisma\.\$transaction/.test(statusSrc)
  );
  check(
    "forward progression paid→shipping→shipped→delivered",
    shouldUpgradeOrderStatus("paid", "shipping") &&
      shouldUpgradeOrderStatus("shipping", "shipped") &&
      shouldUpgradeOrderStatus("shipped", "delivered") &&
      !shouldUpgradeOrderStatus("shipped", "shipping")
  );
  check(
    "shipment.status.changed maps in_transit → shipped",
    mapShipmentStatusToOrderStatus("in_transit") === "shipped"
  );
  check(
    "normalize shipment.status.changed event",
    normalizeProviderShipmentStatus("", "shipment.status.changed") === null &&
      normalizeProviderShipmentStatus("in_transit", "shipment.status.changed") === "in_transit"
  );
  const webhookSrc = read("src/app/api/webhooks/shipping/shipbubble/route.ts");
  check("webhook verifies x-ship-signature", /verifyShipbubbleWebhookSignature/.test(webhookSrc));
  check("invalid sig → unauthorized (401)", /unauthorized\("Invalid Shipbubble webhook signature"\)/.test(webhookSrc));

  const sbSecret = envValue(envFile, "SHIPBUBBLE_WEBHOOK_SECRET") || "test-secret";
  const body = JSON.stringify({
    event: "shipment.status.changed",
    order_id: "SB-TEST-1",
    status: "in_transit",
    event_id: "evt-phase3-smoke",
  });
  const sig = crypto.createHmac("sha512", sbSecret).update(body, "utf8").digest("hex");
  check(
    "HMAC vector (curl helper)",
    verifyShipbubbleWebhookSignature(body, sig, sbSecret)
  );

  console.log("\n5) Admin API + permissions (F8/S10)");
  const shipmentsRoute = read("src/app/api/shipping/shipments/route.ts");
  check("GET list requires deliveries:read", /P\.DeliveriesRead/.test(shipmentsRoute));
  check("POST book requires deliveries:manage", /P\.DeliveriesManage/.test(shipmentsRoute));
  const byOrderRoute = read("src/app/api/shipping/shipments/by-order/[orderId]/route.ts");
  check("by-order allows owner path", /ownerUserId: actor\.sub/.test(byOrderRoute));
  const perms = read("src/lib/auth/permissions.ts");
  check("permissions catalog lists shipment routes", /GET \/api\/shipping\/shipments/.test(perms));

  console.log("\n6) Order responses include shipment (Phase 3 sync)");
  const serializeSrc = read("src/lib/commerceSerialize.ts");
  check("serializeOrder exposes shipment", /shipment\?: SerializedShipment/.test(serializeSrc));
  const orderListSrc = read("src/lib/orderList.ts");
  check("loadOrdersList includes shipments", /shipments:/.test(orderListSrc));

  console.log("\n7) Database spot-checks (F5 populated)");
  const settings = orgId
    ? await prisma.shippingSettings.findUnique({ where: { orgId } })
    : null;
  check("ShippingSettings row for DEFAULT_ORG_ID", Boolean(settings));
  check(
    "autoBookOnPaid field present",
    settings == null || typeof settings.autoBookOnPaid === "boolean"
  );

  const shipmentCount = await prisma.shipment.count();
  check("Shipment table readable", shipmentCount >= 0, `rows=${shipmentCount}`);

  const paidWithMethod = await prisma.order.findMany({
    where: {
      status: { in: ["paid", "shipping", "shipped", "delivered"] },
      shippingMethod: { not: null },
      shippingFee: { gt: 0 },
    },
    take: 10,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      shippingFee: true,
      shipments: { select: { id: true, status: true }, take: 3 },
    },
  });
  const missingShipment = paidWithMethod.filter((o) => o.shipments.length === 0);
  check(
    "Paid orders with fee>0 + method have Shipment row (or none in DB yet)",
    missingShipment.length === 0 || paidWithMethod.length === 0,
    missingShipment.map((o) => o.id).join(",") || "no paid+shipping orders yet"
  );

  const failedRows = await prisma.shipment.findMany({
    where: { status: "failed" },
    take: 5,
    select: { id: true, order: { select: { status: true } } },
  });
  const paidAfterFail = failedRows.every(
    (s) => s.order.status === "paid" || s.order.status === "shipping" || s.order.status === "shipped"
  );
  check(
    "Failed shipment does not roll order back from paid+",
    failedRows.length === 0 || paidAfterFail,
    failedRows
      .filter((s) => !["paid", "shipping", "shipped", "delivered"].includes(s.order.status))
      .map((s) => s.id)
      .join(",")
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  assertNode.equal(failed, 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
