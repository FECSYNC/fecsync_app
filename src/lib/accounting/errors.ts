/**
 * Stable accounting error codes. `message === code` so API clients and the
 * admin AccountingErrorMessage map can rely on it.
 */
import { NextResponse } from "next/server";
export { ACCT, type AccountingErrorCode } from "@/lib/accounting/acctCodes";
import type { AccountingErrorCode } from "@/lib/accounting/acctCodes";

const STATUS: Record<AccountingErrorCode, number> = {
  ACCT_NOT_INITIALIZED: 409,
  ACCT_ALREADY_INITIALIZED: 200,
  ACCT_BODY_ORG_REJECTED: 400,
  ACCT_NOT_FOUND: 404,
  ACCT_VALIDATION: 400,
  ACCT_BASE_CURRENCY_LOCKED: 409,
  ACCT_FISCAL_YEAR_LOCKED: 409,
  ACCT_GO_LIVE_LOCKED: 409,
  ACCT_CODE_TAKEN: 409,
  ACCT_PARENT_TYPE_MISMATCH: 400,
  ACCT_HEADER_ACCOUNT: 400,
  ACCT_ACCOUNT_INACTIVE: 400,
  ACCT_ACCOUNT_HAS_BALANCE: 409,
  ACCT_SYSTEM_ACCOUNT_LOCKED: 409,
  ACCT_ACCOUNT_TYPE_LOCKED: 409,
  ACCT_CONTROL_ACCOUNT: 400,
  ACCT_MAPPING_TYPE_INVALID: 400,
  ACCT_MAPPING_MISSING: 400,
  ACCT_UNBALANCED: 400,
  ACCT_EMPTY_JOURNAL: 400,
  ACCT_LINE_INVALID: 400,
  ACCT_PERIOD_CLOSED: 409,
  ACCT_PERIOD_LOCKED: 409,
  ACCT_PERIOD_ORDER: 409,
  ACCT_PERIOD_NOT_FOUND: 404,
  ACCT_PERIOD_HAS_PENDING: 409,
  ACCT_BEFORE_GO_LIVE: 400,
  ACCT_JOURNAL_NOT_EDITABLE: 409,
  ACCT_SELF_APPROVAL: 403,
  ACCT_APPROVAL_REQUIRED: 409,
  ACCT_ALREADY_POSTED: 409,
  ACCT_ALREADY_REVERSED: 409,
  ACCT_SYSTEM_ENTRY_LOCKED: 409,
  ACCT_CURRENCY_MISMATCH: 400,
  ACCT_FX_RATE_REQUIRED: 400,
  ACCT_PARTY_REQUIRED: 400,
  ACCT_ALLOCATION_PARTY_MISMATCH: 400,
  ACCT_OVERALLOCATION: 400,
  ACCT_INVOICE_HAS_PAYMENTS: 409,
  ACCT_INVOICE_NOT_ISSUED: 409,
  ACCT_INVOICE_KIND_LOCKED: 409,
  ACCT_DUPLICATE_SUPPLIER_INVOICE: 409,
  ACCT_SUPPLIER_ARCHIVED: 409,
  ACCT_SUPPLIER_HAS_OPEN_BILLS: 409,
  ACCT_BILL_NOT_APPROVED: 409,
  ACCT_PO_RECEIVE_EXCEEDS: 400,
  ACCT_PO_CLOSED: 409,
  ACCT_EXPENSE_NOT_SUBMITTED: 409,
  ACCT_EXPENSE_RECEIPT_REQUIRED: 400,
  ACCT_BANK_ACCOUNT_IN_USE: 409,
  ACCT_BANK_IMPORT_INVALID: 400,
  ACCT_MATCH_AMOUNT_MISMATCH: 400,
  ACCT_ALREADY_RECONCILED: 409,
  ACCT_RECON_DIFFERENCE: 409,
  ACCT_RECON_IN_PROGRESS: 409,
  ACCT_TRANSFER_SAME_ACCOUNT: 400,
  ACCT_INVENTORY_PRODUCT_UNTRACKED: 400,
  ACCT_NEGATIVE_STOCK: 409,
  ACCT_LOCATION_OUT_OF_SCOPE: 404,
  ACCT_LOCATION_ARCHIVED: 409,
  ACCT_TOKEN_INVALID: 404,
  ACCT_TOKEN_EXPIRED: 410,
  ACCT_ATTACHMENT_INVALID: 400,
  ACCT_RATE_LIMITED: 429,
  ACCT_REPORT_UNKNOWN: 404,
  ACCT_DATE_RANGE_INVALID: 400,
};

export class AccountingError extends Error {
  readonly code: AccountingErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly details?: unknown;

  constructor(
    code: AccountingErrorCode,
    opts: { fields?: Record<string, string>; details?: unknown; message?: string } = {}
  ) {
    super(opts.message ?? code);
    this.name = "AccountingError";
    this.code = code;
    this.status = STATUS[code];
    this.fields = opts.fields;
    this.details = opts.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAccountingError(err: unknown): err is AccountingError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "AccountingError" &&
    typeof (err as { code?: unknown }).code === "string"
  );
}

export function acctError(
  code: AccountingErrorCode,
  opts?: { fields?: Record<string, string>; details?: unknown; message?: string }
): AccountingError {
  return new AccountingError(code, opts);
}

export function accountingErrorToResponse(err: unknown): NextResponse | null {
  if (!isAccountingError(err)) return null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (err.status === 429) headers["Retry-After"] = "60";
  return new NextResponse(
    JSON.stringify({
      success: false,
      error: err.code,
      code: err.code,
      ...(err.fields ? { fields: err.fields } : {}),
      ...(err.details !== undefined ? { details: err.details } : {}),
    }),
    { status: err.status, headers }
  );
}
