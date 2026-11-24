/**
 * MembershipPlan merchandising parsers (ROLLER create-membership field map).
 */
import type { MembershipIntervalUnit, MembershipPlanType } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import {
  MEMBERSHIP_INTERVAL_UNITS,
  MEMBERSHIP_PLAN_TYPES,
  type MembershipPlanVariation,
} from "@/lib/memberships/types";
import { sanitizeAlternateAddressForWrite } from "@/lib/memberships/alternateAddress";
import {
  sanitizeCancellationTermsForWrite,
  sanitizeInstructionsForWrite,
  sanitizeTermsAndConditionsForWrite,
} from "@/lib/memberships/richText";
import { sanitizeReportingCategoryForWrite } from "@/lib/memberships/reportingCategory";

export type MerchandisingFields = {
  membershipType: MembershipPlanType;
  detailedDescription: string | null;
  physicalPassMessage: string | null;
  imageUrl: string | null;
  tags: string[];
  daysValidFromPurchase: number | null;
  daysValidFromRedemption: number | null;
  redemptionStartsAt: Date | null;
  redemptionEndsAt: Date | null;
  customRedemptionDescription: string | null;
  salesStartsAt: Date | null;
  salesEndsAt: Date | null;
  hideFromOnlineSales: boolean;
  addOnsEnabled: boolean;
  alternateAddress: string | null;
  cancellationTerms: string | null;
  formsEnabled: boolean;
  instructions: string | null;
  reportingCategory: string | null;
  overrideTax: boolean;
  termsAndConditions: string | null;
  variations: MembershipPlanVariation[];
};

function parseOptionalString(
  value: unknown,
  max: number,
  field: string
): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new Error(`${field} is too long (max ${max})`);
  }
  return trimmed;
}

function parseOptionalInt(
  value: unknown,
  field: string,
  min: number,
  max: number
): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${field} must be an integer from ${min} to ${max}`);
  }
  return n;
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new Error(`${field} must be an ISO date string`);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${field} is not a valid date`);
  }
  return d;
}

function parseTags(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error("tags must be an array of strings");
  }
  return value
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((s) => s.slice(0, 40));
}

function parseMembershipType(value: unknown): MembershipPlanType {
  if (
    typeof value === "string" &&
    (MEMBERSHIP_PLAN_TYPES as readonly string[]).includes(value)
  ) {
    return value as MembershipPlanType;
  }
  throw new Error("membershipType must be single or group");
}

function parseVariationFrequency(value: unknown): "one_time" | "recurring" {
  if (value === "one_time" || value === "recurring") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "one time" || lower === "onetime" || lower === "fixed") {
      return "one_time";
    }
    if (lower === "recurring") return "recurring";
  }
  throw new Error("variation.frequency must be one_time or recurring");
}

function parseVariationIntervalUnit(
  value: unknown
): MembershipIntervalUnit | null {
  if (value == null || value === "") return null;
  if (
    typeof value === "string" &&
    (MEMBERSHIP_INTERVAL_UNITS as readonly string[]).includes(value)
  ) {
    return value as MembershipIntervalUnit;
  }
  throw new Error("variation.intervalUnit must be day, week, month, or year");
}

export function parseVariations(raw: unknown): MembershipPlanVariation[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("variations must be an array");
  }
  if (raw.length > 25) {
    throw new Error("variations: at most 25 rows");
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`variations[${i}] must be an object`);
    }
    const o = item as Record<string, unknown>;
    const name =
      typeof o.name === "string" ? o.name.trim().slice(0, 75) : "";
    if (!name) throw new Error(`variations[${i}].name is required`);

    let priceStr: string;
    if (typeof o.price === "number" && Number.isFinite(o.price) && o.price >= 0) {
      priceStr = o.price.toFixed(2);
    } else if (typeof o.price === "string" && o.price.trim()) {
      const n = Number(o.price);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`variations[${i}].price must be non-negative`);
      }
      priceStr = n.toFixed(2);
    } else {
      throw new Error(`variations[${i}].price is required`);
    }

    const frequency = parseVariationFrequency(o.frequency);
    let intervalCount: number | null = null;
    if (o.intervalCount != null && o.intervalCount !== "") {
      const n = Number(o.intervalCount);
      if (!Number.isInteger(n) || n < 1 || n > 120) {
        throw new Error(
          `variations[${i}].intervalCount must be an integer from 1 to 120`
        );
      }
      intervalCount = n;
    }
    const intervalUnit = parseVariationIntervalUnit(o.intervalUnit);
    if (frequency === "recurring" && (intervalCount == null || !intervalUnit)) {
      throw new Error(
        `variations[${i}]: recurring requires intervalCount and intervalUnit`
      );
    }

    const payments =
      typeof o.payments === "string" && o.payments.trim()
        ? o.payments.trim().slice(0, 120)
        : null;

    return {
      name,
      sell: o.sell === undefined ? true : Boolean(o.sell),
      price: priceStr,
      frequency,
      payments,
      intervalCount,
      intervalUnit,
    };
  });
}

/** Read path — tolerate legacy empty/partial JSON. */
export function parseVariationsLoose(raw: unknown): MembershipPlanVariation[] {
  try {
    return parseVariations(raw);
  } catch {
    return [];
  }
}

/**
 * Sync primary sellable variation → plan price/billing fields.
 * First sell=true row wins; else first row; else null (caller keeps existing).
 */
export function primaryFromVariations(
  variations: MembershipPlanVariation[]
): {
  nameHint: string | null;
  price: PrismaNS.Decimal;
  billing: "fixed" | "recurring";
  intervalCount: number | null;
  intervalUnit: MembershipIntervalUnit | null;
} | null {
  if (!variations.length) return null;
  const primary = variations.find((v) => v.sell) ?? variations[0] ?? null;
  if (!primary) return null;
  return {
    nameHint: primary.name,
    price: new PrismaNS.Decimal(primary.price),
    billing: primary.frequency === "recurring" ? "recurring" : "fixed",
    intervalCount: primary.intervalCount ?? null,
    intervalUnit: primary.intervalUnit ?? null,
  };
}

function hasKey(b: Record<string, unknown>, key: string, partial: boolean) {
  return key in b || !partial;
}

export function parseMerchandisingFromBody(
  b: Record<string, unknown>,
  opts?: { partial?: boolean }
): Partial<MerchandisingFields> {
  const partial = Boolean(opts?.partial);
  const out: Partial<MerchandisingFields> = {};

  if (hasKey(b, "membershipType", partial)) {
    if (b.membershipType != null && b.membershipType !== "") {
      out.membershipType = parseMembershipType(b.membershipType);
    } else if (!partial) {
      out.membershipType = "single";
    }
  }

  if (hasKey(b, "detailedDescription", partial)) {
    out.detailedDescription = parseOptionalString(
      b.detailedDescription,
      4000,
      "detailedDescription"
    );
  }
  if (hasKey(b, "physicalPassMessage", partial)) {
    out.physicalPassMessage = parseOptionalString(
      b.physicalPassMessage,
      500,
      "physicalPassMessage"
    );
  }
  if (hasKey(b, "imageUrl", partial)) {
    out.imageUrl = parseOptionalString(b.imageUrl, 2000, "imageUrl");
  }
  if (hasKey(b, "tags", partial)) {
    out.tags = parseTags(b.tags);
  }

  if (hasKey(b, "daysValidFromPurchase", partial)) {
    out.daysValidFromPurchase = parseOptionalInt(
      b.daysValidFromPurchase,
      "daysValidFromPurchase",
      1,
      36500
    );
  }
  if (hasKey(b, "daysValidFromRedemption", partial)) {
    out.daysValidFromRedemption = parseOptionalInt(
      b.daysValidFromRedemption,
      "daysValidFromRedemption",
      1,
      36500
    );
  }
  if (hasKey(b, "redemptionStartsAt", partial)) {
    out.redemptionStartsAt = parseOptionalDate(
      b.redemptionStartsAt,
      "redemptionStartsAt"
    );
  }
  if (hasKey(b, "redemptionEndsAt", partial)) {
    out.redemptionEndsAt = parseOptionalDate(
      b.redemptionEndsAt,
      "redemptionEndsAt"
    );
  }
  if (hasKey(b, "customRedemptionDescription", partial)) {
    out.customRedemptionDescription = parseOptionalString(
      b.customRedemptionDescription,
      500,
      "customRedemptionDescription"
    );
  }
  if (hasKey(b, "salesStartsAt", partial)) {
    out.salesStartsAt = parseOptionalDate(b.salesStartsAt, "salesStartsAt");
  }
  if (hasKey(b, "salesEndsAt", partial)) {
    out.salesEndsAt = parseOptionalDate(b.salesEndsAt, "salesEndsAt");
  }
  if (hasKey(b, "hideFromOnlineSales", partial)) {
    out.hideFromOnlineSales = partial
      ? Boolean(b.hideFromOnlineSales)
      : Boolean(b.hideFromOnlineSales);
  }

  if (hasKey(b, "addOnsEnabled", partial)) {
    out.addOnsEnabled = Boolean(b.addOnsEnabled);
  }
  if (hasKey(b, "alternateAddress", partial)) {
    // Structured JSON (name/address/website/email/phone) — same rules as admin UI.
    out.alternateAddress = sanitizeAlternateAddressForWrite(b.alternateAddress);
  }
  if (hasKey(b, "cancellationTerms", partial)) {
    // Sanitized HTML (bold/lists/links) — plain-text + HTML budgets in richText.
    out.cancellationTerms = sanitizeCancellationTermsForWrite(
      b.cancellationTerms
    );
  }
  if (hasKey(b, "formsEnabled", partial)) {
    out.formsEnabled = Boolean(b.formsEnabled);
  }
  if (hasKey(b, "instructions", partial)) {
    // Sanitized HTML (bold/lists/links) — same pipeline as cancellation terms.
    out.instructions = sanitizeInstructionsForWrite(b.instructions);
  }
  if (hasKey(b, "reportingCategory", partial)) {
    out.reportingCategory = sanitizeReportingCategoryForWrite(
      b.reportingCategory
    );
  }
  if (hasKey(b, "overrideTax", partial)) {
    out.overrideTax = Boolean(b.overrideTax);
  }
  if (hasKey(b, "termsAndConditions", partial)) {
    // Sanitized HTML (bold/lists/links) — agreement body for guests.
    out.termsAndConditions = sanitizeTermsAndConditionsForWrite(
      b.termsAndConditions
    );
  }
  if (hasKey(b, "variations", partial)) {
    out.variations = parseVariations(b.variations ?? []);
  }

  if (
    out.redemptionStartsAt &&
    out.redemptionEndsAt &&
    out.redemptionStartsAt > out.redemptionEndsAt
  ) {
    throw new Error("redemptionStartsAt must be before redemptionEndsAt");
  }
  if (
    out.salesStartsAt &&
    out.salesEndsAt &&
    out.salesStartsAt > out.salesEndsAt
  ) {
    throw new Error("salesStartsAt must be before salesEndsAt");
  }

  return out;
}

export function merchandisingDefaults(): MerchandisingFields {
  return {
    membershipType: "single",
    detailedDescription: null,
    physicalPassMessage: null,
    imageUrl: null,
    tags: [],
    daysValidFromPurchase: null,
    daysValidFromRedemption: null,
    redemptionStartsAt: null,
    redemptionEndsAt: null,
    customRedemptionDescription: null,
    salesStartsAt: null,
    salesEndsAt: null,
    hideFromOnlineSales: false,
    addOnsEnabled: false,
    alternateAddress: null,
    cancellationTerms: null,
    formsEnabled: false,
    instructions: null,
    reportingCategory: null,
    overrideTax: false,
    termsAndConditions: null,
    variations: [],
  };
}
