import { validateFabricSellableFields, type FabricSellableInput } from "@/lib/fabricCommerce";
import { omitCatalogTenantKeys } from "@/lib/catalogWrite";
import { resolveFabricImageForWrite } from "@/lib/resolveCatalogMedia";

const FABRIC_WRITE_KEYS = [
  "name",
  "image",
  "type",
  "color",
  "pattern",
  "weight",
  "width",
  "composition",
  "supplier",
  "pricePerMeter",
  "inStock",
  "yardBundle",
  "bundlePrice",
  "stockBundles",
  "isSellable",
  "taxRate",
  "taxExempt",
] as const;

/** Allowlisted fabric write fields. taxRate/taxExempt persist for authorized editors only. */
export function pickFabricBody(
  body: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return picked;
  const sanitized = omitCatalogTenantKeys(body);
  for (const key of FABRIC_WRITE_KEYS) {
    if (sanitized[key] !== undefined) {
      picked[key] = sanitized[key];
    }
  }
  return picked;
}

export function hasFabricWriteFields(fields: Record<string, unknown>): boolean {
  return Object.keys(fields).length > 0;
}

/** Upload any data: fabric image to Cloudinary before persist. */
export async function resolveFabricWriteImage(
  fields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (fields.image === undefined) return fields;
  const image = await resolveFabricImageForWrite(fields.image);
  return { ...fields, image: image ?? "" };
}

export function validateFabricPayload(
  body: Record<string, unknown>,
  options?: { requireName?: boolean }
): string | null {
  if (options?.requireName && !body.name) {
    return "Name is required";
  }

  const sellError = validateFabricSellableFields({
    isSellable: Boolean(body.isSellable),
    yardBundle: body.yardBundle as number | undefined,
    bundlePrice: body.bundlePrice as number | undefined,
    stockBundles: body.stockBundles as number | undefined,
  });

  return sellError;
}

export type { FabricSellableInput };
