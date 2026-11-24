export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { shopApiGone } from "@/lib/shopApi";

/*
 * Step 4.3 — Shop-by-id unused by UI. Not multi-tenant.
 * Do not apply body.owner or invent tenant/owner checks.
 * Public /shop/[slug] is product detail (GET /api/product/[id]), unrelated.
 */

export async function GET() {
  return shopApiGone();
}

export async function POST() {
  return shopApiGone();
}

export async function PUT() {
  return shopApiGone();
}

export async function PATCH() {
  return shopApiGone();
}

export async function DELETE() {
  return shopApiGone();
}
