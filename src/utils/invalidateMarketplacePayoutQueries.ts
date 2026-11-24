import type { QueryClient } from "@tanstack/react-query";
import { invalidateMarketplacePayoutQueries as invalidateFromService } from "@/services/marketplace";
import { broadcastMarketplacePayoutsChange } from "@/utils/marketplacePayoutsSync";

/**
 * Drop marketplace / franchise park Connect payout caches after onboard, sync,
 * archive, or org SaaS session flips that may affect charge-ready.
 * Optionally broadcast so sister admin tabs refresh without reload.
 */
export function invalidateMarketplacePayoutQueries(
  queryClient: QueryClient,
  opts?: { orgId?: string | null; locationId?: string | null; broadcast?: boolean }
) {
  invalidateFromService(queryClient);
  if (opts?.broadcast !== false && opts?.orgId) {
    broadcastMarketplacePayoutsChange({
      orgId: opts.orgId,
      locationId: opts.locationId ?? null,
      reason: "invalidate",
    });
  }
}
