export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { shopApiGone } from "@/lib/shopApi";

/*
 * Step 4.3 — Shop collection unused by UI (no admin/storefront caller).
 * Not the tenant root — Organization is (Step 5.1).
 * Public /shop pages use GET /api/product, not this API.
 * Mutations and the open GET directory are 410 Gone (not settings:manage).
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
