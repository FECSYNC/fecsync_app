/**
 * Kitchen ticket creation for POS sales and party food orders (one helper).
 * No Kitchen Display screen consumes these yet; rows are queued for routing.
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export type KitchenTicketItem = {
  name: string;
  qty: number;
  notes?: string | null;
  modifiers?: unknown;
};

export const DEFAULT_KITCHEN_STATION = "kitchen";

/** First configured kitchenRoute wins, else the default station. */
export function resolveKitchenStation(routes: Array<string | null | undefined>): string {
  return routes.find((route) => typeof route === "string" && route.trim())?.trim() || DEFAULT_KITCHEN_STATION;
}

export async function createKitchenTicket(
  db: Db,
  opts: {
    orgId: string;
    locationId: string;
    saleId?: string | null;
    station: string;
    items: KitchenTicketItem[];
  }
) {
  return db.kitchenTicket.create({
    data: {
      orgId: opts.orgId,
      locationId: opts.locationId,
      saleId: opts.saleId ?? null,
      station: opts.station,
      items: opts.items as unknown as Prisma.InputJsonValue,
      status: "queued",
    },
  });
}
