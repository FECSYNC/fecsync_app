export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { gone } from "@/lib/response";

/**
 * Unused leftover surface (Step 4.1 / Phase deep audit).
 * Product staff CRUD lives on /api/product and /api/product/[id] only.
 */
export async function GET() {
  return gone("Use /api/product?scope=staff — /api/product/shop/[id] is retired");
}

export async function PUT() {
  return gone("Use /api/product/[id] — /api/product/shop/[id] is retired");
}

export async function DELETE() {
  return gone("Use /api/product/[id] — /api/product/shop/[id] is retired");
}
