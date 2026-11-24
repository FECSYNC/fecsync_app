/**
 * POS + shop product picker for inventory / payables screens.
 */
import prisma from "@/lib/prisma";
import type { AccountingCtx } from "@/lib/accounting/types";

export async function listAccountingProducts(
  ctx: AccountingCtx,
  q: { q?: string; locationId?: string | null; limit?: number } = {}
) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const term = q.q?.trim();
  const locationFilter = q.locationId
    ? q.locationId
    : ctx.scope.allLocations
      ? undefined
      : { in: ctx.scope.locationIds };

  const [pos, shop] = await Promise.all([
    prisma.posProduct.findMany({
      where: {
        orgId: ctx.orgId,
        archivedAt: null,
        ...(locationFilter ? { locationId: locationFilter } : {}),
        ...(term
          ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { sku: { contains: term, mode: "insensitive" } }] }
          : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        locationId: true,
        onHand: true,
        avgCost: true,
        trackInventory: true,
      },
      orderBy: { name: "asc" },
      take: limit,
    }),
    prisma.product.findMany({
      where: {
        orgId: ctx.orgId,
        ...(locationFilter
          ? { OR: [{ venueLocationId: locationFilter }, { venueLocationId: null }] }
          : {}),
        ...(term ? { name: { contains: term, mode: "insensitive" } } : {}),
      },
      select: {
        id: true,
        name: true,
        venueLocationId: true,
        remainingInStock: true,
        avgCost: true,
      },
      orderBy: { name: "asc" },
      take: limit,
    }),
  ]);

  return {
    products: [
      ...pos.map((p) => ({
        ref: `pos:${p.id}`,
        kind: "pos" as const,
        id: p.id,
        name: p.name,
        sku: p.sku,
        locationId: p.locationId,
        onHand: p.onHand,
        unitCost: String(p.avgCost),
        trackInventory: p.trackInventory,
      })),
      ...shop.map((p) => ({
        ref: `shop:${p.id}`,
        kind: "shop" as const,
        id: p.id,
        name: p.name,
        sku: null,
        locationId: p.venueLocationId,
        onHand: p.remainingInStock,
        unitCost: String(p.avgCost),
        trackInventory: true,
      })),
    ],
  };
}
