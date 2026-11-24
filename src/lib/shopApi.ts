/**
 * Shop CRUD is unused leftover (not a tenant domain).
 * Harewa is a single catalog. Public `/shop` is GET /api/product listing.
 * Do not invent multi-tenant shop behavior, owner/org checks, or shop-scoped tax/checkout.
 */

import { gone } from "@/lib/response";

export const SHOP_API_GONE_MESSAGE =
  "Shop APIs are unused. FECSYNC is a single catalog, not multi-tenant. Public /shop is the product storefront.";

export function shopApiGone() {
  return gone(SHOP_API_GONE_MESSAGE);
}
