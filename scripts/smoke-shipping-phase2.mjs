/**
 * Phase 2 offline verification (no live Shipbubble HTTP).
 * Usage: node scripts/smoke-shipping-phase2.mjs
 */
import assertNode from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl, readEnvFile, envValue } from "./prisma-env.mjs";

loadDatabaseUrl();
const envFile = readEnvFile();
const orgId = envValue(envFile, "DEFAULT_ORG_ID");
const hasSbKey = Boolean(envValue(envFile, "SHIPBUBBLE_API_KEY")?.trim());
const shippingEnabledFlag = envValue(envFile, "SHIPPING_ENABLED");

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

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Mirror isShippingCheckoutRequired core gates (without TS import). */
function shippingRequired(settings, env) {
  if (String(env.SHIPPING_ENABLED || "").trim().toLowerCase() === "false") {
    return false;
  }
  const enabled = settings.enabledProviders?.length
    ? settings.enabledProviders
    : [settings.primaryProvider];
  const shipbubbleOk =
    enabled.includes("shipbubble") && Boolean(env.SHIPBUBBLE_API_KEY?.trim());
  if (!shipbubbleOk) return false;
  const origin = settings.originAddress || {};
  return Boolean(String(origin.line1 || "").trim() && String(origin.phone || "").trim());
}

async function main() {
  console.log("\nPhase 2 smoke (offline)\n");

  const settings = orgId
    ? await prisma.shippingSettings.findUnique({ where: { orgId } })
    : null;
  check("ShippingSettings exists for DEFAULT_ORG_ID", Boolean(settings));
  const origin = settings?.originAddress || {};
  check(
    "Origin has line1 + phone (rates gate)",
    Boolean(String(origin.line1 || "").trim() && String(origin.phone || "").trim()),
    JSON.stringify(origin)
  );

  check(
    "SHIPPING_ENABLED=false would disable rates gate",
    shippingRequired(settings || {}, {
      SHIPPING_ENABLED: "false",
      SHIPBUBBLE_API_KEY: "sb_sandbox_x",
    }) === false
  );
  check(
    "Missing API key keeps shipping optional",
    shippingRequired(settings || {}, {
      SHIPPING_ENABLED: undefined,
      SHIPBUBBLE_API_KEY: "",
    }) === false
  );
  check(
    "API key + origin enables shipping gate",
    shippingRequired(settings || {}, {
      SHIPPING_ENABLED: undefined,
      SHIPBUBBLE_API_KEY: "sb_sandbox_x",
    }) === true
  );

  const orders = await prisma.order.findMany({
    take: 20,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      subtotal: true,
      taxAmount: true,
      shippingFee: true,
      amount: true,
    },
  });
  const mismatches = orders.filter((o) => {
    const expected = roundMoney(
      Number(o.subtotal) + Number(o.taxAmount) + Number(o.shippingFee || 0)
    );
    return expected !== roundMoney(o.amount);
  });
  check(
    "order.amount === subtotal + tax + shippingFee (spot-check)",
    mismatches.length === 0,
    mismatches.map((m) => m.id).join(",")
  );
  check(
    "Legacy / current orders have shippingFee field (default 0 ok)",
    orders.every((o) => typeof o.shippingFee === "number")
  );

  check(
    "No NEXT_PUBLIC shipping secrets in .env.local",
    !/NEXT_PUBLIC_.*(SHIP|FEZ|BUBBLE)/i.test(envFile)
  );

  if (!hasSbKey) {
    console.log(
      "  NOTE  SHIPBUBBLE_API_KEY empty — live POST /api/shipping/rates + paid-with-shipping need a sandbox key"
    );
  } else {
    check("SHIPBUBBLE_API_KEY set for live rates", true);
  }
  if (shippingEnabledFlag != null) {
    console.log(`  INFO  SHIPPING_ENABLED=${shippingEnabledFlag}`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  assertNode.equal(failed, 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
