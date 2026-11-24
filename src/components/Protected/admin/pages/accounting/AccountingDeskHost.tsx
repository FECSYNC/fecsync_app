"use client";

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { prefetchAdminRoute } from "@/lib/prefetchAdminRoute";
import {
  isAdminPageAllowed,
  isStorefrontOrgSession,
} from "@/hooks/useAdminPermission";
import { useAccountingInitialized } from "@/hooks/useAccounting";
import { planAllowsModule } from "@/lib/subscriptionPlans";
import { P } from "@/lib/auth/permissions";
import {
  ACCOUNTING_DESK_TABS,
  AccountingDeskContext,
  AccountingInDeskContext,
  accountingHrefFromPanel,
  accountingReportIdFromHref,
  accountingReportsHref,
  type AccountingDeskApi,
  type AccountingDeskPanel,
  type AccountingLedgerFocus,
} from "./accountingDesk";
import AccountingTabRail, {
  type AccountingTabRailItem,
} from "./AccountingTabRail";

function normalizeAccountingPath(pathname: string) {
  const path = (pathname.split("?")[0] ?? pathname).split("#")[0] ?? pathname;
  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
}

type PageMod = { default: ComponentType };

/**
 * Lazy panel loaders — first hover/idle warm compiles the chunk; after that
 * openPanel paints from cache with no route navigation.
 */
const LOADERS: Record<AccountingDeskPanel, () => Promise<PageMod>> = {
  dashboard: () => import("./dashboard/AccountingDashboardPage"),
  approvals: () => import("./approvals/ApprovalsInboxPage"),
  journals: () => import("./journals/JournalsPage"),
  ledger: () => import("./ledger/GeneralLedgerPage"),
  "chart-of-accounts": () => import("./chart/ChartOfAccountsPage"),
  customers: () => import("./customers/CustomersPage"),
  invoices: () => import("./invoices/InvoicesPage"),
  receipts: () => import("./receipts/ReceiptsPage"),
  suppliers: () => import("./suppliers/SuppliersPage"),
  "purchase-orders": () => import("./purchaseOrders/PurchaseOrdersPage"),
  bills: () => import("./bills/BillsPage"),
  "supplier-payments": () => import("./supplierPayments/SupplierPaymentsPage"),
  expenses: () => import("./expenses/ExpensesPage"),
  "expense-categories": () => import("./expenseCategories/ExpenseCategoriesPage"),
  banking: () => import("./banking/BankingOverviewPage"),
  "bank-accounts": () => import("./bankAccounts/BankAccountsPage"),
  transfers: () => import("./banking/TransfersPage"),
  reconciliations: () => import("./reconciliations/ReconciliationsPage"),
  inventory: () => import("./inventory/InventoryValuationPage"),
  "inventory-movements": () => import("./inventory/InventoryMovementsPage"),
  reports: () => import("./reports/ReportsHubPage"),
  tax: () => import("./tax/AccountingTaxPage"),
  periods: () => import("./periods/AccountingPeriodsPage"),
  "posting-queue": () => import("./postingQueue/PostingQueuePage"),
  audit: () => import("./audit/AccountingAuditPage"),
  setup: () => import("./setup/AccountingSetupWizard"),
  mappings: () => import("./mappings/AccountingMappingsPage"),
  "tax-codes": () => import("./taxCodes/AccountingTaxCodesPage"),
  "opening-balances": () => import("./openingBalances/OpeningBalancesPage"),
  settings: () => import("./settings/AccountingSettingsPage"),
};

const lazyCache = new Map<
  AccountingDeskPanel,
  React.LazyExoticComponent<ComponentType>
>();

function lazyPanel(panel: AccountingDeskPanel) {
  let Comp = lazyCache.get(panel);
  if (!Comp) {
    Comp = lazy(LOADERS[panel]);
    lazyCache.set(panel, Comp);
  }
  return Comp;
}

const preloadPromises = new Map<AccountingDeskPanel, Promise<unknown>>();

function preloadPanel(panel: AccountingDeskPanel) {
  let p = preloadPromises.get(panel);
  if (!p) {
    p = LOADERS[panel]().catch(() => undefined);
    preloadPromises.set(panel, p);
    lazyPanel(panel);
  }
  return p;
}

let idleWarmDone = false;

export default function AccountingDeskHost({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const qc = useQueryClient();
  const { can, user } = useAuthStore();
  const storefront = isStorefrontOrgSession(user);
  const planOk = planAllowsModule(user?.subscriptionPlan, "accounting");
  const { initialized } = useAccountingInitialized(
    !storefront && planOk && (can(P.AccountingRead) || can(P.AccountingManage))
  );

  const [panel, setPanel] = useState<AccountingDeskPanel | null>(null);
  const [retainedPanel, setRetainedPanel] =
    useState<AccountingDeskPanel | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [ledgerFocus, setLedgerFocus] = useState<AccountingLedgerFocus | null>(
    null
  );
  const [mounted, setMounted] = useState<Set<AccountingDeskPanel>>(
    () => new Set()
  );
  const panelRef = useRef<AccountingDeskPanel | null>(null);
  panelRef.current = panel;
  const reportIdRef = useRef<string | null>(null);
  reportIdRef.current = reportId;
  /** Skip clearing reportId when openPanel is invoked from openReport. */
  const keepReportOnOpenRef = useRef(false);
  /** Skip clearing ledgerFocus when openPanel is invoked from openLedger. */
  const keepLedgerFocusOnOpenRef = useRef(false);
  /**
   * Desk-driven router.replace calls — ignore N following pathname updates so
   * a racing relative `?query` rewrite cannot clear retainedPanel.
   */
  const skipPathCloseCountRef = useRef(0);
  const lastPath = useRef(pathname);

  /** JS chunk only — safe on hover; never stamps the API/compile queue. */
  const warmPanelChunk = useCallback((p: AccountingDeskPanel) => {
    void preloadPanel(p);
  }, []);

  /**
   * Keep the address bar on the tab’s canonical URL.
   *
   * While the desk modal is already open, tab switches use history.replaceState
   * ONLY — calling router.replace here kicks Turbopack RSC (often 30–100s) and
   * makes every tab feel “stuck”. App Router is synced on first open + close.
   */
  const syncPathToPanel = useCallback(
    (
      p: AccountingDeskPanel,
      mode: "switch" | "retain" | "open" = "switch",
      activeReportId?: string | null
    ) => {
      const href =
        p === "reports"
          ? accountingReportsHref(
              activeReportId === undefined
                ? reportIdRef.current
                : activeReportId
            )
          : accountingHrefFromPanel(p);
      const hrefPath = normalizeAccountingPath(href.split("?")[0] ?? href);
      const current = normalizeAccountingPath(pathname);
      if (mode === "retain" && current === hrefPath) {
        if (typeof window !== "undefined") {
          const bar = `${window.location.pathname}${window.location.search}`;
          if (bar === href) return;
          if (
            bar.split("?")[0] === hrefPath &&
            !window.location.search &&
            !href.includes("?")
          ) {
            return;
          }
        } else {
          return;
        }
      }
      if ((mode === "switch" || mode === "open") && current === hrefPath) {
        // Same path — still may need to set/clear ?report=.
        if (typeof window !== "undefined") {
          const bar = `${window.location.pathname}${window.location.search}`;
          if (bar === href) return;
        }
      }

      // Instant URL bar (same idea as navigateAdminRoute).
      if (typeof window !== "undefined") {
        const here = `${window.location.pathname}${window.location.search}`;
        if (here !== href) {
          try {
            const state =
              window.history.state && typeof window.history.state === "object"
                ? { ...window.history.state, __fecAcctDesk: href }
                : { __fecAcctDesk: href };
            window.history.replaceState(state, "", href);
          } catch {
            /* ignore SecurityError / quota */
          }
        }
      }

      // Desk already open → client panel swap only (no RSC).
      if (mode === "switch" && panelRef.current != null) {
        return;
      }

      // First open: App Router sync without the report query (desk keeps ?report via replaceState).
      const routerHref =
        p === "reports" ? accountingHrefFromPanel("reports") : hrefPath;
      skipPathCloseCountRef.current += 1;
      router.replace(routerHref);
    },
    [pathname, router]
  );

  const openPanel = useCallback(
    (p: AccountingDeskPanel) => {
      const opening = panelRef.current == null;
      if (!keepReportOnOpenRef.current) {
        setReportId(null);
      }
      if (!keepLedgerFocusOnOpenRef.current) {
        setLedgerFocus(null);
      }
      // Paint the panel immediately; URL bar via replaceState; RSC only on open.
      setRetainedPanel(p);
      setMounted((prev) => {
        if (prev.has(p)) return prev;
        const next = new Set(prev);
        next.add(p);
        return next;
      });
      setPanel(p);
      syncPathToPanel(
        p,
        opening ? "open" : "switch",
        keepReportOnOpenRef.current ? reportIdRef.current : null
      );
      void preloadPanel(p);
      // Dev: leaf useQuery already fetches — prefetch here fights Turbopack
      // (hard refresh logs showed 3–8min compiles + 90s API timeouts).
      if (process.env.NODE_ENV === "development") return;
      window.setTimeout(() => {
        prefetchAdminRoute(qc, accountingHrefFromPanel(p), can, user);
      }, 800);
    },
    [syncPathToPanel, qc, can, user]
  );

  const openReport = useCallback(
    (id: string) => {
      const next = id.trim();
      if (!next) return;
      setReportId(next);
      reportIdRef.current = next;
      keepReportOnOpenRef.current = true;
      openPanel("reports");
      keepReportOnOpenRef.current = false;
      syncPathToPanel(
        "reports",
        panelRef.current != null ? "switch" : "open",
        next
      );
      if (process.env.NODE_ENV === "development") return;
      window.setTimeout(() => {
        prefetchAdminRoute(
          qc,
          `/admin/accounting/reports/${encodeURIComponent(next)}`,
          can,
          user
        );
      }, 400);
    },
    [openPanel, syncPathToPanel, qc, can, user]
  );

  const clearReport = useCallback(() => {
    setReportId(null);
    reportIdRef.current = null;
    if (panelRef.current === "reports") {
      syncPathToPanel("reports", "switch", null);
    }
  }, [syncPathToPanel]);

  const openLedger = useCallback(
    (focus?: AccountingLedgerFocus | null) => {
      const next: AccountingLedgerFocus | null =
        focus?.accountId || focus?.systemKey
          ? {
              ...(focus.accountId ? { accountId: focus.accountId } : {}),
              ...(focus.systemKey ? { systemKey: focus.systemKey } : {}),
            }
          : null;
      setLedgerFocus(next);
      keepLedgerFocusOnOpenRef.current = true;
      openPanel("ledger");
      keepLedgerFocusOnOpenRef.current = false;
      // Address bar deep-link (replaceState only — Next searchParams may lag).
      if (typeof window !== "undefined" && next) {
        const qs = new URLSearchParams();
        if (next.accountId) qs.set("accountId", next.accountId);
        else if (next.systemKey) qs.set("systemKey", next.systemKey);
        const href = `/admin/accounting/ledger?${qs.toString()}`;
        try {
          window.history.replaceState(
            window.history.state && typeof window.history.state === "object"
              ? { ...window.history.state, __fecAcctDesk: href }
              : { __fecAcctDesk: href },
            "",
            href
          );
        } catch {
          /* ignore */
        }
      }
    },
    [openPanel]
  );

  const clearLedgerFocus = useCallback(() => {
    setLedgerFocus(null);
  }, []);

  const closePanel = useCallback(() => {
    const current = panelRef.current;
    if (current) {
      setRetainedPanel(current);
      // Ensure the address bar matches the tab we keep highlighted.
      syncPathToPanel(
        current,
        "retain",
        current === "reports" ? reportIdRef.current : null
      );
    }
    setPanel(null);
  }, [syncPathToPanel]);

  /**
   * External navigations (sidebar, detail links, browser back) dismiss the desk.
   * Report detail paths open the Reports desk in-place instead.
   * Path updates from syncPathToPanel are ignored via skipPathCloseCountRef.
   */
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (skipPathCloseCountRef.current > 0) {
      skipPathCloseCountRef.current -= 1;
      return;
    }
    const detailId = accountingReportIdFromHref(pathname);
    if (detailId) {
      setReportId(detailId);
      reportIdRef.current = detailId;
      setRetainedPanel("reports");
      setMounted((prev) => {
        if (prev.has("reports")) return prev;
        const next = new Set(prev);
        next.add("reports");
        return next;
      });
      setPanel("reports");
      void preloadPanel("reports");
      // Canonicalize to hub + ?report= without dismissing the desk.
      if (typeof window !== "undefined") {
        const href = accountingReportsHref(detailId);
        try {
          window.history.replaceState(
            window.history.state && typeof window.history.state === "object"
              ? { ...window.history.state, __fecAcctDesk: href }
              : { __fecAcctDesk: href },
            "",
            href
          );
        } catch {
          /* ignore */
        }
      }
      skipPathCloseCountRef.current += 1;
      router.replace("/admin/accounting/reports");
      return;
    }
    setPanel(null);
    setRetainedPanel(null);
    setReportId(null);
    reportIdRef.current = null;
    setLedgerFocus(null);
  }, [pathname, router]);

  useEffect(() => {
    // Dev: never idle-import sibling panels — each import queues a Turbopack
    // compile that blocks the hard-refreshed route (terminal: 466s compile).
    if (process.env.NODE_ENV === "development") return;
    if (idleWarmDone) return;
    idleWarmDone = true;
    const queue: AccountingDeskPanel[] = [
      "dashboard",
      "banking",
      "expenses",
    ];
    let timer = 0;
    const step = () => {
      if (!queue.length) return;
      if (!document.hidden && qc.isFetching() === 0) {
        warmPanelChunk(queue.shift()!);
      }
      timer = window.setTimeout(step, 8000);
    };
    timer = window.setTimeout(step, 30_000);
    return () => window.clearTimeout(timer);
  }, [warmPanelChunk, qc]);

  const visibleTabs = useMemo(() => {
    return ACCOUNTING_DESK_TABS.filter((t) => {
      if (t.href === "/admin/accounting") return true;
      if (initialized === true && t.panel === "setup") return false;
      return isAdminPageAllowed(t.href, can, user).allowed;
    });
  }, [can, user, initialized]);

  const api = useMemo<AccountingDeskApi>(
    () => ({
      panel,
      retainedPanel,
      reportId,
      ledgerFocus,
      openPanel,
      openReport,
      clearReport,
      openLedger,
      clearLedgerFocus,
      closePanel,
      warmPanel: warmPanelChunk,
    }),
    [
      panel,
      retainedPanel,
      reportId,
      ledgerFocus,
      openPanel,
      openReport,
      clearReport,
      openLedger,
      clearLedgerFocus,
      closePanel,
      warmPanelChunk,
    ]
  );

  return (
    <AccountingDeskContext.Provider value={api}>
      {children}
      {panel ? (
        <AccountingDeskModal
          panel={panel}
          reportId={reportId}
          mounted={mounted}
          tabs={visibleTabs}
          onClose={closePanel}
          onClearReport={clearReport}
          onSwitch={openPanel}
          onWarm={warmPanelChunk}
        />
      ) : null}
    </AccountingDeskContext.Provider>
  );
}

function PanelFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
    </div>
  );
}

function AccountingDeskModal({
  panel,
  reportId,
  mounted,
  tabs,
  onClose,
  onClearReport,
  onSwitch,
  onWarm,
}: {
  panel: AccountingDeskPanel;
  reportId: string | null;
  mounted: Set<AccountingDeskPanel>;
  tabs: typeof ACCOUNTING_DESK_TABS;
  onClose: () => void;
  onClearReport: () => void;
  onSwitch: (panel: AccountingDeskPanel) => void;
  onWarm: (panel: AccountingDeskPanel) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const reportIdLocal = reportId;
  const panelLocal = panel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const nested = bodyRef.current?.querySelector(
        '[role="dialog"], [aria-modal="true"]'
      );
      if (nested) return;
      // Report viewer → catalog first (like a nested panel), then Close.
      if (panelLocal === "reports" && reportIdLocal) {
        onClearReport();
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, onClearReport, panelLocal, reportIdLocal]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [panel, reportId]);

  const label =
    ACCOUNTING_DESK_TABS.find((t) => t.panel === panel)?.label ?? "Accounting";

  const railItems: AccountingTabRailItem[] = useMemo(
    () =>
      tabs.map((tab) => ({
        key: tab.href,
        label: tab.label,
        active: tab.panel === panel,
        onWarm: () => onWarm(tab.panel),
        onSelect: () => onSwitch(tab.panel),
      })),
    [tabs, panel, onWarm, onSwitch]
  );

  const activeKey =
    tabs.find((t) => t.panel === panel)?.href ?? null;

  return (
    // lg:left-64 keeps the admin sidebar visible and clickable.
    <div className="fixed inset-y-0 left-0 right-0 z-[60] flex lg:left-64">
      <style>{`@keyframes acctDeskIn{from{opacity:0;transform:translateY(10px) scale(.995)}to{opacity:1;transform:none}}@keyframes acctDeskFade{from{opacity:0}to{opacity:1}}`}</style>
      <button
        type="button"
        aria-label="Close overlay"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]"
        style={{ animation: "acctDeskFade 150ms ease-out" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative m-0 flex w-full flex-col overflow-hidden bg-[#faf9f7] shadow-[0_24px_60px_-28px_rgba(28,25,23,0.55)] sm:m-3 sm:rounded-2xl sm:border sm:border-stone-200"
        style={{ animation: "acctDeskIn 180ms cubic-bezier(0.22,1,0.36,1)" }}
      >
        <header className="relative shrink-0 border-b border-stone-200 bg-white px-2 py-2 sm:px-3">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#D4AF37]/12 via-white to-white"
          />
          <div className="relative">
            <AccountingTabRail
              items={railItems}
              activeKey={activeKey}
              ariaLabel="Accounting sections"
              trailing={
                <button
                  ref={closeRef}
                  type="button"
                  onClick={onClose}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]/50 sm:px-3"
                >
                  <X className="h-4 w-4" />
                  <span className="hidden sm:inline">Close</span>
                  <kbd className="ml-0.5 hidden rounded border border-stone-200 px-1 text-[10px] text-stone-400 md:inline">
                    Esc
                  </kbd>
                </button>
              }
            />
          </div>
        </header>
        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        >
          <AccountingInDeskContext.Provider value={true}>
            <Suspense fallback={<PanelFallback />}>
              {[...mounted].map((p) => {
                const Comp = lazyPanel(p);
                return (
                  <div
                    key={p}
                    className={p === panel ? "block" : "hidden"}
                    aria-hidden={p !== panel}
                  >
                    <Comp />
                  </div>
                );
              })}
            </Suspense>
          </AccountingInDeskContext.Provider>
        </div>
      </div>
    </div>
  );
}
