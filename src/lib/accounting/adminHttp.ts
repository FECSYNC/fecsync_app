/**
 * Staff accounting catch-all dispatcher (every /api/admin/accounting/* route).
 */
import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { P, lookupApiPermission, type Permission } from "@/lib/auth/permissions";
import { consumeRateLimit } from "@/lib/rateLimit";
import { isUploadFile, uploadSingleFile } from "@/lib/upload";
import { requireAccountingActor } from "@/lib/accounting/gate";
import {
  accountingRouteError,
  matchRoute,
  parseOptionalDate,
  readJsonBody,
  respond,
  type RouteDef,
} from "@/lib/accounting/http";
import { rejectBodyOrgId } from "@/lib/accounting/scope";
import { acctError, ACCT } from "@/lib/accounting/errors";
import {
  getAccountingSettingsCached,
  settingsPatchSchema,
  toSettingsDto,
  updateAccountingSettings,
} from "@/lib/accounting/settings";
import { defaultBaseCurrency, defaultTimezone, setupAccounting } from "@/lib/accounting/setup";
import { FEC_DEFAULT_CHART } from "@/lib/accounting/chartTemplate";
import { backfillOrgHistory, BACKFILL_SOURCES } from "@/lib/accounting/backfill";
import { accountingLookups } from "@/lib/accounting/lookups";
import {
  archiveAccount,
  createAccount,
  importAccountsCsv,
  listAccounts,
  loadAccountInOrg,
  toAccountDto,
  updateAccount,
} from "@/lib/accounting/accounts";
import { listMappings, upsertMappings } from "@/lib/accounting/mappings";
import { createTaxCode, listTaxCodes, syncTaxCodesNow, updateTaxCode } from "@/lib/accounting/taxCodes";
import {
  closeChecklist,
  closePeriod,
  generatePeriodsForYear,
  listPeriods,
  reopenPeriod,
  yearEndClose,
} from "@/lib/accounting/periods";
import {
  approveJournal,
  createManualDraft,
  deleteManualDraft,
  getJournal,
  listJournals,
  postManual,
  rejectJournal,
  reverseJournal,
  submitForApproval,
  toJournalDto,
  updateManualDraft,
} from "@/lib/accounting/journalEngine";
import { getLedger } from "@/lib/accounting/ledgerQueries";
import { getOpeningBalances, saveOpeningBalances } from "@/lib/accounting/posting/openingBalances";
import {
  listQueue,
  processPostingQueue,
  retryQueueItem,
  skipQueueItem,
} from "@/lib/accounting/postingQueue";
import { decideApproval, listPendingApprovals } from "@/lib/accounting/approvals";
import { listAuditTrail } from "@/lib/accounting/reports/auditTrail";
import {
  getCustomer,
  listCustomers,
  searchCustomerParties,
} from "@/lib/accounting/receivables/customers";
import {
  buildCustomerStatement,
  buildSupplierStatement,
  createStatementToken,
} from "@/lib/accounting/receivables/statements";
import {
  createManualInvoice,
  getInvoice,
  issueInvoice,
  listInvoices,
  requestWriteOff,
  updateManualInvoice,
  voidInvoice,
} from "@/lib/accounting/receivables/manualInvoices";
import {
  allocateUnapplied,
  createReceipt,
  getReceipt,
  listReceipts,
  voidReceipt,
} from "@/lib/accounting/receivables/customerReceipts";
import {
  archiveSupplier,
  createSupplier,
  getSupplier,
  importSuppliersCsv,
  listSuppliers,
  updateSupplier,
} from "@/lib/accounting/payables/suppliers";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  convertToBill,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  markPurchaseOrderSent,
  receivePurchaseOrder,
  rejectPurchaseOrder,
  submitPurchaseOrder,
  updatePurchaseOrder,
} from "@/lib/accounting/payables/purchaseOrders";
import {
  approveBill,
  createBill,
  createBillCreditNote,
  getBill,
  listBills,
  postBill,
  rejectBill,
  submitBill,
  updateBill,
  voidBill,
} from "@/lib/accounting/payables/bills";
import {
  approveSupplierPayment,
  createSupplierPayment,
  getSupplierPayment,
  listSupplierPayments,
  postSupplierPaymentDoc,
  remittanceData,
  voidSupplierPayment,
} from "@/lib/accounting/payables/supplierPayments";
import prisma from "@/lib/prisma";
import {
  approveExpense,
  createExpense,
  getExpense,
  listExpenses,
  payReimbursement,
  rejectExpense,
  submitExpense,
  updateExpense,
  voidExpense,
} from "@/lib/accounting/expenses/expenses";
import {
  createExpenseCategory,
  listExpenseCategories,
  updateExpenseCategory,
} from "@/lib/accounting/expenses/expenseCategories";
import {
  archiveBankAccount,
  createBankAccount,
  listBankAccounts,
  updateBankAccount,
} from "@/lib/accounting/banking/bankAccounts";
import { ForbiddenError } from "@/lib/auth/http-error";
import { addManualTransaction, importStatement } from "@/lib/accounting/banking/bankImport";
import {
  createEntryFromBankLine,
  excludeTransaction,
  listBankTransactions,
  matchTransaction,
  suggestMatches,
  unmatchTransaction,
} from "@/lib/accounting/banking/bankMatching";
import { createTransfer, listTransfers, voidTransfer } from "@/lib/accounting/banking/transfers";
import {
  completeReconciliation,
  getReconciliation,
  listReconciliations,
  reopenReconciliation,
  startReconciliation,
  toggleCleared,
} from "@/lib/accounting/banking/reconciliation";
import {
  createAdjustment,
  inventoryValuation,
  listMovements,
  setCosts,
} from "@/lib/accounting/inventory/valuation";
import { getAccountingDashboard } from "@/lib/accounting/dashboard";
import { reportCatalog, runReport } from "@/lib/accounting/reports";
import { listAccountingProducts } from "@/lib/accounting/productsPicker";
import type { AccountingCtx } from "@/lib/accounting/types";
import { ctxHas } from "@/lib/accounting/types";

const OPTIONAL_INIT = new Set([
  "GET settings",
  "POST setup",
  "GET setup/preview",
]);

function spNum(sp: URLSearchParams, key: string): number | undefined {
  const v = sp.get(key);
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function reasonBody(body: Record<string, unknown>, min = 5, max = 500): string {
  const reason = String(body.reason ?? "").trim();
  if (reason.length < min || reason.length > max) {
    throw acctError(ACCT.VALIDATION, { fields: { reason: `Reason must be ${min}–${max} characters` } });
  }
  return reason;
}

async function sourceEntries(ctx: AccountingCtx, sp: URLSearchParams) {
  const sourceType = sp.get("sourceType");
  const sourceId = sp.get("sourceId");
  if (!sourceType || !sourceId) throw acctError(ACCT.VALIDATION, { fields: { sourceType: "Required", sourceId: "Required" } });
  const entries = await prisma.journalEntry.findMany({
    where: {
      orgId: ctx.orgId,
      sourceType: sourceType as never,
      sourceId,
      ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
    },
    include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } },
    orderBy: [{ entryDate: "desc" }, { id: "desc" }],
    take: 100,
  });
  return { items: entries.map((e) => toJournalDto(e)) };
}

type Ctx = AccountingCtx;

const routes: RouteDef<Ctx>[] = [
  {
    method: "GET",
    pattern: "settings",
    requireInitialized: false,
    handler: async ({ ctx }) => {
      const s = await getAccountingSettingsCached(ctx.orgId);
      if (!s?.enabled) {
        return {
          initialized: false,
          defaults: {
            baseCurrency: await defaultBaseCurrency(ctx.orgId),
            timezone: await defaultTimezone(ctx.orgId),
            fiscalYearStartMonth: 1,
            template: "fec_default",
          },
        };
      }
      return { initialized: true, settings: toSettingsDto(s) };
    },
  },
  {
    method: "PATCH",
    pattern: "settings",
    handler: async ({ ctx, body }) => ({
      settings: await updateAccountingSettings(ctx, settingsPatchSchema.parse(body)),
    }),
  },
  {
    method: "GET",
    pattern: "setup/preview",
    requireInitialized: false,
    handler: async ({ ctx }) => {
      const s = await getAccountingSettingsCached(ctx.orgId);
      const dry = s?.enabled
        ? await backfillOrgHistory(ctx.orgId, { dryRun: true, sources: [...BACKFILL_SOURCES] })
        : { enqueued: Object.fromEntries(BACKFILL_SOURCES.map((x) => [x, 0])), processed: 0 };
      return {
        initialized: Boolean(s?.enabled),
        defaults: {
          baseCurrency: await defaultBaseCurrency(ctx.orgId),
          timezone: await defaultTimezone(ctx.orgId),
          fiscalYearStartMonth: s?.fiscalYearStartMonth ?? 1,
          template: "fec_default",
        },
        chartTemplate: FEC_DEFAULT_CHART,
        historyCounts: dry.enqueued,
      };
    },
  },
  {
    method: "POST",
    pattern: "setup",
    requireInitialized: false,
    status: 201,
    handler: async ({ ctx, body }) => setupAccounting(ctx, body),
  },
  { method: "GET", pattern: "lookups", handler: async ({ ctx }) => accountingLookups(ctx) },
  {
    method: "GET",
    pattern: "accounts",
    handler: async ({ ctx, sp }) => {
      const accounts = await listAccounts(ctx, {
        q: sp.get("q") ?? undefined,
        type: sp.get("type") ?? undefined,
        active:
          sp.get("active") ??
          (sp.get("includeArchived") === "1" || sp.get("includeArchived") === "true"
            ? undefined
            : "true"),
        includeBalances: sp.get("includeBalances") === "1" || sp.get("includeBalances") === "true",
        asOf: parseOptionalDate(sp.get("asOf")),
        postableOnly: sp.get("postableOnly") === "1" || sp.get("postableOnly") === "true",
      });
      return { accounts };
    },
  },
  { method: "POST", pattern: "accounts", status: 201, handler: async ({ ctx, body }) => ({ account: await createAccount(ctx, body) }) },
  {
    method: "GET",
    pattern: "accounts/[id]",
    handler: async ({ ctx, params }) => {
      const a = await loadAccountInOrg(ctx, params.id!);
      return { account: toAccountDto(a) };
    },
  },
  { method: "PATCH", pattern: "accounts/[id]", handler: async ({ ctx, params, body }) => ({ account: await updateAccount(ctx, params.id!, body) }) },
  { method: "DELETE", pattern: "accounts/[id]", handler: async ({ ctx, params }) => ({ account: await archiveAccount(ctx, params.id!) }) },
  {
    method: "POST",
    pattern: "accounts/import",
    multipart: true,
    handler: async ({ ctx, form, body }) => {
      let csv = String(body.csv ?? "");
      if (form) {
        const file = form.get("file") ?? form.get("csv");
        if (isUploadFile(file)) csv = await file.text();
        else if (typeof form.get("csv") === "string") csv = String(form.get("csv"));
        else if (typeof form.get("file") === "string") csv = String(form.get("file"));
      }
      if (!csv.trim()) throw acctError(ACCT.VALIDATION, { fields: { csv: "CSV required" } });
      if (Buffer.byteLength(csv, "utf8") > 1024 * 1024) throw acctError(ACCT.ATTACHMENT_INVALID, { message: "CSV must be ≤ 1 MB" });
      return importAccountsCsv(ctx, csv);
    },
  },
  { method: "GET", pattern: "mappings", handler: async ({ ctx }) => listMappings(ctx) },
  { method: "PUT", pattern: "mappings", handler: async ({ ctx, body }) => upsertMappings(ctx, body) },
  { method: "GET", pattern: "tax-codes", handler: async ({ ctx }) => ({ taxCodes: await listTaxCodes(ctx) }) },
  { method: "POST", pattern: "tax-codes", status: 201, handler: async ({ ctx, body }) => ({ taxCode: await createTaxCode(ctx, body) }) },
  { method: "PATCH", pattern: "tax-codes/[id]", handler: async ({ ctx, params, body }) => ({ taxCode: await updateTaxCode(ctx, params.id!, body) }) },
  { method: "POST", pattern: "tax-codes/sync", handler: async ({ ctx }) => ({ taxCodes: await syncTaxCodesNow(ctx) }) },
  { method: "GET", pattern: "periods", handler: async ({ ctx }) => ({ periods: await listPeriods(ctx) }) },
  {
    method: "POST",
    pattern: "periods/generate",
    handler: async ({ ctx, body }) => {
      const fy = Number(body.fiscalYear);
      if (!Number.isInteger(fy)) throw acctError(ACCT.VALIDATION, { fields: { fiscalYear: "Required" } });
      return { periods: await generatePeriodsForYear(ctx, fy) };
    },
  },
  { method: "GET", pattern: "periods/[id]/close-checklist", handler: async ({ ctx, params }) => closeChecklist(ctx, params.id!) },
  { method: "POST", pattern: "periods/[id]/close", handler: async ({ ctx, params }) => ({ period: await closePeriod(ctx, params.id!) }) },
  {
    method: "POST",
    pattern: "periods/[id]/reopen",
    handler: async ({ ctx, params, body }) => ({ period: await reopenPeriod(ctx, params.id!, reasonBody(body)) }),
  },
  {
    method: "POST",
    pattern: "periods/year-end-close",
    handler: async ({ ctx, body }) => {
      const fy = Number(body.fiscalYear);
      if (!Number.isInteger(fy)) throw acctError(ACCT.VALIDATION, { fields: { fiscalYear: "Required" } });
      return yearEndClose(ctx, fy);
    },
  },
  {
    method: "GET",
    pattern: "journals",
    handler: async ({ ctx, sp }) =>
      listJournals(ctx, {
        from: parseOptionalDate(sp.get("from")),
        to: parseOptionalDate(sp.get("to")),
        status: sp.get("status") ?? undefined,
        kind: sp.get("kind") ?? undefined,
        sourceType: sp.get("sourceType") ?? undefined,
        accountId: sp.get("accountId") ?? undefined,
        locationId: sp.get("locationId") ?? undefined,
        q: sp.get("q") ?? undefined,
        cursor: sp.get("cursor") ?? undefined,
        limit: spNum(sp, "limit"),
      }),
  },
  { method: "POST", pattern: "journals", status: 201, handler: async ({ ctx, body }) => ({ journal: await createManualDraft(ctx, body) }) },
  { method: "GET", pattern: "journals/[id]", handler: async ({ ctx, params }) => ({ journal: await getJournal(ctx, params.id!) }) },
  { method: "PATCH", pattern: "journals/[id]", handler: async ({ ctx, params, body }) => ({ journal: await updateManualDraft(ctx, params.id!, body) }) },
  { method: "DELETE", pattern: "journals/[id]", handler: async ({ ctx, params }) => ({ journal: await deleteManualDraft(ctx, params.id!) }) },
  { method: "POST", pattern: "journals/[id]/submit", handler: async ({ ctx, params }) => ({ journal: await submitForApproval(ctx, params.id!) }) },
  { method: "POST", pattern: "journals/[id]/approve", handler: async ({ ctx, params }) => ({ journal: await approveJournal(ctx, params.id!) }) },
  {
    method: "POST",
    pattern: "journals/[id]/reject",
    handler: async ({ ctx, params, body }) => ({ journal: await rejectJournal(ctx, params.id!, reasonBody(body)) }),
  },
  { method: "POST", pattern: "journals/[id]/post", handler: async ({ ctx, params }) => ({ journal: await postManual(ctx, params.id!) }) },
  { method: "POST", pattern: "journals/[id]/reverse", handler: async ({ ctx, params, body }) => ({ journal: await reverseJournal(ctx, params.id!, body) }) },
  {
    method: "GET",
    pattern: "ledger",
    handler: async ({ ctx, sp }) => {
      const accountId = sp.get("accountId");
      if (!accountId) throw acctError(ACCT.VALIDATION, { fields: { accountId: "Required" } });
      return getLedger(ctx, {
        accountId,
        from: parseOptionalDate(sp.get("from")),
        to: parseOptionalDate(sp.get("to")),
        locationId: sp.get("locationId"),
        cursor: sp.get("cursor") ?? undefined,
        limit: spNum(sp, "limit"),
      });
    },
  },
  { method: "GET", pattern: "opening-balances", handler: async ({ ctx }) => getOpeningBalances(ctx) },
  { method: "PUT", pattern: "opening-balances", handler: async ({ ctx, body }) => saveOpeningBalances(ctx, body) },
  {
    method: "GET",
    pattern: "posting-queue",
    handler: async ({ ctx, sp }) => listQueue(ctx, { status: sp.get("status") ?? undefined, cursor: sp.get("cursor") ?? undefined, limit: spNum(sp, "limit") }),
  },
  {
    method: "POST",
    pattern: "posting-queue/process",
    handler: async ({ ctx }) => {
      const rl = consumeRateLimit(`acct:queue:${ctx.orgId}`, 6, 60_000);
      if (!rl.allowed) throw acctError(ACCT.RATE_LIMITED, { details: { retryAfterSec: rl.retryAfterSec } });
      return processPostingQueue({ orgId: ctx.orgId, limit: 500 });
    },
  },
  { method: "POST", pattern: "posting-queue/[id]/retry", handler: async ({ ctx, params }) => retryQueueItem(ctx, params.id!) },
  {
    method: "POST",
    pattern: "posting-queue/[id]/skip",
    handler: async ({ ctx, params, body }) => skipQueueItem(ctx, params.id!, reasonBody(body)),
  },
  { method: "GET", pattern: "approvals", handler: async ({ ctx }) => ({ approvals: await listPendingApprovals(ctx) }) },
  { method: "POST", pattern: "approvals/[id]/decide", handler: async ({ ctx, params, body }) => decideApproval(ctx, params.id!, body) },
  {
    method: "GET",
    pattern: "audit",
    handler: async ({ ctx, sp }) =>
      listAuditTrail(ctx, {
        entityType: sp.get("entityType"),
        entityId: sp.get("entityId"),
        userId: sp.get("userId"),
        from: parseOptionalDate(sp.get("from")),
        to: parseOptionalDate(sp.get("to")),
        cursor: sp.get("cursor"),
        limit: spNum(sp, "limit"),
      }),
  },
  {
    method: "GET",
    pattern: "customers",
    handler: async ({ ctx, sp }) =>
      listCustomers(ctx, {
        q: sp.get("q") ?? undefined,
        hasBalance: sp.get("hasBalance") === "1" || sp.get("hasBalance") === "true",
        asOf: parseOptionalDate(sp.get("asOf")),
      }),
  },
  {
    method: "GET",
    pattern: "customers/search",
    handler: async ({ ctx, sp }) => ({ parties: await searchCustomerParties(ctx, sp.get("q") ?? "") }),
  },
  { method: "GET", pattern: "customers/[partyKey]", handler: async ({ ctx, params }) => getCustomer(ctx, decodeURIComponent(params.partyKey!)) },
  {
    method: "GET",
    pattern: "customers/[partyKey]/statement",
    handler: async ({ ctx, params, sp }) => {
      const from = parseOptionalDate(sp.get("from")) ?? new Date(Date.now() - 90 * 86_400_000);
      const to = parseOptionalDate(sp.get("to")) ?? new Date();
      return buildCustomerStatement(ctx, decodeURIComponent(params.partyKey!), from, to);
    },
  },
  {
    method: "POST",
    pattern: "customers/[partyKey]/statement-link",
    handler: async ({ ctx, params, body }) => {
      const from = parseOptionalDate(String(body.from ?? "")) ?? new Date(Date.now() - 90 * 86_400_000);
      const to = parseOptionalDate(String(body.to ?? "")) ?? new Date();
      const link = await createStatementToken(ctx, decodeURIComponent(params.partyKey!), from, to);
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (email && body.send) {
        let pdf: Buffer | null = null;
        try {
          const { renderCustomerStatementPdf } = await import("@/lib/accounting/export/pdf");
          pdf = await renderCustomerStatementPdf(
            ctx.orgId,
            decodeURIComponent(params.partyKey!),
            from,
            to
          );
        } catch {
          pdf = null;
        }
        const { notifyCustomerStatementSent } = await import("@/lib/accounting/notifications");
        await notifyCustomerStatementSent({
          orgId: ctx.orgId,
          partyKey: decodeURIComponent(params.partyKey!),
          email,
          token: link.token,
          pdf,
        });
      }
      return link;
    },
  },
  {
    method: "GET",
    pattern: "invoices",
    handler: async ({ ctx, sp }) =>
      listInvoices(ctx, {
        kind: sp.get("kind") ?? undefined,
        status: sp.get("status") ?? undefined,
        partyKey: sp.get("partyKey") ?? undefined,
        overdue: sp.get("overdue") === "1" || sp.get("overdue") === "true",
        from: parseOptionalDate(sp.get("from")),
        to: parseOptionalDate(sp.get("to")),
        cursor: sp.get("cursor") ?? undefined,
        limit: spNum(sp, "limit"),
        q: sp.get("q") ?? undefined,
      }),
  },
  { method: "POST", pattern: "invoices", status: 201, handler: async ({ ctx, body }) => ({ invoice: await createManualInvoice(ctx, body) }) },
  { method: "GET", pattern: "invoices/[id]", handler: async ({ ctx, params }) => ({ invoice: await getInvoice(ctx, params.id!) }) },
  { method: "PATCH", pattern: "invoices/[id]", handler: async ({ ctx, params, body }) => ({ invoice: await updateManualInvoice(ctx, params.id!, body) }) },
  { method: "POST", pattern: "invoices/[id]/issue", handler: async ({ ctx, params }) => ({ invoice: await issueInvoice(ctx, params.id!) }) },
  {
    method: "POST",
    pattern: "invoices/[id]/void",
    handler: async ({ ctx, params, body }) => ({ invoice: await voidInvoice(ctx, params.id!, reasonBody(body, 3)) }),
  },
  {
    method: "POST",
    pattern: "invoices/[id]/credit-note",
    handler: async ({ ctx, params, body }) => {
      const inv = await getInvoice(ctx, params.id!);
      const partyKey =
        inv.accountId ? `account:${inv.accountId}` : inv.guestProfileId ? `guest:${inv.guestProfileId}` : inv.customerUserId ? `user:${inv.customerUserId}` : null;
      if (!partyKey) throw acctError(ACCT.PARTY_REQUIRED);
      return {
      invoice: await createManualInvoice(ctx, {
        ...body,
        kind: "credit_note",
        appliesToInvoiceId: params.id,
          partyKey,
          locationId: inv.locationId,
          currency: inv.currency,
          issueDate: body.issueDate ?? new Date().toISOString().slice(0, 10),
          lines: body.lines,
      }),
      };
  },
  },
  { method: "POST", pattern: "invoices/[id]/write-off", handler: async ({ ctx, params, body }) => requestWriteOff(ctx, params.id!, body) },
  {
    method: "GET",
    pattern: "receipts",
    handler: async ({ ctx, sp }) => listReceipts(ctx, { partyKey: sp.get("partyKey") ?? undefined, cursor: sp.get("cursor") ?? undefined, limit: spNum(sp, "limit") }),
  },
  { method: "POST", pattern: "receipts", status: 201, handler: async ({ ctx, body }) => ({ receipt: await createReceipt(ctx, body) }) },
  { method: "GET", pattern: "receipts/[id]", handler: async ({ ctx, params }) => ({ receipt: await getReceipt(ctx, params.id!) }) },
  {
    method: "POST",
    pattern: "receipts/[id]/void",
    handler: async ({ ctx, params, body }) => ({ receipt: await voidReceipt(ctx, params.id!, reasonBody(body, 3)) }),
  },
  { method: "POST", pattern: "receipts/[id]/allocate", handler: async ({ ctx, params, body }) => allocateUnapplied(ctx, params.id!, body) },
  {
    method: "GET",
    pattern: "suppliers",
    handler: async ({ ctx, sp }) =>
      listSuppliers(ctx, {
        q: sp.get("q") ?? undefined,
        active: sp.get("active") ?? undefined,
        hasBalance: sp.get("hasBalance") === "1" || sp.get("hasBalance") === "true",
    }),
  },
  { method: "POST", pattern: "suppliers", status: 201, handler: async ({ ctx, body }) => ({ supplier: await createSupplier(ctx, body) }) },
  {
    method: "POST",
    pattern: "suppliers/import",
    multipart: true,
    handler: async ({ ctx, form, body }) => {
      let csv = String(body.csv ?? "");
      if (form) {
        const file = form.get("file") ?? form.get("csv");
        if (isUploadFile(file)) csv = await file.text();
        else if (typeof form.get("csv") === "string") csv = String(form.get("csv"));
      }
      if (!csv.trim()) throw acctError(ACCT.VALIDATION, { fields: { csv: "CSV required" } });
      if (Buffer.byteLength(csv, "utf8") > 1024 * 1024) throw acctError(ACCT.ATTACHMENT_INVALID, { message: "CSV must be ≤ 1 MB" });
      return importSuppliersCsv(ctx, csv);
    },
  },
  { method: "GET", pattern: "suppliers/[id]", handler: async ({ ctx, params }) => getSupplier(ctx, params.id!) },
  { method: "PATCH", pattern: "suppliers/[id]", handler: async ({ ctx, params, body }) => ({ supplier: await updateSupplier(ctx, params.id!, body) }) },
  { method: "DELETE", pattern: "suppliers/[id]", handler: async ({ ctx, params }) => ({ supplier: await archiveSupplier(ctx, params.id!) }) },
  {
    method: "GET",
    pattern: "suppliers/[id]/statement",
    handler: async ({ ctx, params, sp }) => {
      const from = parseOptionalDate(sp.get("from")) ?? new Date(Date.now() - 90 * 86_400_000);
      const to = parseOptionalDate(sp.get("to")) ?? new Date();
      return buildSupplierStatement(ctx, params.id!, from, to);
    },
  },
  {
    method: "GET",
    pattern: "purchase-orders",
    handler: async ({ ctx, sp }) =>
      listPurchaseOrders(ctx, {
        status: sp.get("status") ?? undefined,
        supplierId: sp.get("supplierId") ?? undefined,
        cursor: sp.get("cursor") ?? undefined,
        limit: spNum(sp, "limit"),
      }),
  },
  { method: "POST", pattern: "purchase-orders", status: 201, handler: async ({ ctx, body }) => ({ purchaseOrder: await createPurchaseOrder(ctx, body) }) },
  { method: "GET", pattern: "purchase-orders/[id]", handler: async ({ ctx, params }) => ({ purchaseOrder: await getPurchaseOrder(ctx, params.id!) }) },
  { method: "PATCH", pattern: "purchase-orders/[id]", handler: async ({ ctx, params, body }) => ({ purchaseOrder: await updatePurchaseOrder(ctx, params.id!, body) }) },
  { method: "POST", pattern: "purchase-orders/[id]/submit", handler: async ({ ctx, params }) => ({ purchaseOrder: await submitPurchaseOrder(ctx, params.id!) }) },
  { method: "POST", pattern: "purchase-orders/[id]/approve", handler: async ({ ctx, params }) => ({ purchaseOrder: await approvePurchaseOrder(ctx, params.id!) }) },
  {
    method: "POST",
    pattern: "purchase-orders/[id]/reject",
    handler: async ({ ctx, params, body }) => ({ purchaseOrder: await rejectPurchaseOrder(ctx, params.id!, reasonBody(body)) }),
  },
  { method: "POST", pattern: "purchase-orders/[id]/send", handler: async ({ ctx, params }) => ({ purchaseOrder: await markPurchaseOrderSent(ctx, params.id!) }) },
  { method: "POST", pattern: "purchase-orders/[id]/receive", handler: async ({ ctx, params, body }) => ({ purchaseOrder: await receivePurchaseOrder(ctx, params.id!, body) }) },
  { method: "POST", pattern: "purchase-orders/[id]/close", handler: async ({ ctx, params }) => ({ purchaseOrder: await closePurchaseOrder(ctx, params.id!) }) },
  {
    method: "POST",
    pattern: "purchase-orders/[id]/cancel",
    handler: async ({ ctx, params, body }) => ({ purchaseOrder: await cancelPurchaseOrder(ctx, params.id!, reasonBody(body, 3)) }),
  },
  { method: "POST", pattern: "purchase-orders/[id]/convert-to-bill", handler: async ({ ctx, params }) => ({ bill: await convertToBill(ctx, params.id!) }) },
  {
    method: "GET",
    pattern: "bills",
    handler: async ({ ctx, sp }) =>
      listBills(ctx, {
        status: sp.get("status") ?? undefined,
        supplierId: sp.get("supplierId") ?? undefined,
        cursor: sp.get("cursor") ?? undefined,
        limit: spNum(sp, "limit"),
      }),
  },
  { method: "POST", pattern: "bills", status: 201, handler: async ({ ctx, body }) => ({ bill: await createBill(ctx, body) }) },
  { method: "GET", pattern: "bills/[id]", handler: async ({ ctx, params }) => ({ bill: await getBill(ctx, params.id!) }) },
  { method: "PATCH", pattern: "bills/[id]", handler: async ({ ctx, params, body }) => ({ bill: await updateBill(ctx, params.id!, body) }) },
  { method: "POST", pattern: "bills/[id]/submit", handler: async ({ ctx, params }) => ({ bill: await submitBill(ctx, params.id!) }) },
  { method: "POST", pattern: "bills/[id]/approve", handler: async ({ ctx, params }) => ({ bill: await approveBill(ctx, params.id!) }) },
  {
    method: "POST",
    pattern: "bills/[id]/reject",
    handler: async ({ ctx, params, body }) => ({ bill: await rejectBill(ctx, params.id!, reasonBody(body)) }),
  },
  { method: "POST", pattern: "bills/[id]/post", handler: async ({ ctx, params }) => ({ bill: await postBill(ctx, params.id!) }) },
  {
    method: "POST",
    pattern: "bills/[id]/void",
    handler: async ({ ctx, params, body }) => ({ bill: await voidBill(ctx, params.id!, reasonBody(body, 3)) }),
  },
  { method: "POST", pattern: "bills/[id]/credit-note", handler: async ({ ctx, params, body }) => ({ bill: await createBillCreditNote(ctx, params.id!, body) }) },
  {
    method: "GET",
    pattern: "supplier-payments",
    handler: async ({ ctx, sp }) =>
      listSupplierPayments(ctx, {
        status: sp.get("status") ?? undefined,
        supplierId: sp.get("supplierId") ?? undefined,
        cursor: sp.get("cursor") ?? undefined,
        limit: spNum(sp, "limit"),
      }),
  },
  { method: "POST", pattern: "supplier-payments", status: 201, handler: async ({ ctx, body }) => ({ payment: await createSupplierPayment(ctx, body) }) },
  { method: "GET", pattern: "supplier-payments/[id]", handler: async ({ ctx, params }) => ({ payment: await getSupplierPayment(ctx, params.id!) }) },
  { method: "POST", pattern: "supplier-payments/[id]/approve", handler: async ({ ctx, params }) => ({ payment: await approveSupplierPayment(ctx, params.id!) }) },
  { method: "POST", pattern: "supplier-payments/[id]/post", handler: async ({ ctx, params }) => ({ payment: await postSupplierPaymentDoc(ctx, params.id!) }) },
  {
    method: "POST",
    pattern: "supplier-payments/[id]/void",
    handler: async ({ ctx, params, body }) => ({ payment: await voidSupplierPayment(ctx, params.id!, reasonBody(body, 3)) }),
  },
  {
    method: "POST",
    pattern: "supplier-payments/[id]/remittance",
    handler: async ({ ctx, params }) => {
      const data = await remittanceData(ctx, params.id!);
      const { notifySupplierRemittance } = await import("@/lib/accounting/notifications");
      await notifySupplierRemittance(params.id!);
      const sent = await prisma.supplierPayment.findUnique({
        where: { id: params.id! },
        select: { remittanceSentAt: true },
      });
      return {
        ...data,
        remittanceSentAt: sent?.remittanceSentAt?.toISOString() ?? new Date().toISOString(),
      };
    },
  },
  {
    method: "GET",
    pattern: "expenses",
    handler: async ({ ctx, sp }) => {
      const forceMine = sp.get("mine") === "1" || sp.get("mine") === "true";
      const lackAll =
        !ctxHas(ctx, P.AccountingExpensesRead) &&
        !ctxHas(ctx, P.AccountingExpensesApprove) &&
        !ctxHas(ctx, P.AccountingExpensesWrite);
      return listExpenses(ctx, {
        status: sp.get("status") ?? undefined,
        mine: forceMine || lackAll,
        cursor: sp.get("cursor") ?? undefined,
        limit: spNum(sp, "limit"),
      });
    },
  },
  { method: "POST", pattern: "expenses", status: 201, handler: async ({ ctx, body }) => ({ expense: await createExpense(ctx, body) }) },
  { method: "GET", pattern: "expenses/[id]", handler: async ({ ctx, params }) => ({ expense: await getExpense(ctx, params.id!) }) },
  { method: "PATCH", pattern: "expenses/[id]", handler: async ({ ctx, params, body }) => ({ expense: await updateExpense(ctx, params.id!, body) }) },
  { method: "POST", pattern: "expenses/[id]/submit", handler: async ({ ctx, params }) => ({ expense: await submitExpense(ctx, params.id!) }) },
  { method: "POST", pattern: "expenses/[id]/approve", handler: async ({ ctx, params }) => ({ expense: await approveExpense(ctx, params.id!) }) },
  {
    method: "POST",
    pattern: "expenses/[id]/reject",
    handler: async ({ ctx, params, body }) => ({ expense: await rejectExpense(ctx, params.id!, reasonBody(body)) }),
  },
  { method: "POST", pattern: "expenses/[id]/pay", handler: async ({ ctx, params, body }) => ({ expense: await payReimbursement(ctx, params.id!, body) }) },
  {
    method: "POST",
    pattern: "expenses/[id]/void",
    handler: async ({ ctx, params, body }) => ({ expense: await voidExpense(ctx, params.id!, reasonBody(body, 3)) }),
  },
  {
    method: "GET",
    pattern: "expense-categories",
    handler: async ({ ctx, sp }) => ({
      categories: await listExpenseCategories(ctx, sp.get("includeInactive") === "1" || sp.get("includeInactive") === "true"),
    }),
  },
  { method: "POST", pattern: "expense-categories", status: 201, handler: async ({ ctx, body }) => ({ category: await createExpenseCategory(ctx, body) }) },
  { method: "PATCH", pattern: "expense-categories/[id]", handler: async ({ ctx, params, body }) => ({ category: await updateExpenseCategory(ctx, params.id!, body) }) },
  {
    method: "POST",
    pattern: "attachments",
    multipart: true,
    handler: async ({ ctx, form }) => {
      if (!form) throw acctError(ACCT.ATTACHMENT_INVALID);
      const file = form.get("file") ?? form.get("files");
      if (!isUploadFile(file)) throw acctError(ACCT.ATTACHMENT_INVALID, { message: "File required" });
      const maxMb = Math.min(Math.max(Number(process.env.ACCOUNTING_ATTACHMENT_MAX_MB ?? 10) || 10, 1), 25);
      if (file.size > maxMb * 1024 * 1024) throw acctError(ACCT.ATTACHMENT_INVALID, { message: `Max ${maxMb} MB` });
      const buffer = Buffer.from(await file.arrayBuffer());
      const sniffed = (() => {
        if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
          return { mime: "application/pdf", resource: "raw" as const };
        }
        if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
          return { mime: "image/jpeg", resource: "image" as const };
        }
        if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
          return { mime: "image/png", resource: "image" as const };
        }
        if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
          return { mime: "image/webp", resource: "image" as const };
        }
        return null;
      })();
      if (!sniffed) throw acctError(ACCT.ATTACHMENT_INVALID, { message: "pdf/jpg/png/webp only" });
      const uploaded = (await uploadSingleFile(
        buffer,
        undefined,
        `accounting/${ctx.orgId}`,
        sniffed.resource
      )) as { secure_url?: string; public_id?: string };
      if (!uploaded?.secure_url || !uploaded.public_id) throw acctError(ACCT.ATTACHMENT_INVALID);
      return { url: uploaded.secure_url, publicId: uploaded.public_id, mime: sniffed.mime };
    },
  },
  {
    method: "GET",
    pattern: "bank-accounts",
    handler: async ({ ctx, sp }) => ({
      bankAccounts: await listBankAccounts(ctx, {
        includeArchived: sp.get("includeArchived") === "1" || sp.get("includeArchived") === "true",
      }),
    }),
  },
  { method: "POST", pattern: "bank-accounts", status: 201, handler: async ({ ctx, body }) => ({ bankAccount: await createBankAccount(ctx, body) }) },
  { method: "PATCH", pattern: "bank-accounts/[id]", handler: async ({ ctx, params, body }) => ({ bankAccount: await updateBankAccount(ctx, params.id!, body) }) },
  { method: "DELETE", pattern: "bank-accounts/[id]", handler: async ({ ctx, params }) => ({ bankAccount: await archiveBankAccount(ctx, params.id!) }) },
  {
    method: "GET",
    pattern: "bank-accounts/[id]/transactions",
    handler: async ({ ctx, params, sp }) =>
      listBankTransactions(ctx, params.id!, {
        status: sp.get("status") ?? undefined,
        cursor: sp.get("cursor") ?? undefined,
        limit: spNum(sp, "limit"),
      }),
  },
  {
    method: "POST",
    pattern: "bank-accounts/[id]/transactions",
    status: 201,
    handler: async ({ ctx, params, body }) => ({ transaction: await addManualTransaction(ctx, params.id!, body) }),
  },
  {
    method: "POST",
    pattern: "bank-accounts/[id]/import",
    multipart: true,
    handler: async ({ ctx, params, form, body }) => {
      const rl = consumeRateLimit(`acct:bankimport:${ctx.orgId}`, 10, 60 * 60_000);
      if (!rl.allowed) throw acctError(ACCT.RATE_LIMITED, { details: { retryAfterSec: rl.retryAfterSec } });
      const mappingRaw = form?.get("mapping") ?? body.mapping;
      const mapping = typeof mappingRaw === "string" ? JSON.parse(mappingRaw) : mappingRaw;
      let csv = "";
      let name = "statement.csv";
      const file = (form?.get("file") ?? form?.get("csv")) ?? null;
      if (isUploadFile(file)) {
        csv = Buffer.from(await file.arrayBuffer()).toString("utf8");
        name = file.name || name;
      } else {
        csv = String(form?.get("csvText") ?? body.csv ?? "");
      }
      return importStatement(ctx, params.id!, { name, text: csv, size: Buffer.byteLength(csv, "utf8") }, mapping);
    },
  },
  { method: "GET", pattern: "bank-transactions/[id]/suggestions", handler: async ({ ctx, params }) => suggestMatches(ctx, params.id!) },
  { method: "POST", pattern: "bank-transactions/[id]/match", handler: async ({ ctx, params, body }) => matchTransaction(ctx, params.id!, body) },
  { method: "POST", pattern: "bank-transactions/[id]/unmatch", handler: async ({ ctx, params }) => unmatchTransaction(ctx, params.id!) },
  {
    method: "POST",
    pattern: "bank-transactions/[id]/exclude",
    handler: async ({ ctx, params, body }) => excludeTransaction(ctx, params.id!, reasonBody(body, 3)),
  },
  { method: "POST", pattern: "bank-transactions/[id]/create-entry", handler: async ({ ctx, params, body }) => createEntryFromBankLine(ctx, params.id!, body) },
  { method: "GET", pattern: "transfers", handler: async ({ ctx }) => ({ transfers: await listTransfers(ctx) }) },
  { method: "POST", pattern: "transfers", status: 201, handler: async ({ ctx, body }) => ({ transfer: await createTransfer(ctx, body) }) },
  {
    method: "POST",
    pattern: "transfers/[id]/void",
    handler: async ({ ctx, params, body }) => ({ transfer: await voidTransfer(ctx, params.id!, reasonBody(body, 3)) }),
  },
  {
    method: "GET",
    pattern: "reconciliations",
    handler: async ({ ctx, sp }) => ({ reconciliations: await listReconciliations(ctx, sp.get("bankAccountId")) }),
  },
  { method: "POST", pattern: "reconciliations", status: 201, handler: async ({ ctx, body }) => startReconciliation(ctx, body) },
  { method: "GET", pattern: "reconciliations/[id]", handler: async ({ ctx, params }) => getReconciliation(ctx, params.id!) },
  { method: "PATCH", pattern: "reconciliations/[id]", handler: async ({ ctx, params, body }) => toggleCleared(ctx, params.id!, body) },
  { method: "POST", pattern: "reconciliations/[id]/complete", handler: async ({ ctx, params }) => completeReconciliation(ctx, params.id!) },
  {
    method: "POST",
    pattern: "reconciliations/[id]/reopen",
    handler: async ({ ctx, params, body }) => {
      if (!ctxHas(ctx, P.AccountingManage)) throw new ForbiddenError("accounting:manage required to reopen");
      return reopenReconciliation(ctx, params.id!, reasonBody(body));
    },
  },
  {
    method: "GET",
    pattern: "inventory",
    handler: async ({ ctx, sp }) =>
      inventoryValuation(ctx, {
        asOf: parseOptionalDate(sp.get("asOf")) ?? new Date(),
        locationId: sp.get("locationId"),
      }),
  },
  {
    method: "GET",
    pattern: "inventory/movements",
    handler: async ({ ctx, sp }) => {
      const raw = sp.get("productRef");
      let productRef: { posProductId: string } | { shopProductId: string } | null = null;
      if (raw?.startsWith("pos:")) productRef = { posProductId: raw.slice(4) };
      else if (raw?.startsWith("shop:")) productRef = { shopProductId: raw.slice(5) };
      return listMovements(ctx, {
        from: parseOptionalDate(sp.get("from")),
        to: parseOptionalDate(sp.get("to")),
        locationId: sp.get("locationId"),
        productRef,
        cursor: sp.get("cursor") ?? undefined,
        limit: spNum(sp, "limit"),
      });
    },
  },
  { method: "POST", pattern: "inventory/adjustments", status: 201, handler: async ({ ctx, body }) => createAdjustment(ctx, body) },
  { method: "PATCH", pattern: "inventory/costs", handler: async ({ ctx, body }) => setCosts(ctx, body) },
  {
    method: "GET",
    pattern: "products",
    handler: async ({ ctx, sp }) =>
      listAccountingProducts(ctx, { q: sp.get("q") ?? undefined, locationId: sp.get("locationId"), limit: spNum(sp, "limit") }),
  },
  {
    method: "GET",
    pattern: "dashboard",
    handler: async ({ ctx, sp }) =>
      getAccountingDashboard(ctx, {
        from: parseOptionalDate(sp.get("from")),
        to: parseOptionalDate(sp.get("to")),
        locationIds: sp.get("locationId") ? [sp.get("locationId")!] : undefined,
      }),
    },
  { method: "GET", pattern: "reports", handler: async () => ({ reports: reportCatalog() }) },
  {
    method: "GET",
    pattern: "reports/[report]",
    handler: async ({ ctx, params, sp }) => {
      if (params.report === "audit-trail" && !ctxHas(ctx, P.AccountingAuditRead)) {
        throw new ForbiddenError("accounting:audit_read required");
      }
      if (params.report !== "audit-trail" && !ctxHas(ctx, P.AccountingReportsRead)) {
        throw new ForbiddenError("accounting:reports_read required");
      }
      return runReport(ctx, params.report!, sp);
    },
  },
  { method: "GET", pattern: "source-entries", handler: async ({ ctx, sp }) => sourceEntries(ctx, sp) },
  {
    method: "GET",
    pattern: "export/journal-lines",
    handler: async ({ ctx, sp }) => {
      if (!ctxHas(ctx, P.AccountingExport)) throw new ForbiddenError("accounting:export required");
      const from = parseOptionalDate(sp.get("from"));
      const to = parseOptionalDate(sp.get("to"));
      if (!from || !to) throw acctError(ACCT.DATE_RANGE_INVALID, { message: "from and to required" });
      const { assertExportDateRange } = await import("@/lib/accounting/export/respond");
      assertExportDateRange(from, to);
      const { locationWhere } = await import("@/lib/accounting/scope");
      const { toApiString } = await import("@/lib/accounting/money");
      const {
        JOURNAL_LINES_EXPORT_HEADERS,
        csvResponse,
      } = await import("@/lib/accounting/export/csv");
      const lines = await prisma.journalLine.findMany({
        where: {
          orgId: ctx.orgId,
          entryDate: { gte: from, lte: to },
          ...locationWhere(ctx.scope),
          entry: { status: { in: ["posted", "reversed"] } },
        },
        include: {
          account: { select: { code: true, name: true } },
          location: { select: { name: true } },
          entry: { select: { number: true, reference: true, sourceType: true, sourceId: true, memo: true } },
        },
        orderBy: [{ entryDate: "asc" }, { entryId: "asc" }, { lineNo: "asc" }],
        take: 50_000,
      });
      const rows = lines.map((l) => {
        const party =
          l.guestProfileId
            ? `guest:${l.guestProfileId}`
            : l.bookingAccountId
              ? `account:${l.bookingAccountId}`
              : l.customerUserId
                ? `user:${l.customerUserId}`
                : l.supplierId
                  ? `supplier:${l.supplierId}`
                  : l.employeeUserId
                    ? `employee:${l.employeeUserId}`
                    : "";
        return [
          l.entryDate.toISOString().slice(0, 10),
          l.entry.number,
          l.account.code,
          l.account.name,
          l.description ?? l.entry.memo ?? "",
          toApiString(l.debit),
          toApiString(l.credit),
          l.location?.name ?? "",
          party,
          l.entry.reference ?? "",
          l.entry.sourceId ? `${l.entry.sourceType}:${l.entry.sourceId}` : l.entry.sourceType,
        ];
      });
      return {
        __rawResponse: csvResponse(
          "journal-lines.csv",
          [...JOURNAL_LINES_EXPORT_HEADERS],
          rows
        ),
      };
    },
  },
];

export async function handleAccountingAdminRequest(req: NextRequest, pathname: string) {
  const rule = lookupApiPermission(req.method, pathname);
  if (!rule || rule.permissions.length === 0) {
    return NextResponse.json({ success: false, error: "Not found", code: "ACCT_NOT_FOUND" }, { status: 404 });
  }

  const relative = pathname.replace(/^\/api\/admin\/accounting\/?/, "");
  const matched = matchRoute(routes, req.method, relative);
  if (!matched) {
    return NextResponse.json({ success: false, error: "Not found", code: "ACCT_NOT_FOUND" }, { status: 404 });
  }

  const key = `${req.method} ${matched.def.pattern}`;
  const requireInitialized = matched.def.requireInitialized ?? !OPTIONAL_INIT.has(key);

  try {
    await connectDB();
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase());
    const ctx = await requireAccountingActor(req, rule.permissions as Permission[], {
      requireInitialized,
      mutation,
    });
    let body: Record<string, unknown> = {};
    let form: FormData | null = null;
    const contentType = req.headers.get("content-type") || "";
    if (matched.def.multipart && contentType.includes("multipart/form-data")) {
      form = await req.formData();
      form.forEach((value, k) => {
        if (typeof value === "string") body[k] = value;
      });
    } else {
      body = await readJsonBody(req);
    }
    rejectBodyOrgId(body, req.nextUrl.searchParams);
    const data = await matched.def.handler({
      ctx,
      params: matched.params,
      body,
      sp: req.nextUrl.searchParams,
      req,
      form,
    });
    if (
      data &&
      typeof data === "object" &&
      "__rawResponse" in (data as object) &&
      (data as { __rawResponse?: unknown }).__rawResponse instanceof Response
    ) {
      return (data as { __rawResponse: Response }).__rawResponse as NextResponse;
    }
    if (req.method.toUpperCase() === "GET") {
      const { maybeFormatResponse } = await import("@/lib/accounting/export/respond");
      const formatted = await maybeFormatResponse({
        ctx,
        pattern: matched.def.pattern,
        params: matched.params,
        sp: req.nextUrl.searchParams,
        data,
      });
      if (formatted) return formatted as NextResponse;
    }
    return respond(data, matched.def.status ?? 200);
  } catch (err) {
    return accountingRouteError(err, req, pathname);
  }
}
