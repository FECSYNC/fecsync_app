/**
 * Multi-venue membership visit labels (Feature 08 Phase 3).
 * CURRENT / VISITING / INELIGIBLE — fail-closed for non-home without eligibility.
 */
import type { MembershipVisitStatus } from "@prisma/client";

export type VenueEligibilityInput = {
  eligible: boolean;
  localPerksAdd?: unknown;
  localPerksRemove?: unknown;
} | null;

export type MultiVenueStatusResult = {
  visitStatus: MembershipVisitStatus;
  eligible: boolean;
  isHome: boolean;
};

/**
 * Home venue is always CURRENT (eligible) when the membership itself is valid.
 * Non-home requires an eligibility row with eligible=true → VISITING.
 * Missing row or eligible=false → INELIGIBLE (fail-closed).
 */
export function computeVisitStatus(input: {
  homeLocationId: string;
  actingLocationId: string;
  eligibility: VenueEligibilityInput;
}): MultiVenueStatusResult {
  const isHome = input.actingLocationId === input.homeLocationId;
  if (isHome) {
    return { visitStatus: "CURRENT", eligible: true, isHome: true };
  }
  if (input.eligibility?.eligible === true) {
    return { visitStatus: "VISITING", eligible: true, isHome: false };
  }
  return { visitStatus: "INELIGIBLE", eligible: false, isHome: false };
}

/** Normalize perk flag lists from plan entitlements or eligibility JSON. */
export function normalizePerkFlags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const flag = item.trim();
    if (!flag || seen.has(flag)) continue;
    seen.add(flag);
    out.push(flag);
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * Apply local perk customization at a venue:
 * start with plan perks → add localPerksAdd → remove localPerksRemove.
 */
export function applyLocalPerks(input: {
  planPerks: string[];
  localPerksAdd?: unknown;
  localPerksRemove?: unknown;
}): string[] {
  const add = normalizePerkFlags(input.localPerksAdd);
  const remove = new Set(normalizePerkFlags(input.localPerksRemove));
  const merged = [...input.planPerks];
  const seen = new Set(merged);
  for (const flag of add) {
    if (seen.has(flag)) continue;
    seen.add(flag);
    merged.push(flag);
  }
  return merged.filter((f) => !remove.has(f));
}
