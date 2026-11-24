'use client';

import { useMemo } from 'react';
import { useAuthStore } from '@/store/authStore';
import {
  isAdminPageAllowed,
  isStorefrontOrgSession,
  isStorefrontPlatformSuperAdmin,
} from '@/hooks/useAdminPermission';
import {
  ADMIN_NAV_ITEMS,
  ACCOUNTING_APP_TABS,
  isOnlineBookingNavHref,
  isPartiesNavHref,
  isMarketingNavHref,
  isAccountingNavHref as isAccountingNavHrefFromNav,
  type AdminNavChild,
  type AdminNavGroup,
  type AdminNavLink,
} from '@/lib/adminNav';
import {
  DEMO_FEATURE_LOCKED_MESSAGE,
  sessionIsDemoPlan,
} from '@/lib/demoPlanLock';
import { P } from '@/lib/auth/permissions';
import { planAllowsModule } from '@/lib/subscriptionPlans';
import { useAccountingInitialized } from '@/hooks/useAccounting';

export const MEMBERSHIPS_PLAN_LOCKED_MESSAGE =
  'Guest park Memberships needs Growth or Enterprise. Open Billing to upgrade.';

export const WAIVERS_PLAN_LOCKED_MESSAGE =
  'Digital Waivers needs Growth or Enterprise. Open Billing to upgrade.';

export const MARKETING_PLAN_LOCKED_MESSAGE =
  'Guest Marketing Automation needs Growth or Enterprise. Open Billing to upgrade.';

export const POS_PLAN_LOCKED_MESSAGE =
  'POS needs Growth or Enterprise. Open Billing to upgrade.';

export const ACCOUNTING_PLAN_LOCKED_MESSAGE =
  'Accounting needs Growth or Enterprise. Open Billing to upgrade.';

function isMembershipsNavHref(href: string): boolean {
  const path = (href.split('?')[0] ?? href).split('#')[0] ?? href;
  return path === '/admin/memberships' || path.startsWith('/admin/memberships/');
}

function isAccountingNavHref(href: string): boolean {
  return isAccountingNavHrefFromNav(href);
}

function isWaiversNavHref(href: string): boolean {
  const path = (href.split('?')[0] ?? href).split('#')[0] ?? href;
  return path === '/admin/waivers' || path.startsWith('/admin/waivers/');
}

function isPosNavHref(href: string): boolean {
  const path = (href.split('?')[0] ?? href).split('#')[0] ?? href;
  return path === '/admin/pos' || path.startsWith('/admin/pos/');
}

export function planLockedNavMessage(href: string): string {
  if (isMembershipsNavHref(href)) return MEMBERSHIPS_PLAN_LOCKED_MESSAGE;
  if (isWaiversNavHref(href)) return WAIVERS_PLAN_LOCKED_MESSAGE;
  if (isMarketingNavHref(href)) return MARKETING_PLAN_LOCKED_MESSAGE;
  if (isPosNavHref(href)) return POS_PLAN_LOCKED_MESSAGE;
  if (isAccountingNavHref(href)) return ACCOUNTING_PLAN_LOCKED_MESSAGE;
  return DEMO_FEATURE_LOCKED_MESSAGE;
}

export type VisibleNavChild = AdminNavChild & { demoLocked?: boolean };
export type VisibleNavLink = AdminNavLink & { demoLocked?: boolean };
export type VisibleNavGroup = Omit<AdminNavGroup, 'children'> & {
  children: VisibleNavChild[];
};
export type VisibleNavEntry = VisibleNavLink | VisibleNavGroup;

export function isVisibleNavGroup(
  item: VisibleNavEntry
): item is VisibleNavGroup {
  return item.type === 'group';
}

/**
 * ADMIN_NAV_ITEMS filtered for the current session (RBAC, plan modules,
 * Demo lock soft-upsell). Shared by AdminSidebar and the header app search.
 */
export function useVisibleAdminNav(): VisibleNavEntry[] {
  const { user, can } = useAuthStore();
  const demoPlan = sessionIsDemoPlan(user);
  const storefront = isStorefrontOrgSession(user);
  const superAdmin = isStorefrontPlatformSuperAdmin(user);
  return useMemo(() => {
    const resolveChild = (child: AdminNavChild): VisibleNavChild | null => {
      const gate = isAdminPageAllowed(child.href, can, user);
      // Park-locked franchise managers: clarify park Connect vs company SaaS Billing
      // (Billing stays filtered out via isAdminPageAllowed / isParkLockedCompanyHqPath).
      const labeledChild =
        child.href === '/admin/booking-packages' &&
        !can(P.BookingPackagesManage) &&
        can(P.MarketplaceRefunds)
          ? { ...child, name: 'Marketplace bookings' }
          : child.href === '/admin/payouts' &&
              user?.parkLocked === true &&
              user?.franchiseParkManager === true
            ? { ...child, name: 'Park payouts' }
            : child;
      if (gate.allowed) return { ...labeledChild, demoLocked: false };

      // Project owner: never hide a known admin inventory route from the sidebar.
      if (superAdmin && gate.known) {
        return { ...labeledChild, demoLocked: false };
      }

      // Guest park Memberships: Growth+ only — keep discoverable with Upgrade → Billing
      // on Demo/Starter (same pattern as Online Booking soft-upsell).
      if (
        !storefront &&
        isMembershipsNavHref(child.href) &&
        gate.known &&
        gate.permission &&
        !planAllowsModule(user?.subscriptionPlan, 'memberships') &&
        (can(gate.permission) ||
          can(P.MembershipsRead) ||
          can(P.MembershipsSell) ||
          can(P.MembershipsBilling) ||
          can(P.MembershipsRedeem) ||
          can(P.MembershipsAdmin))
      ) {
        return { ...labeledChild, demoLocked: true };
      }

      if (
        !storefront &&
        isPosNavHref(child.href) &&
        gate.known &&
        gate.permission &&
        !planAllowsModule(user?.subscriptionPlan, 'pos') &&
        (can(gate.permission) ||
          can(P.PosRead) ||
          can(P.PosSell) ||
          can(P.PosAdmin) ||
          can(P.PosCheckin) ||
          can(P.PosTabs) ||
          can(P.PosTillOpen))
      ) {
        return { ...labeledChild, demoLocked: true };
      }

      if (
        !storefront &&
        isAccountingNavHref(child.href) &&
        gate.known &&
        gate.permission &&
        !planAllowsModule(user?.subscriptionPlan, 'accounting') &&
        (can(gate.permission) ||
          can(P.AccountingRead) ||
          can(P.AccountingManage) ||
          can(P.AccountingExpensesSubmit))
      ) {
        return { ...labeledChild, demoLocked: true };
      }

      // Digital Waivers: Growth+ only — keep discoverable with Upgrade → Billing.
      if (
        !storefront &&
        isWaiversNavHref(child.href) &&
        gate.known &&
        gate.permission &&
        !planAllowsModule(user?.subscriptionPlan, 'waivers') &&
        (can(gate.permission) ||
          can(P.WaiversRead) ||
          can(P.WaiversWrite) ||
          can(P.WaiversAdmin))
      ) {
        return { ...labeledChild, demoLocked: true };
      }

      if (
        !storefront &&
        isMarketingNavHref(child.href) &&
        gate.known &&
        gate.permission &&
        !planAllowsModule(user?.subscriptionPlan, 'marketing') &&
        (can(gate.permission) ||
          can(P.MarketingRead) ||
          can(P.MarketingWrite) ||
          can(P.MarketingSurveys))
      ) {
        return { ...labeledChild, demoLocked: true };
      }

      // Demo companies: keep Online Booking discoverable with Upgrade → Billing.
      if (
        demoPlan &&
        !storefront &&
        (isOnlineBookingNavHref(child.href) || isPartiesNavHref(child.href)) &&
        !isMembershipsNavHref(child.href) &&
        gate.known &&
        gate.permission &&
        (can(gate.permission) ||
          (child.href.startsWith('/admin/ticketing/settings') &&
            (can(P.TicketingRead) || can(P.TicketingManage))) ||
          (child.href === '/admin/booking-packages' &&
            can(P.MarketplaceRefunds)))
      ) {
        return { ...labeledChild, demoLocked: true };
      }
      return null;
    };

    return ADMIN_NAV_ITEMS.map((item) => {
      if (item.type === 'group') {
        const children = item.children
          .map(resolveChild)
          .filter((c): c is VisibleNavChild => c != null);
        if (children.length === 0) return null;
        const name =
          item.name === 'Workspace settings' && storefront
            ? 'Platform settings'
            : item.name;
        return { ...item, name, children };
      }
      const gate = isAdminPageAllowed(item.href, can, user);
      if (gate.allowed) return { ...item, demoLocked: false };
      if (superAdmin && (gate.known || item.href === '/admin')) {
        return { ...item, demoLocked: false };
      }
      // POS: Growth+ only — keep discoverable with Upgrade → Billing (flat link).
      if (
        !storefront &&
        isPosNavHref(item.href) &&
        gate.known &&
        gate.permission &&
        !planAllowsModule(user?.subscriptionPlan, 'pos') &&
        (can(gate.permission) ||
          can(P.PosRead) ||
          can(P.PosSell) ||
          can(P.PosAdmin) ||
          can(P.PosCheckin) ||
          can(P.PosTabs) ||
          can(P.PosTillOpen))
      ) {
        return { ...item, demoLocked: true };
      }
      // Accounting (flat link): Growth+ soft-upsell.
      if (
        !storefront &&
        isAccountingNavHref(item.href) &&
        gate.known &&
        gate.permission &&
        !planAllowsModule(user?.subscriptionPlan, 'accounting') &&
        (can(gate.permission) ||
          can(P.AccountingRead) ||
          can(P.AccountingManage) ||
          can(P.AccountingExpensesSubmit))
      ) {
        return { ...item, demoLocked: true };
      }
      // Marketing (flat link): Growth+ only — keep discoverable with Upgrade → Billing.
      if (
        !storefront &&
        isMarketingNavHref(item.href) &&
        gate.known &&
        gate.permission &&
        !planAllowsModule(user?.subscriptionPlan, 'marketing') &&
        (can(gate.permission) ||
          can(P.MarketingRead) ||
          can(P.MarketingWrite) ||
          can(P.MarketingSurveys))
      ) {
        return { ...item, demoLocked: true };
      }
      // Parties (flat link): Demo companies keep it discoverable with Upgrade → Billing.
      if (
        demoPlan &&
        !storefront &&
        isPartiesNavHref(item.href) &&
        gate.known &&
        gate.permission &&
        can(gate.permission)
      ) {
        return { ...item, demoLocked: true };
      }
      return null;
    }).filter((item): item is VisibleNavEntry => item != null);
  }, [can, user, demoPlan, storefront, superAdmin]);
}

/** Flat Accounting feature list for app search (sidebar no longer expands them). */
export function useAccountingSearchApps(): Array<{
  key: string;
  name: string;
  href: string;
  context: string;
  demoLocked: boolean;
  upgrade: boolean;
}> {
  const { user, can } = useAuthStore();
  const storefront = isStorefrontOrgSession(user);
  const demoPlan = sessionIsDemoPlan(user);
  const { initialized } = useAccountingInitialized(
    !storefront && (can(P.AccountingRead) || can(P.AccountingManage))
  );
  const planLocked =
    !storefront && !planAllowsModule(user?.subscriptionPlan, 'accounting');

  return useMemo(() => {
    let section: string | null = null;
    const out: Array<{
      key: string;
      name: string;
      href: string;
      context: string;
      demoLocked: boolean;
      upgrade: boolean;
    }> = [];
    for (const tab of ACCOUNTING_APP_TABS) {
      if (tab.section) section = tab.section;
      if (initialized === true && tab.href === '/admin/accounting/setup') continue;
      const gate = isAdminPageAllowed(tab.href, can, user);
      if (!gate.allowed && !(planLocked && gate.known)) continue;
      const demoLocked = Boolean(planLocked || demoPlan);
      out.push({
        key: `Accounting:${tab.href}`,
        name: tab.name,
        href: tab.href,
        context: section ? `Accounting · ${section}` : 'Accounting',
        demoLocked,
        upgrade: demoLocked,
      });
    }
    return out;
  }, [can, user, initialized, planLocked, demoPlan]);
}
