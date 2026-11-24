'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Bot,
  Building2,
  Calculator,
  ClipboardList,
  CreditCard,
  FilePen,
  IdCard,
  LayoutDashboard,
  MapPin,
  Megaphone,
  PartyPopper,
  Scissors,
  Settings,
  Ticket,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useProfileQuery } from '@/hooks/useProfile';
import { useToast } from '@/contexts/toast-context';
import { clearUserQueries } from '@/utils/clearUserQueries';
import { isStorefrontOrgSession } from '@/hooks/useAdminPermission';
import {
  groupAdminNavChildrenBySection,
  type AdminNavIconKey,
  type AdminNavLink,
} from '@/lib/adminNav';
import {
  isVisibleNavGroup as isGroup,
  planLockedNavMessage,
  ACCOUNTING_PLAN_LOCKED_MESSAGE,
  POS_PLAN_LOCKED_MESSAGE,
  useVisibleAdminNav,
  WAIVERS_PLAN_LOCKED_MESSAGE,
  type VisibleNavChild,
} from '@/hooks/useVisibleAdminNav';
import DashboardBrandLogo, { sessionCompanyBrand } from '@/components/brand/CompanyBrandLogo';
import { postLogoutPath } from '@/lib/tenantDomain';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { useAdminRouteTransition } from '@/lib/adminInstantNav';
import { hydrateAllAdminListSnapshots } from '@/lib/adminListSnapshot';

interface AdminSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

function hrefQuery(href: string): string {
  const q = href.indexOf('?');
  if (q < 0) return '';
  const hash = href.indexOf('#', q);
  return (hash >= 0 ? href.slice(q + 1, hash) : href.slice(q + 1)) || '';
}

function isRouteActive(
  pathname: string,
  href: string,
  siblingHrefs: string[] = [],
  search = ''
) {
  if (href === '/admin') return pathname === '/admin';
  const hrefPath = (href.split('?')[0] ?? href).split('#')[0] ?? href;
  const wantQuery = hrefQuery(href);
  const haveQuery = search.startsWith('?') ? search.slice(1) : search;
  if (pathname === hrefPath) {
    // Marketing desk: ?tab= siblings share one path — match the query exactly.
    if (
      hrefPath === '/admin/marketing' &&
      siblingHrefs.some((s) => hrefQuery(s).length > 0 || s.includes('?tab='))
    ) {
      if (!wantQuery) return !haveQuery || !haveQuery.includes('tab=');
      return haveQuery === wantQuery || haveQuery.includes(wantQuery);
    }
    return true;
  }
  if (!pathname.startsWith(`${hrefPath}/`)) return false;
  // A more specific sibling owns this path (e.g. /bookings/new vs /bookings).
  const longerSiblingOwns = siblingHrefs.some((sibling) => {
    const siblingPath = (sibling.split('?')[0] ?? sibling).split('#')[0] ?? sibling;
    return (
      siblingPath !== hrefPath &&
      siblingPath.length > hrefPath.length &&
      (pathname === siblingPath || pathname.startsWith(`${siblingPath}/`))
    );
  });
  return !longerSiblingOwns;
}

/** One icon per app — matched to what the app does (lucide, same stroke style everywhere). */
const NAV_ICONS: Record<AdminNavIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  venues: MapPin,
  catalog: UtensilsCrossed,
  operations: ClipboardList,
  bookings: Ticket,
  parties: PartyPopper,
  pos: CreditCard,
  accounting: Calculator,
  memberships: IdCard,
  waivers: FilePen,
  marketing: Megaphone,
  tailors: Scissors,
  ai: Bot,
  users: Users,
  workspaces: Building2,
  settings: Settings,
};

function navIcon(key: AdminNavIconKey, active: boolean): ReactNode {
  const Icon = NAV_ICONS[key];
  if (!Icon) return null;
  return (
    <Icon
      aria-hidden
      strokeWidth={1.8}
      className={`h-5 w-5 shrink-0 transition-colors ${active ? 'text-[#D4AF37]' : 'text-gray-400'}`}
    />
  );
}

export default function AdminSidebar({ isOpen = true, onClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeTransition = useAdminRouteTransition();
  // While Opening…, highlight the clicked destination even if App Router
  // pathname has not caught up yet (address bar already shows it).
  const activePath = routeTransition.href || pathname;
  // Prefer address-bar search during soft-nav (pushState updates it first).
  const activeSearch =
    typeof window !== 'undefined' && routeTransition.href
      ? window.location.search.replace(/^\?/, '')
      : searchParams.toString();
  const router = useRouter();
  const { logout, user, isAuthenticated } = useAuthStore();
  const { data: profile } = useProfileQuery(Boolean(isAuthenticated));
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const greetingName = useMemo(() => {
    const profileFullName = [profile?.firstName, profile?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return (
      profileFullName ||
      user?.fullName?.trim() ||
      user?.name?.trim() ||
      user?.email?.split('@')[0] ||
      'there'
    );
  }, [profile?.firstName, profile?.lastName, user?.fullName, user?.name, user?.email]);

  const visibleNavigation = useVisibleAdminNav();

  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  // Group chevrons only accordion-close other *groups*. Leaf items (Parties,
  // POS, …) never touch this map, so a peeked dropdown stayed open after
  // navigating there. Clearing overrides lets expansion follow the route
  // (`childActive`) again.
  const closeNavGroupOverrides = () => setManualOpen({});

  const prefetchGroupChildren = () => {
    // Snapshots only — do NOT warm every child chunk (webpack stampede / OOM).
    // Each leaf warms itself on hover via AdminPendingLink.
    // Memberships used to warm all 6 leaves here and cancelled soft-nav mid-flight
    // (Opening cleared → previous page flashed back).
    if (user?.orgId) {
      hydrateAllAdminListSnapshots(queryClient, user.orgId);
    }
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    const afterLogout = postLogoutPath(
      sessionCompanyBrand(user) ? user?.organizationSlug : null
    );
    try {
      clearUserQueries(queryClient);
      await logout();
      addToast('Logout successful!', 'success');
      router.replace(afterLogout);
    } catch (error) {
      console.error('Logout error:', error);
      addToast('Logout failed, but redirecting...', 'error');
      router.replace(afterLogout);
    }
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-50 w-[min(16rem,85vw)] max-w-xs bg-white border-r border-gray-200 flex flex-col transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 lg:w-64 lg:max-w-none`}
      >
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-4 border-b border-gray-200 bg-[#0B1F2A]">
          <div className="flex items-center min-w-0 flex-1 pr-2">
            <AdminPendingLink href="/admin" className="min-w-0 inline-flex">
              <DashboardBrandLogo user={user} variant="onDark" className="min-w-0" />
            </AdminPendingLink>
          </div>

          <button
            onClick={onClose}
            className="lg:hidden p-2 text-white hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-shrink-0 px-6 py-4">
          <p className="text-sm text-gray-600 truncate" title={`Hello ${greetingName}`}>
            Hello {greetingName}
          </p>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-2 [scrollbar-width:thin] [scrollbar-color:#c4c4c4_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 hover:[&::-webkit-scrollbar-thumb]:bg-gray-400">
          <ul className="space-y-2 pb-2">
            {visibleNavigation.map((item) => {
              if (isGroup(item)) {
                if (item.name === 'Waivers') {
                  const href = '/admin/waivers';
                  const isActive =
                    activePath === href || activePath.startsWith(`${href}/`);
                  const demoLocked =
                    item.children.length > 0 &&
                    item.children.every((child) => child.demoLocked);
                  return (
                    <li key={item.name}>
                      <AdminPendingLink
                        href={href}
                        title={demoLocked ? WAIVERS_PLAN_LOCKED_MESSAGE : undefined}
                        onNavigate={() => {
                          closeNavGroupOverrides();
                          if (demoLocked) {
                            addToast(WAIVERS_PLAN_LOCKED_MESSAGE, 'info');
                          }
                          onClose?.();
                        }}
                        className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          demoLocked
                            ? 'text-gray-600 opacity-80 hover:bg-gray-50 hover:text-gray-900'
                            : isActive
                              ? 'bg-[#D4AF37]/20 text-gray-900'
                              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                        trailing={
                          demoLocked ? (
                            <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-900">
                              Upgrade
                            </span>
                          ) : null
                        }
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          {navIcon(item.icon, isActive)}
                          <span className="truncate">{item.name}</span>
                        </span>
                      </AdminPendingLink>
                    </li>
                  );
                }
                const siblingHrefs = item.children.map((c) => c.href);
                const childActive = item.children.some((child) =>
                  isRouteActive(
                    activePath,
                    child.href,
                    siblingHrefs,
                    activeSearch
                  )
                );
                // Closed by default until clicked. Keep the active section open
                // so the current page stays visible in the nav.
                const expanded =
                  manualOpen[item.name] === undefined
                    ? childActive
                    : Boolean(manualOpen[item.name]);
                return (
                  <li key={item.name}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !expanded;
                        setManualOpen((prev) => {
                          if (!next) {
                            // Closing this group only — keep other overrides.
                            // Replacing the whole map with `{ [name]: false }`
                            // cleared sibling closes, so Online Booking (and
                            // any active section) fell back to childActive and
                            // re-opened by itself.
                            return { ...prev, [item.name]: false };
                          }
                          // Accordion: opening one group closes every other group.
                          const closed: Record<string, boolean> = {};
                          for (const entry of visibleNavigation) {
                            if (isGroup(entry) && entry.name !== item.name) {
                              closed[entry.name] = false;
                            }
                          }
                          closed[item.name] = true;
                          return closed;
                        });
                        if (next) prefetchGroupChildren();
                      }}
                      onMouseEnter={() => prefetchGroupChildren()}
                      onFocus={() => prefetchGroupChildren()}
                      className={`flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        childActive
                          ? 'bg-[#D4AF37]/20 text-gray-900'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                      aria-expanded={expanded}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {navIcon(item.icon, childActive)}
                        <span className="truncate">{item.name}</span>
                      </span>
                      <svg
                        className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expanded && (
                      <ul className="mt-1 ml-2 min-w-0 space-y-1 border-l border-gray-100 pl-2 sm:ml-4 sm:pl-3">
                        {groupAdminNavChildrenBySection(item.children).map(
                          (bucket) => {
                            /** Every leaf keeps its own destination — never remap to a shared URL. */
                            const renderChild = (child: VisibleNavChild) => {
                              const isActive = isRouteActive(
                                activePath,
                                child.href,
                                siblingHrefs,
                                activeSearch
                              );
                              const hqLocked =
                                child.href === '/admin/hq' &&
                                user?.enterpriseHqEnabled !== true &&
                                !isStorefrontOrgSession(user);
                              const showUpgrade =
                                Boolean(child.demoLocked) || hqLocked;
                              return (
                                <li
                                  key={`${item.name}:${child.href}`}
                                  className="min-w-0"
                                >
                                  <AdminPendingLink
                                    href={child.href}
                                    title={
                                      child.demoLocked
                                        ? planLockedNavMessage(child.href)
                                        : undefined
                                    }
                                    onNavigate={() => {
                                      closeNavGroupOverrides();
                                      if (child.demoLocked) {
                                        addToast(
                                          planLockedNavMessage(child.href),
                                          'info'
                                        );
                                      }
                                      onClose?.();
                                    }}
                                    className={`flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors sm:px-3 ${
                                      child.demoLocked
                                        ? 'text-gray-600 opacity-80 hover:bg-gray-50 hover:text-gray-900'
                                        : isActive
                                          ? 'bg-[#D4AF37]/20 font-medium text-gray-900'
                                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                    }`}
                                    trailing={
                                      showUpgrade ? (
                                        <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-900">
                                          Upgrade
                                        </span>
                                      ) : null
                                    }
                                  >
                                    <span className="truncate">
                                      {child.name}
                                    </span>
                                  </AdminPendingLink>
                                </li>
                              );
                            };

                            if (!bucket.section) {
                              return bucket.items.map(renderChild);
                            }

                            const sectionKey = `${item.name}::${bucket.section}`;
                            // Section labels are static — always show every leaf Link
                            // (no nested accordion that hides / skips destinations).
                            return (
                              <li
                                key={sectionKey}
                                className="min-w-0 pt-1 first:pt-0"
                              >
                                <div className="px-2.5 py-1 sm:px-3">
                                  <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                                    {bucket.section}
                                  </span>
                                </div>
                                <ul className="mt-0.5 min-w-0 space-y-0.5 border-l border-gray-100 pl-2 sm:pl-2.5">
                                  {bucket.items.map(renderChild)}
                                </ul>
                              </li>
                            );
                          }
                        )}
                      </ul>
                    )}
                  </li>
                );
              }

              const link = item as AdminNavLink & { demoLocked?: boolean };
              const isActive =
                link.href === '/admin/pos'
                  ? activePath === '/admin/pos' ||
                    activePath.startsWith('/admin/pos/')
                  : link.href === '/admin/accounting'
                    ? activePath === '/admin/accounting' ||
                      activePath.startsWith('/admin/accounting/')
                    : isRouteActive(activePath, link.href);
              const demoLocked = Boolean(link.demoLocked);
              const lockMessage =
                link.href === '/admin/pos'
                  ? POS_PLAN_LOCKED_MESSAGE
                  : link.href === '/admin/accounting'
                    ? ACCOUNTING_PLAN_LOCKED_MESSAGE
                    : planLockedNavMessage(link.href);
              return (
                <li key={`${link.name}:${link.href}`}>
                  <AdminPendingLink
                    href={link.href}
                    title={demoLocked ? lockMessage : undefined}
                    onNavigate={() => {
                      closeNavGroupOverrides();
                      if (demoLocked) {
                        addToast(lockMessage, 'info');
                      }
                      onClose?.();
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      demoLocked
                        ? 'text-gray-600 opacity-80 hover:bg-gray-50 hover:text-gray-900'
                        : isActive
                          ? 'bg-[#D4AF37]/20 text-gray-900'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                    trailing={
                      demoLocked ? (
                        <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-900">
                          Upgrade
                        </span>
                      ) : null
                    }
                  >
                    <span className="flex items-center space-x-3 min-w-0">
                      {navIcon(link.icon, isActive)}
                      <span className="truncate">{link.name}</span>
                    </span>
                  </AdminPendingLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex-shrink-0 p-4 bg-black border-t border-gray-700">
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className={`flex items-center space-x-3 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 w-full group ${
              isLoggingOut
                ? 'text-gray-400 cursor-not-allowed'
                : 'text-white hover:text-gray-300 hover:bg-gray-800 cursor-pointer'
            }`}
          >
            {isLoggingOut ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 transition-transform duration-200 group-hover:translate-x-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
              </svg>
            )}
            <span>{isLoggingOut ? 'Logging out...' : 'Log out'}</span>
          </button>
        </div>
      </div>
    </>
  );
}
