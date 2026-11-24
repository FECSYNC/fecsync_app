/**
 * Step 7.3 — Resource-level policy helpers (permission catalog remains SSOT).
 *
 * These encode constraints beyond coarse permissions:
 * - orders:manage may update status/address, never financial totals
 * - tax:manage does not imply products:delete (catalog delete is separate)
 *
 * Does not weaken Phase 3–4 user isolation or org tenancy — callers still
 * use requireAuth*, staffOrg, and *Access helpers.
 */

import { ForbiddenError } from "@/lib/auth/http-error";
import { hasPermission, P, type Permission } from "@/lib/auth/permissions";
import type { NormalizedAccessToken } from "@/lib/auth/claims";

/** Fields set only at order create / payment — never via PUT. */
export const ORDER_IMMUTABLE_FINANCIAL_FIELDS = [
  "amount",
  "subtotal",
  "taxAmount",
  "taxRate",
  "taxLabel",
  "total",
  "discount",
  "shippingFee",
  "shippingMethod",
  "shippingAddress",
] as const;

export type OrderImmutableFinancialField =
  (typeof ORDER_IMMUTABLE_FINANCIAL_FIELDS)[number];

/**
 * Reject body attempts to mutate order totals (orders:manage cannot change amount).
 * Throws ForbiddenError → 403 + audit when wired through authErrorToResponse.
 */
export function assertNoOrderFinancialMutation(
  body: Record<string, unknown>
): void {
  for (const field of ORDER_IMMUTABLE_FINANCIAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      throw new ForbiddenError(
        `Order ${field} cannot be changed via API`
      );
    }
  }
}

/**
 * Product DELETE requires products:delete explicitly.
 * finance (tax:manage) and ops_manager presets do not include this grant.
 */
export function assertProductDeleteAllowed(
  permissions: Iterable<string> | null | undefined
): void {
  if (!hasPermission(permissions, P.ProductsDelete)) {
    throw new ForbiddenError("Missing required permission");
  }
}

/** Permission required for catalog DELETE — documented SSOT cross-ref. */
export const PRODUCT_DELETE_PERMISSION: Permission = P.ProductsDelete;

/** Status changes on orders require orders:manage even when caller owns the order. */
export function assertOrderStatusChangeAllowed(
  actor: NormalizedAccessToken,
  previousStatus: string,
  nextStatus: string
): void {
  if (nextStatus === previousStatus) return;
  if (!hasPermission(actor.permissions, P.OrdersManage)) {
    throw new ForbiddenError("Missing required permission");
  }
}
