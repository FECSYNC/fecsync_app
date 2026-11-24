/**
 * Inventory valuation, adjustments, cost updates, movement history.
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, round2, toApiString } from "@/lib/accounting/money";
import { assertLocationWritable, locationWhere, narrowScope } from "@/lib/accounting/scope";
import { balancesByAccount } from "@/lib/accounting/ledgerQueries";
import {
  recordInventoryMovement,
  toMovementDto,
  type ProductRef,
} from "@/lib/accounting/inventory/movements";
import { flushAccountingQueueSoon } from "@/lib/accounting/postingQueue";
import type { AccountingCtx } from "@/lib/accounting/types";

export const productRefSchema = z.union([
  z.object({ posProductId: z.string().min(1) }).strict(),
  z.object({ shopProductId: z.string().min(1) }).strict(),
]);

export async function inventoryValuation(
  ctx: AccountingCtx,
  q: { asOf?: Date; locationId?: string | null }
) {
  const scope = narrowScope(ctx.scope, q.locationId ?? null);
  const asOf = q.asOf ?? new Date();
  const movements = await prisma.inventoryMovement.groupBy({
    by: ["posProductId", "shopProductId", "locationId"],
    where: { orgId: ctx.orgId, createdAt: { lte: asOf }, ...locationWhere(scope) },
    _sum: { qty: true, totalCost: true },
    _max: { createdAt: true },
  });
  const posIds = movements.map((m) => m.posProductId).filter((x): x is string => Boolean(x));
  const shopIds = movements.map((m) => m.shopProductId).filter((x): x is string => Boolean(x));
  const [posProducts, shopProducts, flags] = await Promise.all([
    posIds.length
      ? prisma.posProduct.findMany({
          where: { id: { in: posIds } },
          select: { id: true, name: true, kind: true, onHand: true, avgCost: true, sku: true, reorderLevel: true },
        })
      : [],
    shopIds.length
      ? prisma.product.findMany({
          where: { id: { in: shopIds } },
          select: { id: true, name: true, remainingInStock: true, avgCost: true },
        })
      : [],
    prisma.inventoryMovement.groupBy({
      by: ["posProductId", "shopProductId"],
      where: { orgId: ctx.orgId, OR: [{ negativeStock: true }, { costMissing: true }], ...locationWhere(scope) },
      _count: { _all: true },
    }),
  ]);
  const posById = new Map(posProducts.map((p) => [p.id, p]));
  const shopById = new Map(shopProducts.map((p) => [p.id, p]));
  const flagged = new Set(flags.map((f) => f.posProductId ?? f.shopProductId ?? ""));
  let totalValue = ZERO;
  const rows = movements.map((m) => {
    const qty = D(m._sum.qty ?? 0);
    const pos = m.posProductId ? posById.get(m.posProductId) : undefined;
    const shop = m.shopProductId ? shopById.get(m.shopProductId) : undefined;
    const avg = D(pos?.avgCost ?? shop?.avgCost ?? 0);
    const value = round2(D(m._sum.totalCost ?? 0));
    totalValue = totalValue.add(value);
    return {
      productRef: m.posProductId ? { posProductId: m.posProductId } : { shopProductId: m.shopProductId! },
      name: pos?.name ?? shop?.name ?? "Unknown",
      sku: pos?.sku ?? null,
      kind: pos?.kind ?? "shop",
      locationId: m.locationId,
      qty: qty.toString(),
      onHandNow: String(pos?.onHand ?? shop?.remainingInStock ?? 0),
      avgCost: avg.toFixed(4),
      value: toApiString(value),
      reorderLevel: pos?.reorderLevel ?? null,
      flagged: flagged.has(m.posProductId ?? m.shopProductId ?? ""),
      lastMovementAt: m._max.createdAt?.toISOString() ?? null,
    };
  });
  const inventoryAccounts = await prisma.ledgerAccount.findMany({
    where: { orgId: ctx.orgId, subtype: "inventory", isHeader: false },
    select: { id: true },
  });
  const ledger = await balancesByAccount(ctx, {
    to: asOf,
    accountIds: inventoryAccounts.map((a) => a.id),
    scope,
  });
  let ledgerValue = ZERO;
  for (const v of ledger.values()) ledgerValue = ledgerValue.add(v.debit).sub(v.credit);
  return {
    asOf: asOf.toISOString(),
    rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
    totalValue: toApiString(totalValue),
    ledgerValue: toApiString(ledgerValue),
    difference: toApiString(ledgerValue.sub(totalValue)),
  };
}

export async function cogsForPeriod(ctx: AccountingCtx, from: Date, to: Date, locationId?: string | null) {
  const scope = narrowScope(ctx.scope, locationId ?? null);
  const agg = await prisma.inventoryMovement.aggregate({
    where: { orgId: ctx.orgId, kind: { in: ["sale", "sale_return"] }, createdAt: { gte: from, lte: to }, ...locationWhere(scope) },
    _sum: { totalCost: true },
  });
  return round2(D(agg._sum.totalCost ?? 0).neg());
}

export async function listMovements(
  ctx: AccountingCtx,
  q: { productRef?: ProductRef | null; kind?: string; locationId?: string | null; from?: Date; to?: Date; cursor?: string; limit?: number }
) {
  const scope = narrowScope(ctx.scope, q.locationId ?? null);
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const where: Prisma.InventoryMovementWhereInput = { orgId: ctx.orgId, ...locationWhere(scope) };
  if (q.productRef?.posProductId) where.posProductId = q.productRef.posProductId;
  if (q.productRef?.shopProductId) where.shopProductId = q.productRef.shopProductId;
  if (q.kind) where.kind = q.kind as never;
  if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
  const rows = await prisma.inventoryMovement.findMany({
    where,
    include: { posProduct: { select: { name: true } }, shopProduct: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(q.cursor && isValidId(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return { items: page.map(toMovementDto), nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

export const adjustmentSchema = z
  .object({
    locationId: z.string().min(1),
    productRef: productRefSchema,
    qtyDelta: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    unitCost: z.union([z.string(), z.number()]).optional().transform((v) => (v == null || v === "" ? null : D(String(v)))),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

async function assertProductInOrg(ctx: AccountingCtx, ref: ProductRef, locationId: string | null) {
  if (ref.posProductId) {
    if (!isValidId(ref.posProductId)) throw acctError(ACCT.NOT_FOUND);
    const p = await prisma.posProduct.findFirst({ where: { id: ref.posProductId, orgId: ctx.orgId } });
    if (!p) throw acctError(ACCT.NOT_FOUND);
    if (locationId && p.locationId !== locationId) throw acctError(ACCT.LOCATION_OUT_OF_SCOPE);
    return;
  }
  if (!isValidId(ref.shopProductId!)) throw acctError(ACCT.NOT_FOUND);
  const p = await prisma.product.findFirst({ where: { id: ref.shopProductId!, orgId: ctx.orgId } });
  if (!p) throw acctError(ACCT.NOT_FOUND);
}

export async function createAdjustment(ctx: AccountingCtx, raw: unknown) {
  const input = adjustmentSchema.parse(raw);
  if (input.qtyDelta.isZero()) throw acctError(ACCT.VALIDATION, { fields: { qtyDelta: "Must not be zero" } });
  if (input.unitCost && input.unitCost.lessThan(0)) throw acctError(ACCT.VALIDATION, { fields: { unitCost: "Must be ≥ 0" } });
  const locationId = await assertLocationWritable(ctx, input.locationId);
  await assertProductInOrg(ctx, input.productRef as ProductRef, locationId);
  const movement = await prisma.$transaction((tx) =>
    recordInventoryMovement(tx, {
      orgId: ctx.orgId,
      productRef: input.productRef as ProductRef,
      kind: input.qtyDelta.greaterThan(0) ? "adjustment_in" : "adjustment_out",
      qty: input.qtyDelta,
      unitCost: input.qtyDelta.greaterThan(0) ? input.unitCost : null,
      sourceType: "inventory_movement",
      sourceId: `adj:${Date.now()}:${ctx.actorId ?? "system"}`,
      reason: input.reason,
      actorId: ctx.actorId,
      enforceNonNegative: true,
    })
  );
  flushAccountingQueueSoon(ctx.orgId);
  recordAccountingAudit(ctx, {
    action: "inventory.adjust",
    entityType: "InventoryMovement",
    entityId: movement?.id ?? null,
    description: `Stock adjusted by ${input.qtyDelta.toString()}`,
    reason: input.reason,
  });
  return movement ? toMovementDto(movement) : null;
}

export const costUpdateSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productRef: productRefSchema,
            unitCost: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
            reason: z.string().trim().min(3).max(500),
          })
          .strict()
      )
      .min(1)
      .max(200),
  })
  .strict();

/** Set cost: revaluation movement when stock is on hand, else just the cost. */
export async function setCosts(ctx: AccountingCtx, raw: unknown) {
  const { items } = costUpdateSchema.parse(raw);
  const out: Array<ReturnType<typeof toMovementDto> | { productRef: ProductRef; avgCost: string }> = [];
  for (const item of items) {
    if (item.unitCost.lessThan(0)) throw acctError(ACCT.VALIDATION, { fields: { unitCost: "Must be ≥ 0" } });
    const ref = item.productRef as ProductRef;
    await assertProductInOrg(ctx, ref, null);
    const result = await prisma.$transaction(async (tx) => {
      const onHand = ref.posProductId
        ? (await tx.posProduct.findFirstOrThrow({ where: { id: ref.posProductId }, select: { onHand: true, trackInventory: true, locationId: true } }))
        : null;
      if (ref.posProductId && !onHand?.trackInventory) throw acctError(ACCT.INVENTORY_PRODUCT_UNTRACKED);
      const qty = ref.posProductId
        ? D(onHand?.onHand ?? 0)
        : D((await tx.product.findFirstOrThrow({ where: { id: ref.shopProductId! }, select: { remainingInStock: true } })).remainingInStock);
      if (!qty.isZero()) {
        return recordInventoryMovement(tx, {
          orgId: ctx.orgId,
          productRef: ref,
          kind: "revaluation",
          qty: 0,
          unitCost: item.unitCost,
          sourceType: "inventory_movement",
          sourceId: `reval:${Date.now()}:${ref.posProductId ?? ref.shopProductId}`,
          reason: item.reason,
          actorId: ctx.actorId,
        });
      }
      if (ref.posProductId) {
        await tx.posProduct.update({ where: { id: ref.posProductId }, data: { avgCost: item.unitCost, lastCost: item.unitCost } });
      } else {
        await tx.product.update({ where: { id: ref.shopProductId! }, data: { avgCost: item.unitCost, lastCost: item.unitCost } });
      }
      return null;
    });
    out.push(result ? toMovementDto(result) : { productRef: ref, avgCost: item.unitCost.toFixed(4) });
    recordAccountingAudit(ctx, {
      action: "inventory.cost",
      entityType: "InventoryMovement",
      entityId: result?.id ?? null,
      description: `Unit cost set to ${item.unitCost.toFixed(4)}`,
      reason: item.reason,
    });
  }
  flushAccountingQueueSoon(ctx.orgId);
  return out;
}