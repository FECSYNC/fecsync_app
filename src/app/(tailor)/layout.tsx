'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { isTailorProviderPreset } from '@/lib/auth/permissions';
import { currentReturnTo, signInHref } from '@/utils/authRedirect';
import UserTailoringAlerts from '@/components/common/UserTailoringAlerts';
import TailorBottomNav from '@/components/Protected/tailor/TailorBottomNav';
import { useNotificationsQuery } from '@/hooks/useNotifications';
import { invalidateOrgSaasQueries } from '@/utils/invalidateOrgSaasQueries';
import { orgBillingFingerprint } from '@/utils/orgSaasSessionSync';

export default function TailorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { user, hasHydratedAuth, isStaff, hydrateFromCookie, silentRefresh } =
    useAuthStore();
  const { data: notifications = [] } = useNotificationsQuery(Boolean(user));
  const unread = notifications.filter((n) => !n.read).length;

  // Same waiting-room gate as AdminLayout — pending/suspended/soft-hold
  // cannot use studio (export/offboard still on /company-pending for billing holds).
  // SuspendedAccountGate owns the ops_hold dialog on /tailor — do not emit here.
  useEffect(() => {
    if (!user || !hasHydratedAuth) return;
    if (
      user.orgStatus === 'pending' ||
      user.orgStatus === 'suspended' ||
      user.billingSoftHold === true
    ) {
      router.replace('/company-pending');
    }
  }, [user, hasHydratedAuth, router]);

  // Refresh /me so lazy-expire / remote suspend propagates into orgStatus.
  // When billing fields change, drop stale plan-cap list caches (campaigns/clients).
  useEffect(() => {
    if (!user?.orgId || !hasHydratedAuth) return;
    if (
      user.orgStatus === 'pending' ||
      user.orgStatus === 'suspended' ||
      user.billingSoftHold === true
    ) {
      return;
    }
    let cancelled = false;

    invalidateOrgSaasQueries(queryClient);

    const run = async () => {
      const before = orgBillingFingerprint(useAuthStore.getState().user);
      await silentRefresh().catch(() => undefined);
      if (cancelled) return;
      const after = orgBillingFingerprint(useAuthStore.getState().user);
      if (before !== after) {
        invalidateOrgSaasQueries(queryClient);
      }
    };
    void run();
    const id = window.setInterval(() => {
      void run();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user?.orgId, user?.orgStatus, user?.billingSoftHold, hasHydratedAuth, silentRefresh, queryClient]);

  useEffect(() => {
    if (user) {
      const isTailor = isTailorProviderPreset(
        user.preset,
        user.membershipRole
      );
      if (!isTailor && !isStaff()) {
        router.replace(
          `/403?from=${encodeURIComponent(pathname || '/tailor/home')}&reason=${encodeURIComponent('This area is for tailor providers.')}`
        );
        return;
      }
      setReady(true);
      return;
    }

    if (!hasHydratedAuth) return;

    // Cookies can be valid right after login while the client store is briefly
    // empty — hydrate before bouncing to sign-in (same pattern as AdminLayout).
    let cancelled = false;
    void (async () => {
      try {
        await hydrateFromCookie();
      } catch {
        // Fall through to gate check.
      }
      if (cancelled) return;
      const nextUser = useAuthStore.getState().user;
      if (!nextUser) {
        router.replace(signInHref(currentReturnTo(pathname)));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, hasHydratedAuth, router, pathname, isStaff, hydrateFromCookie]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 text-sm text-stone-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 pb-20 md:pb-0 overflow-x-hidden">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-3 sm:px-4 py-3 min-w-0">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#D4AF37]">
              FECSYNC
            </p>
            <h1 className="text-base font-semibold text-stone-900 truncate">
              {pathname.startsWith('/tailor/home') || pathname === '/tailor'
                ? 'Home'
                : 'Tailor workspace'}
            </h1>
          </div>
          <nav className="hidden items-center gap-3 text-sm md:flex">
            <Link
              href="/tailor/home"
              className={`hover:text-stone-900 ${pathname.startsWith('/tailor/home') ? 'font-medium text-stone-900' : 'text-stone-600'}`}
            >
              Home
            </Link>
            <Link
              href="/tailor/campaigns"
              className={`hover:text-stone-900 ${pathname.startsWith('/tailor/campaigns') ? 'font-medium text-stone-900' : 'text-stone-600'}`}
            >
              Campaigns
            </Link>
            <Link
              href="/tailor/jobs"
              className={`hover:text-stone-900 ${pathname.startsWith('/tailor/jobs') ? 'font-medium text-stone-900' : 'text-stone-600'}`}
            >
              Jobs
            </Link>
            <Link
              href="/tailor/dashboard"
              className={`hover:text-stone-900 ${pathname.startsWith('/tailor/dashboard') ? 'font-medium text-stone-900' : 'text-stone-600'}`}
            >
              Studio profile
            </Link>
            <UserTailoringAlerts jobBasePath="/tailor/jobs" />
            <Link
              href="/tailor/notifications"
              className="relative rounded-lg p-2 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              aria-label="Notifications"
            >
              <Bell size={18} />
              {unread > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null}
            </Link>
            <Link href="/home" className="text-stone-500 hover:text-stone-800">
              Store
            </Link>
          </nav>
          <div className="flex items-center gap-1 sm:gap-2 md:hidden shrink-0">
            <Link
              href="/home"
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100"
            >
              Store
            </Link>
            <Link
              href="/tailor/notifications"
              className="relative rounded-lg p-2 text-stone-600"
              aria-label="Notifications"
            >
              <Bell size={20} />
              {unread > 0 ? (
                <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl min-w-0 px-3 sm:px-4 py-4 sm:py-6">{children}</main>
      <TailorBottomNav />
    </div>
  );
}
