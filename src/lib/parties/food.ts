/**
 * Party food orders. Lines snapshot PartyMenuItem (or the linked PosProduct
 * price). Every non-cancelled order is part of the booking total as `add_on`
 * BookingLines (never a shop Order). Submit emits a queued KitchenTicket.
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { P } from "@/lib/auth/permissions";
import { createKitchenTicket, resolveKitchenStation } from "@/lib/pos/kitchen";
import {
  TicketingError,
  INVALID_STATUS_TRANSITION,
  PARTY_FOOD_CUTOFF,
  PARTY_MENU_ITEM_INVALID,
  PARTY_REASON_REQUIRED,
  PartyValidationError,
} from "@/lib/parties/errors";
import { actorCan, partyStaffContext, type PartyActor } from "@/lib/parties/gate";
import { isPartyLive, loadPartyById, loadStaffParty, type LoadedParty } from "@/lib/parties/load";
import { resolvePartySettings } from "@/lib/parties/settings";
import { logPartyActivity } from "@/lib/parties/activity";
import type { PartyFoodLineInput } from "@/lib/parties/pricing";

const OPEN_STATUSES = ["draft", "submitted", "sent_to_kitchen", "fulfilled"] as const;

export type FoodLineRequest = {
  menuItemId: string;
  qty: number;
  notes?: string | null;
  modifiers?: unknown;
  unitPriceCents?: number | null;
};

export type ResolvedFoodLine = {
  menuItemId: string;
  posProductId: string | null;
  nameSnapshot: string;
  qty: number;
  unitPriceCents: number;
  notes: string | null;
  modifiers: unknown;
};

export function parseFoodLines(raw: unknown): FoodLineRequest[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("lines must be an array");
  return raw.map((r, i) => {
    const b = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const qty = Number(b.qty ?? 1);
    if (typeof b.menuItemId !== "string" || !isValidId(b.menuItemId)) {
      throw new PartyValidationError(PARTY_MENU_ITEM_INVALID, { [`lines.${i}.menuItemId`]: "Choose a menu item" });
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      throw new PartyValidationError(PARTY_MENU_ITEM_INVALID, { [`lines.${i}.qty`]: "Quantity must be 1 or more" });
    }
    const override =
      b.unitPriceCents === undefined || b.unitPriceCents === null || b.unitPriceCents === ""
        ? null
        : Number(b.unitPriceCents);
    if (override != null && (!Number.isInteger(override) || override < 0)) {
      throw new PartyValidationError(PARTY_MENU_ITEM_INVALID, { [`lines.${i}.unitPriceCents`]: "Price must be 0 or more cents" });
    }
    return {
      menuItemId: b.menuItemId,
      qty,
      notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim().slice(0, 500) : null,
      modifiers: b.modifiers ?? null,
      unitPriceCents: override,
    };
  });
}

/** Menu item must be available, not archived, same org + venue. POS price wins unless overridden. */
export async function resolveFoodLines(
  orgId: string,
  locationId: string,
  requests: FoodLineRequest[],
  opts: { allowPriceOverride: boolean }
): Promise<ResolvedFoodLine[]> {
  if (!requests.length) return [];
  const ids = [...new Set(requests.map((r) => r.menuItemId))];
  const items = await prisma.partyMenuItem.findMany({
    where: { id: { in: ids }, orgId, locationId, available: true, archivedAt: null },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const posIds = items.map((i) => i.posProductId).filter((id): id is string => Boolean(id));
  const pos = posIds.length
    ? await prisma.posProduct.findMany({
        where: { id: { in: posIds }, orgId, locationId, archivedAt: null },
        select: { id: true, price: true },
      })
    : [];
  const posPrice = new Map(pos.map((p) => [p.id, Math.round(Number(p.price.toString()) * 100)]));
  return requests.map((r, i) => {
    const item = byId.get(r.menuItemId);
    if (!item) {
      throw new PartyValidationError(PARTY_MENU_ITEM_INVALID, {
        [`lines.${i}.menuItemId`]: "Menu item is not available at this venue",
      });
    }
    const snapshot =
      item.posProductId && posPrice.has(item.posProductId)
        ? posPrice.get(item.posProductId)!
        : item.priceCents;
    return {
      menuItemId: item.id,
      posProductId: item.posProductId && posPrice.has(item.posProductId) ? item.posProductId : null,
      nameSnapshot: item.name,
      qty: r.qty,
      unitPriceCents: opts.allowPriceOverride && r.unitPriceCents != null ? r.unitPriceCents : snapshot,
      notes: r.notes ?? null,
      modifiers: r.modifiers ?? null,
    };
  });
}

/** Food lines that belong in the booking total (all non-cancelled orders). */
export function partyFoodPricing(party: Pick<LoadedParty, "partyDetail">): PartyFoodLineInput[] {
  return party.partyDetail.foodOrders
    .filter((o) => (OPEN_STATUSES as readonly string[]).includes(o.status))
    .flatMap((o) =>
      o.lines.map((l) => ({ name: l.nameSnapshot, qty: l.qty, unitPriceCents: l.unitPriceCents }))
    );
}

export function toFoodOrderDto(order: LoadedParty["partyDetail"]["foodOrders"][number]) {
  return {
    id: order.id,
    status: order.status,
    promisedAt: order.promisedAt?.toISOString() ?? null,
    kitchenTicketId: order.kitchenTicketId,
    notes: order.notes,
    submittedAt: order.submittedAt?.toISOString() ?? null,
    fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
    cutoffOverrideReason: order.cutoffOverrideReason,
    totalCents: order.lines.reduce((s, l) => s + l.unitPriceCents * l.qty, 0),
    lines: order.lines.map((l) => ({
      id: l.id,
      menuItemId: l.menuItemId,
      posProductId: l.posProductId,
      nameSnapshot: l.nameSnapshot,
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      modifiers: l.modifiers,
      notes: l.notes,
    })),
    createdAt: order.createdAt.toISOString(),
  };
}

export function foodCutoffPassed(visitStartsAt: Date | null, cutoffMinutes: number, now = Date.now()) {
  if (!visitStartsAt) return false;
  return now >= visitStartsAt.getTime() - cutoffMinutes * 60_000;
}

/** Staff reprice runs as the actor; host edits reprice as the system (org already resolved). */
async function reprice(staffActor: PartyActor | null, party: LoadedParty) {
  const { repricePartyBooking } = await import("@/lib/parties/partyEngine");
  await repricePartyBooking(staffActor, party.id, party.orgId, {});
}

/** Write the draft (create if none) inside a transaction; reprice after. */
export async function writeFoodDraft(
  party: LoadedParty,
  lines: ResolvedFoodLine[],
  meta: { notes?: string | null; promisedAt?: Date | null },
  db: Prisma.TransactionClient
) {
  const draft = party.partyDetail.foodOrders.find((o) => o.status === "draft");
  const order = draft
    ? await db.partyFoodOrder.update({
        where: { id: draft.id },
        data: {
          ...(meta.notes !== undefined ? { notes: meta.notes } : {}),
          ...(meta.promisedAt !== undefined ? { promisedAt: meta.promisedAt } : {}),
        },
      })
    : await db.partyFoodOrder.create({
        data: {
          orgId: party.orgId,
          locationId: party.locationId,
          partyDetailId: party.partyDetail.id,
          status: "draft",
          notes: meta.notes ?? null,
          promisedAt: meta.promisedAt ?? party.visitStartsAt ?? null,
        },
      });
  await db.partyFoodLine.deleteMany({ where: { foodOrderId: order.id } });
  if (lines.length) {
    await db.partyFoodLine.createMany({
      data: lines.map((l) => ({
        orgId: party.orgId,
        locationId: party.locationId,
        foodOrderId: order.id,
        menuItemId: l.menuItemId,
        posProductId: l.posProductId,
        nameSnapshot: l.nameSnapshot,
        qty: l.qty,
        unitPriceCents: l.unitPriceCents,
        notes: l.notes,
        modifiers: (l.modifiers ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
  }
  return order;
}

export async function getPartyFood(actor: PartyActor, bookingId: string) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  const settings = await resolvePartySettings(party.orgId, party.locationId);
  return {
    orders: party.partyDetail.foodOrders.map(toFoodOrderDto),
    foodNotes: party.partyDetail.foodNotes,
    cutoffMinutes: settings.foodOrderCutoffMinutes,
    cutoffPassed: foodCutoffPassed(party.visitStartsAt, settings.foodOrderCutoffMinutes),
  };
}

/** Core PUT shared by staff and host. Host callers pass enforceCutoff. */
export async function putFoodDraftForParty(
  party: LoadedParty,
  raw: Record<string, unknown>,
  opts: {
    actor: PartyActor | null;
    allowPriceOverride: boolean;
    enforceCutoff: boolean;
    /** Host (client) edits: reprice without staff gates. */
    asHost?: boolean;
  }
) {
  if (!isPartyLive(party.status)) throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  const settings = await resolvePartySettings(party.orgId, party.locationId);
  if (opts.enforceCutoff && foodCutoffPassed(party.visitStartsAt, settings.foodOrderCutoffMinutes)) {
    throw new TicketingError(PARTY_FOOD_CUTOFF, 409);
  }
  const lines = await resolveFoodLines(party.orgId, party.locationId, parseFoodLines(raw.lines), {
    allowPriceOverride: opts.allowPriceOverride,
  });
  const promisedAt =
    raw.promisedAt === undefined
      ? undefined
      : raw.promisedAt
        ? new Date(String(raw.promisedAt))
        : null;
  if (promisedAt && Number.isNaN(promisedAt.getTime())) throw new Error("promisedAt is invalid");
  const order = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${party.id} FOR UPDATE`;
    return writeFoodDraft(
      party,
      lines,
      {
        notes: typeof raw.notes === "string" ? raw.notes.trim().slice(0, 1000) || null : undefined,
        promisedAt,
      },
      tx
    );
  });
  const fresh = await loadPartyById(party.orgId, party.id);
  await reprice(opts.asHost ? null : opts.actor, fresh);
  await logPartyActivity({
    orgId: party.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "edited",
    event: "food_draft",
    payload: { foodOrderId: order.id, lineCount: lines.length },
    actorUserId: opts.actor?.sub ?? null,
    entity: "PartyFoodOrder",
    entityId: order.id,
  });
  const after = await loadPartyById(party.orgId, party.id);
  return after.partyDetail.foodOrders.map(toFoodOrderDto);
}

export async function putPartyFoodDraft(actor: PartyActor, bookingId: string, raw: Record<string, unknown>) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  return putFoodDraftForParty(party, raw, {
    actor,
    allowPriceOverride: actorCan(actor, P.PartiesFood),
    enforceCutoff: false,
  });
}

/**
 * Submit the draft to the kitchen. Inside foodOrderCutoffMinutes of the visit
 * start this fails with PARTY_FOOD_CUTOFF unless the actor holds parties:food
 * and gives an override reason (logged).
 */
export async function submitPartyFood(
  actor: PartyActor,
  bookingId: string,
  raw: Record<string, unknown>
) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  if (!isPartyLive(party.status)) throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  const draft = party.partyDetail.foodOrders.find((o) => o.status === "draft");
  if (!draft || !draft.lines.length) throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  const settings = await resolvePartySettings(party.orgId, party.locationId);
  const reason = typeof raw.overrideReason === "string" ? raw.overrideReason.trim() : "";
  let overrideReason: string | null = null;
  if (foodCutoffPassed(party.visitStartsAt, settings.foodOrderCutoffMinutes)) {
    if (!reason || !actorCan(actor, P.PartiesFood)) {
      throw new TicketingError(PARTY_FOOD_CUTOFF, 409);
    }
    overrideReason = reason.slice(0, 500);
  }
  const posIds = draft.lines.map((l) => l.posProductId).filter((id): id is string => Boolean(id));
  const routes = posIds.length
    ? (
        await prisma.posProduct.findMany({
          where: { id: { in: posIds }, orgId: party.orgId },
          select: { kitchenRoute: true },
        })
      ).map((p) => p.kitchenRoute)
    : [];

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${party.id} FOR UPDATE`;
    const claimed = await tx.partyFoodOrder.updateMany({
      where: { id: draft.id, status: "draft" },
      data: { status: "submitted", submittedAt: new Date(), cutoffOverrideReason: overrideReason },
    });
    if (claimed.count !== 1) throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
    const ticket = await createKitchenTicket(tx, {
      orgId: party.orgId,
      locationId: party.locationId,
      saleId: null,
      station: resolveKitchenStation(routes),
      items: draft.lines.map((l) => ({
        name: l.nameSnapshot,
        qty: l.qty,
        notes: l.notes,
        modifiers: l.modifiers,
      })),
    });
    return tx.partyFoodOrder.update({
      where: { id: draft.id },
      data: { status: "sent_to_kitchen", kitchenTicketId: ticket.id },
    });
  });

  await logPartyActivity({
    orgId: party.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "edited",
    event: "food_submitted",
    payload: {
      foodOrderId: result.id,
      kitchenTicketId: result.kitchenTicketId,
      ...(overrideReason ? { cutoffOverrideReason: overrideReason } : {}),
    },
    actorUserId: actor.sub ?? null,
    entity: "PartyFoodOrder",
    entityId: result.id,
  });
  const after = await loadPartyById(party.orgId, party.id);
  return after.partyDetail.foodOrders.map(toFoodOrderDto);
}

/** Cancel the open order (draft or sent) — voids its kitchen ticket and reprices. */
export async function cancelPartyFood(actor: PartyActor, bookingId: string, raw: Record<string, unknown>) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  const orderId = typeof raw.foodOrderId === "string" && isValidId(raw.foodOrderId) ? raw.foodOrderId : null;
  const target = party.partyDetail.foodOrders.find((o) =>
    orderId ? o.id === orderId : ["draft", "submitted", "sent_to_kitchen"].includes(o.status)
  );
  if (!target || !["draft", "submitted", "sent_to_kitchen"].includes(target.status)) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }
  const reason = typeof raw.reason === "string" ? raw.reason.trim().slice(0, 500) : "";
  if (target.status !== "draft" && !reason) throw new TicketingError(PARTY_REASON_REQUIRED, 400);
  await prisma.$transaction(async (tx) => {
    await tx.partyFoodOrder.update({ where: { id: target.id }, data: { status: "cancelled" } });
    if (target.kitchenTicketId) {
      await tx.kitchenTicket.updateMany({
        where: { id: target.kitchenTicketId, status: { in: ["queued", "sent", "accepted"] } },
        data: { status: "void" },
      });
    }
  });
  if (isPartyLive(party.status)) {
    await reprice(actor, await loadPartyById(party.orgId, party.id));
  }
  await logPartyActivity({
    orgId: party.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "edited",
    event: "food_cancelled",
    payload: { foodOrderId: target.id, reason: reason || null },
    actorUserId: actor.sub ?? null,
    entity: "PartyFoodOrder",
    entityId: target.id,
  });
  const after = await loadPartyById(party.orgId, party.id);
  return after.partyDetail.foodOrders.map(toFoodOrderDto);
}
