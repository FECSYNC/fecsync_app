/**
 * Report registry (ids are the /reports/[report] slugs).
 */
import { acctError, ACCT } from "@/lib/accounting/errors";
import { parseReportQuery, type ReportQuery } from "@/lib/accounting/reports/common";
import { profitAndLoss } from "@/lib/accounting/reports/profitAndLoss";
import { balanceSheet } from "@/lib/accounting/reports/balanceSheet";
import { cashFlow } from "@/lib/accounting/reports/cashFlow";
import { generalLedgerReport, journalReport, trialBalanceReport } from "@/lib/accounting/reports/ledgerReports";
import { apAgingReport, arAgingReport, customerBalancesReport, supplierBalancesReport } from "@/lib/accounting/reports/aging";
import { salesByAccount, salesByChannel, salesByLocation, salesByProduct, tenderSummary } from "@/lib/accounting/reports/salesReports";
import { expensesByCategory, expensesBySupplier } from "@/lib/accounting/reports/expenseReports";
import { taxSummary } from "@/lib/accounting/reports/taxReport";
import { grossMarginReport, inventoryMovementsReport, inventoryValuationReport } from "@/lib/accounting/reports/inventoryReports";
import { bankReconciliationReport, subledgerReconciliation } from "@/lib/accounting/reports/reconciliationReport";
import { auditTrailReport } from "@/lib/accounting/reports/auditTrail";
import type { AccountingCtx } from "@/lib/accounting/types";

type Runner = (ctx: AccountingCtx, q: ReportQuery, sp: URLSearchParams) => Promise<unknown>;

export const REPORTS: Record<string, { title: string; group: string; run: Runner; audit?: boolean }> = {
  "profit-and-loss": { title: "Profit and loss", group: "Financial statements", run: profitAndLoss },
  "balance-sheet": { title: "Balance sheet", group: "Financial statements", run: balanceSheet },
  "cash-flow": { title: "Cash flow", group: "Financial statements", run: cashFlow },
  "trial-balance": { title: "Trial balance", group: "Financial statements", run: trialBalanceReport },
  "general-ledger": { title: "General ledger", group: "Financial statements", run: generalLedgerReport },
  journal: { title: "Journal", group: "Financial statements", run: journalReport },
  "ar-aging": { title: "Receivables aging", group: "Receivables", run: arAgingReport },
  "customer-balances": { title: "Customer balances", group: "Receivables", run: customerBalancesReport },
  "ap-aging": { title: "Payables aging", group: "Payables", run: apAgingReport },
  "supplier-balances": { title: "Supplier balances", group: "Payables", run: supplierBalancesReport },
  "sales-by-location": { title: "Sales by location", group: "Sales", run: salesByLocation },
  "sales-by-account": { title: "Sales by account", group: "Sales", run: salesByAccount },
  "sales-by-product": { title: "Sales by product", group: "Sales", run: salesByProduct },
  "sales-by-channel": { title: "Sales by channel", group: "Sales", run: salesByChannel },
  "tender-summary": { title: "Tender summary", group: "Sales", run: tenderSummary },
  "expenses-by-category": { title: "Expenses by category", group: "Expenses", run: expensesByCategory },
  "expenses-by-supplier": { title: "Expenses by supplier", group: "Expenses", run: expensesBySupplier },
  "tax-summary": { title: "Tax summary", group: "Tax", run: taxSummary },
  "inventory-valuation": { title: "Inventory valuation", group: "Inventory", run: inventoryValuationReport },
  "inventory-movements": { title: "Inventory movements", group: "Inventory", run: inventoryMovementsReport },
  "gross-margin": { title: "Gross margin", group: "Inventory", run: grossMarginReport },
  "bank-reconciliation": { title: "Bank reconciliation", group: "Banking", run: bankReconciliationReport },
  "subledger-reconciliation": { title: "Subledger reconciliation", group: "Control", run: subledgerReconciliation },
  "audit-trail": { title: "Audit trail", group: "Control", run: auditTrailReport, audit: true },
};

export function reportCatalog() {
  return Object.entries(REPORTS).map(([id, r]) => ({ id, title: r.title, group: r.group, requiresAudit: Boolean(r.audit) }));
}

export async function runReport(ctx: AccountingCtx, id: string, sp: URLSearchParams) {
  const report = REPORTS[id];
  if (!report) throw acctError(ACCT.REPORT_UNKNOWN);
  const q = await parseReportQuery(ctx, sp);
  return report.run(ctx, q, sp);
}
