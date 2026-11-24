'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { navigateAdminRoute } from '@/lib/adminInstantNav';
import { hydrateAllAdminListSnapshots } from '@/lib/adminListSnapshot';
import { listAdminVenueLocations, venueLocationKeys } from '@/services/venueLocations';
import {
  adminPartyKeys,
  getAdminPartySettings,
  listAdminParties,
  listAdminPartyBalances,
  listAdminPartyMenu,
  listAdminPartyPackages,
  listAdminPartyRooms,
  listAdminPartyRunSheets,
} from '@/services/adminParties';
import { usePartyCrossTabSync } from '@/utils/partyCrossTabSync';
import PartyPackagesPage from './PartyPackagesPage';
import PartyRoomsPage from './PartyRoomsPage';
import PartyMenuPage from './PartyMenuPage';
import PartyBalancesPage from './PartyBalancesPage';
import PartySettingsPage from './PartySettingsPage';
import PartyRunSheetsPrintPage from './PartyRunSheetsPrintPage';
import { todayInZone } from './partyFormat';
import {
  PARTIES_DESK_TABS,
  PartiesDeskContext,
  PartiesInDeskContext,
  type PartiesDeskApi,
  type PartiesDeskPanel,
} from './partiesDesk';

/** Panels are bundled with the layout (static imports) so opening never waits on a chunk / dev compile. */
const PANELS: Record<PartiesDeskPanel, () => ReactNode> = {
  packages: () => <PartyPackagesPage />,
  rooms: () => <PartyRoomsPage />,
  menu: () => <PartyMenuPage />,
  balances: () => <PartyBalancesPage />,
  'run-sheets': () => <PartyRunSheetsPrintPage />,
  settings: () => <PartySettingsPage />,
};

/** Warm every panel's data once per session, one request at a time, after the page settles. */
let idleWarmDone = false;

export default function PartiesDeskHost({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  usePartyCrossTabSync();

  const [panel, setPanel] = useState<PartiesDeskPanel | null>(null);

  const canRead = can(P.PartiesRead);
  /**
   * Direct prefetch with the exact keys each panel reads (no dynamic import —
   * under yarn dev that import compiled first and the warm landed too late).
   * Fresh cache is skipped by React Query, so repeat hovers cost nothing.
   */
  const warmPanel = useCallback(
    (p: PartiesDeskPanel) => {
      if (!canRead) return;
      const warm = <T,>(queryKey: readonly unknown[], queryFn: () => Promise<T>) =>
        void qc.prefetchQuery({ queryKey, queryFn, staleTime: 30_000 }).catch(() => undefined);
      warm(venueLocationKeys.list('all'), () => listAdminVenueLocations({ scope: 'all' }));
      if (p === 'packages') {
        warm(adminPartyKeys.packages({ status: 'all' }), () => listAdminPartyPackages({ status: 'all' }));
        // The create / edit sheet reads these.
        warm(adminPartyKeys.rooms({}), () => listAdminPartyRooms({}));
        warm(adminPartyKeys.menu({}), () => listAdminPartyMenu({}));
      }
      if (p === 'rooms') {
        warm(adminPartyKeys.rooms({ includeArchived: true }), () => listAdminPartyRooms({ includeArchived: true }));
        const today = { date: 'today', take: 25, skip: 0 };
        warm(adminPartyKeys.list(today), () => listAdminParties(today));
      }
      if (p === 'menu') warm(adminPartyKeys.menu({ includeArchived: true }), () => listAdminPartyMenu({ includeArchived: true }));
      if (p === 'balances') warm(adminPartyKeys.balances({ take: 500 }), () => listAdminPartyBalances({ take: 500 }));
      if (p === 'run-sheets') {
        const today = todayInZone(null);
        warm(adminPartyKeys.runSheets(today, undefined), () => listAdminPartyRunSheets(today, undefined));
      }
      if (p === 'settings') {
        warm(adminPartyKeys.settings(null), () => getAdminPartySettings(null));
        // Each venue's overrides too (venue list is already cached) — switching venues is then instant.
        const venues = qc.getQueryData<Array<{ id: string; status?: string }>>(venueLocationKeys.list('all')) ?? [];
        for (const v of venues.filter((x) => x.status !== 'archived').slice(0, 8)) {
          warm(adminPartyKeys.settings(v.id), () => getAdminPartySettings(v.id));
        }
      }
    },
    [qc, canRead]
  );

  // Last session's panel data (sessionStorage snapshots) → instant paint before any network.
  useEffect(() => {
    if (user?.orgId) hydrateAllAdminListSnapshots(qc, user.orgId);
  }, [qc, user?.orgId]);

  /**
   * Desk state is React-only on purpose. Writing ?panel= into the URL made the
   * Next router treat the change as a navigation (RSC refetch of the whole page,
   * full reload on Back) — the tab then "loaded the page" instead of the modal.
   */
  const openPanel = useCallback(
    (p: PartiesDeskPanel) => {
      setPanel(p);
      warmPanel(p);
    },
    [warmPanel]
  );

  const closePanel = useCallback(() => setPanel(null), []);

  // Any route change (sidebar, a link inside a panel) closes the desk.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setPanel(null);
  }, [pathname]);

  // Idle warm: one panel at a time, only while nothing else is loading and the tab is visible,
  // so it never competes with the page's own requests for the (small) database pool.
  useEffect(() => {
    if (idleWarmDone) return;
    idleWarmDone = true;
    const queue: PartiesDeskPanel[] = ['packages', 'balances', 'run-sheets', 'rooms', 'menu', 'settings'];
    let timer = 0;
    const step = () => {
      if (!queue.length) return;
      if (!document.hidden && qc.isFetching() === 0) warmPanel(queue.shift()!);
      timer = window.setTimeout(step, 1500);
    };
    timer = window.setTimeout(step, 2000);
    return () => window.clearTimeout(timer);
  }, [warmPanel, qc]);

  const api = useMemo<PartiesDeskApi>(
    () => ({ panel, openPanel, closePanel, warmPanel }),
    [panel, openPanel, closePanel, warmPanel]
  );

  return (
    <PartiesDeskContext.Provider value={api}>
      {children}
      {panel ? (
        <PartiesDeskModal
          panel={panel}
          onClose={closePanel}
          onSwitch={openPanel}
          onWarm={warmPanel}
          onGoToParties={() => {
            if (pathname === '/admin/parties') closePanel();
            else {
              setPanel(null);
              navigateAdminRoute(router, '/admin/parties');
            }
          }}
        />
      ) : null}
    </PartiesDeskContext.Provider>
  );
}

function PartiesDeskModal({
  panel,
  onClose,
  onSwitch,
  onWarm,
  onGoToParties,
}: {
  panel: PartiesDeskPanel;
  onClose: () => void;
  onSwitch: (panel: PartiesDeskPanel) => void;
  onWarm: (panel: PartiesDeskPanel) => void;
  onGoToParties: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Let a nested dialog (payment, refund…) handle its own Escape first.
      const nested = bodyRef.current?.querySelector('[role="dialog"], [aria-modal="true"]');
      if (nested) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [panel]);

  const label = PARTIES_DESK_TABS.find((t) => t.panel === panel)?.label ?? 'Parties';

  return (
    // lg:left-64 keeps the sidebar visible and clickable.
    <div className="fixed inset-y-0 left-0 right-0 z-[60] flex lg:left-64">
      <style>{`@keyframes partiesDeskIn{from{opacity:0;transform:translateY(10px) scale(.995)}to{opacity:1;transform:none}}@keyframes partiesDeskFade{from{opacity:0}to{opacity:1}}`}</style>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]"
        style={{ animation: 'partiesDeskFade 150ms ease-out' }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative m-0 flex w-full flex-col overflow-hidden bg-[#faf9f7] shadow-[0_24px_60px_-28px_rgba(28,25,23,0.55)] sm:m-3 sm:rounded-2xl sm:border sm:border-stone-200"
        style={{ animation: 'partiesDeskIn 180ms cubic-bezier(0.22,1,0.36,1)' }}
      >
        <header className="relative flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-5">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#D4AF37]/12 via-white to-white" />
          <nav className="relative flex min-w-0 flex-wrap gap-1.5 text-sm" aria-label="Parties sections">
            {PARTIES_DESK_TABS.map((t) => {
              const active = t.panel === panel;
              return (
                <button
                  key={t.href}
                  type="button"
                  onMouseEnter={() => (t.panel ? onWarm(t.panel) : undefined)}
                  onClick={() => (t.panel ? onSwitch(t.panel) : onGoToParties())}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-md px-3 py-1.5 font-medium transition ${
                    active
                      ? 'bg-[#D4AF37]/20 text-stone-900 ring-1 ring-[#D4AF37]/60'
                      : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="relative inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]/50"
          >
            <X className="h-4 w-4" />
            Close
            <kbd className="ml-1 hidden rounded border border-stone-200 px-1 text-[10px] text-stone-400 sm:inline">Esc</kbd>
          </button>
        </header>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <PartiesInDeskContext.Provider value={true}>
            <div key={panel}>{PANELS[panel]()}</div>
          </PartiesInDeskContext.Provider>
        </div>
      </div>
    </div>
  );
}
