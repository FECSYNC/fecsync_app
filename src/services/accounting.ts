/**
 * Staff accounting API client (S1-Q1).
 * Paths match API_PERMISSIONS under /api/admin/accounting/*.
 */
import { api, unwrap, type MaybeWrapped } from "@/utils/api";

const BASE = "/api/admin/accounting";

type JsonRecord = Record<string, unknown>;

function qs(
  params: Record<string, string | number | boolean | null | undefined> = {}
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function call<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const raw = await api<MaybeWrapped<T>>(path, {
    credentials: "include",
    ...init,
  });
  return unwrap(raw) as T;
}

async function getJson<T>(path: string): Promise<T> {
  return call<T>(path, { method: "GET" });
}

async function sendJson<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  return call<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ─── Shared DTOs (loose enough for API evolution; tighten as routes land) ───

export type AccountingSettingsDto = {
  id: string;
  enabled: boolean;
  enabledAt: string | null;
  baseCurrency: string;
  timezone: string;
  fiscalYearStartMonth: number;
  goLiveDate: string;
  bookingRevenueRecognition: "on_confirm" | "on_visit";
  membershipRecognition: "on_payment" | "over_term";
  requireApprovalForManualJournals: boolean;
  manualJournalApprovalThreshold: string | null;
  expenseApprovalThreshold: string | null;
  billApprovalThreshold: string | null;
  supplierPaymentApprovalThreshold: string | null;
  allowSelfApproval: boolean;
  receiptRequiredAbove: string | null;
  defaultPaymentTermsDays: number;
  invoiceReminderOffsets: number[];
  billReminderDaysBefore: number[];
  postShopOrders: boolean;
  postTailoringJobs: boolean;
  giftCardBreakageOnExpiry: boolean;
  allowNegativeStock: boolean;
  statementFooter: string | null;
  openingBalanceVersion?: number;
  updatedAt: string;
};

export type AccountingSettingsResponse =
  | { initialized: true; settings: AccountingSettingsDto }
  | {
      initialized: false;
      defaults?: {
        baseCurrency?: string;
        timezone?: string;
        fiscalYearStartMonth?: number;
      };
      settings?: null;
    }
  | AccountingSettingsDto;

export type LedgerAccountDto = {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype: string;
  systemKey: string | null;
  parentId: string | null;
  isHeader: boolean;
  isActive: boolean;
  archivedAt: string | null;
  locationId: string | null;
  currency: string | null;
  description: string | null;
  cashFlowCategory: string;
  allowManualPosting: boolean;
  defaultTaxCodeId: string | null;
  sortOrder?: number;
  balance?: string | null;
};

export type TaxCodeDto = {
  id: string;
  code: string;
  name: string;
  rate: string;
  kind: string;
  salesTaxAccountId: string | null;
  purchaseTaxAccountId: string | null;
  isDefaultSales: boolean;
  isDefaultPurchase: boolean;
  isActive: boolean;
  syncedFromTaxSettings: boolean;
};

export type AccountingPeriodDto = {
  id: string;
  fiscalYear: number;
  periodNumber: number;
  startsOn: string;
  endsOn: string;
  status: "open" | "closed" | "locked";
  closedAt: string | null;
  lockedAt: string | null;
};

export type BankAccountDto = {
  id: string;
  name: string;
  kind: string;
  locationId: string | null;
  ledgerAccountId: string;
  ledgerAccountCode: string | null;
  ledgerAccountName: string | null;
  bankName: string | null;
  accountLast4: string | null;
  currency: string;
  openingBalance: string;
  openingBalanceDate: string | null;
  stripeAccountId: string | null;
  isDefault: boolean;
  isActive: boolean;
  archivedAt: string | null;
  lastReconciledAt: string | null;
  lastReconciledBalance: string | null;
  balance: string | null;
  /** Present on list responses — unmatched bank lines awaiting match. */
  unmatchedCount?: number;
};

export type ExpenseCategoryDto = {
  id: string;
  name: string;
  ledgerAccountId: string;
  ledgerAccountCode: string | null;
  ledgerAccountName: string | null;
  defaultTaxCodeId: string | null;
  defaultTaxCodeLabel?: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type AccountingSetupPreview = JsonRecord;
export type AccountingSetupResult = JsonRecord;
export type AccountingLookups = JsonRecord;
export type AccountingMappingCatalog = JsonRecord;
export type OpeningBalancesDto = JsonRecord;
export type JournalEntryDto = JsonRecord;
export type CursorPage<T> = { items?: T[]; nextCursor?: string | null } & JsonRecord;

function firstArray<T>(data: unknown, keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const o = data as JsonRecord;
    for (const k of keys) {
      const v = o[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

// ─── Settings / setup / lookups ─────────────────────────────────────────────

export async function getAccountingSettings(): Promise<AccountingSettingsResponse> {
  return getJson(`${BASE}/settings`);
}

export async function patchAccountingSettings(
  patch: Partial<AccountingSettingsDto> & JsonRecord
): Promise<AccountingSettingsDto> {
  const data = await sendJson<{ settings?: AccountingSettingsDto } & AccountingSettingsDto>(
    `${BASE}/settings`,
    "PATCH",
    patch
  );
  return (data as { settings?: AccountingSettingsDto }).settings ?? (data as AccountingSettingsDto);
}

export async function getAccountingSetupPreview(): Promise<AccountingSetupPreview> {
  return getJson(`${BASE}/setup/preview`);
}

export async function runAccountingSetup(
  body: {
    baseCurrency: string;
    fiscalYearStartMonth: number;
    goLiveDate: string;
    timezone?: string;
    template?: "fec_default";
    importHistory?: boolean;
  }
): Promise<AccountingSetupResult> {
  return sendJson(`${BASE}/setup`, "POST", body);
}

export async function getAccountingLookups(): Promise<AccountingLookups> {
  return getJson(`${BASE}/lookups`);
}

// ─── Accounts ───────────────────────────────────────────────────────────────

export type ListAccountsParams = {
  asOf?: string;
  locationId?: string | null;
  includeArchived?: boolean;
  postableOnly?: boolean;
  type?: string;
  q?: string;
};

export async function listAccountingAccounts(
  params: ListAccountsParams = {}
): Promise<LedgerAccountDto[]> {
  const data = await getJson<unknown>(
    `${BASE}/accounts${qs({
      asOf: params.asOf,
      locationId: params.locationId ?? undefined,
      includeArchived: params.includeArchived ? "1" : undefined,
      postableOnly: params.postableOnly ? "1" : undefined,
      type: params.type,
      q: params.q,
    })}`
  );
  return firstArray<LedgerAccountDto>(data, ["accounts", "items"]);
}

export async function getAccountingAccount(id: string): Promise<LedgerAccountDto> {
  const data = await getJson<{ account?: LedgerAccountDto } & LedgerAccountDto>(
    `${BASE}/accounts/${encodeURIComponent(id)}`
  );
  return data.account ?? data;
}

export async function createAccountingAccount(
  body: JsonRecord
): Promise<LedgerAccountDto> {
  const data = await sendJson<{ account?: LedgerAccountDto } & LedgerAccountDto>(
    `${BASE}/accounts`,
    "POST",
    body
  );
  return data.account ?? data;
}

export async function patchAccountingAccount(
  id: string,
  body: JsonRecord
): Promise<LedgerAccountDto> {
  const data = await sendJson<{ account?: LedgerAccountDto } & LedgerAccountDto>(
    `${BASE}/accounts/${encodeURIComponent(id)}`,
    "PATCH",
    body
  );
  return data.account ?? data;
}

export async function archiveAccountingAccount(
  id: string,
  body?: JsonRecord
): Promise<LedgerAccountDto> {
  const data = await sendJson<{ account?: LedgerAccountDto } & LedgerAccountDto>(
    `${BASE}/accounts/${encodeURIComponent(id)}`,
    "DELETE",
    body ?? {}
  );
  return data.account ?? data;
}

export async function importAccountingAccounts(
  formData: FormData
): Promise<JsonRecord> {
  return call(`${BASE}/accounts/import`, { method: "POST", body: formData });
}

// ─── Mappings ───────────────────────────────────────────────────────────────

export async function getAccountingMappings(
  params: { locationId?: string | null } = {}
): Promise<AccountingMappingCatalog> {
  return getJson(
    `${BASE}/mappings${qs({ locationId: params.locationId ?? undefined })}`
  );
}

export async function putAccountingMappings(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/mappings`, "PUT", body);
}

// ─── Tax codes ──────────────────────────────────────────────────────────────

export async function listAccountingTaxCodes(
  params: { includeInactive?: boolean } = {}
): Promise<TaxCodeDto[]> {
  const data = await getJson<unknown>(
    `${BASE}/tax-codes${qs({
      includeInactive: params.includeInactive ? "1" : undefined,
    })}`
  );
  return firstArray<TaxCodeDto>(data, ["taxCodes", "items"]);
}

export async function createAccountingTaxCode(body: JsonRecord): Promise<TaxCodeDto> {
  const data = await sendJson<{ taxCode?: TaxCodeDto } & TaxCodeDto>(
    `${BASE}/tax-codes`,
    "POST",
    body
  );
  return data.taxCode ?? data;
}

export async function patchAccountingTaxCode(
  id: string,
  body: JsonRecord
): Promise<TaxCodeDto> {
  const data = await sendJson<{ taxCode?: TaxCodeDto } & TaxCodeDto>(
    `${BASE}/tax-codes/${encodeURIComponent(id)}`,
    "PATCH",
    body
  );
  return data.taxCode ?? data;
}

export async function syncAccountingTaxCodes(): Promise<TaxCodeDto[]> {
  const data = await sendJson<unknown>(`${BASE}/tax-codes/sync`, "POST", {});
  return firstArray<TaxCodeDto>(data, ["taxCodes", "items"]);
}

// ─── Periods ────────────────────────────────────────────────────────────────

export async function listAccountingPeriods(
  params: { fiscalYear?: number } = {}
): Promise<AccountingPeriodDto[]> {
  const data = await getJson<unknown>(
    `${BASE}/periods${qs({ fiscalYear: params.fiscalYear })}`
  );
  return firstArray<AccountingPeriodDto>(data, ["periods", "items"]);
}

export async function generateAccountingPeriods(
  body: { fiscalYear: number }
): Promise<AccountingPeriodDto[]> {
  const data = await sendJson<unknown>(`${BASE}/periods/generate`, "POST", body);
  return firstArray<AccountingPeriodDto>(data, ["periods", "items"]);
}

export async function getPeriodCloseChecklist(id: string): Promise<JsonRecord> {
  return getJson(`${BASE}/periods/${encodeURIComponent(id)}/close-checklist`);
}

export async function closeAccountingPeriod(
  id: string,
  body: JsonRecord = {}
): Promise<JsonRecord> {
  return sendJson(`${BASE}/periods/${encodeURIComponent(id)}/close`, "POST", body);
}

export async function reopenAccountingPeriod(
  id: string,
  body: { reason: string }
): Promise<JsonRecord> {
  return sendJson(`${BASE}/periods/${encodeURIComponent(id)}/reopen`, "POST", body);
}

export async function yearEndCloseAccounting(
  body: { fiscalYear: number; confirm?: boolean }
): Promise<JsonRecord> {
  return sendJson(`${BASE}/periods/year-end-close`, "POST", body);
}

// ─── Journals ───────────────────────────────────────────────────────────────

export type ListJournalsParams = {
  from?: string;
  to?: string;
  status?: string;
  kind?: string;
  sourceType?: string;
  accountId?: string;
  locationId?: string | null;
  q?: string;
  cursor?: string;
};

export async function listAccountingJournals(
  params: ListJournalsParams = {}
): Promise<CursorPage<JournalEntryDto>> {
  return getJson(
    `${BASE}/journals${qs({
      from: params.from,
      to: params.to,
      status: params.status,
      kind: params.kind,
      sourceType: params.sourceType,
      accountId: params.accountId,
      locationId: params.locationId ?? undefined,
      q: params.q,
      cursor: params.cursor,
    })}`
  );
}

export async function createAccountingJournal(body: JsonRecord): Promise<JournalEntryDto> {
  const data = await sendJson<{ entry?: JournalEntryDto } & JournalEntryDto>(
    `${BASE}/journals`,
    "POST",
    body
  );
  return (data as { entry?: JournalEntryDto }).entry ?? data;
}

export async function getAccountingJournal(id: string): Promise<JournalEntryDto> {
  const data = await getJson<{ entry?: JournalEntryDto } & JournalEntryDto>(
    `${BASE}/journals/${encodeURIComponent(id)}`
  );
  return data.entry ?? data;
}

export async function patchAccountingJournal(
  id: string,
  body: JsonRecord
): Promise<JournalEntryDto> {
  const data = await sendJson<{ entry?: JournalEntryDto } & JournalEntryDto>(
    `${BASE}/journals/${encodeURIComponent(id)}`,
    "PATCH",
    body
  );
  return data.entry ?? data;
}

export async function deleteAccountingJournal(id: string): Promise<JsonRecord> {
  return sendJson(`${BASE}/journals/${encodeURIComponent(id)}`, "DELETE", {});
}

export async function submitAccountingJournal(id: string): Promise<JournalEntryDto> {
  const data = await sendJson<{ entry?: JournalEntryDto } & JournalEntryDto>(
    `${BASE}/journals/${encodeURIComponent(id)}/submit`,
    "POST",
    {}
  );
  return data.entry ?? data;
}

export async function approveAccountingJournal(id: string): Promise<JournalEntryDto> {
  const data = await sendJson<{ entry?: JournalEntryDto } & JournalEntryDto>(
    `${BASE}/journals/${encodeURIComponent(id)}/approve`,
    "POST",
    {}
  );
  return data.entry ?? data;
}

export async function rejectAccountingJournal(
  id: string,
  body: { reason: string }
): Promise<JournalEntryDto> {
  const data = await sendJson<{ entry?: JournalEntryDto } & JournalEntryDto>(
    `${BASE}/journals/${encodeURIComponent(id)}/reject`,
    "POST",
    body
  );
  return data.entry ?? data;
}

export async function postAccountingJournal(id: string): Promise<JournalEntryDto> {
  const data = await sendJson<{ entry?: JournalEntryDto } & JournalEntryDto>(
    `${BASE}/journals/${encodeURIComponent(id)}/post`,
    "POST",
    {}
  );
  return data.entry ?? data;
}

export async function reverseAccountingJournal(
  id: string,
  body: { reversalDate?: string; reason: string }
): Promise<JournalEntryDto> {
  const data = await sendJson<{ entry?: JournalEntryDto } & JournalEntryDto>(
    `${BASE}/journals/${encodeURIComponent(id)}/reverse`,
    "POST",
    body
  );
  return data.entry ?? data;
}

// ─── Ledger / opening balances ──────────────────────────────────────────────

export type LedgerParams = {
  accountId: string;
  from?: string;
  to?: string;
  locationId?: string | null;
  cursor?: string;
};

export async function getAccountingLedger(params: LedgerParams): Promise<JsonRecord> {
  return getJson(
    `${BASE}/ledger${qs({
      accountId: params.accountId,
      from: params.from,
      to: params.to,
      locationId: params.locationId ?? undefined,
      cursor: params.cursor,
    })}`
  );
}

export async function getOpeningBalances(): Promise<OpeningBalancesDto> {
  return getJson(`${BASE}/opening-balances`);
}

export async function putOpeningBalances(body: JsonRecord): Promise<OpeningBalancesDto> {
  return sendJson(`${BASE}/opening-balances`, "PUT", body);
}

// ─── Posting queue / approvals / audit ──────────────────────────────────────

export async function listPostingQueue(
  params: { status?: string; cursor?: string } = {}
): Promise<JsonRecord> {
  return getJson(
    `${BASE}/posting-queue${qs({ status: params.status, cursor: params.cursor })}`
  );
}

export async function processPostingQueue(
  body: { limit?: number } = {}
): Promise<JsonRecord> {
  return sendJson(`${BASE}/posting-queue/process`, "POST", body);
}

export async function retryPostingQueueItem(id: string): Promise<JsonRecord> {
  return sendJson(`${BASE}/posting-queue/${encodeURIComponent(id)}/retry`, "POST", {});
}

export async function skipPostingQueueItem(
  id: string,
  body: { reason: string }
): Promise<JsonRecord> {
  return sendJson(`${BASE}/posting-queue/${encodeURIComponent(id)}/skip`, "POST", body);
}

export async function listAccountingApprovals(
  params: { entity?: string; cursor?: string } = {}
): Promise<JsonRecord> {
  return getJson(
    `${BASE}/approvals${qs({ entity: params.entity, cursor: params.cursor })}`
  );
}

export async function decideAccountingApproval(
  id: string,
  body: { decision: "approve" | "reject"; reason?: string }
): Promise<JsonRecord> {
  return sendJson(`${BASE}/approvals/${encodeURIComponent(id)}/decide`, "POST", body);
}

export async function getAccountingAudit(
  params: {
    entityType?: string;
    entityId?: string;
    userId?: string;
    from?: string;
    to?: string;
    cursor?: string;
  } = {}
): Promise<JsonRecord> {
  return getJson(`${BASE}/audit${qs(params)}`);
}

// ─── Customers / invoices / receipts ────────────────────────────────────────

export async function listAccountingCustomers(
  params: JsonRecord = {}
): Promise<JsonRecord> {
  return getJson(`${BASE}/customers${qs(params as Record<string, string>)}`);
}

export async function searchAccountingCustomers(
  params: { q: string; limit?: number } = { q: "" }
): Promise<JsonRecord> {
  return getJson(
    `${BASE}/customers/search${qs({ q: params.q, limit: params.limit })}`
  );
}

export async function getAccountingCustomer(partyKey: string): Promise<JsonRecord> {
  return getJson(`${BASE}/customers/${encodeURIComponent(partyKey)}`);
}

export async function getCustomerStatement(
  partyKey: string,
  params: { from?: string; to?: string; format?: string } = {}
): Promise<JsonRecord> {
  return getJson(
    `${BASE}/customers/${encodeURIComponent(partyKey)}/statement${qs(params)}`
  );
}

export async function createCustomerStatementLink(
  partyKey: string,
  body: { from: string; to: string } & JsonRecord
): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/customers/${encodeURIComponent(partyKey)}/statement-link`,
    "POST",
    body
  );
}

export async function listAccountingInvoices(
  params: JsonRecord = {}
): Promise<JsonRecord> {
  return getJson(`${BASE}/invoices${qs(params as Record<string, string>)}`);
}

export async function createAccountingInvoice(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/invoices`, "POST", body);
}

export async function getAccountingInvoice(id: string): Promise<JsonRecord> {
  return getJson(`${BASE}/invoices/${encodeURIComponent(id)}`);
}

export async function patchAccountingInvoice(
  id: string,
  body: JsonRecord
): Promise<JsonRecord> {
  return sendJson(`${BASE}/invoices/${encodeURIComponent(id)}`, "PATCH", body);
}

export async function issueAccountingInvoice(id: string): Promise<JsonRecord> {
  return sendJson(`${BASE}/invoices/${encodeURIComponent(id)}/issue`, "POST", {});
}

export async function voidAccountingInvoice(
  id: string,
  body: { reason: string }
): Promise<JsonRecord> {
  return sendJson(`${BASE}/invoices/${encodeURIComponent(id)}/void`, "POST", body);
}

export async function creditNoteAccountingInvoice(
  id: string,
  body: JsonRecord
): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/invoices/${encodeURIComponent(id)}/credit-note`,
    "POST",
    body
  );
}

export async function writeOffAccountingInvoice(
  id: string,
  body: { amount: string | number; reason: string }
): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/invoices/${encodeURIComponent(id)}/write-off`,
    "POST",
    body
  );
}

export async function listAccountingReceipts(
  params: JsonRecord = {}
): Promise<JsonRecord> {
  return getJson(`${BASE}/receipts${qs(params as Record<string, string>)}`);
}

export async function createAccountingReceipt(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/receipts`, "POST", body);
}

export async function getAccountingReceipt(id: string): Promise<JsonRecord> {
  return getJson(`${BASE}/receipts/${encodeURIComponent(id)}`);
}

export async function voidAccountingReceipt(
  id: string,
  body: { reason: string }
): Promise<JsonRecord> {
  return sendJson(`${BASE}/receipts/${encodeURIComponent(id)}/void`, "POST", body);
}

export async function allocateAccountingReceipt(
  id: string,
  body: JsonRecord
): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/receipts/${encodeURIComponent(id)}/allocate`,
    "POST",
    body
  );
}

// ─── Suppliers / POs / bills / supplier payments ────────────────────────────

export async function listAccountingSuppliers(
  params: JsonRecord = {}
): Promise<JsonRecord> {
  return getJson(`${BASE}/suppliers${qs(params as Record<string, string>)}`);
}

export async function createAccountingSupplier(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/suppliers`, "POST", body);
}

export async function importAccountingSuppliers(formData: FormData): Promise<JsonRecord> {
  return call(`${BASE}/suppliers/import`, { method: "POST", body: formData });
}

export async function getAccountingSupplier(id: string): Promise<JsonRecord> {
  return getJson(`${BASE}/suppliers/${encodeURIComponent(id)}`);
}

export async function patchAccountingSupplier(
  id: string,
  body: JsonRecord
): Promise<JsonRecord> {
  return sendJson(`${BASE}/suppliers/${encodeURIComponent(id)}`, "PATCH", body);
}

export async function archiveAccountingSupplier(id: string): Promise<JsonRecord> {
  return sendJson(`${BASE}/suppliers/${encodeURIComponent(id)}`, "DELETE", {});
}

export async function getSupplierStatement(
  id: string,
  params: { from?: string; to?: string } = {}
): Promise<JsonRecord> {
  return getJson(
    `${BASE}/suppliers/${encodeURIComponent(id)}/statement${qs(params)}`
  );
}

export async function listPurchaseOrders(params: JsonRecord = {}): Promise<JsonRecord> {
  return getJson(`${BASE}/purchase-orders${qs(params as Record<string, string>)}`);
}

export async function createPurchaseOrder(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/purchase-orders`, "POST", body);
}

export async function getPurchaseOrder(id: string): Promise<JsonRecord> {
  return getJson(`${BASE}/purchase-orders/${encodeURIComponent(id)}`);
}

export async function patchPurchaseOrder(
  id: string,
  body: JsonRecord
): Promise<JsonRecord> {
  return sendJson(`${BASE}/purchase-orders/${encodeURIComponent(id)}`, "PATCH", body);
}

async function poAction(id: string, action: string, body: JsonRecord = {}) {
  return sendJson(
    `${BASE}/purchase-orders/${encodeURIComponent(id)}/${action}`,
    "POST",
    body
  );
}

export const submitPurchaseOrder = (id: string) => poAction(id, "submit");
export const approvePurchaseOrder = (id: string) => poAction(id, "approve");
export const rejectPurchaseOrder = (id: string, body: { reason?: string }) =>
  poAction(id, "reject", body);
export const sendPurchaseOrder = (id: string) => poAction(id, "send");
export const receivePurchaseOrder = (id: string, body: JsonRecord) =>
  poAction(id, "receive", body);
export const closePurchaseOrder = (id: string) => poAction(id, "close");
export const cancelPurchaseOrder = (id: string, body: { reason?: string } = {}) =>
  poAction(id, "cancel", body);
export const convertPurchaseOrderToBill = (id: string) =>
  poAction(id, "convert-to-bill");

export async function listAccountingBills(params: JsonRecord = {}): Promise<JsonRecord> {
  return getJson(`${BASE}/bills${qs(params as Record<string, string>)}`);
}

export async function createAccountingBill(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/bills`, "POST", body);
}

export async function getAccountingBill(id: string): Promise<JsonRecord> {
  return getJson(`${BASE}/bills/${encodeURIComponent(id)}`);
}

export async function patchAccountingBill(
  id: string,
  body: JsonRecord
): Promise<JsonRecord> {
  return sendJson(`${BASE}/bills/${encodeURIComponent(id)}`, "PATCH", body);
}

async function billAction(id: string, action: string, body: JsonRecord = {}) {
  return sendJson(`${BASE}/bills/${encodeURIComponent(id)}/${action}`, "POST", body);
}

export const submitAccountingBill = (id: string) => billAction(id, "submit");
export const approveAccountingBill = (id: string) => billAction(id, "approve");
export const rejectAccountingBill = (id: string, body: { reason?: string }) =>
  billAction(id, "reject", body);
export const postAccountingBill = (id: string) => billAction(id, "post");
export const voidAccountingBill = (id: string, body: { reason: string }) =>
  billAction(id, "void", body);
export const creditNoteAccountingBill = (id: string, body: JsonRecord) =>
  billAction(id, "credit-note", body);

export async function listSupplierPayments(params: JsonRecord = {}): Promise<JsonRecord> {
  return getJson(
    `${BASE}/supplier-payments${qs(params as Record<string, string>)}`
  );
}

export async function createSupplierPayment(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/supplier-payments`, "POST", body);
}

export async function getSupplierPayment(id: string): Promise<JsonRecord> {
  return getJson(`${BASE}/supplier-payments/${encodeURIComponent(id)}`);
}

export async function approveSupplierPayment(id: string): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/supplier-payments/${encodeURIComponent(id)}/approve`,
    "POST",
    {}
  );
}

export async function postSupplierPayment(id: string): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/supplier-payments/${encodeURIComponent(id)}/post`,
    "POST",
    {}
  );
}

export async function voidSupplierPayment(
  id: string,
  body: { reason: string }
): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/supplier-payments/${encodeURIComponent(id)}/void`,
    "POST",
    body
  );
}

export async function sendSupplierPaymentRemittance(id: string): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/supplier-payments/${encodeURIComponent(id)}/remittance`,
    "POST",
    {}
  );
}

// ─── Expenses / categories / attachments ────────────────────────────────────

export async function listAccountingExpenses(
  params: JsonRecord = {}
): Promise<JsonRecord> {
  return getJson(`${BASE}/expenses${qs(params as Record<string, string>)}`);
}

export async function createAccountingExpense(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/expenses`, "POST", body);
}

export async function getAccountingExpense(id: string): Promise<JsonRecord> {
  return getJson(`${BASE}/expenses/${encodeURIComponent(id)}`);
}

export async function patchAccountingExpense(
  id: string,
  body: JsonRecord
): Promise<JsonRecord> {
  return sendJson(`${BASE}/expenses/${encodeURIComponent(id)}`, "PATCH", body);
}

async function expenseAction(id: string, action: string, body: JsonRecord = {}) {
  return sendJson(
    `${BASE}/expenses/${encodeURIComponent(id)}/${action}`,
    "POST",
    body
  );
}

export const submitAccountingExpense = (id: string) => expenseAction(id, "submit");
export const approveAccountingExpense = (id: string) => expenseAction(id, "approve");
export const rejectAccountingExpense = (id: string, body: { reason: string }) =>
  expenseAction(id, "reject", body);
export const payAccountingExpense = (id: string, body: JsonRecord = {}) =>
  expenseAction(id, "pay", body);
export const voidAccountingExpense = (id: string, body: { reason: string }) =>
  expenseAction(id, "void", body);

export async function listExpenseCategories(
  params: { includeInactive?: boolean } = {}
): Promise<ExpenseCategoryDto[]> {
  const data = await getJson<unknown>(
    `${BASE}/expense-categories${qs({
      includeInactive: params.includeInactive ? "1" : undefined,
    })}`
  );
  return firstArray<ExpenseCategoryDto>(data, ["categories", "items"]);
}

export async function createExpenseCategory(
  body: JsonRecord
): Promise<ExpenseCategoryDto> {
  const data = await sendJson<{ category?: ExpenseCategoryDto } & ExpenseCategoryDto>(
    `${BASE}/expense-categories`,
    "POST",
    body
  );
  return data.category ?? data;
}

export async function patchExpenseCategory(
  id: string,
  body: JsonRecord
): Promise<ExpenseCategoryDto> {
  const data = await sendJson<{ category?: ExpenseCategoryDto } & ExpenseCategoryDto>(
    `${BASE}/expense-categories/${encodeURIComponent(id)}`,
    "PATCH",
    body
  );
  return data.category ?? data;
}

export async function uploadAccountingAttachment(
  formData: FormData
): Promise<{ url: string; publicId?: string } & JsonRecord> {
  return call(`${BASE}/attachments`, { method: "POST", body: formData });
}

// ─── Banking ────────────────────────────────────────────────────────────────

export async function listBankAccounts(
  params: { includeArchived?: boolean; locationId?: string | null } = {}
): Promise<BankAccountDto[]> {
  const data = await getJson<unknown>(
    `${BASE}/bank-accounts${qs({
      includeArchived: params.includeArchived ? "1" : undefined,
      locationId: params.locationId ?? undefined,
    })}`
  );
  return firstArray<BankAccountDto>(data, ["bankAccounts", "accounts", "items"]);
}

export async function createBankAccount(body: JsonRecord): Promise<BankAccountDto> {
  const data = await sendJson<{ bankAccount?: BankAccountDto } & BankAccountDto>(
    `${BASE}/bank-accounts`,
    "POST",
    body
  );
  return data.bankAccount ?? data;
}

export async function patchBankAccount(
  id: string,
  body: JsonRecord
): Promise<BankAccountDto> {
  const data = await sendJson<{ bankAccount?: BankAccountDto } & BankAccountDto>(
    `${BASE}/bank-accounts/${encodeURIComponent(id)}`,
    "PATCH",
    body
  );
  return data.bankAccount ?? data;
}

export async function archiveBankAccount(id: string): Promise<BankAccountDto> {
  const data = await sendJson<{ bankAccount?: BankAccountDto } & BankAccountDto>(
    `${BASE}/bank-accounts/${encodeURIComponent(id)}`,
    "DELETE",
    {}
  );
  return data.bankAccount ?? data;
}

export async function listBankTransactions(
  bankAccountId: string,
  params: JsonRecord = {}
): Promise<JsonRecord> {
  return getJson(
    `${BASE}/bank-accounts/${encodeURIComponent(bankAccountId)}/transactions${qs(
      params as Record<string, string>
    )}`
  );
}

export async function createBankTransaction(
  bankAccountId: string,
  body: JsonRecord
): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/bank-accounts/${encodeURIComponent(bankAccountId)}/transactions`,
    "POST",
    body
  );
}

export async function importBankTransactions(
  bankAccountId: string,
  formData: FormData
): Promise<JsonRecord> {
  return call(
    `${BASE}/bank-accounts/${encodeURIComponent(bankAccountId)}/import`,
    { method: "POST", body: formData }
  );
}

export async function getBankTransactionSuggestions(id: string): Promise<JsonRecord> {
  return getJson(`${BASE}/bank-transactions/${encodeURIComponent(id)}/suggestions`);
}

export async function matchBankTransaction(
  id: string,
  body: JsonRecord
): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/bank-transactions/${encodeURIComponent(id)}/match`,
    "POST",
    body
  );
}

export async function unmatchBankTransaction(id: string): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/bank-transactions/${encodeURIComponent(id)}/unmatch`,
    "POST",
    {}
  );
}

export async function excludeBankTransaction(
  id: string,
  body: { reason: string }
): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/bank-transactions/${encodeURIComponent(id)}/exclude`,
    "POST",
    body
  );
}

export async function createEntryFromBankTransaction(
  id: string,
  body: JsonRecord
): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/bank-transactions/${encodeURIComponent(id)}/create-entry`,
    "POST",
    body
  );
}

export async function listBankTransfers(params: JsonRecord = {}): Promise<JsonRecord> {
  return getJson(`${BASE}/transfers${qs(params as Record<string, string>)}`);
}

export async function createBankTransfer(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/transfers`, "POST", body);
}

export async function voidBankTransfer(
  id: string,
  body: { reason: string }
): Promise<JsonRecord> {
  return sendJson(`${BASE}/transfers/${encodeURIComponent(id)}/void`, "POST", body);
}

export async function listReconciliations(params: JsonRecord = {}): Promise<JsonRecord> {
  return getJson(
    `${BASE}/reconciliations${qs(params as Record<string, string>)}`
  );
}

export async function createReconciliation(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/reconciliations`, "POST", body);
}

export async function getReconciliation(id: string): Promise<JsonRecord> {
  return getJson(`${BASE}/reconciliations/${encodeURIComponent(id)}`);
}

export async function patchReconciliation(
  id: string,
  body: JsonRecord
): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/reconciliations/${encodeURIComponent(id)}`,
    "PATCH",
    body
  );
}

export async function completeReconciliation(id: string): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/reconciliations/${encodeURIComponent(id)}/complete`,
    "POST",
    {}
  );
}

export async function reopenReconciliation(
  id: string,
  body: { reason: string }
): Promise<JsonRecord> {
  return sendJson(
    `${BASE}/reconciliations/${encodeURIComponent(id)}/reopen`,
    "POST",
    body
  );
}

// ─── Inventory / products / reports / dashboard / source entries ────────────

export async function getInventoryValuation(
  params: { asOf?: string; locationId?: string | null } = {}
): Promise<JsonRecord> {
  return getJson(
    `${BASE}/inventory${qs({
      asOf: params.asOf,
      locationId: params.locationId ?? undefined,
    })}`
  );
}

export async function listInventoryMovements(
  params: JsonRecord = {}
): Promise<JsonRecord> {
  return getJson(
    `${BASE}/inventory/movements${qs(params as Record<string, string>)}`
  );
}

export async function createInventoryAdjustment(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/inventory/adjustments`, "POST", body);
}

export async function patchInventoryCosts(body: JsonRecord): Promise<JsonRecord> {
  return sendJson(`${BASE}/inventory/costs`, "PATCH", body);
}

export async function listAccountingProducts(
  params: { q?: string; locationId?: string | null } = {}
): Promise<JsonRecord> {
  return getJson(
    `${BASE}/products${qs({
      q: params.q,
      locationId: params.locationId ?? undefined,
    })}`
  );
}

/** Calendar month bounds in local time — keep prefetch keys aligned with the desk UI. */
export function accountingDashboardDefaultRange(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${String(last).padStart(2, "0")}`,
  };
}

export async function getAccountingDashboard(
  params: {
    from?: string;
    to?: string;
    locationId?: string | null;
  } = {}
): Promise<JsonRecord> {
  return getJson(
    `${BASE}/dashboard${qs({
      from: params.from,
      to: params.to,
      locationId: params.locationId ?? undefined,
    })}`
  );
}

export async function listAccountingReports(): Promise<JsonRecord> {
  return getJson(`${BASE}/reports`);
}

export async function getAccountingReport(
  report: string,
  params: JsonRecord = {}
): Promise<JsonRecord> {
  return getJson(
    `${BASE}/reports/${encodeURIComponent(report)}${qs(
      params as Record<string, string>
    )}`
  );
}

export async function getAccountingSourceEntries(params: {
  sourceType: string;
  sourceId: string;
}): Promise<JsonRecord> {
  return getJson(
    `${BASE}/source-entries${qs({
      sourceType: params.sourceType,
      sourceId: params.sourceId,
    })}`
  );
}
