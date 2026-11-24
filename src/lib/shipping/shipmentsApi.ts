/**
 * Shipment list helpers for admin / customer APIs (Phase 3–4).
 */

import type { Prisma, Shipment, ShipmentStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { serializeShipment } from "./serialize";
import type { SerializedShipment, ShipmentListItem } from "./types";
import { parseOrderShippingMethodJson } from "./address";

const SHIPMENT_STATUSES = new Set<string>([
  "pending",
  "booked",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "failed",
  "cancelled",
]);

export function isShipmentStatus(value: string): value is ShipmentStatus {
  return SHIPMENT_STATUSES.has(value);
}

function customerNameFromUser(user: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
} | null): string | null {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.username?.trim() || null;
}

function toListItem(
  row: Shipment & {
    order?: {
      address?: string | null;
      status?: string;
      user?: {
        firstName?: string | null;
        lastName?: string | null;
        username?: string | null;
      } | null;
    } | null;
  }
): ShipmentListItem {
  const base = serializeShipment(row, { includeOpsFields: true });
  return {
    ...base,
    orderAddress: row.order?.address ?? null,
    orderStatus: row.order?.status ?? null,
    customerName: customerNameFromUser(row.order?.user ?? null),
  };
}

const orderInclude = {
  order: {
    select: {
      address: true,
      status: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          username: true,
        },
      },
    },
  },
} as const;

export async function listShipmentsForOrg(
  orgId: string,
  opts?: {
    status?: ShipmentStatus;
    orderId?: string;
    /** When set (CWV=false), only shipments for that customer's orders. */
    orderUserId?: string;
    page?: number;
    limit?: number;
  }
): Promise<{
  items: ShipmentListItem[];
  total: number;
  page: number;
  limit: number;
}> {
  const page = Math.max(1, Math.floor(opts?.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(opts?.limit ?? 20)));
  const where: Prisma.ShipmentWhereInput = { orgId };
  if (opts?.status) where.status = opts.status;
  if (opts?.orderId) where.orderId = opts.orderId;
  if (opts?.orderUserId) {
    where.order = { userId: opts.orderUserId };
  }

  const [total, rows] = await Promise.all([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: orderInclude,
    }),
  ]);

  return {
    items: rows.map((row) => toListItem(row)),
    total,
    page,
    limit,
  };
}

export async function getShipmentByIdForOrg(
  id: string,
  orgId: string,
  opts?: { orderUserId?: string }
): Promise<ShipmentListItem | null> {
  const where: Prisma.ShipmentWhereInput = { id, orgId };
  if (opts?.orderUserId) {
    where.order = { userId: opts.orderUserId };
  }
  const row = await prisma.shipment.findFirst({
    where,
    include: orderInclude,
  });
  return row ? toListItem(row) : null;
}

export async function getShipmentByOrderId(input: {
  orderId: string;
  /** Staff org scope — when set, shipment.orgId must match */
  orgId?: string;
  /** Customer ownership — when set, order.userId must match */
  ownerUserId?: string;
  /** Staff may see failureReason; customers must not */
  includeOpsFields?: boolean;
}): Promise<SerializedShipment | null> {
  const orderId = String(input.orderId || "").trim();
  if (!orderId || orderId.length > 128) return null;

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      ...(input.orgId ? { orgId: input.orgId } : {}),
      ...(input.ownerUserId ? { userId: input.ownerUserId } : {}),
    },
    include: {
      shipments: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!order) return null;
  const { findActiveShipment } = await import("./consistency");
  const preferred = parseOrderShippingMethodJson(order.shippingMethod)?.provider;
  const active = findActiveShipment(order.shipments, preferred);
  return active
    ? serializeShipment(active, {
        includeOpsFields: Boolean(input.includeOpsFields),
      })
    : null;
}
