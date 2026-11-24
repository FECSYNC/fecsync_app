/**
 * Live refresh helpers for admin surfaces (orders / dashboard).
 *
 * Prefer a numeric `refetchInterval` + `refetchIntervalInBackground: false`.
 * TanStack Query pauses/resumes via the Page Visibility API — returning
 * `false` from an interval function can stop polling until remount.
 */

/** Orders list page — near-realtime for new paid checkouts. */
export const ADMIN_ORDERS_LIVE_MS = 45_000;

/**
 * Header bell paid-queue — lighter + slower than the full orders page poll.
 * Avoids pulling hydrate carts every 10s on every admin route.
 */
export const ADMIN_ORDERS_BELL_LIVE_MS = 60_000;

/** Dashboard order widgets + analytics — keep light on the remote pooler. */
export const ADMIN_DASHBOARD_LIVE_MS = 60_000;

/**
 * Accounting live polls — keep light so background refetch does not contend with
 * hard refresh / first paint (especially filtered journals).
 */
export const ACCOUNTING_DASHBOARD_LIVE_MS = 60_000;

/** Accounting approvals inbox — maker-checker queue stays live with submitters. */
export const ACCOUNTING_APPROVALS_LIVE_MS = 45_000;

/** Accounting journals list — stay aligned with posts, approvals, and reversals. */
export const ACCOUNTING_JOURNALS_LIVE_MS = 60_000;

/** General ledger account activity — quiet sync with journal posts. */
export const ACCOUNTING_LEDGER_LIVE_MS = 60_000;

/** Chart of accounts — stay aligned with posts, archives, and imports. */
export const ACCOUNTING_ACCOUNTS_LIVE_MS = 60_000;

/** AR customers list — stay aligned with invoices, receipts, and write-offs. */
export const ACCOUNTING_CUSTOMERS_LIVE_MS = 60_000;

/** AR invoices list — stay aligned with issue, pay, void, and receipts. */
export const ACCOUNTING_INVOICES_LIVE_MS = 60_000;

/** AR receipts list — stay aligned with record, allocate, and void. */
export const ACCOUNTING_RECEIPTS_LIVE_MS = 60_000;

/**
 * Bank accounts list + pickers — stay aligned with create/archive, transfers,
 * reconciliations, and receipt/payment bank selectors.
 */
export const ACCOUNTING_BANK_ACCOUNTS_LIVE_MS = 60_000;

/** Bank transfers — stay aligned with create/void and bank balances. */
export const ACCOUNTING_TRANSFERS_LIVE_MS = 60_000;

/** Bank reconciliations — stay aligned with start/complete/reopen and bank last-reconciled. */
export const ACCOUNTING_RECONCILIATIONS_LIVE_MS = 60_000;

/** AP suppliers list — stay aligned with bills, payments, and imports. */
export const ACCOUNTING_SUPPLIERS_LIVE_MS = 60_000;

/** AP purchase orders — stay aligned with receive, convert, and cancel. */
export const ACCOUNTING_PURCHASE_ORDERS_LIVE_MS = 60_000;

/** AP bills list — stay aligned with post, pay, void, and PO convert. */
export const ACCOUNTING_BILLS_LIVE_MS = 60_000;

/** AP supplier payments — stay aligned with allocate, post, void, and remittance. */
export const ACCOUNTING_SUPPLIER_PAYMENTS_LIVE_MS = 60_000;

/** Expenses desk — stay aligned with submit, approve, pay, and void. */
export const ACCOUNTING_EXPENSES_LIVE_MS = 60_000;

/** Expense categories picker — quiet sync while filing claims. */
export const ACCOUNTING_EXPENSE_CATEGORIES_LIVE_MS = 60_000;

/** Inventory valuation — stay aligned with adjustments, costs, PO receive, and sales. */
export const ACCOUNTING_INVENTORY_LIVE_MS = 60_000;

/** Inventory movements ledger — quiet sync with valuation posts. */
export const ACCOUNTING_INVENTORY_MOVEMENTS_LIVE_MS = 60_000;

/** Reports catalog — quiet sync if registry / entitlements change while desk is open. */
export const ACCOUNTING_REPORTS_LIVE_MS = 60_000;

/** Open report viewer — stay aligned with journals, AR/AP, inventory, and tax posts. */
export const ACCOUNTING_REPORT_VIEWER_LIVE_MS = 60_000;

/** Accounting periods — stay aligned with close / reopen / year-end and posting locks. */
export const ACCOUNTING_PERIODS_LIVE_MS = 60_000;

/** Posting queue / exceptions — near-live so failed and pending rows stay actionable. */
export const ACCOUNTING_POSTING_QUEUE_LIVE_MS = 45_000;

/** Accounting audit trail — quiet sync as journals, bills, periods, and queue actions land. */
export const ACCOUNTING_AUDIT_LIVE_MS = 45_000;

/** Account mappings — stay aligned with catalog / product / settings changes. */
export const ACCOUNTING_MAPPINGS_LIVE_MS = 60_000;

/** Tax codes — stay aligned with checkout tax sync and ledger tax accounts. */
export const ACCOUNTING_TAX_CODES_LIVE_MS = 60_000;

/** Opening balances — quiet sync with chart / inventory / prior versions. */
export const ACCOUNTING_OPENING_BALANCES_LIVE_MS = 60_000;

/** Accounting settings — stay aligned across desks that read policies / go-live. */
export const ACCOUNTING_SETTINGS_LIVE_MS = 60_000;

/**
 * Accounting live poll gate.
 * - Off in development: hard refresh + keep-alive panels stampede Turbopack/DB.
 * - Off when `live` is false (hidden desk keep-alive / muted route child).
 */
export function accountingLiveRefetchInterval(
  ms: number,
  opts: { enabled?: boolean; live?: boolean } = {}
): number | false {
  if (opts.enabled === false || opts.live === false) return false;
  if (process.env.NODE_ENV === "development") return false;
  return ms;
}

/** Open order detail — catch status changes while viewing. */
export const ADMIN_ORDER_DETAIL_LIVE_MS = 30_000;

/** Customer profile orders after checkout. */
export const CUSTOMER_ORDERS_LIVE_MS = 30_000;

/** Header notifications — no need to match orders cadence. */
export const ADMIN_NOTIFICATIONS_LIVE_MS = 60_000;

/**
 * Create/edit membership plan modal — poll connected sources (categories,
 * settings, catalog products, sibling plans) only while the modal is open.
 */
export const ADMIN_MEMBERSHIPS_MODAL_LIVE_MS = 15_000;

/** Memberships → Settings — keep org/park policy fields aligned while the page is open. */
export const ADMIN_MEMBERSHIPS_SETTINGS_LIVE_MS = 15_000;

/** Sell/assign member modal — keep plan + guest pickers fresh while open. */
export const ADMIN_MEMBERSHIPS_SELL_MODAL_LIVE_MS = 20_000;

/**
 * Guest Marketing overview + desks — KPI / leads / surveys stay aligned with
 * automations, consent toggles, and bridge engines while the page is open.
 */
export const ADMIN_MARKETING_LIVE_MS = 15_000;
