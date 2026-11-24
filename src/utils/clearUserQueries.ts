// Utility function to clear user-specific React Query caches
import { QueryClient } from '@tanstack/react-query';
import { removeTicketingQueries } from '@/utils/invalidateTicketingQueries';
import { removeMembershipsQueries } from '@/utils/invalidateMembershipsQueries';
import { removeWaiversQueries } from '@/utils/invalidateWaiversQueries';
import { removeMarketingQueries } from '@/utils/invalidateMarketingQueries';
import { clearAdminListSnapshots } from '@/lib/adminListSnapshot';
import { useAuthStore } from '@/store/authStore';

/**
 * Clears all user-specific React Query caches
 * Should be called before logout to ensure clean state
 */
export function clearUserQueries(queryClient: QueryClient) {
  const orgId = useAuthStore.getState().user?.orgId ?? null;
  clearAdminListSnapshots(orgId);
  queryClient.removeQueries({ queryKey: ['profile'] });
  queryClient.removeQueries({ queryKey: ['cart'] });
  queryClient.removeQueries({ queryKey: ['orders'] });
  queryClient.removeQueries({ queryKey: ['wishlist'] });
  // Step 3.4 — user-scoped customizations must not survive logout / account switch
  queryClient.removeQueries({ queryKey: ['customizations'] });
  // Step 3.5 — fashion-chat history is user-scoped when authenticated
  queryClient.removeQueries({ queryKey: ['fashionChat'] });
  // Staff AI chat inbox is org-scoped
  queryClient.removeQueries({ queryKey: ['admin-fashion-chats'] });
  // Step 6.2 — org members list is actor/org scoped
  queryClient.removeQueries({ queryKey: ['admin-members'] });
  // Account blacklist is org-scoped staff data
  queryClient.removeQueries({ queryKey: ['admin-user-blacklist'] });
  // Role templates are org-scoped
  queryClient.removeQueries({ queryKey: ['admin-role-templates'] });
  // Admin shell warm caches (dashboard + catalog + settings)
  queryClient.removeQueries({ queryKey: ['dashboard'] });
  queryClient.removeQueries({ queryKey: ['admin-products'] });
  queryClient.removeQueries({ queryKey: ['categories'] });
  queryClient.removeQueries({ queryKey: ['fabrics'] });
  queryClient.removeQueries({ queryKey: ['tax-settings'] });
  queryClient.removeQueries({ queryKey: ['ai-settings'] });
  queryClient.removeQueries({ queryKey: ['homepage-content'] });
  queryClient.removeQueries({ queryKey: ['ad-banners'] });
  queryClient.removeQueries({ queryKey: ['notifications'] });
  // Find-a-Tailor provider workspace (profile, jobs, client roster, campaigns)
  queryClient.removeQueries({ queryKey: ['tailors'] });
  queryClient.removeQueries({ queryKey: ['tailor-clients'] });
  queryClient.removeQueries({ queryKey: ['measurement-campaigns'] });
  // Customer measurement profiles use key prefix "measurements" (not measurement-profiles)
  queryClient.removeQueries({ queryKey: ['measurements'] });
  queryClient.removeQueries({ queryKey: ['tailoring-jobs'] });
  // Company SaaS — org-scoped billing + profile must not survive logout / account switch
  queryClient.removeQueries({ queryKey: ['company-billing'] });
  queryClient.removeQueries({ queryKey: ['company-profile'] });
  // Multi-park venues (match invalidateOrgSaasQueries / venueLocationKeys)
  queryClient.removeQueries({ queryKey: ['admin', 'venue-locations'] });
  // Enterprise HQ overview / location-context
  queryClient.removeQueries({ queryKey: ['admin', 'hq'] });
  // Park-context (Growth / park-locked)
  queryClient.removeQueries({ queryKey: ['admin', 'park-context'] });
  // Marketplace / franchise park Connect payouts
  queryClient.removeQueries({ queryKey: ['admin', 'marketplace'] });
  // Match invalidateOrgSaasQueries — storefront PA metrics must not outlive logout
  queryClient.removeQueries({ queryKey: ['registered-companies-metrics'] });
  // Ticketing / bookings (admin + profile + public wizard) — must not outlive logout
  removeTicketingQueries(queryClient);
  // Guest park Memberships — must not outlive logout / account switch
  removeMembershipsQueries(queryClient);
  // Digital Waivers desk — must not outlive logout / account switch
  removeWaiversQueries(queryClient);
  // Guest Marketing Automation — must not outlive logout / account switch
  removeMarketingQueries(queryClient);

  // Clear storefront StyleForge guest session/contact so account switch can't leak chats
  try {
    // Dynamic import avoided — keep sync for logout paths
    if (typeof window !== 'undefined') {
      localStorage.removeItem('harewa_fashion_chat_session');
      localStorage.removeItem('harewa_fashion_chat_contact');
      localStorage.removeItem('harewa_fashion_chat_messages');
      // Registration plan hint is per-browser preference; drop on logout.
      localStorage.removeItem('harewa_company_plan_hint');
      // HQ park-scope cross-tab payload (also cleared via clearCompanySaasSessionSyncStorage).
      localStorage.removeItem('harewa-hq-location-context');
    }
  } catch {
    /* ignore */
  }
}
