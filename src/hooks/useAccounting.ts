"use client";

/**
 * Accounting React Query hooks (S1-Q3).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { adminListQueryDefaults } from "@/lib/adminListCache";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import {
  ACCOUNTING_ACCOUNTS_LIVE_MS,
  ACCOUNTING_APPROVALS_LIVE_MS,
  ACCOUNTING_CUSTOMERS_LIVE_MS,
  ACCOUNTING_DASHBOARD_LIVE_MS,
  ACCOUNTING_INVOICES_LIVE_MS,
  ACCOUNTING_JOURNALS_LIVE_MS,
  ACCOUNTING_LEDGER_LIVE_MS,
  ACCOUNTING_RECEIPTS_LIVE_MS,
  ACCOUNTING_BANK_ACCOUNTS_LIVE_MS,
  ACCOUNTING_TRANSFERS_LIVE_MS,
  ACCOUNTING_RECONCILIATIONS_LIVE_MS,
  ACCOUNTING_SUPPLIERS_LIVE_MS,
  ACCOUNTING_PURCHASE_ORDERS_LIVE_MS,
  ACCOUNTING_BILLS_LIVE_MS,
  ACCOUNTING_SUPPLIER_PAYMENTS_LIVE_MS,
  ACCOUNTING_EXPENSES_LIVE_MS,
  ACCOUNTING_EXPENSE_CATEGORIES_LIVE_MS,
  ACCOUNTING_INVENTORY_LIVE_MS,
  ACCOUNTING_INVENTORY_MOVEMENTS_LIVE_MS,
  ACCOUNTING_REPORTS_LIVE_MS,
  ACCOUNTING_REPORT_VIEWER_LIVE_MS,
  ACCOUNTING_PERIODS_LIVE_MS,
  ACCOUNTING_POSTING_QUEUE_LIVE_MS,
  ACCOUNTING_AUDIT_LIVE_MS,
  ACCOUNTING_MAPPINGS_LIVE_MS,
  ACCOUNTING_TAX_CODES_LIVE_MS,
  ACCOUNTING_OPENING_BALANCES_LIVE_MS,
  ACCOUNTING_SETTINGS_LIVE_MS,
  accountingLiveRefetchInterval,
} from "@/utils/adminLiveRefresh";
import { useAccountingDeskPanelLive } from "@/components/Protected/admin/pages/accounting/accountingDesk";
import * as acct from "@/services/accounting";

/** Stable default filters — must match desk prefetch for split-second open. */
export function accountingAuditDefaultFilters(): {
  from: string;
  to: string;
} {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

export const accountingKeys = {
  all: ["admin", "accounting"] as const,
  settings: () => [...accountingKeys.all, "settings"] as const,
  setupPreview: () => [...accountingKeys.all, "setup-preview"] as const,
  lookups: () => [...accountingKeys.all, "lookups"] as const,
  accounts: (filters: acct.ListAccountsParams = {}) =>
    [...accountingKeys.all, "accounts", filters] as const,
  account: (id: string) => [...accountingKeys.all, "account", id] as const,
  mappings: (filters: { locationId?: string | null } = {}) =>
    [...accountingKeys.all, "mappings", filters] as const,
  taxCodes: (filters: { includeInactive?: boolean } = {}) =>
    [...accountingKeys.all, "tax-codes", filters] as const,
  periods: (filters: { fiscalYear?: number } = {}) =>
    [...accountingKeys.all, "periods", filters] as const,
  periodChecklist: (id: string) =>
    [...accountingKeys.all, "period-checklist", id] as const,
  journals: (filters: acct.ListJournalsParams = {}) =>
    [...accountingKeys.all, "journals", filters] as const,
  journal: (id: string) => [...accountingKeys.all, "journal", id] as const,
  ledger: (filters: acct.LedgerParams) =>
    [...accountingKeys.all, "ledger", filters] as const,
  openingBalances: () => [...accountingKeys.all, "opening-balances"] as const,
  postingQueue: (filters: { status?: string; cursor?: string } = {}) =>
    [...accountingKeys.all, "posting-queue", filters] as const,
  approvals: (filters: { entity?: string; cursor?: string } = {}) =>
    [...accountingKeys.all, "approvals", filters] as const,
  audit: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "audit", filters] as const,
  customers: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "customers", filters] as const,
  customerSearch: (q: string) =>
    [...accountingKeys.all, "customer-search", q] as const,
  customer: (partyKey: string) =>
    [...accountingKeys.all, "customer", partyKey] as const,
  customerStatement: (partyKey: string, filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "customer-statement", partyKey, filters] as const,
  invoices: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "invoices", filters] as const,
  invoice: (id: string) => [...accountingKeys.all, "invoice", id] as const,
  receipts: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "receipts", filters] as const,
  receipt: (id: string) => [...accountingKeys.all, "receipt", id] as const,
  suppliers: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "suppliers", filters] as const,
  supplier: (id: string) => [...accountingKeys.all, "supplier", id] as const,
  purchaseOrders: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "purchase-orders", filters] as const,
  purchaseOrder: (id: string) =>
    [...accountingKeys.all, "purchase-order", id] as const,
  bills: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "bills", filters] as const,
  bill: (id: string) => [...accountingKeys.all, "bill", id] as const,
  supplierPayments: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "supplier-payments", filters] as const,
  supplierPayment: (id: string) =>
    [...accountingKeys.all, "supplier-payment", id] as const,
  expenses: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "expenses", filters] as const,
  expense: (id: string) => [...accountingKeys.all, "expense", id] as const,
  expenseCategories: (filters: { includeInactive?: boolean } = {}) =>
    [...accountingKeys.all, "expense-categories", filters] as const,
  bankAccounts: (
    filters: { includeArchived?: boolean; locationId?: string | null } = {}
  ) => [...accountingKeys.all, "bank-accounts", filters] as const,
  bankTransactions: (accountId: string, filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "bank-transactions", accountId, filters] as const,
  transfers: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "transfers", filters] as const,
  reconciliations: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "reconciliations", filters] as const,
  reconciliation: (id: string) =>
    [...accountingKeys.all, "reconciliation", id] as const,
  inventory: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "inventory", filters] as const,
  inventoryMovements: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "inventory-movements", filters] as const,
  products: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "products", filters] as const,
  reports: () => [...accountingKeys.all, "reports"] as const,
  report: (id: string, filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "report", id, filters] as const,
  dashboard: (filters: Record<string, unknown> = {}) =>
    [...accountingKeys.all, "dashboard", filters] as const,
  sourceEntries: (sourceType: string, sourceId: string) =>
    [...accountingKeys.all, "source-entries", sourceType, sourceId] as const,
};

function invalidateMany(qc: QueryClient, keys: readonly (readonly unknown[])[]) {
  for (const key of keys) {
    void qc.invalidateQueries({ queryKey: key as unknown[] });
  }
}

const ledgerish = [
  accountingKeys.all,
  accountingKeys.dashboard(),
  accountingKeys.reports(),
  accountingKeys.ledger({ accountId: "" }),
] as const;

/** Prefer HQ/park scoped location when the page filter is empty. */
export function useAccountingLocationFilter(initialLocationId = "") {
  const hq = useHqLocationFilter(initialLocationId);
  const effectiveLocationId = hq.locationId || hq.scopedLocationId || "";
  return { ...hq, effectiveLocationId };
}

function isInitializedSettings(
  data: acct.AccountingSettingsResponse | undefined
): data is acct.AccountingSettingsDto | { initialized: true; settings: acct.AccountingSettingsDto } {
  if (!data) return false;
  if ("initialized" in data) return data.initialized === true;
  return "enabled" in data && Boolean((data as acct.AccountingSettingsDto).enabled);
}

export function useAccountingSettingsQuery(enabled = true) {
  // Poll while Settings desk is open, or while any accounting route child
  // owns the URL (desk closed) — Gate/Initialized share this key.
  const live = useAccountingDeskPanelLive("settings");
  return useQuery({
    queryKey: accountingKeys.settings(),
    queryFn: acct.getAccountingSettings,
    enabled,
    staleTime: ACCOUNTING_SETTINGS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(
      ACCOUNTING_SETTINGS_LIVE_MS,
      { enabled, live }
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (p) => p,
  });
}

export function useAccountingInitialized(enabled = true) {
  const q = useAccountingSettingsQuery(enabled);
  const initialized = isInitializedSettings(q.data);
  const settings =
    q.data && "settings" in q.data && q.data.settings
      ? q.data.settings
      : q.data && "enabled" in q.data
        ? (q.data as acct.AccountingSettingsDto)
        : null;
  return { ...q, initialized, settings };
}

export function useAccountingSetupPreviewQuery(enabled = true) {
  return useQuery({
    queryKey: accountingKeys.setupPreview(),
    queryFn: acct.getAccountingSetupPreview,
    enabled,
    staleTime: 30_000,
  });
}

export function useAccountingLookupsQuery(enabled = true) {
  return useQuery({
    queryKey: accountingKeys.lookups(),
    queryFn: acct.getAccountingLookups,
    enabled,
    ...adminListQueryDefaults,
  });
}

export function useAccountingAccountsQuery(
  filters: acct.ListAccountsParams = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.accounts(filters),
    queryFn: () => acct.listAccountingAccounts(filters),
    enabled,
    staleTime: ACCOUNTING_ACCOUNTS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_ACCOUNTS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingAccountQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.account(id),
    queryFn: () => acct.getAccountingAccount(id),
    enabled: enabled && Boolean(id),
  });
}

export function useAccountingMappingsQuery(
  filters: { locationId?: string | null } = {},
  enabled = true
) {
  const live = useAccountingDeskPanelLive("mappings");
  // Empty `{}` matches desk prefetch — location scope is applied client-side.
  const keyFilters =
    filters.locationId != null && filters.locationId !== ""
      ? { locationId: filters.locationId }
      : {};
  return useQuery({
    queryKey: accountingKeys.mappings(keyFilters),
    queryFn: () => acct.getAccountingMappings(keyFilters),
    enabled,
    staleTime: ACCOUNTING_MAPPINGS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(
      ACCOUNTING_MAPPINGS_LIVE_MS,
      { enabled, live }
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingTaxCodesQuery(
  filters: { includeInactive?: boolean } = {},
  enabled = true
) {
  const live = useAccountingDeskPanelLive("tax-codes");
  return useQuery({
    queryKey: accountingKeys.taxCodes(filters),
    queryFn: () => acct.listAccountingTaxCodes(filters),
    enabled,
    staleTime: ACCOUNTING_TAX_CODES_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(
      ACCOUNTING_TAX_CODES_LIVE_MS,
      { enabled, live }
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

function taxCodesInvalidate(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "tax-codes"] });
  // Tax report + desk tax summary read rates from these codes.
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "report"] });
  void qc.invalidateQueries({ queryKey: accountingKeys.dashboard() });
}

export function useAccountingPeriodsQuery(
  filters: { fiscalYear?: number } = {},
  enabled = true
) {
  const live = useAccountingDeskPanelLive("periods");
  return useQuery({
    queryKey: accountingKeys.periods(filters),
    queryFn: () => acct.listAccountingPeriods(filters),
    enabled,
    staleTime: ACCOUNTING_PERIODS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_PERIODS_LIVE_MS, {
      enabled,
      live,
    }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function usePeriodCloseChecklistQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.periodChecklist(id),
    queryFn: () => acct.getPeriodCloseChecklist(id),
    enabled: enabled && Boolean(id),
  });
}

export function useOpeningBalancesQuery(enabled = true) {
  const live = useAccountingDeskPanelLive("opening-balances");
  return useQuery({
    queryKey: accountingKeys.openingBalances(),
    queryFn: acct.getOpeningBalances,
    enabled,
    staleTime: ACCOUNTING_OPENING_BALANCES_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(
      ACCOUNTING_OPENING_BALANCES_LIVE_MS,
      { enabled, live }
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useBankAccountsQuery(
  filters: { includeArchived?: boolean; locationId?: string | null } = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.bankAccounts(filters),
    queryFn: () => acct.listBankAccounts(filters),
    enabled,
    staleTime: ACCOUNTING_BANK_ACCOUNTS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_BANK_ACCOUNTS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useExpenseCategoriesQuery(
  filters: { includeInactive?: boolean } = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.expenseCategories(filters),
    queryFn: () => acct.listExpenseCategories(filters),
    enabled,
    staleTime: ACCOUNTING_EXPENSE_CATEGORIES_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_EXPENSE_CATEGORIES_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingJournalsQuery(
  filters: acct.ListJournalsParams = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.journals(filters),
    queryFn: () => acct.listAccountingJournals(filters),
    enabled,
    staleTime: ACCOUNTING_JOURNALS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    // Quiet background sync — do not refetch on every window focus (feels like
    // constant "Refreshing…" and delays hard-refresh / first paint).
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_JOURNALS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingJournalQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.journal(id),
    queryFn: () => acct.getAccountingJournal(id),
    enabled: enabled && Boolean(id),
  });
}

export function useAccountingLedgerQuery(
  filters: acct.LedgerParams,
  enabled = true
) {
  const live = useAccountingDeskPanelLive("ledger");
  return useQuery({
    queryKey: accountingKeys.ledger(filters),
    queryFn: () => acct.getAccountingLedger(filters),
    enabled: enabled && Boolean(filters.accountId),
    staleTime: ACCOUNTING_LEDGER_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_LEDGER_LIVE_MS, {
      enabled: enabled && Boolean(filters.accountId),
      live,
    }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function usePostingQueueQuery(
  filters: { status?: string; cursor?: string } = {},
  enabled = true
) {
  const live = useAccountingDeskPanelLive("posting-queue");
  return useQuery({
    queryKey: accountingKeys.postingQueue(filters),
    queryFn: () => acct.listPostingQueue(filters),
    enabled,
    staleTime: ACCOUNTING_POSTING_QUEUE_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(
      ACCOUNTING_POSTING_QUEUE_LIVE_MS,
      { enabled, live }
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingApprovalsQuery(
  filters: { entity?: string; cursor?: string } = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.approvals(filters),
    queryFn: () => acct.listAccountingApprovals(filters),
    enabled,
    staleTime: ACCOUNTING_APPROVALS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_APPROVALS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingAuditQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  const live = useAccountingDeskPanelLive("audit");
  return useQuery({
    queryKey: accountingKeys.audit(filters),
    queryFn: () => acct.getAccountingAudit(filters),
    enabled,
    staleTime: ACCOUNTING_AUDIT_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_AUDIT_LIVE_MS, {
      enabled,
      live,
    }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingCustomersQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.customers(filters),
    queryFn: () => acct.listAccountingCustomers(filters),
    enabled,
    staleTime: ACCOUNTING_CUSTOMERS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_CUSTOMERS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingCustomerSearchQuery(q: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.customerSearch(q),
    queryFn: () => acct.searchAccountingCustomers({ q }),
    enabled: enabled && q.trim().length >= 1,
    staleTime: 15_000,
  });
}

export function useAccountingCustomerQuery(partyKey: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.customer(partyKey),
    queryFn: () => acct.getAccountingCustomer(partyKey),
    enabled: enabled && Boolean(partyKey),
  });
}

export function useAccountingInvoicesQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.invoices(filters),
    queryFn: () => acct.listAccountingInvoices(filters),
    enabled,
    staleTime: ACCOUNTING_INVOICES_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_INVOICES_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingInvoiceQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.invoice(id),
    queryFn: () => acct.getAccountingInvoice(id),
    enabled: enabled && Boolean(id),
  });
}

export function useAccountingReceiptsQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.receipts(filters),
    queryFn: () => acct.listAccountingReceipts(filters),
    enabled,
    staleTime: ACCOUNTING_RECEIPTS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_RECEIPTS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingReceiptQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.receipt(id),
    queryFn: () => acct.getAccountingReceipt(id),
    enabled: enabled && Boolean(id),
    staleTime: ACCOUNTING_RECEIPTS_LIVE_MS,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_RECEIPTS_LIVE_MS, { enabled: enabled && Boolean(id) }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingCustomerStatementQuery(
  partyKey: string,
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.customerStatement(partyKey, filters),
    queryFn: () =>
      acct.getCustomerStatement(partyKey, filters as { from?: string; to?: string }),
    enabled: enabled && Boolean(partyKey),
  });
}

export function useAccountingSuppliersQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.suppliers(filters),
    queryFn: () => acct.listAccountingSuppliers(filters),
    enabled,
    staleTime: ACCOUNTING_SUPPLIERS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_SUPPLIERS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingSupplierQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.supplier(id),
    queryFn: () => acct.getAccountingSupplier(id),
    enabled: enabled && Boolean(id),
  });
}

export function usePurchaseOrdersQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.purchaseOrders(filters),
    queryFn: () => acct.listPurchaseOrders(filters),
    enabled,
    staleTime: ACCOUNTING_PURCHASE_ORDERS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_PURCHASE_ORDERS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingBillsQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.bills(filters),
    queryFn: () => acct.listAccountingBills(filters),
    enabled,
    staleTime: ACCOUNTING_BILLS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_BILLS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useSupplierPaymentsQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.supplierPayments(filters),
    queryFn: () => acct.listSupplierPayments(filters),
    enabled,
    staleTime: ACCOUNTING_SUPPLIER_PAYMENTS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_SUPPLIER_PAYMENTS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingExpensesQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.expenses(filters),
    queryFn: () => acct.listAccountingExpenses(filters),
    enabled,
    staleTime: ACCOUNTING_EXPENSES_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_EXPENSES_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useBankTransactionsQuery(
  accountId: string,
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.bankTransactions(accountId, filters),
    queryFn: () => acct.listBankTransactions(accountId, filters),
    enabled: enabled && Boolean(accountId),
    ...adminListQueryDefaults,
  });
}

export function useBankTransfersQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.transfers(filters),
    queryFn: () => acct.listBankTransfers(filters),
    enabled,
    staleTime: ACCOUNTING_TRANSFERS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_TRANSFERS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useReconciliationsQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.reconciliations(filters),
    queryFn: () => acct.listReconciliations(filters),
    enabled,
    staleTime: ACCOUNTING_RECONCILIATIONS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_RECONCILIATIONS_LIVE_MS, { enabled }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useReconciliationQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.reconciliation(id),
    queryFn: () => acct.getReconciliation(id),
    enabled: enabled && Boolean(id),
  });
}

export function useInventoryValuationQuery(
  filters: { asOf?: string; locationId?: string | null } = {},
  enabled = true
) {
  const live = useAccountingDeskPanelLive("inventory");
  return useQuery({
    queryKey: accountingKeys.inventory(filters),
    queryFn: () => acct.getInventoryValuation(filters),
    enabled,
    staleTime: ACCOUNTING_INVENTORY_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_INVENTORY_LIVE_MS, {
      enabled,
      live,
    }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useInventoryMovementsQuery(
  filters: Record<string, unknown> = {},
  enabled = true
) {
  const live = useAccountingDeskPanelLive("inventory-movements");
  return useQuery({
    queryKey: accountingKeys.inventoryMovements(filters),
    queryFn: () => acct.listInventoryMovements(filters),
    enabled,
    staleTime: ACCOUNTING_INVENTORY_MOVEMENTS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(
      ACCOUNTING_INVENTORY_MOVEMENTS_LIVE_MS,
      { enabled, live }
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingProductsQuery(
  filters: { q?: string; locationId?: string | null } = {},
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.products(filters),
    queryFn: () => acct.listAccountingProducts(filters),
    enabled,
    staleTime: 30_000,
  });
}

export function useAccountingDashboardQuery(
  filters: { from?: string; to?: string; locationId?: string | null } = {},
  enabled = true
) {
  const live = useAccountingDeskPanelLive("dashboard");
  return useQuery({
    queryKey: accountingKeys.dashboard(filters),
    queryFn: () => acct.getAccountingDashboard(filters),
    enabled,
    staleTime: ACCOUNTING_DASHBOARD_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_DASHBOARD_LIVE_MS, {
      enabled,
      live,
    }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingReportsCatalogQuery(enabled = true) {
  const live = useAccountingDeskPanelLive("reports");
  return useQuery({
    queryKey: accountingKeys.reports(),
    queryFn: acct.listAccountingReports,
    enabled,
    staleTime: ACCOUNTING_REPORTS_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(ACCOUNTING_REPORTS_LIVE_MS, {
      enabled,
      live,
    }),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingReportQuery(
  report: string,
  filters: Record<string, unknown> = {},
  enabled = true
) {
  // Tax desk + Reports viewer both consume report queries.
  const live = useAccountingDeskPanelLive(["reports", "tax"]);
  return useQuery({
    queryKey: accountingKeys.report(report, filters),
    queryFn: () => acct.getAccountingReport(report, filters),
    enabled: enabled && Boolean(report),
    staleTime: ACCOUNTING_REPORT_VIEWER_LIVE_MS,
    gcTime: 30 * 60 * 1000,
    refetchInterval: accountingLiveRefetchInterval(
      ACCOUNTING_REPORT_VIEWER_LIVE_MS,
      { enabled: enabled && Boolean(report), live }
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

export function useAccountingSourceEntriesQuery(
  sourceType: string,
  sourceId: string,
  enabled = true
) {
  return useQuery({
    queryKey: accountingKeys.sourceEntries(sourceType, sourceId),
    queryFn: () => acct.getAccountingSourceEntries({ sourceType, sourceId }),
    enabled: enabled && Boolean(sourceType) && Boolean(sourceId),
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useRunAccountingSetupMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.runAccountingSetup,
    onSuccess: () => {
      invalidateMany(qc, [
        accountingKeys.settings(),
        accountingKeys.setupPreview(),
        accountingKeys.accounts(),
        accountingKeys.mappings(),
        accountingKeys.taxCodes(),
        accountingKeys.periods(),
        accountingKeys.bankAccounts(),
        accountingKeys.expenseCategories(),
        accountingKeys.lookups(),
      ]);
    },
  });
}

export function usePatchAccountingSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.patchAccountingSettings,
    onSuccess: (settings) => {
      qc.setQueryData(accountingKeys.settings(), {
        initialized: true,
        settings,
      });
      void qc.invalidateQueries({ queryKey: accountingKeys.settings() });
      // Go-live, FY, recognition, and thresholds feed these desks.
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "periods"] });
      void qc.invalidateQueries({
        queryKey: accountingKeys.openingBalances(),
      });
      void qc.invalidateQueries({ queryKey: accountingKeys.dashboard() });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "report"] });
      void qc.invalidateQueries({ queryKey: accountingKeys.lookups() });
    },
  });
}

function invalidateChartOfAccounts(qc: QueryClient) {
  invalidateMany(qc, [
    [...accountingKeys.all, "accounts"],
    accountingKeys.lookups(),
    accountingKeys.mappings(),
    accountingKeys.dashboard(),
    accountingKeys.reports(),
    accountingKeys.openingBalances(),
    accountingKeys.bankAccounts(),
  ]);
}

export function useCreateAccountingAccountMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createAccountingAccount,
    onSuccess: () => {
      invalidateChartOfAccounts(qc);
    },
  });
}

export function usePatchAccountingAccountMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.patchAccountingAccount(id, body),
    onSuccess: (account) => {
      qc.setQueryData(accountingKeys.account(account.id), account);
      invalidateChartOfAccounts(qc);
    },
  });
}

export function useArchiveAccountingAccountMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: Record<string, unknown> }) =>
      acct.archiveAccountingAccount(id, body),
    onSuccess: () => {
      invalidateChartOfAccounts(qc);
    },
  });
}

export function useImportAccountingAccountsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.importAccountingAccounts,
    onSuccess: () => {
      invalidateChartOfAccounts(qc);
    },
  });
}

export function usePutAccountingMappingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.putAccountingMappings,
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: [...accountingKeys.all, "mappings"],
      });
      // Posting / suspense / dashboard resolve through mappings.
      invalidateAccountingMoney(qc);
    },
  });
}

export function useCreateTaxCodeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createAccountingTaxCode,
    onSuccess: () => taxCodesInvalidate(qc),
  });
}

export function usePatchTaxCodeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.patchAccountingTaxCode(id, body),
    onSuccess: () => taxCodesInvalidate(qc),
  });
}

export function useSyncTaxCodesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.syncAccountingTaxCodes,
    onSuccess: () => taxCodesInvalidate(qc),
  });
}

function periodsInvalidate(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "periods"] });
  void qc.invalidateQueries({ queryKey: accountingKeys.dashboard() });
}

export function useGeneratePeriodsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.generateAccountingPeriods,
    onSuccess: () => {
      periodsInvalidate(qc);
    },
  });
}

export function useClosePeriodMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: Record<string, unknown> }) =>
      acct.closeAccountingPeriod(id, body),
    onSuccess: () => {
      periodsInvalidate(qc);
      invalidateMany(qc, ledgerish as readonly (readonly unknown[])[]);
    },
  });
}

export function useReopenPeriodMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      acct.reopenAccountingPeriod(id, { reason }),
    onSuccess: () => {
      periodsInvalidate(qc);
      invalidateMany(qc, ledgerish as readonly (readonly unknown[])[]);
    },
  });
}

export function useYearEndCloseMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.yearEndCloseAccounting,
    onSuccess: () => {
      periodsInvalidate(qc);
      invalidateAccountingMoney(qc);
    },
  });
}

export function usePutOpeningBalancesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.putOpeningBalances,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.openingBalances() });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "accounts"] });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "journals"] });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "ledger"] });
      void qc.invalidateQueries({ queryKey: accountingKeys.inventory() });
      void qc.invalidateQueries({
        queryKey: [...accountingKeys.all, "inventory-movements"],
      });
      void qc.invalidateQueries({ queryKey: accountingKeys.dashboard() });
      invalidateAccountingMoney(qc);
    },
  });
}

/** Bank accounts ↔ Banking overview, transfers, receipts/payments pickers, CoA. */
function bankAccountsInvalidate(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "bank-accounts"] });
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "accounts"] });
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "transfers"] });
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "reconciliations"] });
  void qc.invalidateQueries({ queryKey: accountingKeys.dashboard() });
}

export function useCreateBankAccountMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createBankAccount,
    onSuccess: () => bankAccountsInvalidate(qc),
  });
}

export function usePatchBankAccountMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.patchBankAccount(id, body),
    onSuccess: () => bankAccountsInvalidate(qc),
  });
}

export function useArchiveBankAccountMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.archiveBankAccount,
    onSuccess: () => bankAccountsInvalidate(qc),
  });
}

function expenseCategoriesInvalidate(qc: QueryClient) {
  void qc.invalidateQueries({
    queryKey: [...accountingKeys.all, "expense-categories"],
  });
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "expenses"] });
  void qc.invalidateQueries({ queryKey: accountingKeys.mappings() });
}

export function useCreateExpenseCategoryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createExpenseCategory,
    onSuccess: () => expenseCategoriesInvalidate(qc),
  });
}

export function usePatchExpenseCategoryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.patchExpenseCategory(id, body),
    onSuccess: () => expenseCategoriesInvalidate(qc),
  });
}

export function useUploadAccountingAttachmentMutation() {
  return useMutation({ mutationFn: acct.uploadAccountingAttachment });
}

/** Broad invalidation helper for journal / bill / expense money mutations (Step 2 screens). */
export function invalidateAccountingMoney(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: accountingKeys.all });
}

export function useCreateJournalMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createAccountingJournal,
    onSuccess: () => invalidateAccountingMoney(qc),
  });
}

export function usePatchJournalMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.patchAccountingJournal(id, body),
    onSuccess: (entry) => {
      const id = String((entry as { id?: string }).id ?? "");
      if (id) qc.setQueryData(accountingKeys.journal(id), entry);
      invalidateAccountingMoney(qc);
    },
  });
}

export function useDeleteJournalMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.deleteAccountingJournal,
    onSuccess: () => invalidateAccountingMoney(qc),
  });
}

export function useSubmitJournalMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.submitAccountingJournal,
    onSuccess: () => invalidateAccountingMoney(qc),
  });
}

export function useApproveJournalMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.approveAccountingJournal,
    onSuccess: () => invalidateAccountingMoney(qc),
  });
}

export function useRejectJournalMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      acct.rejectAccountingJournal(id, { reason }),
    onSuccess: () => invalidateAccountingMoney(qc),
  });
}

export function usePostJournalMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.postAccountingJournal,
    onSuccess: () => invalidateAccountingMoney(qc),
  });
}

export function useReverseJournalMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      reason,
      reversalDate,
    }: {
      id: string;
      reason: string;
      reversalDate?: string;
    }) => acct.reverseAccountingJournal(id, { reason, reversalDate }),
    onSuccess: () => invalidateAccountingMoney(qc),
  });
}

export function useDecideApprovalMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      reason,
    }: {
      id: string;
      decision: "approve" | "reject";
      reason?: string;
    }) => acct.decideAccountingApproval(id, { decision, reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "approvals"] });
      invalidateAccountingMoney(qc);
    },
  });
}

/** Bulk approve/reject with per-item results (does not stop on first failure). */
export function useBulkDecideApprovalsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      decision,
      reason,
    }: {
      ids: string[];
      decision: "approve" | "reject";
      reason?: string;
    }) => {
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const id of ids) {
        try {
          await acct.decideAccountingApproval(id, { decision, reason });
          results.push({ id, ok: true });
        } catch (err) {
          results.push({
            id,
            ok: false,
            error: err instanceof Error ? err.message : "Failed",
          });
        }
      }
      return results;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "approvals"] });
      invalidateAccountingMoney(qc);
    },
  });
}

export function useCreateInvoiceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createAccountingInvoice,
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "invoices"] });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "customers"] });
      const partyKey =
        vars && typeof vars === "object" && typeof vars.partyKey === "string"
          ? vars.partyKey
          : "";
      if (partyKey) {
        void qc.invalidateQueries({ queryKey: accountingKeys.customer(partyKey) });
      }
    },
  });
}

export function usePatchInvoiceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.patchAccountingInvoice(id, body),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.invoice(v.id) });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "invoices"] });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "customers"] });
    },
  });
}

export function useIssueInvoiceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.issueAccountingInvoice,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "customers"] });
      invalidateAccountingMoney(qc);
    },
  });
}

export function useVoidInvoiceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      acct.voidAccountingInvoice(id, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "customers"] });
      invalidateAccountingMoney(qc);
    },
  });
}

export function useCreditNoteInvoiceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.creditNoteAccountingInvoice(id, body),
    onSuccess: () => invalidateAccountingMoney(qc),
  });
}

export function useWriteOffInvoiceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      amount,
      reason,
    }: {
      id: string;
      amount: string | number;
      reason: string;
    }) => acct.writeOffAccountingInvoice(id, { amount, reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "approvals"] });
      invalidateAccountingMoney(qc);
    },
  });
}

export function useCreateReceiptMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createAccountingReceipt,
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "receipts"] });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "invoices"] });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "customers"] });
      const partyKey =
        vars && typeof vars === "object" && typeof vars.partyKey === "string"
          ? vars.partyKey
          : "";
      if (partyKey) {
        void qc.invalidateQueries({ queryKey: accountingKeys.customer(partyKey) });
      }
      invalidateAccountingMoney(qc);
    },
  });
}

export function useVoidReceiptMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      acct.voidAccountingReceipt(id, { reason }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.receipt(v.id) });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "receipts"] });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "invoices"] });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "customers"] });
      invalidateAccountingMoney(qc);
    },
  });
}

export function useAllocateReceiptMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.allocateAccountingReceipt(id, body),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.receipt(v.id) });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "receipts"] });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "invoices"] });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "customers"] });
      invalidateAccountingMoney(qc);
    },
  });
}

export function useCreateCustomerStatementLinkMutation() {
  return useMutation({
    mutationFn: ({
      partyKey,
      body,
    }: {
      partyKey: string;
      body: { from: string; to: string } & Record<string, unknown>;
    }) => acct.createCustomerStatementLink(partyKey, body),
  });
}

export function usePurchaseOrderQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.purchaseOrder(id),
    queryFn: () => acct.getPurchaseOrder(id),
    enabled: enabled && Boolean(id),
  });
}

export function useAccountingBillQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.bill(id),
    queryFn: () => acct.getAccountingBill(id),
    enabled: enabled && Boolean(id),
  });
}

export function useSupplierPaymentQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.supplierPayment(id),
    queryFn: () => acct.getSupplierPayment(id),
    enabled: enabled && Boolean(id),
  });
}

export function useAccountingExpenseQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: accountingKeys.expense(id),
    queryFn: () => acct.getAccountingExpense(id),
    enabled: enabled && Boolean(id),
  });
}

export function useSupplierStatementQuery(
  id: string,
  filters: { from?: string; to?: string } = {},
  enabled = true
) {
  return useQuery({
    queryKey: [...accountingKeys.supplier(id), "statement", filters] as const,
    queryFn: () => acct.getSupplierStatement(id, filters),
    enabled: enabled && Boolean(id),
  });
}

function payablesInvalidate(qc: QueryClient) {
  invalidateMany(qc, [
    [...accountingKeys.all, "suppliers"],
    [...accountingKeys.all, "purchase-orders"],
    [...accountingKeys.all, "bills"],
    [...accountingKeys.all, "supplier-payments"],
    accountingKeys.dashboard(),
    accountingKeys.reports(),
  ] as readonly (readonly unknown[])[]);
}

export function useCreateSupplierMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createAccountingSupplier,
    onSuccess: () => payablesInvalidate(qc),
  });
}

export function usePatchSupplierMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.patchAccountingSupplier(id, body),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.supplier(v.id) });
      payablesInvalidate(qc);
    },
  });
}

export function useArchiveSupplierMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.archiveAccountingSupplier,
    onSuccess: () => payablesInvalidate(qc),
  });
}

export function useImportSuppliersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.importAccountingSuppliers,
    onSuccess: () => payablesInvalidate(qc),
  });
}

export function useCreatePurchaseOrderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createPurchaseOrder,
    onSuccess: () => payablesInvalidate(qc),
  });
}

export function usePatchPurchaseOrderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.patchPurchaseOrder(id, body),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.purchaseOrder(v.id) });
      payablesInvalidate(qc);
    },
  });
}

export function usePurchaseOrderActionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      action,
      body,
    }: {
      id: string;
      action:
        | "submit"
        | "approve"
        | "reject"
        | "send"
        | "receive"
        | "close"
        | "cancel"
        | "convert-to-bill";
      body?: Record<string, unknown>;
    }) => {
      switch (action) {
        case "submit":
          return acct.submitPurchaseOrder(id);
        case "approve":
          return acct.approvePurchaseOrder(id);
        case "reject":
          return acct.rejectPurchaseOrder(id, body ?? {});
        case "send":
          return acct.sendPurchaseOrder(id);
        case "receive":
          return acct.receivePurchaseOrder(id, body ?? {});
        case "close":
          return acct.closePurchaseOrder(id);
        case "cancel":
          return acct.cancelPurchaseOrder(id, body ?? {});
        case "convert-to-bill":
          return acct.convertPurchaseOrderToBill(id);
        default:
          throw new Error(`Unknown PO action: ${action as string}`);
      }
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.purchaseOrder(v.id) });
      payablesInvalidate(qc);
      if (v.action === "receive" || v.action === "convert-to-bill") {
        void qc.invalidateQueries({ queryKey: accountingKeys.inventory() });
        void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "bills"] });
      }
    },
  });
}

export function useCreateBillMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createAccountingBill,
    onSuccess: () => payablesInvalidate(qc),
  });
}

export function usePatchBillMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.patchAccountingBill(id, body),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.bill(v.id) });
      payablesInvalidate(qc);
    },
  });
}

export function useBillActionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      action,
      body,
    }: {
      id: string;
      action: "submit" | "approve" | "reject" | "post" | "void" | "credit-note";
      body?: Record<string, unknown>;
    }) => {
      switch (action) {
        case "submit":
          return acct.submitAccountingBill(id);
        case "approve":
          return acct.approveAccountingBill(id);
        case "reject":
          return acct.rejectAccountingBill(id, body ?? {});
        case "post":
          return acct.postAccountingBill(id);
        case "void":
          return acct.voidAccountingBill(id, body as { reason: string });
        case "credit-note":
          return acct.creditNoteAccountingBill(id, body ?? {});
        default:
          throw new Error(`Unknown bill action: ${action as string}`);
      }
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.bill(v.id) });
      payablesInvalidate(qc);
      invalidateAccountingMoney(qc);
    },
  });
}

export function useCreateSupplierPaymentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createSupplierPayment,
    onSuccess: () => payablesInvalidate(qc),
  });
}

export function useSupplierPaymentActionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      action,
      body,
    }: {
      id: string;
      action: "approve" | "post" | "void" | "remittance";
      body?: Record<string, unknown>;
    }) => {
      switch (action) {
        case "approve":
          return acct.approveSupplierPayment(id);
        case "post":
          return acct.postSupplierPayment(id);
        case "void":
          return acct.voidSupplierPayment(id, body as { reason: string });
        case "remittance":
          return acct.sendSupplierPaymentRemittance(id);
        default:
          throw new Error(`Unknown payment action: ${action as string}`);
      }
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.supplierPayment(v.id) });
      payablesInvalidate(qc);
      invalidateAccountingMoney(qc);
    },
  });
}

function expensesInvalidate(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "expenses"] });
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "approvals"] });
  void qc.invalidateQueries({ queryKey: accountingKeys.dashboard() });
}

export function useCreateExpenseMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createAccountingExpense,
    onSuccess: () => {
      expensesInvalidate(qc);
      invalidateAccountingMoney(qc);
    },
  });
}

export function usePatchExpenseMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.patchAccountingExpense(id, body),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.expense(v.id) });
      expensesInvalidate(qc);
    },
  });
}

export function useExpenseActionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      action,
      body,
    }: {
      id: string;
      action: "submit" | "approve" | "reject" | "pay" | "void";
      body?: Record<string, unknown>;
    }) => {
      switch (action) {
        case "submit":
          return acct.submitAccountingExpense(id);
        case "approve":
          return acct.approveAccountingExpense(id);
        case "reject":
          return acct.rejectAccountingExpense(id, body as { reason: string });
        case "pay":
          return acct.payAccountingExpense(id, body ?? {});
        case "void":
          return acct.voidAccountingExpense(id, body as { reason: string });
        default:
          throw new Error(`Unknown expense action: ${action as string}`);
      }
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.expense(v.id) });
      expensesInvalidate(qc);
      invalidateAccountingMoney(qc);
    },
  });
}

export function useCreateBankTransactionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bankAccountId,
      body,
    }: {
      bankAccountId: string;
      body: Record<string, unknown>;
    }) => acct.createBankTransaction(bankAccountId, body),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({
        queryKey: [...accountingKeys.all, "bank-transactions", v.bankAccountId],
      });
      void qc.invalidateQueries({
        queryKey: [...accountingKeys.all, "bank-accounts"],
      });
      invalidateAccountingMoney(qc);
    },
  });
}

export function useImportBankTransactionsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bankAccountId,
      formData,
    }: {
      bankAccountId: string;
      formData: FormData;
    }) => acct.importBankTransactions(bankAccountId, formData),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({
        queryKey: [...accountingKeys.all, "bank-transactions", v.bankAccountId],
      });
      void qc.invalidateQueries({
        queryKey: [...accountingKeys.all, "bank-accounts"],
      });
      invalidateAccountingMoney(qc);
    },
  });
}

export function useBankTransactionActionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      action,
      body,
      bankAccountId,
    }: {
      id: string;
      bankAccountId: string;
      action: "match" | "unmatch" | "exclude" | "create-entry";
      body?: Record<string, unknown>;
    }) => {
      switch (action) {
        case "match":
          return acct.matchBankTransaction(id, body ?? {});
        case "unmatch":
          return acct.unmatchBankTransaction(id);
        case "exclude":
          return acct.excludeBankTransaction(id, body as { reason: string });
        case "create-entry":
          return acct.createEntryFromBankTransaction(id, body ?? {});
        default:
          throw new Error(`Unknown bank txn action: ${action as string}`);
      }
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({
        queryKey: [...accountingKeys.all, "bank-transactions", v.bankAccountId],
      });
      invalidateAccountingMoney(qc);
    },
  });
}

/** Transfers ↔ bank balances, Banking overview, journals. */
function transfersInvalidate(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "transfers"] });
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "bank-accounts"] });
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "journals"] });
  void qc.invalidateQueries({ queryKey: accountingKeys.dashboard() });
}

export function useCreateBankTransferMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createBankTransfer,
    onSuccess: () => {
      transfersInvalidate(qc);
      invalidateAccountingMoney(qc);
    },
  });
}

export function useVoidBankTransferMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      acct.voidBankTransfer(id, { reason }),
    onSuccess: () => {
      transfersInvalidate(qc);
      invalidateAccountingMoney(qc);
    },
  });
}

/** Reconciliations ↔ bank last-reconciled, Banking overview, detail. */
function reconciliationsInvalidate(qc: QueryClient, id?: string) {
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "reconciliations"] });
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "bank-accounts"] });
  void qc.invalidateQueries({ queryKey: accountingKeys.dashboard() });
  if (id) {
    void qc.invalidateQueries({ queryKey: accountingKeys.reconciliation(id) });
  }
}

export function useCreateReconciliationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createReconciliation,
    onSuccess: () => reconciliationsInvalidate(qc),
  });
}

export function usePatchReconciliationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      acct.patchReconciliation(id, body),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.reconciliation(v.id) });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "reconciliations"] });
    },
  });
}

export function useCompleteReconciliationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.completeReconciliation,
    onSuccess: (_d, id) => reconciliationsInvalidate(qc, id),
  });
}

export function useReopenReconciliationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      acct.reopenReconciliation(id, { reason }),
    onSuccess: (_d, v) => reconciliationsInvalidate(qc, v.id),
  });
}

function inventoryInvalidate(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: accountingKeys.inventory() });
  void qc.invalidateQueries({
    queryKey: [...accountingKeys.all, "inventory-movements"],
  });
  void qc.invalidateQueries({ queryKey: accountingKeys.dashboard() });
}

export function useInventoryAdjustmentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.createInventoryAdjustment,
    onSuccess: () => {
      inventoryInvalidate(qc);
      invalidateAccountingMoney(qc);
    },
  });
}

export function usePatchInventoryCostsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.patchInventoryCosts,
    onSuccess: () => {
      inventoryInvalidate(qc);
      invalidateAccountingMoney(qc);
    },
  });
}

function postingQueueInvalidate(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, "posting-queue"] });
  void qc.invalidateQueries({ queryKey: accountingKeys.dashboard() });
}

export function useProcessPostingQueueMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => acct.processPostingQueue({}),
    onSuccess: () => {
      postingQueueInvalidate(qc);
      invalidateAccountingMoney(qc);
    },
  });
}

export function useRetryPostingQueueMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acct.retryPostingQueueItem,
    onSuccess: () => {
      postingQueueInvalidate(qc);
      invalidateAccountingMoney(qc);
    },
  });
}

export function useSkipPostingQueueMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      acct.skipPostingQueueItem(id, { reason }),
    onSuccess: () => {
      postingQueueInvalidate(qc);
    },
  });
}

export function useBankTransactionSuggestionsQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: [...accountingKeys.all, "bank-suggestions", id] as const,
    queryFn: () => acct.getBankTransactionSuggestions(id),
    enabled: enabled && Boolean(id),
  });
}
