import prisma from "@/lib/prisma";
import type { PosProductKind, Prisma } from "@prisma/client";
import { ForbiddenError } from "@/lib/auth/http-error";
import { PosError } from "@/lib/pos/errors";
import { money, num } from "@/lib/pos/money";
import { posListLocationWhere, requirePosVenue, type PosActor } from "@/lib/pos/scope";
import { recordInventoryMovementNow } from "@/lib/accounting/inventory/movements";

const KINDS = new Set<string>([
  "admission_proxy",
  "food",
  "beverage",
  "merchandise",
  "open_price",
  "package",
  "party_package_proxy",
  "add_on",
  "gift_card",
  "membership_plan",
  "cashless_card",
  "park_wallet",
  "gratuity",
  "other",
]);

function productDto(row: {
  id: string;
  orgId: string;
  locationId: string;
  kind: PosProductKind;
  name: string;
  description: string | null;
  sku: string | null;
  price: Prisma.Decimal;
  openPrice: boolean;
  taxExemptDefault: boolean;
  trackInventory: boolean;
  onHand: number | null;
  suspendSales: boolean;
  archivedAt: Date | null;
  kitchenRoute: string | null;
  membershipPlanId: string | null;
  admissionProductId: string | null;
  giftCardDefaultAmount: Prisma.Decimal | null;
  allowCustomAmount: boolean;
  avgCost?: Prisma.Decimal;
  lastCost?: Prisma.Decimal | null;
  inventoryAccountId?: string | null;
  cogsAccountId?: string | null;
  revenueAccountId?: string | null;
  modifierGroups?: Array<{
    id: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    modifiers: Array<{ id: string; name: string; priceDelta: Prisma.Decimal }>;
  }>;
}) {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    kind: row.kind,
    name: row.name,
    description: row.description,
    sku: row.sku,
    price: num(row.price),
    openPrice: row.openPrice,
    taxExemptDefault: row.taxExemptDefault,
    trackInventory: row.trackInventory,
    onHand: row.onHand,
    suspendSales: row.suspendSales,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    kitchenRoute: row.kitchenRoute,
    membershipPlanId: row.membershipPlanId,
    admissionProductId: row.admissionProductId,
    giftCardDefaultAmount:
      row.giftCardDefaultAmount == null ? null : num(row.giftCardDefaultAmount),
    allowCustomAmount: row.allowCustomAmount,
    avgCost: row.avgCost == null ? undefined : num(row.avgCost),
    lastCost: row.lastCost == null ? null : num(row.lastCost),
    inventoryAccountId: row.inventoryAccountId ?? null,
    cogsAccountId: row.cogsAccountId ?? null,
    revenueAccountId: row.revenueAccountId ?? null,
    modifierGroups: (row.modifierGroups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      required: g.required,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      modifiers: g.modifiers.map((m) => ({
        id: m.id,
        name: m.name,
        priceDelta: num(m.priceDelta),
      })),
    })),
  };
}

const includeGroups = {
  modifierGroups: { include: { modifiers: true } },
} satisfies Prisma.PosProductInclude;

export async function listPosProducts(actor: PosActor, locationId?: string | null) {
  const where = await posListLocationWhere(actor);
  const rows = await prisma.posProduct.findMany({
    where: {
      ...where,
      ...(locationId ? { locationId } : {}),
      archivedAt: null,
    },
    include: includeGroups,
    orderBy: { name: "asc" },
  });
  return rows.map(productDto);
}

export async function createPosProduct(actor: PosActor, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const kind = String(body.kind || "");
  if (!KINDS.has(kind)) throw new PosError("PRODUCT_KIND", "Unknown POS product kind");
  const name = String(body.name || "").trim();
  if (!name) throw new PosError("PRODUCT_NAME", "name is required");
  const row = await prisma.posProduct.create({
    data: {
      orgId,
      locationId,
      kind: kind as PosProductKind,
      name,
      description: body.description == null ? null : String(body.description),
      sku: body.sku == null ? null : String(body.sku),
      price: money(Number(body.price ?? body.giftCardDefaultAmount ?? 0)),
      openPrice: body.openPrice === true || kind === "open_price",
      taxExemptDefault: body.taxExemptDefault === true,
      trackInventory: body.trackInventory === true,
      onHand: body.trackInventory === true ? 0 : body.onHand == null ? null : Number(body.onHand),
      kitchenRoute: body.kitchenRoute == null ? null : String(body.kitchenRoute),
      membershipPlanId:
        body.membershipPlanId == null ? null : String(body.membershipPlanId),
      admissionProductId:
        body.admissionProductId == null ? null : String(body.admissionProductId),
      giftCardDefaultAmount:
        body.giftCardDefaultAmount == null
          ? null
          : money(Number(body.giftCardDefaultAmount)),
      allowCustomAmount: body.allowCustomAmount === true,
      denominations: Array.isArray(body.denominations) ? body.denominations : undefined,
    },
    include: includeGroups,
  });
  const openingQty =
    body.trackInventory === true && body.onHand != null ? Number(body.onHand) : null;
  if (openingQty != null && Number.isFinite(openingQty) && openingQty !== 0) {
    await recordInventoryMovementNow({
      orgId,
      productRef: { posProductId: row.id },
      kind: "opening",
      qty: openingQty,
      absoluteQty: openingQty,
      sourceType: "opening_balance",
      sourceId: `pos_product:${row.id}:create`,
      actorId: actor.sub ?? null,
    });
  }
  const refreshed = await prisma.posProduct.findFirstOrThrow({
    where: { id: row.id },
    include: includeGroups,
  });
  return productDto(refreshed);
}

export async function updatePosProduct(
  actor: PosActor,
  id: string,
  body: Record<string, unknown>
) {
  const where = await posListLocationWhere(actor);
  const existing = await prisma.posProduct.findFirst({ where: { ...where, id } });
  if (!existing) {
    const foreign = await prisma.posProduct.findFirst({ where: { id }, select: { id: true } });
    if (foreign) throw new ForbiddenError("Product is outside this company");
    throw new PosError("NOT_FOUND", "Product not found", 404);
  }
  const data: Prisma.PosProductUpdateInput = {};
  if (typeof body.name === "string") data.name = body.name.trim();
  if (typeof body.description === "string") data.description = body.description;
  if (typeof body.suspendSales === "boolean") data.suspendSales = body.suspendSales;
  if (typeof body.trackInventory === "boolean") data.trackInventory = body.trackInventory;
  if (body.lastCost != null && body.lastCost !== "") {
    data.lastCost = money(Number(body.lastCost));
  }
  if (body.inventoryAccountId !== undefined) {
    data.inventoryAccountId =
      body.inventoryAccountId == null || body.inventoryAccountId === ""
        ? null
        : String(body.inventoryAccountId);
  }
  if (body.cogsAccountId !== undefined) {
    data.cogsAccountId =
      body.cogsAccountId == null || body.cogsAccountId === ""
        ? null
        : String(body.cogsAccountId);
  }
  if (body.revenueAccountId !== undefined) {
    data.revenueAccountId =
      body.revenueAccountId == null || body.revenueAccountId === ""
        ? null
        : String(body.revenueAccountId);
  }
  const stockTarget = body.onHand != null ? Number(body.onHand) : null;
  if (body.archived === true) data.archivedAt = new Date();
  const row = await prisma.posProduct.update({
    where: { id: existing.id },
    data,
    include: includeGroups,
  });
  if (
    stockTarget != null &&
    Number.isFinite(stockTarget) &&
    (row.trackInventory || body.trackInventory === true)
  ) {
    const current = existing.onHand ?? 0;
    const delta = stockTarget - current;
    if (delta !== 0) {
      await recordInventoryMovementNow({
        orgId: row.orgId,
        productRef: { posProductId: row.id },
        kind: delta > 0 ? "adjustment_in" : "adjustment_out",
        qty: delta,
        absoluteQty: stockTarget,
        sourceType: "inventory_movement",
        sourceId: `pos_product:${row.id}:adj:${Date.now()}`,
        actorId: actor.sub ?? null,
      });
    }
  }
  if (Array.isArray(body.modifiers)) {
    await prisma.posModifierGroup.deleteMany({ where: { productId: row.id } });
    for (const group of body.modifiers as Array<Record<string, unknown>>) {
      await prisma.posModifierGroup.create({
        data: {
          orgId: row.orgId,
          productId: row.id,
          name: String(group.name || "Options"),
          required: group.required === true,
          minSelect: Number(group.minSelect ?? 0),
          maxSelect: Number(group.maxSelect ?? 1),
          modifiers: {
            create: (Array.isArray(group.modifiers) ? group.modifiers : []).map(
              (m: Record<string, unknown>) => ({
                orgId: row.orgId,
                name: String(m.name || "Option"),
                priceDelta: money(Number(m.priceDelta ?? 0)),
              })
            ),
          },
        },
      });
    }
  }
  if (Array.isArray(body.links)) {
    await prisma.posProductLink.deleteMany({ where: { parentProductId: row.id } });
    for (const link of body.links as Array<Record<string, unknown>>) {
      await prisma.posProductLink.create({
        data: {
          orgId: row.orgId,
          parentProductId: row.id,
          childProductId: String(link.childProductId),
          required: link.required === true,
          maxQty: link.maxQty == null ? null : Number(link.maxQty),
        },
      });
    }
  }
  const fresh = await prisma.posProduct.findFirstOrThrow({
    where: { id: row.id },
    include: includeGroups,
  });
  return productDto(fresh);
}

export async function suspendPosProduct(actor: PosActor, id: string, suspend = true) {
  return updatePosProduct(actor, id, { suspendSales: suspend });
}

export async function listMenus(actor: PosActor, locationId: string) {
  const { orgId } = await requirePosVenue(actor, locationId);
  return prisma.posMenu.findMany({
    where: { orgId, locationId },
    include: { categories: true, items: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createMenu(actor: PosActor, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const menu = await prisma.posMenu.create({
    data: {
      orgId,
      locationId,
      name: String(body.name || "Menu"),
      deviceTemplateKey:
        body.deviceTemplateKey == null ? null : String(body.deviceTemplateKey),
      sortOrder: Number(body.sortOrder ?? 0),
    },
  });
  if (Array.isArray(body.categories)) {
    for (const c of body.categories as Array<Record<string, unknown>>) {
      await prisma.posMenuCategory.create({
        data: {
          menuId: menu.id,
          orgId,
          name: String(c.name || "Category"),
          sortOrder: Number(c.sortOrder ?? 0),
        },
      });
    }
  }
  if (Array.isArray(body.items)) {
    for (const item of body.items as Array<Record<string, unknown>>) {
      await prisma.posMenuItem.create({
        data: {
          menuId: menu.id,
          orgId,
          productId: String(item.productId),
          sortOrder: Number(item.sortOrder ?? 0),
          hidden: item.hidden === true,
        },
      });
    }
  }
  return prisma.posMenu.findFirstOrThrow({
    where: { id: menu.id },
    include: { categories: true, items: true },
  });
}

export async function addMenuCategory(
  actor: PosActor,
  menuId: string,
  body: Record<string, unknown>
) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const menu = await prisma.posMenu.findFirst({ where: { id: menuId, orgId, locationId } });
  if (!menu) throw new PosError("NOT_FOUND", "Menu not found", 404);
  return prisma.posMenuCategory.create({
    data: {
      menuId: menu.id,
      orgId,
      name: String(body.name || "Category"),
      sortOrder: Number(body.sortOrder ?? 0),
    },
  });
}

export async function addMenuItem(
  actor: PosActor,
  menuId: string,
  body: Record<string, unknown>
) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const menu = await prisma.posMenu.findFirst({ where: { id: menuId, orgId, locationId } });
  if (!menu) throw new PosError("NOT_FOUND", "Menu not found", 404);
  return prisma.posMenuItem.create({
    data: {
      menuId: menu.id,
      orgId,
      productId: String(body.productId),
      categoryId: body.categoryId ? String(body.categoryId) : null,
      sortOrder: Number(body.sortOrder ?? 0),
      hidden: body.hidden === true,
      color: body.color == null ? null : String(body.color),
      icon: body.icon == null ? null : String(body.icon),
    },
  });
}

export async function getPosCatalog(actor: PosActor, locationId: string, deviceId?: string | null) {
  const { orgId } = await requirePosVenue(actor, locationId);
  const device = deviceId
    ? await prisma.posDevice.findFirst({
        where: { id: deviceId, orgId, locationId, archivedAt: null },
      })
    : null;
  const products = await prisma.posProduct.findMany({
    where: { orgId, locationId, archivedAt: null, suspendSales: false },
    include: includeGroups,
    orderBy: { name: "asc" },
  });
  const menus = await prisma.posMenu.findMany({
    where: {
      orgId,
      locationId,
      ...(device ? { OR: [{ deviceTemplateKey: null }, { deviceTemplateKey: device.templateKey }] } : {}),
    },
    include: { categories: true, items: { where: { hidden: false } } },
  });
  const admissions = await prisma.admissionProduct.findMany({
    where: { orgId, locationId, published: true, archivedAt: null },
    select: {
      id: true,
      name: true,
      type: true,
      description: true,
      waiverRequired: true,
      prices: { select: { code: true, amount: true, currency: true } },
    },
  });
  return {
    device: device ? { id: device.id, name: device.name, templateKey: device.templateKey } : null,
    menus,
    products: products.map(productDto),
    admissions: admissions.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      description: a.description,
      waiverRequired: a.waiverRequired,
      prices: a.prices.map((p) => ({
        code: p.code,
        amount: num(p.amount),
        currency: p.currency,
      })),
    })),
  };
}

export async function listDiscountCodes(actor: PosActor, locationId?: string | null) {
  const where = await posListLocationWhere(actor);
  return prisma.posDiscountCode.findMany({
    where: { ...where, ...(locationId ? { locationId } : {}), archivedAt: null },
    orderBy: { code: "asc" },
  });
}

export async function createDiscountCode(actor: PosActor, body: Record<string, unknown>) {
  const locationId = body.locationId == null || body.locationId === "" ? null : String(body.locationId);
  const orgId = locationId
    ? (await requirePosVenue(actor, locationId)).orgId
    : (await posListLocationWhere(actor)).orgId;
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new PosError("DISCOUNT_CODE", "code is required");
  return prisma.posDiscountCode.create({
    data: {
      orgId,
      locationId,
      code,
      percentOff: body.percentOff == null ? null : money(Number(body.percentOff)),
      amountOff: body.amountOff == null ? null : money(Number(body.amountOff)),
      minSubtotal: body.minSubtotal == null ? null : money(Number(body.minSubtotal)),
      requiresManagerPin: body.requiresManagerPin !== false,
      maxRedemptions: body.maxRedemptions == null ? null : Number(body.maxRedemptions),
    },
  });
}
