/**
 * Party price plan: package band + extra kids/adults bands + add-ons + food,
 * taxed with the booking tax helper (TaxSettings). The plan's lines are what
 * the booking engine prices, so preview and booking totals use the same bands.
 */
import type { BookingLineInput, CustomLineInput } from "@/lib/ticketing/bookingEngine";
import prisma from "@/lib/prisma";
import { previewBookingTax } from "@/lib/ticketing/tax";
import {
  TicketingError,
  PARTY_COUNTS_INVALID,
  PARTY_PACKAGE_INVALID,
} from "@/lib/parties/errors";
import {
  PARTY_EXTRA_ADULT_BAND,
  PARTY_EXTRA_KID_BAND,
  type EffectivePackageConfig,
  type PartyPackageRow,
} from "@/lib/parties/packages";
import { computeDepositRequiredCents, fromCents, toCents } from "@/lib/parties/deposits";
import type { PartySettingsValues } from "@/lib/parties/settings";

export type PartyFoodLineInput = {
  name: string;
  qty: number;
  unitPriceCents: number;
};

export type PartyPricePreview = {
  packageCents: number;
  includedKids: number;
  includedAdults: number;
  extraKids: number;
  extraKidUnitCents: number;
  extraAdults: number;
  extraAdultUnitCents: number;
  addOnCents: number;
  foodCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  depositRequiredCents: number;
};

/** S1-F3 count rules. Room defaultCapacity is a headcount cap. */
export function assertPartyCounts(opts: {
  kidCount: number;
  adultCount: number;
  minGuests: number | null;
  maxGuests: number | null;
  roomCapacity?: number | null;
}) {
  const { kidCount, adultCount } = opts;
  if (!Number.isInteger(kidCount) || kidCount < 0 || !Number.isInteger(adultCount) || adultCount < 0) {
    throw new TicketingError(PARTY_COUNTS_INVALID, 400);
  }
  if (kidCount < 1 && opts.minGuests !== 0) {
    throw new TicketingError(PARTY_COUNTS_INVALID, 400);
  }
  const heads = kidCount + adultCount;
  if (opts.minGuests != null && heads < opts.minGuests) {
    throw new TicketingError(PARTY_COUNTS_INVALID, 400);
  }
  if (opts.maxGuests != null && heads > opts.maxGuests) {
    throw new TicketingError(PARTY_COUNTS_INVALID, 400);
  }
  if (opts.roomCapacity != null && opts.roomCapacity > 0 && heads > opts.roomCapacity) {
    throw new TicketingError(PARTY_COUNTS_INVALID, 400);
  }
}

export async function buildPartyPricePlan(opts: {
  orgId: string;
  pkg: PartyPackageRow;
  effective: EffectivePackageConfig;
  settings: PartySettingsValues;
  sessionId: string;
  roomResourceId: string | null;
  visitStartsAt: Date;
  kidCount: number;
  adultCount: number;
  addOns?: Array<{ productId: string; qty?: number }>;
  food?: PartyFoodLineInput[];
  taxExempt?: boolean;
}): Promise<{
  lines: BookingLineInput[];
  customLines: CustomLineInput[];
  preview: PartyPricePreview;
}> {
  const { pkg, effective } = opts;
  if (!effective.basePriceBand || effective.basePriceCents == null || effective.basePriceCents <= 0) {
    throw new TicketingError(PARTY_PACKAGE_INVALID, 400);
  }
  const visitDate = opts.visitStartsAt.toISOString();
  const lines: BookingLineInput[] = [
    {
      productId: pkg.id,
      priceBandCode: effective.basePriceBand,
      qty: 1,
      sessionId: opts.sessionId,
      resourceId: opts.roomResourceId,
    },
  ];

  const extraKids = Math.max(0, opts.kidCount - effective.includedKids);
  const extraAdults = Math.max(0, opts.adultCount - effective.includedAdults);
  const extraKidUnit = effective.extraKidPriceCents;
  const extraAdultUnit = effective.extraAdultPriceCents;
  if (extraKids > 0) {
    if (extraKidUnit == null) throw new TicketingError(PARTY_COUNTS_INVALID, 400);
    if (extraKidUnit > 0) {
      lines.push({
        productId: pkg.id,
        priceBandCode: PARTY_EXTRA_KID_BAND,
        qty: extraKids,
        visitDate,
        resourceId: opts.roomResourceId,
      });
    }
  }
  if (extraAdults > 0) {
    if (extraAdultUnit == null) throw new TicketingError(PARTY_COUNTS_INVALID, 400);
    if (extraAdultUnit > 0) {
      lines.push({
        productId: pkg.id,
        priceBandCode: PARTY_EXTRA_ADULT_BAND,
        qty: extraAdults,
        visitDate,
        resourceId: opts.roomResourceId,
      });
    }
  }

  let addOnCents = 0;
  const addOnInputs = (opts.addOns ?? []).filter((a) => a.productId);
  if (addOnInputs.length) {
    const linked = new Map(
      pkg.parentLinks
        .filter((l) => l.addOnProduct?.type === "add_on" && !l.addOnProduct.archivedAt)
        .map((l) => [l.addOnProductId, l])
    );
    const merged = new Map<string, number>();
    for (const a of addOnInputs) {
      const qty = Math.max(1, Math.floor(Number(a.qty ?? 1)));
      merged.set(a.productId, (merged.get(a.productId) ?? 0) + qty);
    }
    const products = await prisma.admissionProduct.findMany({
      where: { id: { in: [...merged.keys()] }, orgId: opts.orgId, locationId: pkg.locationId, type: "add_on" },
      include: { prices: { orderBy: { amount: "asc" } } },
    });
    for (const [productId, qty] of merged) {
      const link = linked.get(productId);
      const product = products.find((p) => p.id === productId);
      if (!link || !product || !product.prices.length) {
        throw new Error("Add-on is not available for this party package");
      }
      if (link.maxQty != null && qty > link.maxQty) {
        throw new Error(`Add-on quantity exceeds max (${link.maxQty})`);
      }
      const band = product.prices[0]!;
      addOnCents += toCents(band.amount) * qty;
      lines.push({ productId, priceBandCode: band.code, qty, visitDate });
    }
  }

  const customLines: CustomLineInput[] = (opts.food ?? []).map((f) => ({
    productName: `Party food: ${f.name}`,
    priceBandCode: "party_food",
    qty: f.qty,
    unitPrice: fromCents(f.unitPriceCents),
    visitDate: opts.visitStartsAt,
  }));
  const foodCents = (opts.food ?? []).reduce((s, f) => s + f.unitPriceCents * f.qty, 0);

  const extraKidCents = extraKids * (extraKidUnit ?? 0);
  const extraAdultCents = extraAdults * (extraAdultUnit ?? 0);
  const subtotalCents =
    effective.basePriceCents + extraKidCents + extraAdultCents + addOnCents + foodCents;
  const tax = await previewBookingTax({
    orgId: opts.orgId,
    subtotal: fromCents(subtotalCents),
    taxExempt: opts.taxExempt,
  });
  const totalCents = toCents(tax.total);
  const depositRequiredCents = computeDepositRequiredCents(
    totalCents,
    {
      depositFixedCentsOverride: effective.depositFixedCentsOverride,
      depositPercentOverride: effective.depositPercentOverride,
    },
    opts.settings
  );

  return {
    lines,
    customLines,
    preview: {
      packageCents: effective.basePriceCents,
      includedKids: effective.includedKids,
      includedAdults: effective.includedAdults,
      extraKids,
      extraKidUnitCents: extraKidUnit ?? 0,
      extraAdults,
      extraAdultUnitCents: extraAdultUnit ?? 0,
      addOnCents,
      foodCents,
      subtotalCents,
      taxCents: toCents(tax.taxAmount),
      totalCents,
      depositRequiredCents,
    },
  };
}
