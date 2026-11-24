/**
 * The ONLY function that changes PosProduct.onHand or Product.remainingInStock.
 * Locks the product row, applies weighted average cost, writes the movement,
 * and enqueues its posting. Works whether or not accounting is enabled
 * (quantity must always move; postings are no-ops until accounting is on).
 */
import type { AccountingSourceType, InventoryMovement, InventoryMovementKind } from "@prisma/client";
import prisma from "@/lib/prisma";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { D, ZERO, round2, type Dec } from "@/lib/accounting/money";
import { enqueueAccountingEventSafe, flushAccountingQueueSoon } from "@/lib/accounting/postingQueue";
import type { Db } from "@/lib/accounting/types";

export type ProductRef = { posProductId: string; shopProductId?: never } | { shopProductId: string; posProductId?: never };

export type RecordMovementInput = {
  orgId: string;
  productRef: ProductRef;
  kind: InventoryMovementKind;
  /** Signed quantity change (sale/wastage/adjustment_out negative). */
  qty: Dec | number;
  unitCost?: Dec | null;
  sourceType: AccountingSourceType;
  sourceId: string;
  reason?: string | null;
  actorId?: string | null;
  /** Reject when stock would go negative (adjustments); sales use `failIfInsufficient`. */
  enforceNonNegative?: boolean;
  /** Sale paths that must not oversell: throw INSUFFICIENT instead of recording. */
  failIfInsufficient?: boolean;
  /** For opening movements: set on-hand to this absolute quantity. */
  absoluteQty?: Dec | number | null;
};

export class InsufficientStockError extends Error {
  constructor(readonly productName: string) {
    super(`Not enough stock for ${productName}`);
    this.name = "InsufficientStockError";
  }
}

type LockedProduct = {
  id: string;
  name: string;
  locationId: string | null;
  onHand: Dec;
  avgCost: Dec;
  track: boolean;
};

async function lockProduct(db: Db, orgId: string, ref: ProductRef): Promise<LockedProduct> {
  if (ref.posProductId) {
    const rows = await db.$queryRaw<Array<{ id: string; name: string; locationId: string; onHand: number | null; avgCost: string; trackInventory: boolean }>>`
      SELECT "id", "name", "locationId", "onHand", "avgCost"::text AS "avgCost", "trackInventory"
      FROM "pos_products" WHERE "id" = ${ref.posProductId} AND "orgId" = ${orgId} FOR UPDATE
    `;
    const p = rows[0];
    if (!p) throw acctError(ACCT.NOT_FOUND, { fields: { productRef: "Unknown product" } });
    return { id: p.id, name: p.name, locationId: p.locationId, onHand: D(String(p.onHand ?? 0)), avgCost: D(p.avgCost), track: p.trackInventory };
  }
  const rows = await db.$queryRaw<Array<{ id: string; name: string; venueLocationId: string | null; remainingInStock: number; avgCost: string }>>`
    SELECT "id", "name", "venueLocationId", "remainingInStock", "avgCost"::text AS "avgCost"
    FROM "products" WHERE "id" = ${ref.shopProductId!} AND "orgId" = ${orgId} FOR UPDATE
  `;
  const p = rows[0];
  if (!p) throw acctError(ACCT.NOT_FOUND, { fields: { productRef: "Unknown product" } });
  return { id: p.id, name: p.name, locationId: p.venueLocationId, onHand: D(String(p.remainingInStock ?? 0)), avgCost: D(p.avgCost), track: true };
}

export async function recordInventoryMovement(
  db: Db,
  input: RecordMovementInput
): Promise<InventoryMovement | null> {
  const product = await lockProduct(db, input.orgId, input.productRef);
  const isAdjustment = input.kind === "adjustment_in" || input.kind === "adjustment_out" || input.kind === "revaluation";
  if (!product.track) {
    if (isAdjustment) throw acctError(ACCT.INVENTORY_PRODUCT_UNTRACKED);
    return null;
  }
  const existing = await db.inventoryMovement.findFirst({
    where: {
      orgId: input.orgId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      kind: input.kind,
      posProductId: input.productRef.posProductId ?? null,
      shopProductId: input.productRef.shopProductId ?? null,
    },
  });
  if (existing) return existing;

  const settings = await db.accountingSettings.findUnique({
    where: { orgId: input.orgId },
    select: { allowNegativeStock: true, enabled: true },
  });
  let qty = round3(D(input.qty));
  if (input.absoluteQty != null) qty = round3(D(input.absoluteQty).sub(product.onHand));
  const onHandAfter = product.onHand.add(qty);
  const negative = onHandAfter.lessThan(0);
  if (negative && input.failIfInsufficient) throw new InsufficientStockError(product.name);
  if (negative && (input.enforceNonNegative || (settings && !settings.allowNegativeStock && input.kind !== "sale"))) {
    throw acctError(ACCT.NEGATIVE_STOCK, { details: { product: product.name } });
  }

  let avgCostAfter = product.avgCost;
  let unitCost = product.avgCost;
  const incomingCost = input.unitCost != null ? D(input.unitCost) : null;
  if (input.kind === "opening") {
    unitCost = incomingCost ?? product.avgCost;
    avgCostAfter = unitCost;
  } else if (input.kind === "revaluation") {
    unitCost = incomingCost ?? product.avgCost;
    avgCostAfter = unitCost;
  } else if (qty.greaterThan(0) && incomingCost != null) {
    unitCost = incomingCost;
    const base = product.onHand.greaterThan(0) ? product.onHand : ZERO;
    const denom = base.add(qty);
    avgCostAfter = denom.greaterThan(0)
      ? base.mul(product.avgCost).add(qty.mul(incomingCost)).div(denom).toDecimalPlaces(4)
      : incomingCost;
  }
  const totalCost =
    input.kind === "revaluation"
      ? round2(product.onHand.mul(unitCost.sub(product.avgCost)))
      : input.kind === "opening"
        ? round2(onHandAfter.mul(unitCost))
        : round2(qty.mul(unitCost));
  const costMissing = unitCost.isZero() && input.kind !== "revaluation";

  const movement = await db.inventoryMovement.create({
    data: {
      orgId: input.orgId,
      locationId: product.locationId,
      posProductId: input.productRef.posProductId ?? null,
      shopProductId: input.productRef.shopProductId ?? null,
      kind: input.kind,
      qty,
      unitCost,
      totalCost,
      onHandAfter,
      avgCostAfter,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reason: input.reason?.slice(0, 500) ?? null,
      negativeStock: negative,
      costMissing,
      createdById: input.actorId ?? null,
    },
  });

  const newQtyInt = Math.round(onHandAfter.toNumber());
  if (input.productRef.posProductId) {
    await db.posProduct.update({
      where: { id: product.id },
      data: {
        onHand: newQtyInt,
        avgCost: avgCostAfter,
        ...(incomingCost != null && qty.greaterThan(0) ? { lastCost: incomingCost } : {}),
      },
    });
  } else {
    await db.product.update({
      where: { id: product.id },
      data: {
        remainingInStock: Math.max(0, newQtyInt),
        avgCost: avgCostAfter,
        ...(incomingCost != null && qty.greaterThan(0) ? { lastCost: incomingCost } : {}),
      },
    });
  }

  if (settings?.enabled) {
    await enqueueAccountingEventSafe(db, {
      orgId: input.orgId,
      locationId: product.locationId,
      sourceType: "inventory_movement",
      sourceId: movement.id,
      eventAt: movement.createdAt,
    });
  }
  return movement;
}

function round3(v: Dec): Dec {
  return v.toDecimalPlaces(3);
}

/** Non-transactional callers: record then flush postings. */
export async function recordInventoryMovementNow(input: RecordMovementInput) {
  const m = await prisma.$transaction((tx) => recordInventoryMovement(tx, input));
  flushAccountingQueueSoon(input.orgId);
  return m;
}

export function toMovementDto(m: InventoryMovement & { posProduct?: { name: string } | null; shopProduct?: { name: string } | null }) {
  return {
    id: m.id,
    locationId: m.locationId,
    posProductId: m.posProductId,
    shopProductId: m.shopProductId,
    productName: m.posProduct?.name ?? m.shopProduct?.name ?? null,
    kind: m.kind,
    qty: D(m.qty).toString(),
    unitCost: D(m.unitCost).toFixed(4),
    totalCost: round2(D(m.totalCost)).toFixed(2),
    onHandAfter: D(m.onHandAfter).toString(),
    avgCostAfter: D(m.avgCostAfter).toFixed(4),
    sourceType: m.sourceType,
    sourceId: m.sourceId,
    journalEntryId: m.journalEntryId,
    reason: m.reason,
    negativeStock: m.negativeStock,
    costMissing: m.costMissing,
    createdAt: m.createdAt.toISOString(),
  };
}