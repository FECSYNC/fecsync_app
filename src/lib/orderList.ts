/**
 * Fast staff/customer order list loading.
 */

import prisma from "@/lib/prisma";
import { asIdString } from "@/lib/ids";
import {
  cartLinesInclude,
  orderWhereFromLegacyFilter,
  productListSelect,
  fabricListSelect,
  serializeCart,
  serializeOrder,
  type SerializedCart,
} from "@/lib/commerceSerialize";

const PRODUCT_LIST_SELECT = productListSelect;
const FABRIC_LIST_SELECT = fabricListSelect;

function asId(value: unknown): string | null {
  return asIdString(value);
}

function indexById<T extends { id: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

function hydrateCartLines(
  cart: SerializedCart,
  products: Map<string, Record<string, unknown>>,
  fabrics: Map<string, Record<string, unknown>>
) {
  for (const line of cart.lines) {
    const productId = asId(line.product);
    if (productId && products.has(productId)) {
      line.product = products.get(productId)! as SerializedCart["lines"][0]["product"];
    }
    const fabricId = asId(line.fabric);
    if (fabricId && fabrics.has(fabricId)) {
      line.fabric = fabrics.get(fabricId)! as SerializedCart["lines"][0]["fabric"];
    }
  }

  for (const item of cart.products) {
    const productId = asId(item.product);
    if (productId && products.has(productId)) {
      item.product = products.get(productId)! as typeof item.product;
    }
  }
}

export type LoadOrdersListOptions = {
  limit?: number;
  hydrateCarts?: boolean;
  /** Staff order views — include shipment.failureReason. */
  includeShipmentOpsFields?: boolean;
};

export async function loadOrdersList(
  filter: Record<string, unknown>,
  options?: LoadOrdersListOptions
): Promise<Record<string, unknown>[]> {
  const limit = Math.min(Math.max(options?.limit ?? 200, 1), 500);
  const hydrateCarts = options?.hydrateCarts !== false;
  const where = orderWhereFromLegacyFilter(filter);

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          phoneNumber: true,
          firstName: true,
          lastName: true,
        },
      },
      shipments: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (orders.length === 0) return [];

  const userIds = [...new Set(orders.map((o) => o.userId))];
  const profiles = userIds.length
    ? await prisma.profile.findMany({
        where: { userId: { in: userIds } },
        select: {
          userId: true,
          firstName: true,
          lastName: true,
          profilePicture: true,
        },
      })
    : [];

  const byUser = new Map(profiles.map((p) => [p.userId, p]));

  const serialized = orders.map((order) => {
    const row = serializeOrder(
      {
        ...order,
        user: order.user
          ? {
              ...order.user,
              profile: byUser.get(order.userId)
                ? {
                    firstName: byUser.get(order.userId)!.firstName,
                    lastName: byUser.get(order.userId)!.lastName,
                    profilePicture: byUser.get(order.userId)!.profilePicture,
                  }
                : undefined,
            }
          : undefined,
      },
      undefined,
      {
        includeShipmentOpsFields: Boolean(options?.includeShipmentOpsFields),
      }
    );
    return row as unknown as Record<string, unknown>;
  });

  if (!hydrateCarts) {
    for (const order of serialized) {
      delete order.carts;
    }
    return serialized;
  }

  const cartIds = [...new Set(orders.map((o) => o.cartId))];
  const carts = cartIds.length
    ? await prisma.cart.findMany({
        where: { id: { in: cartIds } },
        include: cartLinesInclude,
      })
    : [];

  if (carts.length === 0) return serialized;

  const cartsById = new Map(
    carts.map((c) => [c.id, serializeCart(c)])
  );

  const productIds = new Set<string>();
  const fabricIds = new Set<string>();
  for (const cart of cartsById.values()) {
    for (const line of cart.lines) {
      const pid = asId(line.product);
      if (pid) productIds.add(pid);
      const fid = asId(line.fabric);
      if (fid) fabricIds.add(fid);
    }
    for (const item of cart.products) {
      const pid = asId(item.product);
      if (pid) productIds.add(pid);
    }
  }

  const [products, fabrics] = await Promise.all([
    productIds.size
      ? prisma.product.findMany({
          where: { id: { in: [...productIds] } },
          select: PRODUCT_LIST_SELECT,
        })
      : Promise.resolve([]),
    fabricIds.size
      ? prisma.fabric.findMany({
          where: { id: { in: [...fabricIds] } },
          select: FABRIC_LIST_SELECT,
        })
      : Promise.resolve([]),
  ]);

  const productsById = indexById(
    products.map((p) => ({ ...p, _id: p.id } as { id: string; _id: string }))
  );
  const fabricsById = indexById(
    fabrics.map((f) => ({ ...f, _id: f.id } as { id: string; _id: string }))
  );

  for (const cart of cartsById.values()) {
    hydrateCartLines(
      cart,
      productsById as Map<string, Record<string, unknown>>,
      fabricsById as Map<string, Record<string, unknown>>
    );
  }

  for (const order of serialized) {
    const cartId = asId(order.cartId ?? order.carts);
    if (cartId && cartsById.has(cartId)) {
      order.carts = cartsById.get(cartId);
    }
  }

  return serialized;
}

export async function loadOrderDetail(
  filter: Record<string, unknown>,
  options?: Pick<LoadOrdersListOptions, "includeShipmentOpsFields" | "hydrateCarts">
): Promise<Record<string, unknown> | null> {
  const rows = await loadOrdersList(filter, { limit: 1, ...options });
  return rows[0] ?? null;
}
