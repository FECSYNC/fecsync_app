/**
 * Stock periods for add-ons / capped availability.
 */
import type { Prisma, StockPeriodKind } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertTicketingStaffMutate,
  assertTicketingStaffRead,
  assertLocationInHqScope,
  assertVenueActiveForTicketingMutate,
  locationScopeFilter,
  applyTicketingLocationScope,
  rejectClientOrgFields,
  requireActorVenue,
  LOCATION_REQUIRED,
  type TicketingActor,
} from "@/lib/ticketing/common";

const KINDS = new Set(["available", "blocked"]);

export type CreateStockPeriodInput = {
  locationId: string;
  startsAt: string;
  endsAt: string;
  kind: StockPeriodKind;
  quantity?: number | null;
  productIds?: string[];
};

export type UpdateStockPeriodInput = {
  startsAt?: string;
  endsAt?: string;
  kind?: StockPeriodKind;
  quantity?: number | null;
  /** When provided, replaces product attachments (empty = venue-wide / no SKUs). */
  productIds?: string[];
};

type StockPeriodRow = {
  id: string;
  orgId: string;
  locationId: string;
  startsAt: Date;
  endsAt: Date;
  kind: StockPeriodKind;
  quantity: number | null;
};

type Db = Prisma.TransactionClient | typeof prisma;

const stockPeriodProductInclude = {
  products: {
    include: { product: { select: { id: true, name: true } } },
  },
} as const;

export function toStockPeriodDto(row: {
  id: string;
  orgId: string;
  locationId: string;
  startsAt: Date;
  endsAt: Date;
  kind: StockPeriodKind;
  quantity: number | null;
  createdAt: Date;
  updatedAt: Date;
  products?: Array<{ productId: string; product?: { id: string; name: string } }>;
}) {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    kind: row.kind,
    quantity: row.quantity,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    productIds: (row.products ?? []).map((p) => p.productId),
    products: (row.products ?? []).map((p) => p.product).filter(Boolean),
  };
}

export async function listStockPeriods(
  actor: TicketingActor,
  filters: { locationId?: string; productId?: string } = {}
) {
  await assertTicketingStaffRead(actor);
  const scope = await locationScopeFilter(actor);
  const where: Prisma.StockPeriodWhereInput = { orgId: scope.orgId };
  applyTicketingLocationScope(scope, where);
  if (
    !scope.parkLocked &&
    !scope.locationId &&
    filters.locationId !== undefined &&
    filters.locationId !== ""
  ) {
    if (!isValidId(filters.locationId)) {
      throw new Error("Invalid locationId");
    }
    where.locationId = filters.locationId;
  }
  if (filters.productId !== undefined && filters.productId !== "") {
    if (!isValidId(filters.productId)) {
      throw new Error("Invalid productId");
    }
    where.products = { some: { productId: filters.productId } };
  }

  const rows = await prisma.stockPeriod.findMany({
    where,
    include: stockPeriodProductInclude,
    orderBy: { startsAt: "asc" },
    take: 300,
  });
  return rows.map(toStockPeriodDto);
}

async function requireStockPeriodInScope(
  actor: TicketingActor,
  orgId: string,
  stockPeriodId: string
) {
  const scope = await locationScopeFilter(actor);
  const where: Prisma.StockPeriodWhereInput = {
    id: requireId(stockPeriodId, "stockPeriodId"),
    orgId,
  };
  applyTicketingLocationScope(scope, where);
  const row = await prisma.stockPeriod.findFirst({
    where,
    include: stockPeriodProductInclude,
  });
  if (!row) throw new ForbiddenError("Stock period not found");
  await assertLocationInHqScope(actor, row.locationId);
  return row;
}

async function assertProductIdsForVenue(
  orgId: string,
  locationId: string,
  productIds: string[]
) {
  const ids = [...new Set(productIds)];
  for (const id of ids) {
    if (typeof id !== "string" || !isValidId(id)) {
      throw new Error("Invalid productId in productIds");
    }
  }
  if (!ids.length) return ids;
  const count = await prisma.admissionProduct.count({
    where: {
      id: { in: ids },
      orgId,
      locationId,
      archivedAt: null,
    },
  });
  if (count !== ids.length) {
    throw new ForbiddenError("One or more products are invalid for this venue");
  }
  return ids;
}

export async function createStockPeriod(
  actor: TicketingActor,
  input: CreateStockPeriodInput
) {
  const orgId = await assertTicketingStaffMutate(actor);
  if (!input.locationId || !isValidId(input.locationId)) {
    throw new Error(LOCATION_REQUIRED);
  }
  const venue = await requireActorVenue(orgId, input.locationId);
  await assertLocationInHqScope(actor, venue.id);
  if (!KINDS.has(input.kind)) throw new Error("Invalid stock period kind");

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new Error("Invalid stock period dates");
  }
  if (endsAt <= startsAt) throw new Error("endsAt must be after startsAt");

  let quantity: number | null = null;
  if (input.quantity != null && input.quantity !== undefined) {
    const n = Number(input.quantity);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error("quantity must be a non-negative integer or null");
    }
    quantity = n;
  }

  const productIds = await assertProductIdsForVenue(
    orgId,
    venue.id,
    input.productIds ?? []
  );

  const row = await prisma.stockPeriod.create({
    data: {
      orgId,
      locationId: venue.id,
      startsAt,
      endsAt,
      kind: input.kind,
      quantity,
      products: productIds.length
        ? {
            create: productIds.map((productId) => ({ productId })),
          }
        : undefined,
    },
    include: stockPeriodProductInclude,
  });
  return toStockPeriodDto(row);
}

export async function updateStockPeriod(
  actor: TicketingActor,
  stockPeriodId: string,
  input: UpdateStockPeriodInput
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const existing = await requireStockPeriodInScope(actor, orgId, stockPeriodId);
  await assertVenueActiveForTicketingMutate(orgId, existing.locationId);

  const startsAt =
    input.startsAt !== undefined
      ? new Date(input.startsAt)
      : existing.startsAt;
  const endsAt =
    input.endsAt !== undefined ? new Date(input.endsAt) : existing.endsAt;
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new Error("Invalid stock period dates");
  }
  if (endsAt <= startsAt) throw new Error("endsAt must be after startsAt");

  let kind = existing.kind;
  if (input.kind !== undefined) {
    if (!KINDS.has(input.kind)) throw new Error("Invalid stock period kind");
    kind = input.kind;
  }

  let quantity = existing.quantity;
  if (input.quantity !== undefined) {
    if (input.quantity == null) {
      quantity = null;
    } else {
      const n = Number(input.quantity);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error("quantity must be a non-negative integer or null");
      }
      quantity = n;
    }
  }

  const replaceProducts = input.productIds !== undefined;
  const productIds = replaceProducts
    ? await assertProductIdsForVenue(
        orgId,
        existing.locationId,
        input.productIds ?? []
      )
    : null;

  const row = await prisma.$transaction(async (tx) => {
    if (replaceProducts) {
      await tx.stockPeriodProduct.deleteMany({
        where: { stockPeriodId: existing.id },
      });
      if (productIds!.length) {
        await tx.stockPeriodProduct.createMany({
          data: productIds!.map((productId) => ({
            stockPeriodId: existing.id,
            productId,
          })),
        });
      }
    }
    return tx.stockPeriod.update({
      where: { id: existing.id },
      data: { startsAt, endsAt, kind, quantity },
      include: stockPeriodProductInclude,
    });
  });
  return toStockPeriodDto(row);
}

export async function deleteStockPeriod(
  actor: TicketingActor,
  stockPeriodId: string
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const existing = await requireStockPeriodInScope(actor, orgId, stockPeriodId);
  await assertVenueActiveForTicketingMutate(orgId, existing.locationId);
  await prisma.stockPeriod.delete({ where: { id: existing.id } });
  return { id: existing.id };
}

export function parseUpdateStockPeriodBody(body: unknown): UpdateStockPeriodInput {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  const out: UpdateStockPeriodInput = {};
  if (b.startsAt !== undefined) out.startsAt = String(b.startsAt ?? "");
  if (b.endsAt !== undefined) out.endsAt = String(b.endsAt ?? "");
  if (b.kind !== undefined) {
    out.kind = String(b.kind ?? "") as StockPeriodKind;
  }
  if (b.quantity !== undefined) {
    out.quantity =
      b.quantity == null || b.quantity === "" ? null : Number(b.quantity);
  }
  if (b.productIds !== undefined) {
    if (!Array.isArray(b.productIds)) {
      throw new Error("productIds must be an array");
    }
    out.productIds = b.productIds.map((id) => String(id));
  } else if (b.productId !== undefined) {
    out.productIds =
      b.productId == null || b.productId === ""
        ? []
        : [String(b.productId)];
  }
  return out;
}

export function parseCreateStockPeriodBody(
  body: unknown
): CreateStockPeriodInput {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  return {
    locationId: String(b.locationId ?? ""),
    startsAt: String(b.startsAt ?? ""),
    endsAt: String(b.endsAt ?? ""),
    kind: (String(b.kind ?? "available") as StockPeriodKind),
    quantity:
      b.quantity == null || b.quantity === ""
        ? null
        : Number(b.quantity),
    productIds: Array.isArray(b.productIds)
      ? (b.productIds as string[])
      : b.productId
        ? [String(b.productId)]
        : [],
  };
}

/**
 * Atomic remaining decrement for capped available stock periods (schema: quantity = remaining).
 */
export async function tryConsumeStockPeriodQuantity(
  stockPeriodId: string,
  qty: number,
  db: Db = prisma
): Promise<boolean> {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error("qty must be a positive integer");
  }
  const result = await db.$executeRaw`
    UPDATE stock_periods
    SET quantity = quantity - ${qty}, "updatedAt" = NOW()
    WHERE id = ${stockPeriodId}
      AND kind = 'available'
      AND quantity IS NOT NULL
      AND quantity >= ${qty}
  `;
  return result === 1;
}

export async function restoreStockPeriodQuantity(
  stockPeriodId: string,
  qty: number,
  db: Db = prisma
): Promise<void> {
  if (!Number.isInteger(qty) || qty < 1) return;
  await db.$executeRaw`
    UPDATE stock_periods
    SET quantity = quantity + ${qty}, "updatedAt" = NOW()
    WHERE id = ${stockPeriodId}
      AND kind = 'available'
      AND quantity IS NOT NULL
  `;
}

/**
 * Resolve stock periods that apply to an add-on SKU at a venue.
 * SSOT: StockPeriodProduct joins (admin UI). Also includes periods pointed at by
 * AdmissionAddOnLink.stockPeriodId for backwards compatibility.
 */
export async function stockPeriodsForAddOnProduct(
  opts: {
    orgId: string;
    locationId: string;
    productId: string;
  },
  db: Db = prisma
): Promise<StockPeriodRow[]> {
  const [viaProducts, viaLinks] = await Promise.all([
    db.stockPeriod.findMany({
      where: {
        orgId: opts.orgId,
        locationId: opts.locationId,
        products: { some: { productId: opts.productId } },
      },
      take: 100,
    }),
    db.admissionAddOnLink.findMany({
      where: {
        orgId: opts.orgId,
        addOnProductId: opts.productId,
        stockPeriodId: { not: null },
      },
      include: { stockPeriod: true },
      take: 50,
    }),
  ]);

  const byId = new Map<string, StockPeriodRow>();
  for (const sp of viaProducts) {
    byId.set(sp.id, sp);
  }
  for (const link of viaLinks) {
    const sp = link.stockPeriod;
    if (!sp || sp.locationId !== opts.locationId) continue;
    byId.set(sp.id, sp);
  }
  return [...byId.values()];
}

function inStockWindow(sp: StockPeriodRow, at: Date) {
  const t = at.getTime();
  return t >= sp.startsAt.getTime() && t <= sp.endsAt.getTime();
}

/** Gate add-on sales against stock periods (blocked / available / remaining). */
export async function assertAddOnStockAvailable(
  opts: {
    orgId: string;
    locationId: string;
    productId: string;
    qty: number;
    at: Date;
  },
  db: Db = prisma
): Promise<void> {
  const periods = await stockPeriodsForAddOnProduct(
    {
      orgId: opts.orgId,
      locationId: opts.locationId,
      productId: opts.productId,
    },
    db
  );
  if (!periods.length) return;

  const inWindow = periods.filter((sp) => inStockWindow(sp, opts.at));
  if (inWindow.some((sp) => sp.kind === "blocked")) {
    throw new Error("Add-on is blocked for this date (stock period)");
  }

  const available = periods.filter((sp) => sp.kind === "available");
  if (!available.length) return;

  const availableInWindow = available.filter((sp) => inStockWindow(sp, opts.at));
  if (!availableInWindow.length) {
    throw new Error("Add-on is outside its available stock period");
  }
  for (const sp of availableInWindow) {
    if (sp.quantity != null && opts.qty > sp.quantity) {
      throw new Error("Add-on quantity exceeds stock period remaining");
    }
  }
}

/** Available-in-window capped periods linked to an add-on at a venue. */
export async function cappedStockPeriodsForAddOn(
  opts: {
    orgId: string;
    locationId: string;
    productId: string;
    at: Date;
  },
  db: Db = prisma
): Promise<Array<{ id: string; quantity: number }>> {
  const periods = await stockPeriodsForAddOnProduct(
    {
      orgId: opts.orgId,
      locationId: opts.locationId,
      productId: opts.productId,
    },
    db
  );
  const out: Array<{ id: string; quantity: number }> = [];
  const seen = new Set<string>();
  for (const sp of periods) {
    if (sp.kind !== "available" || sp.quantity == null) continue;
    if (!inStockWindow(sp, opts.at)) continue;
    if (seen.has(sp.id)) continue;
    seen.add(sp.id);
    out.push({ id: sp.id, quantity: sp.quantity });
  }
  return out;
}

type StockLine = {
  productId: string | null;
  productType: string;
  qty: number;
  visitDate: Date | null;
  sessionId: string | null;
};

type StockClaimPiece = { stockPeriodId: string; qty: number };

const ADDON_STOCK_HELD = "addon_stock_held";
const ADDON_STOCK_RELEASED = "addon_stock_released";

function piecesFromPayload(
  payload: unknown
): StockClaimPiece[] | null {
  if (!payload || typeof payload !== "object") return null;
  const pieces = (payload as { pieces?: unknown }).pieces;
  if (!Array.isArray(pieces)) return null;
  const out: StockClaimPiece[] = [];
  for (const p of pieces) {
    if (!p || typeof p !== "object") continue;
    const id = String((p as { stockPeriodId?: unknown }).stockPeriodId ?? "");
    const qty = Number((p as { qty?: unknown }).qty);
    if (!id || !Number.isInteger(qty) || qty < 1) continue;
    out.push({ stockPeriodId: id, qty });
  }
  return out;
}

async function openHeldClaim(
  bookingId: string,
  db: Db
): Promise<{ pieces: StockClaimPiece[] } | null> {
  const latest = await db.bookingActivity.findFirst({
    where: {
      bookingId,
      kind: "system",
      OR: [
        { payload: { path: ["event"], equals: ADDON_STOCK_HELD } },
        { payload: { path: ["event"], equals: ADDON_STOCK_RELEASED } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  if (!latest?.payload || typeof latest.payload !== "object") return null;
  const ev = (latest.payload as { event?: unknown }).event;
  if (ev !== ADDON_STOCK_HELD) return null;
  return { pieces: piecesFromPayload(latest.payload) ?? [] };
}

/**
 * True when this booking currently holds decremented add-on stock.
 * Legacy bookings (never claimed) return false — cancel must not inflate quantity.
 */
export async function bookingHoldsAddOnStock(
  bookingId: string,
  db: Db = prisma
): Promise<boolean> {
  return (await openHeldClaim(bookingId, db)) != null;
}

/**
 * Consume remaining stock for add-on booking lines (call when capacity is held).
 * Idempotent when an open claim already exists for the booking.
 * Persists period id+qty on the claim so restore survives link/catalog edits.
 */
export async function consumeAddOnStockForLines(
  opts: {
    bookingId: string;
    orgId: string;
    locationId: string;
    lines: StockLine[];
  },
  db: Db = prisma
): Promise<void> {
  if (await bookingHoldsAddOnStock(opts.bookingId, db)) {
    return;
  }
  const pieces: StockClaimPiece[] = [];
  for (const line of opts.lines) {
    if (line.productType !== "add_on" || !line.productId) continue;
    const at =
      line.visitDate ??
      (line.sessionId
        ? (
            await db.ticketSession.findFirst({
              where: { id: line.sessionId },
              select: { startsAt: true },
            })
          )?.startsAt ?? new Date()
        : new Date());
    const periods = await cappedStockPeriodsForAddOn(
      {
        orgId: opts.orgId,
        locationId: opts.locationId,
        productId: line.productId,
        at,
      },
      db
    );
    for (const sp of periods) {
      const ok = await tryConsumeStockPeriodQuantity(sp.id, line.qty, db);
      if (!ok) {
        throw new Error("Add-on quantity exceeds stock period remaining");
      }
      pieces.push({ stockPeriodId: sp.id, qty: line.qty });
    }
  }
  if (pieces.length) {
    await db.bookingActivity.create({
      data: {
        orgId: opts.orgId,
        locationId: opts.locationId,
        bookingId: opts.bookingId,
        kind: "system",
        payload: { event: ADDON_STOCK_HELD, pieces },
      },
    });
  }
}

/**
 * Restore remaining stock only when this booking previously claimed it.
 * Prefers claim payload pieces (stable); falls back to current line links.
 */
export async function restoreAddOnStockForLines(
  opts: {
    bookingId: string;
    orgId: string;
    locationId: string;
    lines: StockLine[];
  },
  db: Db = prisma
): Promise<void> {
  const open = await openHeldClaim(opts.bookingId, db);
  if (!open) return;

  if (open.pieces.length > 0) {
    for (const p of open.pieces) {
      await restoreStockPeriodQuantity(p.stockPeriodId, p.qty, db);
    }
  } else {
    // Legacy claims without pieces — best-effort via current links.
    for (const line of opts.lines) {
      if (line.productType !== "add_on" || !line.productId) continue;
      const at =
        line.visitDate ??
        (line.sessionId
          ? (
              await db.ticketSession.findFirst({
                where: { id: line.sessionId },
                select: { startsAt: true },
              })
            )?.startsAt ?? new Date()
          : new Date());
      const periods = await cappedStockPeriodsForAddOn(
        {
          orgId: opts.orgId,
          locationId: opts.locationId,
          productId: line.productId,
          at,
        },
        db
      );
      for (const sp of periods) {
        await restoreStockPeriodQuantity(sp.id, line.qty, db);
      }
    }
  }
  await db.bookingActivity.create({
    data: {
      orgId: opts.orgId,
      locationId: opts.locationId,
      bookingId: opts.bookingId,
      kind: "system",
      payload: { event: ADDON_STOCK_RELEASED },
    },
  });
}
