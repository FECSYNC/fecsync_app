'use client';

/**
 * Step 6.3 — fine-grained admin UI gates.
 * API remaining the source of truth; these helpers only hide/redirect in the UI.
 * Does not change PAYMENT_POLICY, Order/Wallet user isolation, or actor.orgId tenancy.
 */

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import {
  permissionForAdminPath,
  permissionForAdminMutationPath,
  adminPathRequiresStorefrontOrg,
  adminPathRequiresRegisteredCompanyOrg,
  adminPathRequiresStorefrontPlatformAdmin,
  type Permission,
  P,
  isPlatformAdminActor,
} from '@/lib/auth/permissions';
import { isStorefrontOrgSession, type UserProfile } from '@/services/auth';
import {
  DEMO_FEATURE_LOCKED_MESSAGE,
  isDemoAllowedAdminPath,
  sessionIsDemoPlan,
} from '@/lib/demoPlanLock';
import { isPlatformSoftwareOwner } from '@/lib/platformSoftwareOwner';
import { isAdminUiHiddenHref } from '@/lib/adminUiHidden';
import { planAllowsModule } from '@/lib/subscriptionPlans';

export { isStorefrontOrgSession };

type AdminPageUser = Pick<
  UserProfile,
  | 'orgId'
  | 'storefrontOrgId'
  | 'preset'
  | 'membershipRole'
  | 'subscriptionPlan'
  | 'enterpriseHqEnabled'
  | 'parkLocked'
  | 'franchiseParkManager'
>;

/** Company HQ surfaces park-locked seats must not open (APIs also deny). */
function isParkLockedCompanyHqPath(pathname: string): boolean {
  return (
    pathname === '/admin/billing' ||
    pathname.startsWith('/admin/billing/') ||
    pathname === '/admin/company-profile' ||
    pathname.startsWith('/admin/company-profile/') ||
    pathname === '/admin/registered-companies' ||
    pathname.startsWith('/admin/registered-companies/') ||
    pathname === '/admin/platform-accounts' ||
    pathname.startsWith('/admin/platform-accounts/') ||
    pathname === '/admin/payouts' ||
    pathname.startsWith('/admin/payouts/') ||
    pathname === '/admin/hq' ||
    pathname.startsWith('/admin/hq/') ||
    pathname === '/admin/tax-settings' ||
    pathname.startsWith('/admin/tax-settings/') ||
    pathname === '/admin/shipping-settings' ||
    pathname.startsWith('/admin/shipping-settings/') ||
    pathname === '/admin/settings/shipping' ||
    pathname.startsWith('/admin/settings/shipping/')
  );
}

/** Guest park Memberships admin surfaces (Growth+ moduleHints). */
function isMembershipsAdminPath(pathname: string): boolean {
  return (
    pathname === '/admin/memberships' ||
    pathname.startsWith('/admin/memberships/')
  );
}

/** Digital Waivers admin surfaces (Growth+ moduleHints). */
function isWaiversAdminPath(pathname: string): boolean {
  return (
    pathname === '/admin/waivers' ||
    pathname.startsWith('/admin/waivers/')
  );
}

/** POS terminal admin surfaces (Growth+ moduleHints). */
function isPosAdminPath(pathname: string): boolean {
  return pathname === '/admin/pos' || pathname.startsWith('/admin/pos/');
}

/** Accounting admin surfaces (Growth+ moduleHints). */
function isAccountingAdminPath(pathname: string): boolean {
  return pathname === '/admin/accounting' || pathname.startsWith('/admin/accounting/');
}

/** Guest Marketing Automation admin surfaces (Growth+ moduleHints). */
function isMarketingAdminPath(pathname: string): boolean {
  return (
    pathname === '/admin/marketing' ||
    pathname.startsWith('/admin/marketing/')
  );
}

/**
 * FECSYNC storefront Membership `platform_admin` — project owner / developer.
 * Sees every admin sidebar route and page shell for QA (money APIs stay SSOT).
 */
export function isStorefrontPlatformSuperAdmin(
  user?: AdminPageUser | null
): boolean {
  if (!user) return false;
  return isPlatformSoftwareOwner(user);
}

/**
 * Exact `/admin` is soft-gated (widgets decide via analytics:read etc.).
 * ADMIN_ROUTE_PERMISSIONS["/admin"] = analytics:read is inventory for widgets only —
 * `adminPagePermissionForPath` returns null so the shell stays open for staff.
 * Known inventory routes → required read/manage permission.
 * Unknown `/admin/*` → fail closed (treat as denied; permission null).
 */
export function adminPagePermissionForPath(pathname: string): Permission | null {
  if (pathname === '/admin' || pathname === '/admin/') return null;
  // Self-service profile — any authenticated staff may open it.
  if (pathname === '/admin/profile' || pathname.startsWith('/admin/profile/')) {
    return null;
  }
  return permissionForAdminPath(pathname);
}

/** Whether staff may open this admin pathname (fail-closed for unknown routes). */
export function isAdminPageAllowed(
  pathname: string,
  can: (permission: Permission) => boolean,
  user?: AdminPageUser | null
): { allowed: boolean; permission: Permission | null; known: boolean } {
  const normalized = pathname === '/admin/' ? '/admin' : pathname;
  // UI-hidden shop/CMS surfaces: keep routes/APIs, hide from every admin chrome.
  // known:false so even storefront project owner sidebar does not force-show them.
  if (isAdminUiHiddenHref(normalized)) {
    return {
      allowed: false,
      permission: permissionForAdminPath(normalized),
      known: false,
    };
  }
  const superAdmin = isStorefrontPlatformSuperAdmin(user);
  // Demo: only dashboard shell, company profile, billing (upgrade), and my profile.
  // Storefront project owner is never Demo-locked.
  if (
    !superAdmin &&
    sessionIsDemoPlan(user) &&
    !isDemoAllowedAdminPath(normalized)
  ) {
    const permission = permissionForAdminPath(normalized);
    return { allowed: false, permission, known: Boolean(permission) };
  }
  // Memberships: Growth+ only (session plan). Storefront shells stay open for
  // platform_admin QA (same pattern as Online Booking); APIs still deny storefront.
  if (
    !superAdmin &&
    user &&
    !isStorefrontOrgSession(user) &&
    isMembershipsAdminPath(normalized) &&
    !planAllowsModule(user.subscriptionPlan, 'memberships')
  ) {
    const permission = permissionForAdminPath(normalized);
    return { allowed: false, permission, known: Boolean(permission) };
  }
  // Digital Waivers: Growth+ only. Storefront shells stay open for
  // platform_admin QA; staff APIs still deny the storefront org.
  if (
    !superAdmin &&
    user &&
    !isStorefrontOrgSession(user) &&
    isWaiversAdminPath(normalized) &&
    !planAllowsModule(user.subscriptionPlan, 'waivers')
  ) {
    const permission = permissionForAdminPath(normalized);
    return { allowed: false, permission, known: Boolean(permission) };
  }
  // POS terminal: Growth+ only. Storefront shells stay open for QA.
  if (
    !superAdmin &&
    user &&
    !isStorefrontOrgSession(user) &&
    isPosAdminPath(normalized) &&
    !planAllowsModule(user.subscriptionPlan, 'pos')
  ) {
    const permission = permissionForAdminPath(normalized);
    return { allowed: false, permission, known: Boolean(permission) };
  }
  // Guest Marketing: Growth+ only. Storefront shells stay open for
  // platform_admin QA; staff APIs still deny the storefront org.
  if (
    !superAdmin &&
    user &&
    !isStorefrontOrgSession(user) &&
    isMarketingAdminPath(normalized) &&
    !planAllowsModule(user.subscriptionPlan, 'marketing')
  ) {
    const permission = permissionForAdminPath(normalized);
    return { allowed: false, permission, known: Boolean(permission) };
  }
  // Accounting: Growth+ only. APIs deny the storefront org and Demo.
  if (
    !superAdmin &&
    user &&
    !isStorefrontOrgSession(user) &&
    isAccountingAdminPath(normalized) &&
    !planAllowsModule(user.subscriptionPlan, 'accounting')
  ) {
    const permission = permissionForAdminPath(normalized);
    return { allowed: false, permission, known: Boolean(permission) };
  }
  if (normalized === '/admin') {
    return { allowed: true, permission: null, known: true };
  }
  if (normalized === '/admin/profile' || normalized.startsWith('/admin/profile/')) {
    return { allowed: true, permission: null, known: true };
  }
  const permission = permissionForAdminPath(normalized);
  if (!permission) {
    return { allowed: false, permission: null, known: false };
  }
  if (!can(permission)) {
    // Project owner: unlock every known admin route for QA.
    if (superAdmin) {
      // fall through to remaining gates
    } else if (
      (normalized === "/admin/ticketing/settings" ||
        normalized.startsWith("/admin/ticketing/settings/")) &&
      (can(P.TicketingRead) || can(P.TicketingManage))
    ) {
      // fall through to remaining gates
    } else if (
      (normalized === "/admin/booking-packages" ||
        normalized.startsWith("/admin/booking-packages/")) &&
      can(P.MarketplaceRefunds)
    ) {
      // Finance MarketplaceRefunds: refund UI lives on this page (CRUD still
      // requires booking_packages:manage — page degrades to refund-only).
      // fall through to remaining gates
    } else if (
      (normalized === "/admin/payouts" ||
        normalized.startsWith("/admin/payouts/")) &&
      can(P.AnalyticsRead)
    ) {
      // Spec: view payout status = settings:manage OR analytics:read.
      // Mutate CTAs stay platform_admin-gated on the page.
      // fall through to remaining gates
    } else if (
      (normalized === "/admin/memberships/members" ||
        normalized.startsWith("/admin/memberships/members/")) &&
      (can(P.MembershipsSell) ||
        can(P.MembershipsBilling) ||
        can(P.MembershipsCancel) ||
        can(P.MembershipsAdmin))
    ) {
      // Sell/billing/cancel desks live on Members; read is sufficient but not
      // required when the actor only holds lifecycle money permissions.
      // fall through to remaining gates
    } else if (
      (normalized === "/admin/memberships/redeem" ||
        normalized.startsWith("/admin/memberships/redeem/")) &&
      (can(P.MembershipsRedeem) || can(P.MembershipsAdmin))
    ) {
      // Redeem desk: open for redeem|admin only (matches nav quick-link +
      // ADMIN_ROUTE_PERMISSIONS). Verify API still accepts desk-read; redeem/undo stay redeem|admin.
      // fall through to remaining gates
    } else if (
      (normalized === "/admin/accounting/approvals" ||
        normalized.startsWith("/admin/accounting/approvals/")) &&
      (can(P.AccountingPayablesApprove) || can(P.AccountingExpensesApprove))
    ) {
      // Approvals inbox: any approve key (journals | payables | expenses).
      // fall through to remaining gates
    } else if (
      (normalized === "/admin/accounting/expenses" ||
        normalized.startsWith("/admin/accounting/expenses/")) &&
      normalized !== "/admin/accounting/expenses/new" &&
      (can(P.AccountingExpensesRead) || can(P.AccountingExpensesApprove))
    ) {
      // Expense list/detail: submitters (own) or readers/approvers (all in scope).
      // fall through to remaining gates
    } else {
      return { allowed: false, permission, known: true };
    }
  }
  if (
    adminPathRequiresStorefrontOrg(normalized) &&
    user &&
    !isStorefrontOrgSession(user)
  ) {
    return { allowed: false, permission, known: true };
  }
  if (
    adminPathRequiresRegisteredCompanyOrg(normalized) &&
    user &&
    isStorefrontOrgSession(user)
  ) {
    // Project owner: every company SaaS surface (Billing, Payouts, packages,
    // Venues, HQ, Online Booking…) stays visible for testing.
    // Money APIs still refuse DEFAULT_ORG as a Connect / Billing merchant.
    if (superAdmin) {
      // fall through
    } else {
      const opsTenantApp =
        normalized === '/admin/venues' ||
        normalized.startsWith('/admin/venues/') ||
        normalized === '/admin/hq' ||
        normalized.startsWith('/admin/hq/') ||
        normalized === '/admin/ticketing' ||
        normalized.startsWith('/admin/ticketing/') ||
        normalized === '/admin/memberships' ||
        normalized.startsWith('/admin/memberships/') ||
        normalized === '/admin/waivers' ||
        normalized.startsWith('/admin/waivers/') ||
        normalized === '/admin/marketing' ||
        normalized.startsWith('/admin/marketing/') ||
        normalized === '/admin/bookings' ||
        normalized.startsWith('/admin/bookings/') ||
        normalized === '/admin/parties' ||
        normalized.startsWith('/admin/parties/') ||
        normalized === '/admin/booking-accounts' ||
        normalized.startsWith('/admin/booking-accounts/') ||
        normalized === '/admin/booking-invoices' ||
        normalized.startsWith('/admin/booking-invoices/') ||
        normalized === '/admin/booking-payments' ||
        normalized.startsWith('/admin/booking-payments/');
      if (!(opsTenantApp && isPlatformAdminActor(user))) {
        return { allowed: false, permission, known: true };
      }
    }
  }
  // Match assertStorefrontPlatformAdmin on company approval APIs.
  if (
    adminPathRequiresStorefrontPlatformAdmin(normalized) &&
    user &&
    (!isPlatformAdminActor(user) || !isStorefrontOrgSession(user))
  ) {
    return { allowed: false, permission, known: true };
  }
  // Park-locked seats: company HQ lifecycle stays company-wide only.
  // Franchise park managers may open /admin/payouts for assigned park Connect
  // (Step 3) — never /admin/billing SaaS. Storefront software owner is never park-locked.
  if (
    user?.parkLocked === true &&
    !superAdmin &&
    isParkLockedCompanyHqPath(normalized)
  ) {
    const franchisePayouts =
      user.franchiseParkManager === true &&
      (normalized === '/admin/payouts' ||
        normalized.startsWith('/admin/payouts/'));
    if (!franchisePayouts) {
      return { allowed: false, permission, known: true };
    }
  }
  // Park-locked non-managers: Users roster readable; company-wide mutates denied.
  // Franchise park managers may invite/edit park-local seats (APIs scope-check).
  // Enterprise HQ page: settings:manage + registered company (Demo blocked above).
  // Entitlement (enterpriseHqEnabled) gates *data* fetches and mutate affordances —
  // Starter/Growth may open /admin/hq for the Billing upsell (no rollup leak).
  // Do not require enterpriseHqEnabled here or soft-upsell never renders.
  return { allowed: true, permission, known: true };
}

export function useAdminCan() {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  // Recompute when session permissions hydrate (can identity is stable).
  return useMemo(
    () => ({
      can,
      user,
      canReadPath: (pathname: string) =>
        isAdminPageAllowed(pathname, can, user).allowed,
      canMutatePath: (pathname: string) => {
        // Write/manage map only — product/fabric/category delete uses *:delete separately.
        const needed = permissionForAdminMutationPath(pathname);
        if (!needed) return false;
        const superAdmin = isStorefrontPlatformSuperAdmin(user);
        if (
          !superAdmin &&
          sessionIsDemoPlan(user) &&
          !isDemoAllowedAdminPath(pathname)
        ) {
          return false;
        }
        if (
          !superAdmin &&
          user &&
          !isStorefrontOrgSession(user) &&
          isMembershipsAdminPath(pathname) &&
          !planAllowsModule(user.subscriptionPlan, 'memberships')
        ) {
          return false;
        }
        if (
          !superAdmin &&
          user &&
          !isStorefrontOrgSession(user) &&
          isWaiversAdminPath(pathname) &&
          !planAllowsModule(user.subscriptionPlan, 'waivers')
        ) {
          return false;
        }
        if (
          !superAdmin &&
          user &&
          !isStorefrontOrgSession(user) &&
          isPosAdminPath(pathname) &&
          !planAllowsModule(user.subscriptionPlan, 'pos')
        ) {
          return false;
        }
        if (
          !superAdmin &&
          user &&
          !isStorefrontOrgSession(user) &&
          isMarketingAdminPath(pathname) &&
          !planAllowsModule(user.subscriptionPlan, 'marketing')
        ) {
          return false;
        }
        if (
          adminPathRequiresStorefrontOrg(pathname) &&
          user &&
          !isStorefrontOrgSession(user)
        ) {
          return false;
        }
        if (
          adminPathRequiresRegisteredCompanyOrg(pathname) &&
          user &&
          isStorefrontOrgSession(user) &&
          !superAdmin
        ) {
          return false;
        }
        if (
          adminPathRequiresStorefrontPlatformAdmin(pathname) &&
          user &&
          (!isPlatformAdminActor(user) || !isStorefrontOrgSession(user))
        ) {
          return false;
        }
        // Checkout/portal mutate — API requires company platform_admin (not every
        // settings:manage viewer). Align UI mutate affordances with the API.
        const normalized =
          pathname === '/admin/' ? '/admin' : pathname;
        if (
          (normalized === '/admin/billing' ||
            normalized.startsWith('/admin/billing/')) &&
          user &&
          !isPlatformAdminActor(user)
        ) {
          return false;
        }
        if (
          user?.parkLocked === true &&
          !superAdmin &&
          isParkLockedCompanyHqPath(normalized)
        ) {
          const franchisePayouts =
            user.franchiseParkManager === true &&
            (normalized === '/admin/payouts' ||
              normalized.startsWith('/admin/payouts/'));
          if (!franchisePayouts) {
            return false;
          }
        }
        // Park-locked non-managers: Users mutates stay company-wide.
        // Franchise park managers may invite/edit park-local seats.
        if (
          user?.parkLocked === true &&
          user?.franchiseParkManager !== true &&
          !superAdmin &&
          (normalized === '/admin/users' ||
            normalized.startsWith('/admin/users/'))
        ) {
          return false;
        }
        // HQ mutate affordances: entitled Enterprise, or project owner QA.
        if (
          (normalized === '/admin/hq' ||
            normalized.startsWith('/admin/hq/')) &&
          !superAdmin &&
          (!user || user.enterpriseHqEnabled !== true)
        ) {
          return false;
        }
        return superAdmin ? true : can(needed);
      },
    }),
    [can, user]
  );
}

/** Current admin route page permission (null = soft-gated dashboard or unknown). */
export function useAdminPagePermission(): {
  pathname: string;
  permission: Permission | null;
  allowed: boolean;
  known: boolean;
} {
  const pathname = usePathname() || '/admin';
  const { can, user } = useAdminCan();
  return useMemo(() => {
    const access = isAdminPageAllowed(pathname, can, user);
    return {
      pathname,
      permission: access.permission,
      allowed: access.allowed,
      known: access.known,
    };
  }, [pathname, can, user]);
}

/** Common mutation helpers for catalog tables. */
export function useCatalogActionPermissions() {
  const { can, user } = useAdminCan();
  return useMemo(
    () => ({
      canReadProducts: can(P.ProductsRead),
      canWriteProducts: can(P.ProductsWrite),
      canDeleteProducts: can(P.ProductsDelete),
      canReadFabrics: can(P.FabricsRead),
      canWriteFabrics: can(P.FabricsWrite),
      canDeleteFabrics: can(P.FabricsDelete),
      canReadCategories: can(P.CategoriesRead),
      canWriteCategories: can(P.CategoriesWrite),
      canDeleteCategories: can(P.CategoriesDelete),
      canManageOrders: can(P.OrdersManage),
      canManageCustomizations: can(P.CustomizationsManage),
      canManageTax: can(P.TaxManage),
      canManageHomepage: can(P.SettingsManage),
      canManageAdBanners: can(P.SettingsManage),
      canReadCompanyProfile: can(P.CompanyProfileRead),
      canWriteCompanyProfile: can(P.CompanyProfileWrite),
      canReadShipping: can(P.ShippingRead),
      canWriteShipping: can(P.ShippingWrite),
      canReadBilling: can(P.BillingRead),
      canManageBilling: can(P.BillingManage),
      canReadPayouts: can(P.PayoutsRead),
      canManagePayouts: can(P.PayoutsManage),
      canReadVenues: can(P.VenuesRead),
      canWriteVenues: can(P.VenuesWrite),
      canArchiveVenues: can(P.VenuesArchive),
      canReadHq: can(P.HqRead),
      canParkAssign: can(P.UsersParkAssign),
      canUploadImages: can(P.UploadsWrite),
      canManageAi: can(P.AiManage),
      canReadAiChats: can(P.AiChatsRead),
      canReplyAiChats: can(P.AiChatsReply),
      canDeleteAiChats: can(P.AiChatsDelete),
      canDeleteUsers: can(P.UsersDelete) && isPlatformAdminActor(user),
      canManageUserBlacklist: can(P.UsersBlacklist),
      canModerateReviews: can(P.ReviewsModerate),
      canManageDeliveries: can(P.DeliveriesManage),
      canReadTailors: can(P.TailorsRead),
      canManageTailors: can(P.TailorsManage),
      canReadTailoringJobs: can(P.TailoringJobsRead),
      canManageTailoringJobs: can(P.TailoringJobsManage),
    }),
    [can, user]
  );
}

export function permissionDeniedHref(
  from: string,
  permission?: Permission | null,
  options?: {
    reason?: string;
    user?: Pick<UserProfile, 'subscriptionPlan'> | null;
  }
) {
  const params = new URLSearchParams();
  params.set('from', from || '/admin');
  params.set('denied', 'permission');
  // Soft-upsell: non-Enterprise may open /admin/hq — so HQ 403 is Demo lock,
  // missing settings:manage, or storefront/registered-company surface mismatch —
  // never an "upgrade to Enterprise" entitlement message.
  const reason =
    options?.reason ||
    (sessionIsDemoPlan(options?.user)
      ? DEMO_FEATURE_LOCKED_MESSAGE
      : permission
        ? `You need the "${permission}" permission to open this page.`
        : 'You do not have permission to open this page.');
  params.set('reason', reason);
  return `/403?${params.toString()}`;
}
