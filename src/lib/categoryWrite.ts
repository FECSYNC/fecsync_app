/**
 * ProductCategory write payload. orgId is stamped server-side (Step 5.1).
 * Never take seller/shop/orgId from the client.
 */

import { omitCatalogTenantKeys } from "@/lib/catalogWrite";

const CATEGORY_WRITE_KEYS = ["id", "name", "description"] as const;

export type CategoryWriteFields = Partial<
  Record<(typeof CATEGORY_WRITE_KEYS)[number], unknown>
>;

export function pickCategoryWriteFields(
  body: Record<string, unknown> | null | undefined
): CategoryWriteFields {
  const picked: CategoryWriteFields = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return picked;
  const sanitized = omitCatalogTenantKeys(body);
  for (const key of CATEGORY_WRITE_KEYS) {
    if (sanitized[key] !== undefined) {
      picked[key] = sanitized[key];
    }
  }
  return picked;
}

export function hasCategoryWriteFields(fields: CategoryWriteFields): boolean {
  return Object.keys(fields).length > 0;
}
