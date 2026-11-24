/**
 * Party packages = AdmissionProduct (type party_package) + PartyPackageConfig.
 * Bands: `package` (base price), `extra_kid`, `extra_adult` (kept in sync with
 * the config's extra prices so the booking engine prices extras from bands).
 */
import type { AdmissionProductPrice, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import {
  createTicketSession,
  createTicketSessionSeries,
  listTicketSessions,
} from "@/lib/ticketing/sessions";
import { partyStaffContext, type PartyActor } from "@/lib/parties/gate";
import {
  assertVenueWritable,
  locationInPartyScope,
  partyLocationWhere,
  rejectBodyOrgId,
  resolvePartyLocationId,
} from "@/lib/parties/scope";
import {
  PARTY_PACKAGE_INVALID,
  PartyValidationError,
  TicketingError,
  partyNotFound,
} from "@/lib/parties/errors";
import { requireAssignableRoom } from "@/lib/parties/rooms";
import { resolvePartySettings, type PartySettingsValues } from "@/lib/parties/settings";
import { computeDepositRequiredCents, toCents } from "@/lib/parties/deposits";
import { logPartyAudit } from "@/lib/parties/activity";

export const PARTY_BASE_BAND = "package";
export const PARTY_EXTRA_KID_BAND = "extra_kid";
export const PARTY_EXTRA_ADULT_BAND = "extra_adult";
const EXTRA_BANDS = new Set([PARTY_EXTRA_KID_BAND, PARTY_EXTRA_ADULT_BAND]);

const packageInclude = {
  prices: { orderBy: { amount: "asc" } },
  partyConfig: true,
  resource: { select: { id: true, name: true, defaultCapacity: true, archivedAt: true } },
  location: { select: { id: true, name: true, slug: true, timezone: true, status: true } },
  parentLinks: {
    include: {
      addOnProduct: {
        select: {
          id: true,
          name: true,
          type: true,
          published: true,
          archivedAt: true,
          prices: { orderBy: { amount: "asc" }, take: 4 },
        },
      },
    },
  },
} satisfies Prisma.AdmissionProductInclude;

export type PartyPackageRow = Prisma.AdmissionProductGetPayload<{
  include: typeof packageInclude;
}>;

export type EffectivePackageConfig = {
  durationMinutes: number;
  includedKids: number;
  includedAdults: number;
  extraKidPriceCents: number | null;
  extraAdultPriceCents: number | null;
  roomResourceId: string | null;
  roomAssignedAtBooking: boolean;
  depositPercentOverride: number | null;
  depositFixedCentsOverride: number | null;
  includesFood: boolean;
  defaultMenuItemIds: string[];
  basePriceCents: number | null;
  basePriceBand: string | null;
};

function bandCents(prices: AdmissionProductPrice[], code: string): number | null {
  const band = prices.find((p) => p.code.trim().toLowerCase() === code);
  return band ? toCents(band.amount) : null;
}

export function basePriceBand(prices: AdmissionProductPrice[]): AdmissionProductPrice | null {
  return (
    prices.find((p) => p.code.trim().toLowerCase() === PARTY_BASE_BAND) ??
    prices.find((p) => !EXTRA_BANDS.has(p.code.trim().toLowerCase())) ??
    null
  );
}

/**
 * Effective config: PartyPackageConfig when present, otherwise legacy packages
 * created in the ticketing editor fall back to PartySettings defaults.
 */
export function effectivePackageConfig(
  product: Pick<PartyPackageRow, "prices" | "partyConfig" | "resourceId" | "maxGuests">,
  settings: PartySettingsValues
): EffectivePackageConfig {
  const c = product.partyConfig;
  const base = basePriceBand(product.prices);
  const ids = Array.isArray(c?.defaultMenuItemIds)
    ? (c!.defaultMenuItemIds as unknown[]).map(String).filter((id) => isValidId(id))
    : [];
  return {
    durationMinutes: c?.durationMinutes ?? settings.defaultPartyDurationMinutes,
    includedKids: c?.includedKids ?? product.maxGuests ?? settings.defaultMaxKids,
    includedAdults: c?.includedAdults ?? settings.defaultIncludedAdults,
    extraKidPriceCents:
      c?.extraKidPriceCents ?? bandCents(product.prices, PARTY_EXTRA_KID_BAND),
    extraAdultPriceCents:
      c?.extraAdultPriceCents ?? bandCents(product.prices, PARTY_EXTRA_ADULT_BAND),
    roomResourceId: c ? c.roomResourceId : product.resourceId,
    roomAssignedAtBooking: c?.roomAssignedAtBooking ?? false,
    depositPercentOverride:
      c?.depositPercentOverride != null ? Number(c.depositPercentOverride.toString()) : null,
    depositFixedCentsOverride: c?.depositFixedCentsOverride ?? null,
    includesFood: c?.includesFood ?? false,
    defaultMenuItemIds: ids,
    basePriceCents: base ? toCents(base.amount) : null,
    basePriceBand: base ? base.code.trim().toLowerCase() : null,
  };
}

export function toPartyPackageDto(row: PartyPackageRow, settings: PartySettingsValues) {
  const effective = effectivePackageConfig(row, settings);
  return {
    id: row.id,
    locationId: row.locationId,
    location: row.location ? { id: row.location.id, name: row.location.name } : null,
    name: row.name,
    description: row.description,
    images: row.images,
    published: row.published,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    status: row.archivedAt ? "archived" : row.published ? "published" : "draft",
    minGuests: row.minGuests,
    maxGuests: row.maxGuests,
    waiverRequired: row.waiverRequired,
    categoryId: row.categoryId,
    room: row.resource
      ? { id: row.resource.id, name: row.resource.name, defaultCapacity: row.resource.defaultCapacity }
      : null,
    prices: row.prices.map((p) => ({
      code: p.code,
      amountCents: toCents(p.amount),
      currency: p.currency,
    })),
    hasConfig: Boolean(row.partyConfig),
    config: effective,
    depositPreviewCents:
      effective.basePriceCents != null
        ? computeDepositRequiredCents(
            effective.basePriceCents,
            {
              depositFixedCentsOverride: effective.depositFixedCentsOverride,
              depositPercentOverride: effective.depositPercentOverride,
            },
            settings
          )
        : 0,
    addOns: row.parentLinks
      .filter((l) => l.addOnProduct && l.addOnProduct.type === "add_on")
      .map((l) => ({
        productId: l.addOnProductId,
        name: l.addOnProduct.name,
        required: l.required,
        maxQty: l.maxQty,
        published: l.addOnProduct.published,
        archived: Boolean(l.addOnProduct.archivedAt),
        priceCents: l.addOnProduct.prices[0] ? toCents(l.addOnProduct.prices[0].amount) : null,
      })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type PackageInput = {
  name?: string;
  description?: string | null;
  images?: string[];
  minGuests?: number | null;
  maxGuests?: number | null;
  durationMinutes?: number | null;
  includedKids?: number | null;
  includedAdults?: number | null;
  extraKidPriceCents?: number | null;
  extraAdultPriceCents?: number | null;
  packagePriceCents?: number | null;
  roomResourceId?: string | null;
  roomAssignedAtBooking?: boolean;
  depositPercentOverride?: number | null;
  depositFixedCentsOverride?: number | null;
  includesFood?: boolean;
  defaultMenuItemIds?: string[];
  addOns?: Array<{ productId: string; required?: boolean; maxQty?: number | null }>;
  newAddOns?: Array<{ name: string; priceCents: number }>;
  published?: boolean;
  waiverRequired?: boolean;
};

function optInt(raw: unknown, field: string, fields: Record<string, string>, min = 0): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    fields[field] = `Must be a whole number of ${min} or more`;
    return undefined;
  }
  return n;
}

function parsePackageInput(b: Record<string, unknown>): PackageInput {
  const fields: Record<string, string> = {};
  const out: PackageInput = {};
  if (b.name !== undefined) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (name.length < 2) fields.name = "Name is required";
    else if (name.length > 160) fields.name = "Name is too long";
    else out.name = name;
  }
  if (b.description !== undefined) {
    out.description = typeof b.description === "string" && b.description.trim() ? b.description.trim() : null;
  }
  if (Array.isArray(b.images)) out.images = b.images.map(String).slice(0, 12);
  out.minGuests = optInt(b.minGuests, "minGuests", fields);
  out.maxGuests = optInt(b.maxGuests, "maxGuests", fields, 1);
  out.durationMinutes = optInt(b.durationMinutes, "durationMinutes", fields, 15);
  out.includedKids = optInt(b.includedKids, "includedKids", fields);
  out.includedAdults = optInt(b.includedAdults, "includedAdults", fields);
  out.extraKidPriceCents = optInt(b.extraKidPriceCents, "extraKidPriceCents", fields);
  out.extraAdultPriceCents = optInt(b.extraAdultPriceCents, "extraAdultPriceCents", fields);
  out.packagePriceCents = optInt(b.packagePriceCents, "packagePriceCents", fields, 1);
  out.depositFixedCentsOverride = optInt(b.depositFixedCentsOverride, "depositFixedCentsOverride", fields);
  if (b.depositPercentOverride !== undefined) {
    if (b.depositPercentOverride === null || b.depositPercentOverride === "") {
      out.depositPercentOverride = null;
    } else {
      const n = Number(b.depositPercentOverride);
      if (!Number.isFinite(n) || n < 0 || n > 100) fields.depositPercentOverride = "Must be between 0 and 100";
      else out.depositPercentOverride = Math.round(n * 100) / 100;
    }
  }
  if (out.depositPercentOverride != null && out.depositFixedCentsOverride != null) {
    fields.depositFixedCentsOverride = "Use a deposit percent or a fixed amount, not both";
  }
  if (b.roomResourceId !== undefined) {
    if (b.roomResourceId === null || b.roomResourceId === "") out.roomResourceId = null;
    else if (typeof b.roomResourceId === "string" && isValidId(b.roomResourceId)) {
      out.roomResourceId = b.roomResourceId;
    } else fields.roomResourceId = "Choose a party room";
  }
  if (b.roomAssignedAtBooking !== undefined) out.roomAssignedAtBooking = Boolean(b.roomAssignedAtBooking);
  if (b.includesFood !== undefined) out.includesFood = Boolean(b.includesFood);
  if (b.published !== undefined) out.published = Boolean(b.published);
  if (b.waiverRequired !== undefined) out.waiverRequired = Boolean(b.waiverRequired);
  if (Array.isArray(b.defaultMenuItemIds)) {
    out.defaultMenuItemIds = b.defaultMenuItemIds.map(String).filter((id) => isValidId(id));
  }
  if (Array.isArray(b.addOns)) {
    out.addOns = b.addOns
      .map((raw) => raw as Record<string, unknown>)
      .filter((a) => typeof a.productId === "string" && isValidId(a.productId))
      .map((a) => ({
        productId: String(a.productId),
        required: Boolean(a.required),
        maxQty: a.maxQty == null || a.maxQty === "" ? null : Math.max(1, Math.floor(Number(a.maxQty))),
      }));
  }
  if (Array.isArray(b.newAddOns)) {
    out.newAddOns = [];
    b.newAddOns.forEach((raw, i) => {
      const a = raw as Record<string, unknown>;
      const name = typeof a.name === "string" ? a.name.trim() : "";
      const priceCents = Number(a.priceCents);
      if (name.length < 2 || !Number.isInteger(priceCents) || priceCents < 1) {
        fields[`newAddOns.${i}`] = "New add-ons need a name and a price above 0";
      } else out.newAddOns!.push({ name, priceCents });
    });
  }
  if (Object.keys(fields).length) throw new PartyValidationError(PARTY_PACKAGE_INVALID, fields);
  return out;
}

/** Publish rules: duration, max guests, included kids/adults, a price band, a room or assign-at-booking. */
function assertPublishable(state: {
  durationMinutes: number | null | undefined;
  maxGuests: number | null | undefined;
  minGuests: number | null | undefined;
  includedKids: number | null | undefined;
  includedAdults: number | null | undefined;
  packagePriceCents: number | null | undefined;
  roomResourceId: string | null | undefined;
  roomAssignedAtBooking: boolean;
}) {
  const fields: Record<string, string> = {};
  if (!state.durationMinutes || state.durationMinutes <= 0) fields.durationMinutes = "Set the party duration";
  if (!state.maxGuests || state.maxGuests <= 0) fields.maxGuests = "Set the maximum guests";
  if (state.includedKids == null) fields.includedKids = "Set how many kids are included";
  if (state.includedAdults == null) fields.includedAdults = "Set how many adults are included";
  if (!state.packagePriceCents || state.packagePriceCents <= 0) fields.packagePriceCents = "Set the package price";
  if (!state.roomResourceId && !state.roomAssignedAtBooking) {
    fields.roomResourceId = "Choose a party room or mark the room as assigned at booking";
  }
  if (state.minGuests != null && state.maxGuests != null && state.minGuests > state.maxGuests) {
    fields.minGuests = "Minimum guests cannot exceed maximum guests";
  }
  if (
    state.maxGuests != null &&
    state.includedKids != null &&
    state.includedAdults != null &&
    state.includedKids + state.includedAdults > state.maxGuests
  ) {
    fields.includedKids = "Included kids plus adults cannot exceed maximum guests";
  }
  if (Object.keys(fields).length) throw new PartyValidationError(PARTY_PACKAGE_INVALID, fields);
}

async function loadPackage(orgId: string, productId: string) {
  if (!isValidId(productId)) throw partyNotFound();
  const row = await prisma.admissionProduct.findFirst({
    where: { id: productId, orgId, type: "party_package" },
    include: packageInclude,
  });
  if (!row) throw partyNotFound();
  return row;
}

export async function listPartyPackages(
  actor: PartyActor,
  opts: { locationId?: string | null; status?: string | null } = {}
) {
  const ctx = await partyStaffContext(actor);
  const status = (opts.status ?? "").trim();
  const where: Prisma.AdmissionProductWhereInput = {
    orgId: ctx.orgId,
    type: "party_package",
    ...partyLocationWhere(ctx.scope, opts.locationId),
  };
  if (status === "published") Object.assign(where, { published: true, archivedAt: null });
  else if (status === "draft") Object.assign(where, { published: false, archivedAt: null });
  else if (status === "archived") Object.assign(where, { archivedAt: { not: null } });
  else if (status !== "all") Object.assign(where, { archivedAt: null });
  const rows = await prisma.admissionProduct.findMany({
    where,
    include: packageInclude,
    orderBy: [{ locationId: "asc" }, { name: "asc" }],
  });
  const settingsByLocation = new Map<string, PartySettingsValues>();
  for (const id of new Set(rows.map((r) => r.locationId))) {
    settingsByLocation.set(id, await resolvePartySettings(ctx.orgId, id));
  }
  return rows.map((r) => toPartyPackageDto(r, settingsByLocation.get(r.locationId)!));
}

export async function getPartyPackage(actor: PartyActor, productId: string) {
  const ctx = await partyStaffContext(actor);
  const row = await loadPackage(ctx.orgId, productId);
  if (!locationInPartyScope(ctx.scope, row.locationId)) throw partyNotFound();
  return toPartyPackageDto(row, await resolvePartySettings(ctx.orgId, row.locationId));
}

async function syncBands(
  tx: Prisma.TransactionClient,
  product: { id: string; orgId: string; locationId: string },
  bands: Array<{ code: string; cents: number | null | undefined }>
) {
  for (const band of bands) {
    if (band.cents === undefined) continue;
    if (band.cents == null || band.cents <= 0) {
      await tx.admissionProductPrice.deleteMany({ where: { productId: product.id, code: band.code } });
      continue;
    }
    await tx.admissionProductPrice.upsert({
      where: { productId_code: { productId: product.id, code: band.code } },
      create: {
        orgId: product.orgId,
        locationId: product.locationId,
        productId: product.id,
        code: band.code,
        amount: new Decimal(band.cents / 100),
      },
      update: { amount: new Decimal(band.cents / 100) },
    });
  }
}

async function syncAddOns(
  tx: Prisma.TransactionClient,
  product: { id: string; orgId: string; locationId: string },
  input: PackageInput
) {
  const links: Array<{ productId: string; required: boolean; maxQty: number | null }> = [
    ...(input.addOns ?? []).map((a) => ({ ...a, required: Boolean(a.required), maxQty: a.maxQty ?? null })),
  ];
  for (const fresh of input.newAddOns ?? []) {
    const created = await tx.admissionProduct.create({
      data: {
        orgId: product.orgId,
        locationId: product.locationId,
        type: "add_on",
        name: fresh.name,
        published: true,
        prices: {
          create: {
            orgId: product.orgId,
            locationId: product.locationId,
            code: "each",
            amount: new Decimal(fresh.priceCents / 100),
          },
        },
      },
      select: { id: true },
    });
    links.push({ productId: created.id, required: false, maxQty: null });
  }
  if (input.addOns === undefined && !input.newAddOns?.length) return;
  const ids = links.map((l) => l.productId);
  const valid = await tx.admissionProduct.findMany({
    where: {
      id: { in: ids },
      orgId: product.orgId,
      locationId: product.locationId,
      type: "add_on",
      archivedAt: null,
    },
    select: { id: true },
  });
  const validIds = new Set(valid.map((v) => v.id));
  const bad = ids.find((id) => !validIds.has(id));
  if (bad) {
    throw new PartyValidationError(PARTY_PACKAGE_INVALID, {
      addOns: "Add-ons must be active add-on products at the same venue",
    });
  }
  if (input.addOns !== undefined) {
    await tx.admissionAddOnLink.deleteMany({
      where: { parentProductId: product.id, addOnProductId: { notIn: ids } },
    });
  }
  for (const link of links) {
    await tx.admissionAddOnLink.upsert({
      where: {
        parentProductId_addOnProductId: {
          parentProductId: product.id,
          addOnProductId: link.productId,
        },
      },
      create: {
        orgId: product.orgId,
        locationId: product.locationId,
        parentProductId: product.id,
        addOnProductId: link.productId,
        required: link.required,
        maxQty: link.maxQty,
      },
      update: { required: link.required, maxQty: link.maxQty },
    });
  }
}

async function validateMenuIds(orgId: string, locationId: string, ids: string[] | undefined) {
  if (!ids?.length) return;
  const count = await prisma.partyMenuItem.count({
    where: { id: { in: ids }, orgId, locationId, archivedAt: null },
  });
  if (count !== new Set(ids).size) {
    throw new PartyValidationError(PARTY_PACKAGE_INVALID, {
      defaultMenuItemIds: "Default menu items must be active items at the same venue",
    });
  }
}

export async function createPartyPackage(actor: PartyActor, raw: unknown) {
  const ctx = await partyStaffContext(actor);
  const body = rejectBodyOrgId(raw);
  const locationId = await resolvePartyLocationId(actor, ctx.scope, body.locationId);
  await assertVenueWritable(ctx.orgId, locationId);
  const input = parsePackageInput(body);
  if (!input.name) throw new PartyValidationError(PARTY_PACKAGE_INVALID, { name: "Name is required" });
  const settings = await resolvePartySettings(ctx.orgId, locationId);
  if (input.roomResourceId) await requireAssignableRoom(ctx.orgId, locationId, input.roomResourceId);
  await validateMenuIds(ctx.orgId, locationId, input.defaultMenuItemIds);
  const durationMinutes =
    input.durationMinutes === undefined ? settings.defaultPartyDurationMinutes : input.durationMinutes;
  const includedKids = input.includedKids ?? null;
  const includedAdults =
    input.includedAdults === undefined ? settings.defaultIncludedAdults : input.includedAdults;
  if (input.published) {
    assertPublishable({
      durationMinutes,
      maxGuests: input.maxGuests,
      minGuests: input.minGuests,
      includedKids,
      includedAdults,
      packagePriceCents: input.packagePriceCents,
      roomResourceId: input.roomResourceId,
      roomAssignedAtBooking: Boolean(input.roomAssignedAtBooking),
    });
  }

  const productId = await prisma.$transaction(async (tx) => {
    const product = await tx.admissionProduct.create({
      data: {
        orgId: ctx.orgId,
        locationId,
        type: "party_package",
        name: input.name!,
        description: input.description ?? null,
        images: input.images ?? [],
        resourceId: input.roomResourceId ?? null,
        published: Boolean(input.published),
        waiverRequired: Boolean(input.waiverRequired),
        minGuests: input.minGuests ?? null,
        maxGuests: input.maxGuests ?? null,
      },
      select: { id: true, orgId: true, locationId: true },
    });
    await tx.partyPackageConfig.create({
      data: {
        orgId: ctx.orgId,
        locationId,
        productId: product.id,
        durationMinutes: durationMinutes ?? settings.defaultPartyDurationMinutes,
        includedKids: includedKids ?? 0,
        includedAdults: includedAdults ?? 0,
        extraKidPriceCents: input.extraKidPriceCents ?? null,
        extraAdultPriceCents: input.extraAdultPriceCents ?? null,
        roomResourceId: input.roomResourceId ?? null,
        roomAssignedAtBooking: Boolean(input.roomAssignedAtBooking),
        depositPercentOverride:
          input.depositPercentOverride != null ? new Decimal(input.depositPercentOverride) : null,
        depositFixedCentsOverride: input.depositFixedCentsOverride ?? null,
        includesFood: Boolean(input.includesFood),
        defaultMenuItemIds: (input.defaultMenuItemIds ?? []) as Prisma.InputJsonValue,
      },
    });
    await syncBands(tx, product, [
      { code: PARTY_BASE_BAND, cents: input.packagePriceCents },
      { code: PARTY_EXTRA_KID_BAND, cents: input.extraKidPriceCents },
      { code: PARTY_EXTRA_ADULT_BAND, cents: input.extraAdultPriceCents },
    ]);
    await syncAddOns(tx, product, input);
    return product.id;
  });

  logPartyAudit(actor, ctx.orgId, {
    action: "parties.package.create",
    entityType: "AdmissionProduct",
    entityId: productId,
    description: `Party package ${input.name} created`,
    metadata: { locationId, published: Boolean(input.published) },
  });
  return getPartyPackage(actor, productId);
}

export async function updatePartyPackage(actor: PartyActor, productId: string, raw: unknown) {
  const ctx = await partyStaffContext(actor);
  const body = rejectBodyOrgId(raw);
  if (body.locationId !== undefined) {
    throw new PartyValidationError(PARTY_PACKAGE_INVALID, {
      locationId: "A package cannot move to another venue",
    });
  }
  const existing = await loadPackage(ctx.orgId, productId);
  if (!locationInPartyScope(ctx.scope, existing.locationId)) throw partyNotFound();
  if (existing.archivedAt && body.unarchive !== true) {
    throw new TicketingError(PARTY_PACKAGE_INVALID, 400);
  }
  await assertVenueWritable(ctx.orgId, existing.locationId);
  const input = parsePackageInput(body);
  const settings = await resolvePartySettings(ctx.orgId, existing.locationId);
  const current = effectivePackageConfig(existing, settings);
  if (input.roomResourceId) {
    await requireAssignableRoom(ctx.orgId, existing.locationId, input.roomResourceId);
  }
  await validateMenuIds(ctx.orgId, existing.locationId, input.defaultMenuItemIds);

  const next = {
    durationMinutes:
      input.durationMinutes === undefined ? current.durationMinutes : input.durationMinutes,
    maxGuests: input.maxGuests !== undefined ? input.maxGuests : existing.maxGuests,
    minGuests: input.minGuests !== undefined ? input.minGuests : existing.minGuests,
    includedKids:
      input.includedKids !== undefined
        ? input.includedKids
        : existing.partyConfig
          ? existing.partyConfig.includedKids
          : null,
    includedAdults: input.includedAdults !== undefined ? input.includedAdults : current.includedAdults,
    packagePriceCents:
      input.packagePriceCents !== undefined ? input.packagePriceCents : current.basePriceCents,
    roomResourceId: input.roomResourceId !== undefined ? input.roomResourceId : current.roomResourceId,
    roomAssignedAtBooking: input.roomAssignedAtBooking ?? current.roomAssignedAtBooking,
  };
  const willPublish = input.published ?? (existing.published && !existing.archivedAt);
  if (willPublish) assertPublishable(next);

  await prisma.$transaction(async (tx) => {
    await tx.admissionProduct.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.images !== undefined ? { images: input.images } : {}),
        ...(input.minGuests !== undefined ? { minGuests: input.minGuests } : {}),
        ...(input.maxGuests !== undefined ? { maxGuests: input.maxGuests } : {}),
        ...(input.waiverRequired !== undefined ? { waiverRequired: input.waiverRequired } : {}),
        ...(input.roomResourceId !== undefined ? { resourceId: input.roomResourceId } : {}),
        published: Boolean(willPublish),
        ...(body.unarchive === true ? { archivedAt: null } : {}),
      },
    });
    const configData = {
      durationMinutes: next.durationMinutes ?? current.durationMinutes,
      includedKids: next.includedKids ?? 0,
      includedAdults: next.includedAdults ?? 0,
      roomResourceId: next.roomResourceId,
      roomAssignedAtBooking: next.roomAssignedAtBooking,
      ...(input.extraKidPriceCents !== undefined ? { extraKidPriceCents: input.extraKidPriceCents } : {}),
      ...(input.extraAdultPriceCents !== undefined
        ? { extraAdultPriceCents: input.extraAdultPriceCents }
        : {}),
      ...(input.depositPercentOverride !== undefined
        ? {
            depositPercentOverride:
              input.depositPercentOverride != null ? new Decimal(input.depositPercentOverride) : null,
          }
        : {}),
      ...(input.depositFixedCentsOverride !== undefined
        ? { depositFixedCentsOverride: input.depositFixedCentsOverride }
        : {}),
      ...(input.includesFood !== undefined ? { includesFood: input.includesFood } : {}),
      ...(input.defaultMenuItemIds !== undefined
        ? { defaultMenuItemIds: input.defaultMenuItemIds as Prisma.InputJsonValue }
        : {}),
    };
    await tx.partyPackageConfig.upsert({
      where: { productId: existing.id },
      create: {
        orgId: ctx.orgId,
        locationId: existing.locationId,
        productId: existing.id,
        extraKidPriceCents: current.extraKidPriceCents,
        extraAdultPriceCents: current.extraAdultPriceCents,
        ...configData,
      },
      update: configData,
    });
    await syncBands(tx, existing, [
      { code: PARTY_BASE_BAND, cents: input.packagePriceCents },
      { code: PARTY_EXTRA_KID_BAND, cents: input.extraKidPriceCents },
      { code: PARTY_EXTRA_ADULT_BAND, cents: input.extraAdultPriceCents },
    ]);
    await syncAddOns(tx, existing, input);
  });

  logPartyAudit(actor, ctx.orgId, {
    action: "parties.package.update",
    entityType: "AdmissionProduct",
    entityId: existing.id,
    description: `Party package ${input.name ?? existing.name} updated`,
    metadata: { locationId: existing.locationId, published: Boolean(willPublish) },
  });
  return getPartyPackage(actor, existing.id);
}

export async function archivePartyPackage(actor: PartyActor, productId: string) {
  const ctx = await partyStaffContext(actor);
  const existing = await loadPackage(ctx.orgId, productId);
  if (!locationInPartyScope(ctx.scope, existing.locationId)) throw partyNotFound();
  await prisma.admissionProduct.update({
    where: { id: existing.id },
    data: { archivedAt: existing.archivedAt ?? new Date(), published: false },
  });
  logPartyAudit(actor, ctx.orgId, {
    action: "parties.package.archive",
    entityType: "AdmissionProduct",
    entityId: existing.id,
    description: `Party package ${existing.name} archived`,
    metadata: { locationId: existing.locationId },
  });
  return getPartyPackage(actor, existing.id);
}

export async function listPartyPackageSessions(
  actor: PartyActor,
  productId: string,
  opts: { from?: string; to?: string; includeClosed?: boolean } = {}
) {
  const ctx = await partyStaffContext(actor);
  const pkg = await loadPackage(ctx.orgId, productId);
  if (!locationInPartyScope(ctx.scope, pkg.locationId)) throw partyNotFound();
  return listTicketSessions(actor, {
    productId: pkg.id,
    from: opts.from,
    to: opts.to,
    includeClosed: opts.includeClosed,
  });
}

/**
 * Body: { startsAt, endsAt?, capacity?, label?, weekdays?, untilDate? }.
 * endsAt defaults to startsAt + package duration; capacity counts parties per slot.
 */
export async function createPartyPackageSessions(actor: PartyActor, productId: string, raw: unknown) {
  const ctx = await partyStaffContext(actor);
  const body = rejectBodyOrgId(raw);
  const pkg = await loadPackage(ctx.orgId, productId);
  if (!locationInPartyScope(ctx.scope, pkg.locationId)) throw partyNotFound();
  if (pkg.archivedAt) throw new TicketingError(PARTY_PACKAGE_INVALID, 400);
  await assertVenueWritable(ctx.orgId, pkg.locationId);
  const settings = await resolvePartySettings(ctx.orgId, pkg.locationId);
  const effective = effectivePackageConfig(pkg, settings);
  const startsAt = new Date(String(body.startsAt ?? ""));
  if (Number.isNaN(startsAt.getTime())) throw new Error("startsAt is required");
  const endsAt = body.endsAt
    ? new Date(String(body.endsAt))
    : new Date(startsAt.getTime() + effective.durationMinutes * 60_000);
  if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new Error("endsAt must be after startsAt");
  }
  const capacity = body.capacity == null || body.capacity === "" ? 1 : Number(body.capacity);
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("capacity must be 1 or more");
  const base = {
    productId: pkg.id,
    resourceId: effective.roomAssignedAtBooking ? null : effective.roomResourceId,
    label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : null,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    capacity,
  };
  const weekdays = Array.isArray(body.weekdays) ? body.weekdays.map((d) => Number(d)) : [];
  if (weekdays.length) {
    const untilDate = String(body.untilDate ?? "");
    if (!untilDate) throw new Error("untilDate is required for a weekday series");
    return createTicketSessionSeries(actor, { ...base, weekdays, untilDate });
  }
  return [await createTicketSession(actor, base)];
}

export { loadPackage as loadPartyPackageRow, packageInclude as partyPackageInclude };

/** Engine / public: a party package that may be booked now. */
export async function requireBookablePackage(
  orgId: string,
  locationId: string,
  productId: string
): Promise<PartyPackageRow> {
  if (!isValidId(productId)) throw partyNotFound();
  const row = await prisma.admissionProduct.findFirst({
    where: { id: productId, orgId, type: "party_package" },
    include: packageInclude,
  });
  if (!row || row.locationId !== locationId) throw partyNotFound();
  if (row.archivedAt || !row.published) throw new TicketingError(PARTY_PACKAGE_INVALID, 400);
  return row;
}

export function packageLocationTimezone(row: PartyPackageRow): string | null {
  return row.location?.timezone ?? null;
}

export function packageBaseCents(row: PartyPackageRow): number {
  const base = basePriceBand(row.prices);
  return base ? toCents(base.amount) : 0;
}
