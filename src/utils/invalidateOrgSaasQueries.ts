import type { QueryClient } from '@tanstack/react-query';
import { invalidateTicketingQueries } from '@/utils/invalidateTicketingQueries';
import { invalidateMembershipsQueries } from '@/utils/invalidateMembershipsQueries';
import { invalidateWaiversQueries } from '@/utils/invalidateWaiversQueries';
import { invalidateMarketingQueries } from '@/utils/invalidateMarketingQueries';
import { invalidateMarketplacePayoutQueries } from '@/utils/invalidateMarketplacePayoutQueries';

/**
 * Drop stale Company SaaS caches after /me billing/org/profile changes.
 * Plan-cap lists (campaigns/clients) only when billing/org status changes —
 * logo/completeness-only updates must not churn tailor roster caches.
 */
export function invalidateOrgSaasQueries(
  queryClient: QueryClient,
  options?: { planCaps?: boolean }
) {
  void queryClient.invalidateQueries({ queryKey: ['company-billing'] });
  void queryClient.invalidateQueries({ queryKey: ['company-profile'] });
  // Storefront platform_admin CompaniesOverviewCards (prefix match).
  void queryClient.invalidateQueries({
    queryKey: ['registered-companies-metrics'],
  });
  void queryClient.invalidateQueries({
    queryKey: ['registered-companies'],
  });
  if (options?.planCaps === false) return;
  void queryClient.invalidateQueries({ queryKey: ['measurement-campaigns'] });
  void queryClient.invalidateQueries({ queryKey: ['tailor-clients'] });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'venue-locations'] });
  // Enterprise HQ overview + location-context (hqKeys.all)
  void queryClient.invalidateQueries({ queryKey: ['admin', 'hq'] });
  // Park-context (Growth / park-locked)
  void queryClient.invalidateQueries({ queryKey: ['admin', 'park-context'] });
  void queryClient.invalidateQueries({ queryKey: ['admin-role-templates'] });
  // Demo lock / plan demote / entitle flip — refresh ticketing admin + guest caches
  invalidateTicketingQueries(queryClient);
  // Same entitle flip for guest park Memberships (Growth+)
  invalidateMembershipsQueries(queryClient);
  invalidateWaiversQueries(queryClient);
  // Guest Marketing Automation (Growth+) — overview KPIs + desks
  invalidateMarketingQueries(queryClient);
  // Franchise park + org Connect charge-ready (World B — not SaaS billing)
  invalidateMarketplacePayoutQueries(queryClient);
}
