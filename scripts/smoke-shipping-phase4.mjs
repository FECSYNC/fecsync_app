/**
 * Phase 4 offline verification — tracking UX, admin UI, notifications, print.
 * Usage: node scripts/smoke-shipping-phase4.mjs
 */
import assertNode from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
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

function grepSrc(pattern) {
  try {
    const out = execSync(
      `rg -l "${pattern}" src --glob "!**/*.test.*"`,
      { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return out.trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

/** Mirror sendOrderStatusEmail tracking block shape. */
function buildTrackingEmailSnippet(status, trackingUrl, courierName, trackingNumber) {
  const trackingBlock = trackingUrl?.trim()
    ? `<p><a href="${trackingUrl.trim()}">Track your shipment</a></p>`
    : "";
  const courierLine = courierName?.trim()
    ? `<p style="margin: 0;"><strong>Courier:</strong> ${courierName.trim()}</p>`
    : "";
  const trackingNumberLine = trackingNumber?.trim()
    ? `<p style="margin: 0;"><strong>Tracking number:</strong> ${trackingNumber.trim()}</p>`
    : "";
  return { status, trackingBlock, courierLine, trackingNumberLine };
}

function main() {
  console.log("\nPhase 4 smoke (offline)\n");

  console.log("1) No mock deliveries in production src (F8 UI)");
  const mockHits = grepSrc("MOCK_DELIVERIES|mockDeliveries");
  check("grep MOCK_DELIVERIES / mockDeliveries in src → 0", mockHits.length === 0, mockHits.join(", "));

  console.log("\n2) UI sync — shared components (F8/F9)");
  const required = [
    "src/components/common/OrderShipmentPanel.tsx",
    "src/components/Protected/profile/orders/order-details-modal.tsx",
    "src/components/Protected/admin/pages/deliveries/DeliveriesPage.tsx",
    "src/components/Protected/admin/pages/deliveries/DeliveriesTable.tsx",
    "src/components/Protected/admin/pages/deliveries/DeliveryStats.tsx",
    "src/components/Protected/admin/pages/deliveries/DeliveryFilters.tsx",
    "src/hooks/useShipments.ts",
    "src/services/shipping.ts",
  ];
  for (const rel of required) check(`exists ${rel}`, exists(rel));

  const modal = read("src/components/Protected/profile/orders/order-details-modal.tsx");
  check("customer modal uses OrderShipmentPanel", /OrderShipmentPanel/.test(modal));
  check("customer modal shows shipping fee via getOrderMoneySummary", /getOrderMoneySummary/.test(modal));
  check("customer modal fallback getShipmentByOrderId", /getShipmentByOrderId/.test(modal));

  const panel = read("src/components/common/OrderShipmentPanel.tsx");
  check("panel shows trackingNumber", /trackingNumber/.test(panel));
  check("panel shows trackingUrl link", /trackingUrl/.test(panel));
  check("panel shows courier", /courierName/.test(panel));

  const deliveriesPage = read("src/components/Protected/admin/pages/deliveries/DeliveriesPage.tsx");
  check("deliveries page uses useShipmentsQuery", /useShipmentsQuery/.test(deliveriesPage));
  check("deliveries page not importing mock data", !/mock/i.test(deliveriesPage));

  const shippingSvc = read("src/services/shipping.ts");
  check("getShipments hits /api/shipping/shipments", /\/api\/shipping\/shipments/.test(shippingSvc));

  console.log("\n3) Notifications (S7/S8)");
  const mailer = read("src/lib/mailer.ts");
  check("sendOrderStatusEmail accepts trackingUrl", /trackingUrl\?:/.test(mailer));
  check("email includes Track your shipment link", /Track your shipment/.test(mailer));

  const statusSync = read("src/lib/shipping/statusSync.ts");
  check("webhook path calls sendOrderStatusEmail for shipped", /appliedOrderStatus === "shipped"/.test(statusSync));
  check("webhook path calls sendOrderStatusEmail for delivered", /appliedOrderStatus === "delivered"/.test(statusSync));
  check("webhook passes trackingUrl to email", /trackingUrl:/.test(statusSync));

  const orderPut = read("src/app/api/order/[id]/route.ts");
  check("manual status PUT sends sendOrderStatusEmail with trackingUrl", /sendOrderStatusEmail/.test(orderPut) && /trackingUrl/.test(orderPut));
  check("manual status PUT sends in-app notifyCustomerShipmentUpdate", /notifyCustomerShipmentUpdate/.test(orderPut));

  const webhookEmail = buildTrackingEmailSnippet(
    "shipped",
    "https://track.example.com/x",
    "DHL",
    "TRK123"
  );
  const manualEmail = buildTrackingEmailSnippet(
    "shipped",
    "https://track.example.com/x",
    "DHL",
    "TRK123"
  );
  check(
    "webhook vs manual email tracking snippet parity",
    webhookEmail.trackingBlock === manualEmail.trackingBlock &&
      webhookEmail.courierLine === manualEmail.courierLine
  );

  const notify = read("src/lib/shipping/notifyShipmentStatus.ts");
  check("in-app notify uses type order + profile href", /type: "order"/.test(notify) || /"order"/.test(notify));
  check("in-app notify includes trackingUrl metadata", /trackingUrl/.test(notify));

  console.log("\n4) Print slip (S9)");
  const printSummary = read("src/components/Protected/admin/pages/orders/print/OrderPrintSummary.tsx");
  check("print uses getOrderMoneySummary (not hardcoded 0)", /getOrderMoneySummary/.test(printSummary));
  check("print shows tracking number when available", /shipment\?\.trackingNumber/.test(printSummary));
  check("print shows tracking URL when available", /shipment\?\.trackingUrl/.test(printSummary));
  check("no literal shipping = 0 hardcode", !/shipping\s*=\s*0/.test(printSummary));

  console.log("\n5) Regression guards");
  check("loadOrdersList includes shipments for profile/admin", /shipments:/.test(read("src/lib/orderList.ts")));
  check("manual mark delivered path in admin order page", /canMarkDelivered/.test(read("src/app/(admin)/admin/orders/[orderId]/page.tsx")));
  const tailorShipping = grepSrc("shipping|shipment|deliveries").filter((f) =>
    f.replace(/\\/g, "/").includes("/tailor/")
  );
  check("/tailor/* has no shipping integration files", tailorShipping.length === 0, tailorShipping.join(", "));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  assertNode.equal(failed, 0);
}

main();
