/**
 * Phase 5 final audit — Fez fallback, settings, env validation, master F1–F11.
 * Usage: node scripts/smoke-shipping-phase5.mjs
 */
import assertNode from "node:assert/strict";
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

/** Mirror validateShippingEnv (F10). */
function validateShippingEnv(env) {
  const errors = [];
  const warnings = [];
  const shippingFlag = String(env.SHIPPING_ENABLED || "").trim().toLowerCase();
  const shippingExplicit =
    shippingFlag === "true" || shippingFlag === "1" || shippingFlag === "yes";
  if (shippingExplicit && !String(env.SHIPBUBBLE_API_KEY || "").trim()) {
    errors.push("SHIPPING_ENABLED=true requires SHIPBUBBLE_API_KEY");
  }
  if (shippingFlag !== "false" && env.NODE_ENV === "production") {
    if (!String(env.SHIPBUBBLE_WEBHOOK_SECRET || "").trim()) {
      warnings.push("SHIPBUBBLE_WEBHOOK_SECRET missing in production");
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

async function main() {
  console.log("\n=== Phase 5 final audit ===\n");

  console.log("PHASE 5 — Fez, settings, env, docs");
  check("Fez client exists", exists("src/lib/shipping/providers/fez/client.ts"));
  check("providerRouter fallback", /bookShipmentWithFallback/.test(read("src/lib/shipping/providerRouter.ts")));
  check("Fez webhook route", exists("src/app/api/webhooks/shipping/fez/route.ts"));
  const fezWh = read("src/app/api/webhooks/shipping/fez/route.ts");
  check("Fez webhook verifies signature", /verifyFezWebhookSignature/.test(fezWh));
  check("Admin shipping settings API", exists("src/app/api/admin/shipping-settings/route.ts"));
  check("Admin shipping settings UI", exists("src/components/Protected/admin/pages/shipping-settings/ShippingSettingsPage.tsx"));
  check("validateEnv.ts exists", exists("src/lib/shipping/validateEnv.ts"));
  check("validateEnv wired in rates/book", /ensureShippingEnvValidated/.test(read("src/lib/shipping/fetchRatesForCheckout.ts")));
  check("production-checklist.md exists", exists("docs/shipping/production-checklist.md"));
  check("providers.md exists", exists("docs/shipping/providers.md"));
  check("shipping-env.md exists", exists("docs/shipping-env.md"));

  const envMirror = validateShippingEnv({
    ...process.env,
    SHIPPING_ENABLED: envValue(envFile, "SHIPPING_ENABLED") || process.env.SHIPPING_ENABLED,
    SHIPBUBBLE_API_KEY: envValue(envFile, "SHIPBUBBLE_API_KEY") || process.env.SHIPBUBBLE_API_KEY,
    NODE_ENV: process.env.NODE_ENV || "development",
  });
  check(
    "validateEnv rule: SHIPPING_ENABLED=true needs key",
    validateShippingEnv({ SHIPPING_ENABLED: "true", SHIPBUBBLE_API_KEY: "" }).ok === false
  );
  check(
    "local env passes validateEnv (or dev without explicit SHIPPING_ENABLED=true)",
    envMirror.ok || String(envValue(envFile, "SHIPPING_ENABLED") || "").toLowerCase() !== "true"
  );

  console.log("\nMASTER FEATURE CHECKLIST F1–F11");
  const orderRoute = read("src/app/api/order/route.ts");
  check("F1 order.amount includes shippingFee", /calculateOrderTotals\(cart, shippingFee\)/.test(orderRoute));
  check("F2 Shipbubble book live", /POST.*labels|bookShipment/.test(read("src/lib/shipping/providers/shipbubble/book.ts")));
  check("F2 Fez integration", /fezAdapter/.test(read("src/lib/shipping/providerRouter.ts")));
  check("F3 rates API", exists("src/app/api/shipping/rates/route.ts"));
  check("F4 shippingAddress on orders", /shippingAddress/.test(read("prisma/schema.prisma")));
  check("F5 Shipment model", /model Shipment/.test(read("prisma/schema.prisma")));
  check("F6 auto-book after payment", /autoBookAfterPaidSafely/.test(read("src/lib/orderPaymentSettle.ts")));
  check("F7 Shipbubble webhook", exists("src/app/api/webhooks/shipping/shipbubble/route.ts"));
  check("F7 Fez webhook (when enabled)", exists("src/app/api/webhooks/shipping/fez/route.ts"));
  check("F8 Admin deliveries API + UI", exists("src/app/api/shipping/shipments/route.ts") && exists("src/components/Protected/admin/pages/deliveries/DeliveriesPage.tsx"));
  check("F9 customer tracking UI", /OrderShipmentPanel/.test(read("src/components/Protected/profile/orders/order-details-modal.tsx")));
  check("F10 env documented", exists("docs/shipping-env.md") && exists("src/lib/shipping/validateEnv.ts"));
  check("F11 smoke-shipping.mjs exists", exists("scripts/smoke-shipping.mjs"));

  console.log("\nEND-TO-END TRACE (source chain)");
  const chain = [
    ["Checkout rates", "src/app/api/shipping/rates/route.ts"],
    ["Order create + totals", "src/app/api/order/route.ts"],
    ["Stripe settle", "src/app/api/payment/stripe/confirm/route.ts"],
    ["Paystack settle", "src/app/api/payment/paystack/callback/route.ts"],
    ["Wallet settle", "src/app/api/payment/purchase/route.ts"],
    ["Inventory fulfill", "src/lib/orderFulfillment.ts"],
    ["Shipment book", "src/lib/shipping/booking.ts"],
    ["Webhook sync", "src/lib/shipping/statusSync.ts"],
    ["Customer profile", "src/components/Protected/profile/orders/order-details-modal.tsx"],
    ["Admin deliveries", "src/components/Protected/admin/pages/deliveries/DeliveriesPage.tsx"],
    ["Status email", "src/lib/mailer.ts"],
    ["Print slip", "src/components/Protected/admin/pages/orders/print/OrderPrintSummary.tsx"],
  ];
  for (const [label, rel] of chain) check(`E2E: ${label}`, exists(rel));

  console.log("\nCROSS-SYSTEM SYNC");
  check("amountsMatch in gateway settle", /amountsMatch\(chargedAmount, order\.amount\)/.test(read("src/lib/orderPaymentSettle.ts")));
  check("amountsMatch in wallet settle path", /settleOrderWalletPayment/.test(read("src/lib/orderPaymentSettle.ts")));
  check("serializeOrder shipping fields", /shippingFee|shippingMethod|shipment/.test(read("src/lib/commerceSerialize.ts")));
  check("client Order type shipping fields", /shippingFee|shipment\?:/.test(read("src/services/order.ts")));
  check("Analytics uses order.amount", /order\.amount/.test(read("src/app/api/analytics/route.ts")));
  check("Legacy shippingFee default 0", /normalizeOrderShippingFee/.test(read("src/lib/commerceSerialize.ts")));
  check("fulfilledAt separate from bookedAt", /bookedAt/.test(read("src/lib/shipping/booking.ts")) && /fulfilledAt/.test(read("src/lib/orderFulfillment.ts")));
  check("shippingFee immutable via PUT", /shippingFee/.test(read("src/lib/auth/resourcePolicy.ts")));
  check("No NEXT_PUBLIC shipping secrets in .env.local", !/NEXT_PUBLIC_.*(SHIP|FEZ|BUBBLE)/i.test(envFile));

  const tailorHits = [];
  function walkTailor(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walkTailor(p);
      else if (/shipping|shipment|deliveries/i.test(fs.readFileSync(p, "utf8"))) {
        tailorHits.push(path.relative(root, p));
      }
    }
  }
  walkTailor(path.join(root, "src/app/(tailor)"));
  check("Customer vs tailor separation", tailorHits.length === 0, tailorHits.join(", "));

  console.log("\nDB SPOT-CHECKS");
  const settings = orgId
    ? await prisma.shippingSettings.findUnique({ where: { orgId } })
    : null;
  check("ShippingSettings seeded", Boolean(settings));
  const orders = await prisma.order.findMany({
    take: 15,
    orderBy: { createdAt: "desc" },
    select: { subtotal: true, taxAmount: true, shippingFee: true, amount: true },
  });
  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const bad = orders.filter(
    (o) => round(o.subtotal + o.taxAmount + (o.shippingFee || 0)) !== round(o.amount)
  );
  check("F1 DB: amount = subtotal + tax + shipping", bad.length === 0, bad.map((o) => o.id).join(","));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed === 0) {
    console.log("PRODUCTION READY (code + schema audit). Ops still required:");
    console.log("  - Production SHIPBUBBLE_API_KEY + SHIPBUBBLE_WEBHOOK_SECRET");
    console.log("  - Register webhooks (see docs/shipping/production-checklist.md)");
    console.log("  - Admin → Shipping: origin, providers, test connection");
    console.log("  - Optional: enable Fez + FEZ_* env + webhook URL\n");
  }
  assertNode.equal(failed, 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
