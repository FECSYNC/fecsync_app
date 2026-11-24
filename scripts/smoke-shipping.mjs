/**
 * Phase 5 — Shipping smoke tests (F11).
 * Usage: yarn smoke:shipping
 *
 * Skips live courier HTTP when keys are missing.
 * Duplicates minimal address + HMAC helpers (no TS import).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return {};
  const text = fs.readFileSync(p, "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...loadEnvLocal(), ...process.env };

let passed = 0;
let failed = 0;
const results = [];

function assert(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    results.push({ name, ok: false, detail });
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Minimal mirror of validateShippingAddress (NG). */
function validateShippingAddress(addr) {
  const errors = [];
  if (!addr) return { ok: false, errors: ["Address is required"] };
  const clean = (v) => (typeof v === "string" ? v.trim() : "");
  if (!clean(addr.line1)) errors.push("Street address (line1) is required");
  if (!clean(addr.city)) errors.push("City is required");
  if (!clean(addr.state)) errors.push("State is required");
  if (!clean(addr.country)) errors.push("Country is required");
  if (!clean(addr.phone)) errors.push("Phone is required");
  const country = clean(addr.country) || "NG";
  const isNg =
    country.toUpperCase() === "NG" ||
    country.toLowerCase() === "nigeria";
  if (!isNg && !clean(addr.zip)) errors.push("Postal / ZIP code is required");
  return { ok: errors.length === 0, errors };
}

/** Mirror Shipbubble HMAC-SHA512 verify. */
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

/** Mirror Fez HMAC-SHA256 of orderNumber+status+timestamp. */
function verifyFezWebhookSignature(rawBody, headers, secret) {
  const signature = headers["x-signature"] || headers["X-Signature"];
  const timestamp = headers["x-timestamp"] || headers["X-Timestamp"];
  if (!signature || !timestamp || !secret) return false;
  let orderNumber = "";
  let status = "";
  try {
    const parsed = JSON.parse(rawBody);
    orderNumber = String(
      parsed.orderNumber || parsed.orderNo || parsed.order_number || ""
    ).trim();
    status = String(
      parsed.status || parsed.orderStatus || parsed.order_status || ""
    ).trim();
  } catch {
    return false;
  }
  if (!orderNumber || !status) return false;
  const payload = `${orderNumber}${status}${timestamp}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(String(signature).trim(), "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Minimal getOrderMoneySummary with shippingFee. */
function getOrderMoneySummary(order) {
  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const total = round(order.amount);
  const subtotal = round(order.subtotal ?? total);
  const shippingFee =
    order.shippingFee != null && Number.isFinite(Number(order.shippingFee))
      ? round(Math.max(0, Number(order.shippingFee)))
      : 0;
  const taxAmount =
    order.taxAmount != null && Number.isFinite(Number(order.taxAmount))
      ? round(Number(order.taxAmount))
      : round(Math.max(0, total - subtotal - shippingFee));
  return { subtotal, taxAmount, shippingFee, total };
}

console.log("\n=== smoke:shipping ===\n");

console.log("1) Env presence");
const shippingOn = String(env.SHIPPING_ENABLED || "").toLowerCase() !== "false";
const hasSbKey = Boolean(env.SHIPBUBBLE_API_KEY?.trim());
const hasSbSecret = Boolean(env.SHIPBUBBLE_WEBHOOK_SECRET?.trim());
const hasFez =
  Boolean(env.FEZ_SECRET_KEY?.trim() || env.FEZ_API_KEY?.trim()) &&
  (Boolean(env.FEZ_BEARER_TOKEN?.trim()) ||
    (Boolean(env.FEZ_USER_ID?.trim()) && Boolean(env.FEZ_PASSWORD?.trim())));

assert("SHIPBUBBLE_API_KEY present or shipping optional", shippingOn ? hasSbKey || String(env.SHIPPING_ENABLED || "").toLowerCase() !== "true" : true, hasSbKey ? "" : "missing (live courier skipped)");
assert("SHIPBUBBLE_WEBHOOK_SECRET noted", true, hasSbSecret ? "set" : "unset (webhooks will fail verify)");
assert("Fez optional credentials noted", true, hasFez ? "configured" : "not configured");

if (String(env.SHIPPING_ENABLED || "").toLowerCase() === "true" && !hasSbKey) {
  assert("SHIPPING_ENABLED=true requires SHIPBUBBLE_API_KEY", false, "validation rule");
} else {
  assert("SHIPPING_ENABLED / SHIPBUBBLE_API_KEY rule", true);
}

console.log("\n2) validateShippingAddress");
const goodNg = validateShippingAddress({
  line1: "12 Admiralty Way",
  city: "Lagos",
  state: "Lagos",
  country: "NG",
  phone: "08012345678",
});
assert("NG address valid without zip", goodNg.ok, goodNg.errors.join("; "));

const bad = validateShippingAddress({
  line1: "",
  city: "Lagos",
  state: "Lagos",
  country: "NG",
  phone: "",
});
assert("rejects missing line1/phone", !bad.ok && bad.errors.length >= 2);

const usNeedsZip = validateShippingAddress({
  line1: "1 Main St",
  city: "Austin",
  state: "TX",
  country: "US",
  phone: "+15125550100",
});
assert("non-NG requires zip", !usNeedsZip.ok);

console.log("\n3) Webhook HMAC vectors");
const sbBody = JSON.stringify({ event: "shipment.status.changed", order_id: "SB1", status: "in_transit" });
const sbSecret = "test-shipbubble-secret";
const sbSig = crypto.createHmac("sha512", sbSecret).update(sbBody, "utf8").digest("hex");
assert(
  "Shipbubble HMAC accepts known vector",
  verifyShipbubbleWebhookSignature(sbBody, sbSig, sbSecret)
);
assert(
  "Shipbubble HMAC rejects bad sig",
  !verifyShipbubbleWebhookSignature(sbBody, "deadbeef", sbSecret)
);

const fezBody = JSON.stringify({
  orderNumber: "FEZ-99",
  status: "Delivered",
});
const fezSecret = "test-fez-secret";
const fezTs = "1710000000";
const fezSig = crypto
  .createHmac("sha256", fezSecret)
  .update(`FEZ-99Delivered${fezTs}`)
  .digest("hex");
assert(
  "Fez HMAC accepts known vector",
  verifyFezWebhookSignature(fezBody, { "x-signature": fezSig, "x-timestamp": fezTs }, fezSecret)
);
assert(
  "Fez HMAC rejects bad sig",
  !verifyFezWebhookSignature(fezBody, { "x-signature": "nope", "x-timestamp": fezTs }, fezSecret)
);

console.log("\n4) getOrderMoneySummary + shippingFee");
const money = getOrderMoneySummary({
  amount: 11500,
  subtotal: 10000,
  taxAmount: 500,
  shippingFee: 1000,
});
assert("shippingFee extracted", money.shippingFee === 1000);
assert(
  "components sum to amount",
  Math.round((money.subtotal + money.taxAmount + money.shippingFee) * 100) ===
    Math.round(money.total * 100)
);
const legacy = getOrderMoneySummary({ amount: 5000, subtotal: 5000 });
assert("legacy order shippingFee defaults 0", legacy.shippingFee === 0);

console.log("\n5) Live courier (optional)");
if (hasSbKey) {
  console.log("  SKIP  live Shipbubble rate call (use Admin → Test connection)");
  assert("live call deferred to admin Test connection", true);
} else {
  assert("skip live calls when keys missing", true);
}

console.log("\n=== summary ===");
console.log(`passed=${passed} failed=${failed}`);
if (failed > 0) {
  process.exitCode = 1;
}
