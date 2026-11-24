import prisma from "@/lib/prisma";
import type { PosSettings } from "@prisma/client";
import { requirePosVenue, type PosActor } from "@/lib/pos/scope";
import { ensurePosCashierRoleTemplate } from "@/lib/pos/cashierRoleTemplate";

const DEFAULTS = {
  captureGuestPostcode: false,
  postcodeRequired: false,
  requireGuestOnSale: false,
  allowOpenPrice: true,
  allowParkedCarts: true,
  allowUnpaidBookings: true,
  paidRequiredForRedeem: true,
  defaultReceiptEmail: true,
  printTicketsOnSale: true,
  showExpectedTillTotals: true,
  tipPromptEnabled: true,
  tipSuggestedPercents: [15, 18, 20] as number[],
  managerPinRequiredForDiscount: true,
  managerPinRequiredForRefund: true,
  managerPinRequiredForVoid: true,
  managerPinRequiredForWastage: true,
  offlineEnabled: true,
  cashRequiresOpenTill: true,
  lateRedemptionGraceMinutes: 0,
  allowPastDateRedemption: false,
  bannedGuestPrompt: true,
};

export type PosSettingsDto = typeof DEFAULTS & {
  id: string;
  orgId: string;
  locationId: string | null;
  hasManagerOverridePin: boolean;
};

function percents(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULTS.tipSuggestedPercents];
  const nums = value
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 100);
  return nums.length ? nums : [...DEFAULTS.tipSuggestedPercents];
}

export function toSettingsDto(row: PosSettings): PosSettingsDto {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    captureGuestPostcode: row.captureGuestPostcode,
    postcodeRequired: row.postcodeRequired,
    requireGuestOnSale: row.requireGuestOnSale,
    allowOpenPrice: row.allowOpenPrice,
    allowParkedCarts: row.allowParkedCarts,
    allowUnpaidBookings: row.allowUnpaidBookings,
    paidRequiredForRedeem: row.paidRequiredForRedeem,
    defaultReceiptEmail: row.defaultReceiptEmail,
    printTicketsOnSale: row.printTicketsOnSale,
    showExpectedTillTotals: row.showExpectedTillTotals,
    tipPromptEnabled: row.tipPromptEnabled,
    tipSuggestedPercents: percents(row.tipSuggestedPercents),
    managerPinRequiredForDiscount: row.managerPinRequiredForDiscount,
    managerPinRequiredForRefund: row.managerPinRequiredForRefund,
    managerPinRequiredForVoid: row.managerPinRequiredForVoid,
    managerPinRequiredForWastage: row.managerPinRequiredForWastage,
    offlineEnabled: row.offlineEnabled,
    cashRequiresOpenTill: row.cashRequiresOpenTill,
    lateRedemptionGraceMinutes: row.lateRedemptionGraceMinutes,
    allowPastDateRedemption: row.allowPastDateRedemption,
    bannedGuestPrompt: row.bannedGuestPrompt,
    hasManagerOverridePin: Boolean(row.managerOverridePinHash),
  };
}

export async function resolvePosSettings(
  orgId: string,
  locationId: string | null
): Promise<PosSettings> {
  if (locationId) {
    const venueRow = await prisma.posSettings.findFirst({
      where: { orgId, locationId },
    });
    if (venueRow) return venueRow;
  }
  const orgRow = await prisma.posSettings.findFirst({
    where: { orgId, locationId: null },
  });
  if (orgRow) return orgRow;
  return prisma.posSettings.create({
    data: {
      orgId,
      locationId: null,
      tipSuggestedPercents: DEFAULTS.tipSuggestedPercents,
    },
  });
}

export async function getPosSettings(actor: PosActor, locationId: string | null) {
  const orgId = locationId
    ? (await requirePosVenue(actor, locationId)).orgId
    : (await requirePosVenue(actor, await fallbackLocation(actor))).orgId;
  await ensurePosCashierRoleTemplate(orgId);
  const row = await resolvePosSettings(orgId, locationId);
  return toSettingsDto(row);
}

async function fallbackLocation(actor: PosActor): Promise<string> {
  const { assertPosStaff } = await import("@/lib/pos/scope");
  const orgId = await assertPosStaff(actor);
  const venue = await prisma.venueLocation.findFirst({
    where: { orgId, status: "active" },
    select: { id: true },
  });
  if (!venue) {
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    throw new ForbiddenError("Venue location is required");
  }
  return venue.id;
}

const BOOL_KEYS = [
  "captureGuestPostcode",
  "postcodeRequired",
  "requireGuestOnSale",
  "allowOpenPrice",
  "allowParkedCarts",
  "allowUnpaidBookings",
  "paidRequiredForRedeem",
  "defaultReceiptEmail",
  "printTicketsOnSale",
  "showExpectedTillTotals",
  "tipPromptEnabled",
  "managerPinRequiredForDiscount",
  "managerPinRequiredForRefund",
  "managerPinRequiredForVoid",
  "managerPinRequiredForWastage",
  "offlineEnabled",
  "cashRequiresOpenTill",
  "allowPastDateRedemption",
  "bannedGuestPrompt",
] as const;

export async function putPosSettings(
  actor: PosActor,
  locationId: string | null,
  body: Record<string, unknown>
) {
  const orgId = locationId
    ? (await requirePosVenue(actor, locationId)).orgId
    : (await requirePosVenue(actor, await fallbackLocation(actor))).orgId;
  const data: Record<string, unknown> = {};
  for (const key of BOOL_KEYS) {
    if (typeof body[key] === "boolean") data[key] = body[key];
  }
  if (body.lateRedemptionGraceMinutes != null) {
    const n = Number(body.lateRedemptionGraceMinutes);
    if (Number.isFinite(n) && n >= 0) data.lateRedemptionGraceMinutes = Math.floor(n);
  }
  if (Array.isArray(body.tipSuggestedPercents)) {
    data.tipSuggestedPercents = percents(body.tipSuggestedPercents);
  }
  const existing = await prisma.posSettings.findFirst({
    where: { orgId, locationId },
  });
  const row = existing
    ? await prisma.posSettings.update({ where: { id: existing.id }, data })
    : await prisma.posSettings.create({
        data: {
          orgId,
          locationId,
          tipSuggestedPercents: DEFAULTS.tipSuggestedPercents,
          ...data,
        },
      });
  return toSettingsDto(row);
}
