"use client";

import { createContext, useContext } from "react";
import { ACCOUNTING_APP_TABS } from "@/lib/adminNav";

/** Feature panels that open as an in-place desk modal (no route load). */
export type AccountingDeskPanel =
  | "dashboard"
  | "approvals"
  | "journals"
  | "ledger"
  | "chart-of-accounts"
  | "customers"
  | "invoices"
  | "receipts"
  | "suppliers"
  | "purchase-orders"
  | "bills"
  | "supplier-payments"
  | "expenses"
  | "expense-categories"
  | "banking"
  | "bank-accounts"
  | "transfers"
  | "reconciliations"
  | "inventory"
  | "inventory-movements"
  | "reports"
  | "tax"
  | "periods"
  | "posting-queue"
  | "audit"
  | "setup"
  | "mappings"
  | "tax-codes"
  | "opening-balances"
  | "settings";

const HREF_TO_PANEL: Record<string, AccountingDeskPanel> = {
  "/admin/accounting": "dashboard",
  "/admin/accounting/approvals": "approvals",
  "/admin/accounting/journals": "journals",
  "/admin/accounting/ledger": "ledger",
  "/admin/accounting/chart-of-accounts": "chart-of-accounts",
  "/admin/accounting/customers": "customers",
  "/admin/accounting/invoices": "invoices",
  "/admin/accounting/receipts": "receipts",
  "/admin/accounting/suppliers": "suppliers",
  "/admin/accounting/purchase-orders": "purchase-orders",
  "/admin/accounting/bills": "bills",
  "/admin/accounting/supplier-payments": "supplier-payments",
  "/admin/accounting/expenses": "expenses",
  "/admin/accounting/expense-categories": "expense-categories",
  "/admin/accounting/banking": "banking",
  "/admin/accounting/bank-accounts": "bank-accounts",
  "/admin/accounting/transfers": "transfers",
  "/admin/accounting/reconciliations": "reconciliations",
  "/admin/accounting/inventory": "inventory",
  "/admin/accounting/inventory/movements": "inventory-movements",
  "/admin/accounting/reports": "reports",
  "/admin/accounting/tax": "tax",
  "/admin/accounting/periods": "periods",
  "/admin/accounting/posting-queue": "posting-queue",
  "/admin/accounting/audit": "audit",
  "/admin/accounting/setup": "setup",
  "/admin/accounting/mappings": "mappings",
  "/admin/accounting/tax-codes": "tax-codes",
  "/admin/accounting/opening-balances": "opening-balances",
  "/admin/accounting/settings": "settings",
};

export const ACCOUNTING_DESK_TABS: Array<{
  href: string;
  label: string;
  section?: string;
  panel: AccountingDeskPanel;
}> = ACCOUNTING_APP_TABS.flatMap((t) => {
  const panel = HREF_TO_PANEL[t.href];
  if (!panel) return [];
  return [{ href: t.href, label: t.name, section: t.section, panel }];
});

export function accountingPanelFromHref(
  href: string
): AccountingDeskPanel | null {
  const path = (href.split("?")[0] ?? href).split("#")[0] ?? href;
  const normalized =
    path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  if (HREF_TO_PANEL[normalized]) return HREF_TO_PANEL[normalized]!;
  // Detail routes → open their list panel (e.g. /invoices/xyz → invoices).
  const match = Object.keys(HREF_TO_PANEL)
    .filter((h) => h !== "/admin/accounting" && normalized.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? HREF_TO_PANEL[match]! : null;
}

export function accountingHrefFromPanel(panel: AccountingDeskPanel): string {
  const row = ACCOUNTING_DESK_TABS.find((t) => t.panel === panel);
  return row?.href ?? "/admin/accounting";
}

/** `/admin/accounting/reports/profit-and-loss` → `profit-and-loss` */
export function accountingReportIdFromHref(href: string): string | null {
  const path = (href.split("?")[0] ?? href).split("#")[0] ?? href;
  const normalized =
    path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  const m = normalized.match(/^\/admin\/accounting\/reports\/([^/]+)$/);
  return m?.[1] ?? null;
}

export function accountingReportsHref(reportId?: string | null): string {
  if (!reportId) return "/admin/accounting/reports";
  return `/admin/accounting/reports?report=${encodeURIComponent(reportId)}`;
}

/** Deep-link into General Ledger without a slow App Router navigation. */
export type AccountingLedgerFocus = {
  accountId?: string;
  systemKey?: string;
};

export type AccountingDeskApi = {
  /** Currently open desk modal, or null when closed. */
  panel: AccountingDeskPanel | null;
  /**
   * Tab to keep highlighted after Close/Esc (the panel that was just closed).
   * Cleared on route change. Prefer `panel` when the modal is open.
   */
  retainedPanel: AccountingDeskPanel | null;
  /**
   * Active report inside the Reports desk panel (null = catalog).
   * Cards open here instead of leaving the modal.
   */
  reportId: string | null;
  /** Pending ledger account / systemKey when opened from another desk panel. */
  ledgerFocus: AccountingLedgerFocus | null;
  openPanel: (panel: AccountingDeskPanel) => void;
  /** Open Reports desk + show this report in-place (like Inventory tab hops). */
  openReport: (reportId: string) => void;
  /** Back to the Reports catalog without closing the desk. */
  clearReport: () => void;
  /** Open General Ledger in-desk, optionally focused on an account. */
  openLedger: (focus?: AccountingLedgerFocus | null) => void;
  clearLedgerFocus: () => void;
  closePanel: () => void;
  warmPanel: (panel: AccountingDeskPanel) => void;
};

export const AccountingDeskContext = createContext<AccountingDeskApi | null>(
  null
);

/** True when content is painted inside the desk modal (hide duplicate chrome). */
export const AccountingInDeskContext = createContext(false);

export function useAccountingDesk(): AccountingDeskApi | null {
  return useContext(AccountingDeskContext);
}

export function useInAccountingDesk(): boolean {
  return useContext(AccountingInDeskContext);
}

/**
 * Only the visible owner of the address bar may call router.replace('?…').
 * Hidden desk keep-alives and route children under an open modal must not
 * rewrite another tab’s path/query (that races syncPathToPanel and clears
 * retainedPanel highlight on close).
 */
export function useAccountingDeskUrlOwner(panel: AccountingDeskPanel): boolean {
  const desk = useAccountingDesk();
  const inDesk = useInAccountingDesk();
  if (inDesk) return desk?.panel === panel;
  // Route children under the shell: mute while any desk modal is open.
  return desk?.panel == null;
}

/**
 * Whether a desk feature should run live polls.
 * Hidden keep-alive panels and muted route children must not hammer the API.
 */
export function useAccountingDeskPanelLive(
  panel: AccountingDeskPanel | AccountingDeskPanel[]
): boolean {
  const desk = useAccountingDesk();
  const inDesk = useInAccountingDesk();
  const panels = Array.isArray(panel) ? panel : [panel];
  if (inDesk) return panels.some((p) => desk?.panel === p);
  // Route page under the shell: only while the desk overlay is closed.
  return desk?.panel == null;
}
