/**
 * Party food / cake menu (PartyMenuItem). Never shop Product rows.
 * posProductId must be a PosProduct in the same org and venue.
 */
import type { PartyMenuItemKind, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { partyStaffContext, type PartyActor } from "@/lib/parties/gate";
import {
  assertVenueWritable,
  locationInPartyScope,
  partyLocationWhere,
  rejectBodyOrgId,
  resolvePartyLocationId,
} from "@/lib/parties/scope";
import {
  PARTY_MENU_ITEM_INVALID,
  PARTY_NAME_TAKEN,
  PartyValidationError,
  TicketingError,
  partyNotFound,
} from "@/lib/parties/errors";
import { logPartyAudit } from "@/lib/parties/activity";

const KINDS: PartyMenuItemKind[] = ["food", "beverage", "cake", "other"];

type MenuRow = Prisma.PartyMenuItemGetPayload<{
  include: { location: { select: { id: true; name: true } } };
}>;

export function toPartyMenuItemDto(row: MenuRow | Prisma.PartyMenuItemGetPayload<Record<string, never>>) {
  return {
    id: row.id,
    locationId: row.locationId,
    location: "location" in row ? row.location : null,
    name: row.name,
    description: row.description,
    kind: row.kind,
    priceCents: row.priceCents,
    currency: row.currency,
    available: row.available,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    posProductId: row.posProductId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function assertPosProductForVenue(
  orgId: string,
  locationId: string,
  posProductId: string
) {
  if (!isValidId(posProductId)) {
    throw new PartyValidationError(PARTY_MENU_ITEM_INVALID, { posProductId: "Choose a POS product" });
  }
  const pos = await prisma.posProduct.findFirst({
    where: { id: posProductId, orgId, locationId, archivedAt: null },
    select: { id: true, price: true, name: true, kitchenRoute: true },
  });
  if (!pos) {
    throw new PartyValidationError(PARTY_MENU_ITEM_INVALID, {
      posProductId: "POS product must be active at the same venue",
    });
  }
  return pos;
}

function parseMenuInput(b: Record<string, unknown>, partial: boolean) {
  const fields: Record<string, string> = {};
  const out: {
    name?: string;
    description?: string | null;
    kind?: PartyMenuItemKind;
    priceCents?: number;
    available?: boolean;
    posProductId?: string | null;
    sortOrder?: number;
  } = {};
  if (b.name !== undefined || !partial) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (name.length < 2 || name.length > 160) fields.name = "Name is required (2–160 characters)";
    else out.name = name;
  }
  if (b.description !== undefined) {
    out.description = typeof b.description === "string" && b.description.trim() ? b.description.trim() : null;
  }
  if (b.kind !== undefined || !partial) {
    const kind = String(b.kind ?? "food") as PartyMenuItemKind;
    if (!KINDS.includes(kind)) fields.kind = "Choose food, beverage, cake, or other";
    else out.kind = kind;
  }
  if (b.priceCents !== undefined || !partial) {
    const n = Number(b.priceCents);
    if (!Number.isInteger(n) || n < 0) fields.priceCents = "Price must be 0 or more cents";
    else out.priceCents = n;
  }
  if (b.available !== undefined) out.available = Boolean(b.available);
  if (b.sortOrder !== undefined) {
    const n = Number(b.sortOrder);
    if (!Number.isInteger(n)) fields.sortOrder = "Sort order must be a whole number";
    else out.sortOrder = n;
  }
  if (b.posProductId !== undefined) {
    out.posProductId =
      typeof b.posProductId === "string" && b.posProductId.trim() ? b.posProductId.trim() : null;
  }
  if (Object.keys(fields).length) throw new PartyValidationError(PARTY_MENU_ITEM_INVALID, fields);
  return out;
}

async function assertMenuNameFree(orgId: string, locationId: string, name: string, excludeId?: string) {
  const clash = await prisma.partyMenuItem.findFirst({
    where: {
      orgId,
      locationId,
      archivedAt: null,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new TicketingError(PARTY_NAME_TAKEN, 409);
}

export async function listPartyMenuItems(
  actor: PartyActor,
  opts: { locationId?: string | null; includeArchived?: boolean; availableOnly?: boolean } = {}
) {
  const ctx = await partyStaffContext(actor);
  const rows = await prisma.partyMenuItem.findMany({
    where: {
      orgId: ctx.orgId,
      ...partyLocationWhere(ctx.scope, opts.locationId),
      ...(opts.includeArchived ? {} : { archivedAt: null }),
      ...(opts.availableOnly ? { available: true } : {}),
    },
    include: { location: { select: { id: true, name: true } } },
    orderBy: [{ locationId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toPartyMenuItemDto);
}

export async function createPartyMenuItem(actor: PartyActor, raw: unknown) {
  const ctx = await partyStaffContext(actor);
  const body = rejectBodyOrgId(raw);
  const locationId = await resolvePartyLocationId(actor, ctx.scope, body.locationId);
  await assertVenueWritable(ctx.orgId, locationId);
  const input = parseMenuInput(body, false);
  await assertMenuNameFree(ctx.orgId, locationId, input.name!);
  if (input.posProductId) await assertPosProductForVenue(ctx.orgId, locationId, input.posProductId);
  const row = await prisma.partyMenuItem.create({
    data: {
      orgId: ctx.orgId,
      locationId,
      name: input.name!,
      description: input.description ?? null,
      kind: input.kind ?? "food",
      priceCents: input.priceCents ?? 0,
      available: input.available ?? true,
      posProductId: input.posProductId ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
    include: { location: { select: { id: true, name: true } } },
  });
  logPartyAudit(actor, ctx.orgId, {
    action: "parties.menu.create",
    entityType: "Settings",
    entityId: row.id,
    description: `Party menu item ${row.name} created`,
    metadata: { locationId },
  });
  return toPartyMenuItemDto(row);
}

export async function updatePartyMenuItem(actor: PartyActor, itemId: string, raw: unknown) {
  const ctx = await partyStaffContext(actor);
  const body = rejectBodyOrgId(raw);
  if (!isValidId(itemId)) throw partyNotFound();
  const existing = await prisma.partyMenuItem.findFirst({ where: { id: itemId, orgId: ctx.orgId } });
  if (!existing || !locationInPartyScope(ctx.scope, existing.locationId)) throw partyNotFound();
  const input = parseMenuInput(body, true);
  const data: Prisma.PartyMenuItemUpdateInput = {};
  if (body.archive === true) {
    data.archivedAt = existing.archivedAt ?? new Date();
    data.available = false;
  } else {
    await assertVenueWritable(ctx.orgId, existing.locationId);
    if (body.unarchive === true) {
      await assertMenuNameFree(ctx.orgId, existing.locationId, existing.name, existing.id);
      data.archivedAt = null;
    }
  }
  if (input.name !== undefined) {
    await assertMenuNameFree(ctx.orgId, existing.locationId, input.name, existing.id);
    data.name = input.name;
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.priceCents !== undefined) data.priceCents = input.priceCents;
  if (input.available !== undefined && body.archive !== true) data.available = input.available;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.posProductId !== undefined) {
    if (input.posProductId) {
      await assertPosProductForVenue(ctx.orgId, existing.locationId, input.posProductId);
    }
    data.posProductId = input.posProductId;
  }
  const row = await prisma.partyMenuItem.update({
    where: { id: existing.id },
    data,
    include: { location: { select: { id: true, name: true } } },
  });
  logPartyAudit(actor, ctx.orgId, {
    action: body.archive === true ? "parties.menu.archive" : "parties.menu.update",
    entityType: "Settings",
    entityId: row.id,
    description: `Party menu item ${row.name} ${body.archive === true ? "archived" : "updated"}`,
    metadata: { locationId: row.locationId },
  });
  return toPartyMenuItemDto(row);
}

/** POS products a menu item may link to (same org + venue, not archived). */
export async function listPosProductsForMenu(actor: PartyActor, locationId: string) {
  const ctx = await partyStaffContext(actor);
  const loc = await resolvePartyLocationId(actor, ctx.scope, locationId, { allowArchived: true });
  const rows = await prisma.posProduct.findMany({
    where: {
      orgId: ctx.orgId,
      locationId: loc,
      archivedAt: null,
      kind: { in: ["food", "beverage", "add_on", "merchandise", "other"] },
    },
    select: { id: true, name: true, kind: true, price: true, kitchenRoute: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    priceCents: Math.round(Number(r.price.toString()) * 100),
    kitchenRoute: r.kitchenRoute,
  }));
}
