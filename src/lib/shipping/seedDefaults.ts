import { getStorefrontOrgId, parseDefaultOrgEnv } from "@/lib/org";
import { getOrCreateShippingSettings } from "./settings";
import type { ShippingSettingsDoc } from "./types";

/**
 * One-time / boot seed — ensure ShippingSettings exists for the storefront org.
 *
 * Org resolution:
 * 1. `process.env.DEFAULT_ORG_ID` when set and valid
 * 2. else storefront default org (`getStorefrontOrgId`)
 *
 * Creates Lagos (NG) placeholder origin + `autoBookOnPaid: true` when missing.
 * Does not overwrite an existing settings row (admin may have customized origin).
 */
export async function seedDefaultShippingSettings(): Promise<ShippingSettingsDoc> {
  const orgId = parseDefaultOrgEnv() ?? (await getStorefrontOrgId());
  return getOrCreateShippingSettings(orgId);
}

/** Alias matching STEP 6 naming. */
export const seedShippingDefaults = seedDefaultShippingSettings;
