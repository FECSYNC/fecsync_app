"use client";

import { ACCT, type AccountingErrorCode } from "@/lib/accounting/acctCodes";
import { ApiError } from "@/utils/api";

const MESSAGES: Record<AccountingErrorCode, string> = {
  [ACCT.NOT_INITIALIZED]:
    "Accounting is not set up yet. Run Setup to create the chart of accounts.",
  [ACCT.ALREADY_INITIALIZED]: "Accounting is already set up for this company.",
  [ACCT.BODY_ORG_REJECTED]: "Organization id cannot be sent in the request body.",
  [ACCT.NOT_FOUND]: "That accounting record was not found.",
  [ACCT.VALIDATION]: "Please check the highlighted fields and try again.",
  [ACCT.BASE_CURRENCY_LOCKED]:
    "Base currency is locked after journal entries have been posted.",
  [ACCT.FISCAL_YEAR_LOCKED]:
    "Fiscal year start (or timezone) is locked after periods or journals exist.",
  [ACCT.GO_LIVE_LOCKED]:
    "Go-live date can only move forward, and only if no earlier system postings exist.",
  [ACCT.CODE_TAKEN]: "That account code is already in use.",
  [ACCT.PARENT_TYPE_MISMATCH]: "Parent account must be a header of the same type.",
  [ACCT.HEADER_ACCOUNT]: "Header accounts cannot be posted to directly.",
  [ACCT.ACCOUNT_INACTIVE]: "That account is inactive or archived.",
  [ACCT.ACCOUNT_HAS_BALANCE]:
    "Archive requires a zero balance (remap mappings first if needed).",
  [ACCT.SYSTEM_ACCOUNT_LOCKED]: "System accounts cannot be changed that way.",
  [ACCT.ACCOUNT_TYPE_LOCKED]: "Account type is locked once the account has activity.",
  [ACCT.CONTROL_ACCOUNT]: "Control accounts cannot take manual journal lines.",
  [ACCT.MAPPING_TYPE_INVALID]: "That mapping points to an invalid account type.",
  [ACCT.MAPPING_MISSING]: "A required account mapping is missing.",
  [ACCT.UNBALANCED]: "Debits must equal credits.",
  [ACCT.EMPTY_JOURNAL]: "Add at least two journal lines.",
  [ACCT.LINE_INVALID]: "Each line needs exactly one of debit or credit.",
  [ACCT.PERIOD_CLOSED]: "That period is closed.",
  [ACCT.PERIOD_LOCKED]: "That period is locked.",
  [ACCT.PERIOD_ORDER]: "Close earlier periods first.",
  [ACCT.PERIOD_NOT_FOUND]: "Accounting period not found.",
  [ACCT.PERIOD_HAS_PENDING]:
    "Close is blocked while drafts or posting-queue items remain.",
  [ACCT.BEFORE_GO_LIVE]: "Date is before the accounting go-live date.",
  [ACCT.JOURNAL_NOT_EDITABLE]: "Only draft journals can be edited or deleted.",
  [ACCT.SELF_APPROVAL]: "Self-approval is not allowed for this document.",
  [ACCT.APPROVAL_REQUIRED]: "This document still needs approval.",
  [ACCT.ALREADY_POSTED]: "Already posted.",
  [ACCT.ALREADY_REVERSED]: "Already reversed.",
  [ACCT.SYSTEM_ENTRY_LOCKED]: "System journal entries cannot be edited directly.",
  [ACCT.CURRENCY_MISMATCH]: "Currency does not match the ledger base currency.",
  [ACCT.FX_RATE_REQUIRED]: "An exchange rate is required for this currency.",
  [ACCT.PARTY_REQUIRED]: "A customer or supplier is required on this line.",
  [ACCT.ALLOCATION_PARTY_MISMATCH]:
    "Allocations must belong to the same customer or supplier.",
  [ACCT.OVERALLOCATION]: "Allocation exceeds the amount due.",
  [ACCT.INVOICE_HAS_PAYMENTS]: "Invoice has payments and cannot be voided.",
  [ACCT.INVOICE_NOT_ISSUED]: "Invoice must be issued first.",
  [ACCT.INVOICE_KIND_LOCKED]: "Booking invoices are managed from Booking Invoices.",
  [ACCT.DUPLICATE_SUPPLIER_INVOICE]:
    "That supplier invoice number already exists.",
  [ACCT.SUPPLIER_ARCHIVED]: "Supplier is archived.",
  [ACCT.SUPPLIER_HAS_OPEN_BILLS]:
    "Supplier still has open bills or an AP balance.",
  [ACCT.BILL_NOT_APPROVED]: "Bill must be approved before posting.",
  [ACCT.PO_RECEIVE_EXCEEDS]: "Receive quantity exceeds the ordered quantity.",
  [ACCT.PO_CLOSED]: "Purchase order is closed.",
  [ACCT.EXPENSE_NOT_SUBMITTED]: "Expense must be submitted first.",
  [ACCT.EXPENSE_RECEIPT_REQUIRED]:
    "A receipt attachment is required above the threshold.",
  [ACCT.BANK_ACCOUNT_IN_USE]:
    "Bank account still has a balance or unreconciled lines.",
  [ACCT.BANK_IMPORT_INVALID]: "Bank CSV import failed validation.",
  [ACCT.MATCH_AMOUNT_MISMATCH]:
    "Matched journal lines must sum to the bank amount.",
  [ACCT.ALREADY_RECONCILED]: "Already reconciled.",
  [ACCT.RECON_DIFFERENCE]:
    "Reconciliation difference must be 0.00 before completing.",
  [ACCT.RECON_IN_PROGRESS]:
    "Another reconciliation is already in progress for this account.",
  [ACCT.TRANSFER_SAME_ACCOUNT]: "Choose two different bank accounts.",
  [ACCT.INVENTORY_PRODUCT_UNTRACKED]: "Product does not track inventory.",
  [ACCT.NEGATIVE_STOCK]: "That adjustment would create negative stock.",
  [ACCT.LOCATION_OUT_OF_SCOPE]: "That venue is outside your park scope.",
  [ACCT.LOCATION_ARCHIVED]: "That venue is archived.",
  [ACCT.TOKEN_INVALID]: "This link is invalid.",
  [ACCT.TOKEN_EXPIRED]: "This link has expired.",
  [ACCT.ATTACHMENT_INVALID]:
    "Attachment must be a PDF or image within the size limit.",
  [ACCT.RATE_LIMITED]: "Too many requests — try again in a minute.",
  [ACCT.REPORT_UNKNOWN]: "Unknown report.",
  [ACCT.DATE_RANGE_INVALID]: "Date range is invalid or too large.",
};

function extractCode(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    const payload = error.payload as { code?: string; error?: string } | undefined;
    if (payload?.code) return payload.code;
    if (typeof payload?.error === "string" && payload.error.startsWith("ACCT_")) {
      return payload.error;
    }
    if (error.message.startsWith("ACCT_")) return error.message;
  }
  if (error instanceof Error && error.message.startsWith("ACCT_")) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const o = error as { code?: string; message?: string };
    if (o.code?.startsWith("ACCT_")) return o.code;
    if (o.message?.startsWith("ACCT_")) return o.message;
  }
  return null;
}

export function accountingErrorMessage(error: unknown): string {
  const code = extractCode(error);
  if (code && code in MESSAGES) {
    return MESSAGES[code as AccountingErrorCode];
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong with accounting. Please try again.";
}

export default function AccountingErrorMessage({
  error,
  className = "",
}: {
  error: unknown;
  className?: string;
}) {
  if (!error) return null;
  return (
    <div
      className={`rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 ${className}`}
      role="alert"
    >
      {accountingErrorMessage(error)}
    </div>
  );
}
