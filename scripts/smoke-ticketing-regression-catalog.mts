/**
 * Fast catalog/isolation regression: shop + tailoring + booking payment routes.
 *   npx tsx scripts/smoke-ticketing-regression-catalog.mts
 */
import {
  lookupApiPermission,
  isUnguardedApiIsolation,
} from "../src/lib/auth/permissions.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const stripeConfirm = lookupApiPermission("GET", "/api/payment/stripe/confirm");
check(
  "shop Stripe confirm stays provider/unguarded",
  stripeConfirm?.isolation === "provider" &&
    isUnguardedApiIsolation(stripeConfirm.isolation)
);

const tailorConfirm = lookupApiPermission(
  "GET",
  "/api/payment/tailoring/confirm"
);
check(
  "tailoring confirm is provider (not provider_open / guarded)",
  tailorConfirm?.isolation === "provider" &&
    isUnguardedApiIsolation(tailorConfirm.isolation)
);

const bookingConfirm = lookupApiPermission(
  "GET",
  "/api/payment/booking/confirm"
);
check(
  "booking confirm is provider (never shop Order)",
  bookingConfirm?.isolation === "provider" &&
    isUnguardedApiIsolation(bookingConfirm.isolation)
);

const staffCard = lookupApiPermission("POST", "/api/payment/booking");
check(
  "POST /api/payment/booking is staff-gated (not public)",
  staffCard?.isolation === "staff_global" &&
    staffCard.permissions.includes("bookings:payments_take") &&
    !isUnguardedApiIsolation(staffCard.isolation)
);

const signup = lookupApiPermission("POST", "/api/auth/signup");
check(
  "POST /api/auth/signup is gone or uncatalogued (handler 410)",
  !signup || signup.isolation === "gone"
);

const shop = lookupApiPermission("GET", "/api/shop");
check("GET /api/shop stays gone", shop?.isolation === "gone");

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nCatalog isolation regression checks passed");
