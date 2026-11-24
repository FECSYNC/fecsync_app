-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

-- CreateEnum
CREATE TYPE "LedgerAccountSubtype" AS ENUM ('cash', 'bank', 'payment_clearing', 'receivable', 'inventory', 'tax_receivable', 'prepaid', 'fixed_asset', 'contra_asset', 'other_current_asset', 'payable', 'tax_payable', 'unearned_revenue', 'stored_value_liability', 'tips_payable', 'accrued_liability', 'loan', 'other_liability', 'equity_capital', 'retained_earnings', 'opening_balance_equity', 'drawings', 'operating_revenue', 'other_income', 'contra_revenue', 'cost_of_sales', 'operating_expense', 'other_expense', 'suspense');

-- CreateEnum
CREATE TYPE "CashFlowCategory" AS ENUM ('cash', 'operating', 'investing', 'financing', 'none');

-- CreateEnum
CREATE TYPE "AccountingSystemKey" AS ENUM ('cash_on_hand', 'till_cash', 'petty_cash', 'bank_default', 'stripe_clearing', 'paystack_clearing', 'platform_wallet_clearing', 'undeposited_funds', 'accounts_receivable', 'accounts_payable', 'goods_received_not_invoiced', 'employee_reimbursements', 'sales_tax_payable', 'input_tax', 'customer_deposits', 'gift_card_liability', 'stored_value_liability', 'membership_unearned', 'booking_unearned', 'tips_payable', 'retained_earnings', 'opening_balance_equity', 'revenue_admission', 'revenue_party', 'revenue_food_beverage', 'revenue_merchandise', 'revenue_membership', 'revenue_shop', 'revenue_shipping', 'revenue_tailoring', 'revenue_marketplace', 'revenue_other', 'gift_card_breakage', 'sales_discounts', 'sales_refunds', 'inventory_default', 'cogs_default', 'inventory_wastage', 'payment_fees', 'platform_fees', 'bank_charges', 'bad_debt', 'chargebacks', 'cash_over_short', 'rounding', 'fx_gain_loss', 'suspense');

-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('open', 'closed', 'locked');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('draft', 'pending_approval', 'approved', 'posted', 'reversed', 'void');

-- CreateEnum
CREATE TYPE "JournalKind" AS ENUM ('system', 'manual', 'opening_balance', 'adjustment', 'reversal', 'closing');

-- CreateEnum
CREATE TYPE "AccountingSourceType" AS ENUM ('booking', 'booking_payment', 'booking_refund', 'manual_invoice', 'customer_receipt', 'pos_sale', 'pos_refund', 'pos_void', 'till_movement', 'till_close', 'gift_card', 'park_wallet', 'cashless', 'membership_payment', 'membership_refund', 'marketplace_booking', 'marketplace_refund', 'marketplace_dispute', 'shop_order', 'shop_order_refund', 'tailoring_payment', 'supplier_bill', 'supplier_payment', 'purchase_receipt', 'expense', 'expense_payment', 'bank_transfer', 'bank_line', 'inventory_movement', 'processor_fee', 'opening_balance', 'manual', 'period_close', 'revenue_recognition', 'write_off');

-- CreateEnum
CREATE TYPE "AccountingPartyType" AS ENUM ('customer', 'supplier', 'employee');

-- CreateEnum
CREATE TYPE "PostingQueueStatus" AS ENUM ('pending', 'processing', 'posted', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "AccountingMappingKind" AS ENUM ('admission_product_type', 'admission_product', 'pos_product_kind', 'pos_product', 'pos_line_kind', 'booking_tender', 'pos_tender', 'membership_plan', 'shop_category', 'expense_category', 'stripe_account', 'location_default');

-- CreateEnum
CREATE TYPE "RevenueRecognitionPolicy" AS ENUM ('on_confirm', 'on_visit');

-- CreateEnum
CREATE TYPE "MembershipRecognitionPolicy" AS ENUM ('on_payment', 'over_term');

-- CreateEnum
CREATE TYPE "TaxCodeKind" AS ENUM ('output', 'input', 'both', 'exempt', 'zero_rated');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('booking', 'manual', 'credit_note');

-- CreateEnum
CREATE TYPE "SupplierBillKind" AS ENUM ('bill', 'credit_note');

-- CreateEnum
CREATE TYPE "SupplierBillStatus" AS ENUM ('draft', 'pending_approval', 'approved', 'posted', 'partially_paid', 'paid', 'void');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "AccountingPaymentMethod" AS ENUM ('bank_transfer', 'cash', 'card', 'cheque', 'mobile_money', 'other');

-- CreateEnum
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('draft', 'pending_approval', 'approved', 'posted', 'void');

-- CreateEnum
CREATE TYPE "CustomerReceiptStatus" AS ENUM ('posted', 'void');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'paid', 'void');

-- CreateEnum
CREATE TYPE "ExpensePaymentMode" AS ENUM ('paid_now', 'reimbursable', 'on_account');

-- CreateEnum
CREATE TYPE "BankAccountKind" AS ENUM ('bank', 'cash', 'petty_cash', 'till_cash', 'payment_clearing', 'credit_card');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('unmatched', 'matched', 'reconciled', 'excluded');

-- CreateEnum
CREATE TYPE "BankTransactionSource" AS ENUM ('import_csv', 'manual', 'system');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('in_progress', 'completed');

-- CreateEnum
CREATE TYPE "InventoryMovementKind" AS ENUM ('opening', 'purchase_receipt', 'sale', 'sale_return', 'wastage', 'adjustment_in', 'adjustment_out', 'supplier_return', 'revaluation');

-- CreateEnum
CREATE TYPE "AccountingApprovalEntity" AS ENUM ('journal_entry', 'supplier_bill', 'supplier_payment', 'purchase_order', 'expense', 'write_off');

-- CreateEnum
CREATE TYPE "AccountingApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'accounting';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEntityType" ADD VALUE 'LedgerAccount';
ALTER TYPE "ActivityEntityType" ADD VALUE 'JournalEntry';
ALTER TYPE "ActivityEntityType" ADD VALUE 'AccountingPeriod';
ALTER TYPE "ActivityEntityType" ADD VALUE 'AccountingSettings';
ALTER TYPE "ActivityEntityType" ADD VALUE 'AccountingMapping';
ALTER TYPE "ActivityEntityType" ADD VALUE 'TaxCode';
ALTER TYPE "ActivityEntityType" ADD VALUE 'Supplier';
ALTER TYPE "ActivityEntityType" ADD VALUE 'PurchaseOrder';
ALTER TYPE "ActivityEntityType" ADD VALUE 'SupplierBill';
ALTER TYPE "ActivityEntityType" ADD VALUE 'SupplierPayment';
ALTER TYPE "ActivityEntityType" ADD VALUE 'CustomerReceipt';
ALTER TYPE "ActivityEntityType" ADD VALUE 'Expense';
ALTER TYPE "ActivityEntityType" ADD VALUE 'BankAccount';
ALTER TYPE "ActivityEntityType" ADD VALUE 'BankTransaction';
ALTER TYPE "ActivityEntityType" ADD VALUE 'BankTransfer';
ALTER TYPE "ActivityEntityType" ADD VALUE 'BankReconciliation';
ALTER TYPE "ActivityEntityType" ADD VALUE 'InventoryMovement';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "avgCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "lastCost" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "booking_invoices" ADD COLUMN     "amountDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "appliesToInvoiceId" TEXT,
ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerUserId" TEXT,
ADD COLUMN     "guestProfileId" TEXT,
ADD COLUMN     "issueDate" TIMESTAMP(3),
ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "kind" "InvoiceKind" NOT NULL DEFAULT 'booking',
ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "memo" TEXT,
ADD COLUMN     "paymentTermsDays" INTEGER,
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "viewToken" TEXT,
ADD COLUMN     "writeOffReason" TEXT,
ADD COLUMN     "writtenOffAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pos_products" ADD COLUMN     "avgCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cogsAccountId" TEXT,
ADD COLUMN     "inventoryAccountId" TEXT,
ADD COLUMN     "lastCost" DECIMAL(18,4),
ADD COLUMN     "reorderLevel" INTEGER,
ADD COLUMN     "revenueAccountId" TEXT;

-- CreateTable
CREATE TABLE "accounting_settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "goLiveDate" TIMESTAMP(3) NOT NULL,
    "bookingRevenueRecognition" "RevenueRecognitionPolicy" NOT NULL DEFAULT 'on_confirm',
    "membershipRecognition" "MembershipRecognitionPolicy" NOT NULL DEFAULT 'on_payment',
    "requireApprovalForManualJournals" BOOLEAN NOT NULL DEFAULT true,
    "manualJournalApprovalThreshold" DECIMAL(18,2),
    "expenseApprovalThreshold" DECIMAL(18,2),
    "billApprovalThreshold" DECIMAL(18,2),
    "supplierPaymentApprovalThreshold" DECIMAL(18,2),
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "receiptRequiredAbove" DECIMAL(18,2),
    "defaultPaymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "invoiceReminderOffsets" JSONB NOT NULL DEFAULT '[-3,0,7,14,30]',
    "billReminderDaysBefore" JSONB NOT NULL DEFAULT '[3,1]',
    "postShopOrders" BOOLEAN NOT NULL DEFAULT true,
    "postTailoringJobs" BOOLEAN NOT NULL DEFAULT true,
    "giftCardBreakageOnExpiry" BOOLEAN NOT NULL DEFAULT false,
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT true,
    "statementFooter" TEXT,
    "openingBalanceVersion" INTEGER NOT NULL DEFAULT 0,
    "lastDigestAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "subtype" "LedgerAccountSubtype" NOT NULL,
    "systemKey" "AccountingSystemKey",
    "parentId" TEXT,
    "isHeader" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "locationId" TEXT,
    "currency" TEXT,
    "description" TEXT,
    "cashFlowCategory" "CashFlowCategory" NOT NULL DEFAULT 'operating',
    "allowManualPosting" BOOLEAN NOT NULL DEFAULT true,
    "defaultTaxCodeId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "originalDate" TIMESTAMP(3),
    "lateForPeriodId" TEXT,
    "periodId" TEXT NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'draft',
    "kind" "JournalKind" NOT NULL DEFAULT 'manual',
    "sourceType" "AccountingSourceType" NOT NULL DEFAULT 'manual',
    "sourceId" TEXT,
    "sourceEvent" TEXT,
    "idempotencyKey" TEXT,
    "memo" TEXT,
    "reference" TEXT,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "totalDebit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "locationId" TEXT,
    "attachments" JSONB,
    "createdById" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedReason" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "locationId" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "foreignAmount" DECIMAL(18,2),
    "foreignCurrency" TEXT,
    "description" TEXT,
    "partyType" "AccountingPartyType",
    "guestProfileId" TEXT,
    "bookingAccountId" TEXT,
    "customerUserId" TEXT,
    "supplierId" TEXT,
    "employeeUserId" TEXT,
    "taxCodeId" TEXT,
    "taxBaseAmount" DECIMAL(18,2),
    "bookingId" TEXT,
    "posSaleId" TEXT,
    "invoiceId" TEXT,
    "supplierBillId" TEXT,
    "expenseId" TEXT,
    "posProductId" TEXT,
    "shopProductId" TEXT,
    "reconciledInId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_balances" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "locationKey" TEXT NOT NULL DEFAULT '',
    "debitTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "creditTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_posting_queue" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "sourceType" "AccountingSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceEvent" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "eventAt" TIMESTAMP(3) NOT NULL,
    "status" "PostingQueueStatus" NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "lastError" TEXT,
    "warningCode" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journalEntryId" TEXT,
    "skippedReason" TEXT,
    "skippedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "accounting_posting_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_sequences" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "accounting_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_mappings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "kind" "AccountingMappingKind" NOT NULL,
    "matchKey" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "kind" "TaxCodeKind" NOT NULL,
    "salesTaxAccountId" TEXT,
    "purchaseTaxAccountId" TEXT,
    "isDefaultSales" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultPurchase" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedFromTaxSettings" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "taxId" TEXT,
    "paymentTermsDays" INTEGER,
    "currency" TEXT,
    "defaultExpenseAccountId" TEXT,
    "defaultTaxCodeId" TEXT,
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "bankAccountLast4" TEXT,
    "bankAccountCiphertext" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'draft',
    "orderDate" TIMESTAMP(3) NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "posProductId" TEXT,
    "shopProductId" TEXT,
    "ledgerAccountId" TEXT,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "qtyReceived" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qtyBilled" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "taxCodeId" TEXT,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "receivedValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bills" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierInvoiceNumber" TEXT,
    "kind" "SupplierBillKind" NOT NULL DEFAULT 'bill',
    "status" "SupplierBillStatus" NOT NULL DEFAULT 'draft',
    "billDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "purchaseOrderId" TEXT,
    "appliesToBillId" TEXT,
    "expenseId" TEXT,
    "journalEntryId" TEXT,
    "attachments" JSONB,
    "notes" TEXT,
    "submittedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bill_lines" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "ledgerAccountId" TEXT,
    "posProductId" TEXT,
    "shopProductId" TEXT,
    "purchaseOrderLineId" TEXT,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "taxCodeId" TEXT,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "method" "AccountingPaymentMethod" NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "unappliedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "reference" TEXT,
    "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'draft',
    "journalEntryId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "remittanceSentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_allocations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "defaultTaxCodeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "number" TEXT NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "supplierId" TEXT,
    "payeeName" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "taxCodeId" TEXT,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "paymentMode" "ExpensePaymentMode" NOT NULL,
    "bankAccountId" TEXT,
    "employeeUserId" TEXT,
    "receiptUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ExpenseStatus" NOT NULL DEFAULT 'draft',
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentBankAccountId" TEXT,
    "journalEntryId" TEXT,
    "paymentJournalEntryId" TEXT,
    "supplierBillId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "BankAccountKind" NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "bankName" TEXT,
    "accountLast4" TEXT,
    "currency" TEXT NOT NULL,
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openingBalanceDate" TIMESTAMP(3),
    "stripeAccountId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "lastReconciledBalance" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "dateFormat" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "errorRows" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "txnDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "runningBalance" DECIMAL(18,2),
    "source" "BankTransactionSource" NOT NULL,
    "importId" TEXT,
    "dedupeHash" TEXT NOT NULL,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'unmatched',
    "reconciliationId" TEXT,
    "excludedReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transaction_matches" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "journalLineId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "bank_transaction_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transfers" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "fromBankAccountId" TEXT NOT NULL,
    "toBankAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "feeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transferDate" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "journalEntryId" TEXT,
    "status" "CustomerReceiptStatus" NOT NULL DEFAULT 'posted',
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "statementEndingBalance" DECIMAL(18,2) NOT NULL,
    "openingBalance" DECIMAL(18,2) NOT NULL,
    "clearedBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'in_progress',
    "clearedLineIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "posProductId" TEXT,
    "shopProductId" TEXT,
    "kind" "InventoryMovementKind" NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "onHandAfter" DECIMAL(14,3) NOT NULL,
    "avgCostAfter" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sourceType" "AccountingSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "reason" TEXT,
    "negativeStock" BOOLEAN NOT NULL DEFAULT false,
    "costMissing" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_invoice_lines" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "taxCodeId" TEXT,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_receipts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "number" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "guestProfileId" TEXT,
    "bookingAccountId" TEXT,
    "customerUserId" TEXT,
    "method" "AccountingPaymentMethod" NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "unappliedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "reference" TEXT,
    "stripePaymentIntentId" TEXT,
    "status" "CustomerReceiptStatus" NOT NULL DEFAULT 'posted',
    "journalEntryId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_receipt_allocations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "customer_receipt_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_approvals" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "entity" "AccountingApprovalEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "AccountingApprovalStatus" NOT NULL DEFAULT 'pending',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,

    CONSTRAINT "accounting_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_statement_tokens" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "partyType" "AccountingPartyType" NOT NULL,
    "guestProfileId" TEXT,
    "bookingAccountId" TEXT,
    "customerUserId" TEXT,
    "supplierId" TEXT,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3),

    CONSTRAINT "accounting_statement_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_settings_orgId_key" ON "accounting_settings"("orgId");

-- CreateIndex
CREATE INDEX "ledger_accounts_orgId_type_isActive_idx" ON "ledger_accounts"("orgId", "type", "isActive");

-- CreateIndex
CREATE INDEX "ledger_accounts_orgId_parentId_idx" ON "ledger_accounts"("orgId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_orgId_code_key" ON "ledger_accounts"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_orgId_systemKey_key" ON "ledger_accounts"("orgId", "systemKey");

-- CreateIndex
CREATE INDEX "accounting_periods_orgId_startsOn_idx" ON "accounting_periods"("orgId", "startsOn");

-- CreateIndex
CREATE INDEX "accounting_periods_orgId_status_idx" ON "accounting_periods"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_orgId_fiscalYear_periodNumber_key" ON "accounting_periods"("orgId", "fiscalYear", "periodNumber");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversalOfId_key" ON "journal_entries"("reversalOfId");

-- CreateIndex
CREATE INDEX "journal_entries_orgId_entryDate_idx" ON "journal_entries"("orgId", "entryDate");

-- CreateIndex
CREATE INDEX "journal_entries_orgId_status_idx" ON "journal_entries"("orgId", "status");

-- CreateIndex
CREATE INDEX "journal_entries_orgId_sourceType_sourceId_idx" ON "journal_entries"("orgId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journal_entries_orgId_periodId_idx" ON "journal_entries"("orgId", "periodId");

-- CreateIndex
CREATE INDEX "journal_entries_orgId_locationId_entryDate_idx" ON "journal_entries"("orgId", "locationId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_orgId_number_key" ON "journal_entries"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_orgId_idempotencyKey_key" ON "journal_entries"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "journal_lines_orgId_ledgerAccountId_entryDate_idx" ON "journal_lines"("orgId", "ledgerAccountId", "entryDate");

-- CreateIndex
CREATE INDEX "journal_lines_orgId_locationId_entryDate_idx" ON "journal_lines"("orgId", "locationId", "entryDate");

-- CreateIndex
CREATE INDEX "journal_lines_orgId_guestProfileId_idx" ON "journal_lines"("orgId", "guestProfileId");

-- CreateIndex
CREATE INDEX "journal_lines_orgId_bookingAccountId_idx" ON "journal_lines"("orgId", "bookingAccountId");

-- CreateIndex
CREATE INDEX "journal_lines_orgId_customerUserId_idx" ON "journal_lines"("orgId", "customerUserId");

-- CreateIndex
CREATE INDEX "journal_lines_orgId_supplierId_idx" ON "journal_lines"("orgId", "supplierId");

-- CreateIndex
CREATE INDEX "journal_lines_orgId_employeeUserId_idx" ON "journal_lines"("orgId", "employeeUserId");

-- CreateIndex
CREATE INDEX "journal_lines_orgId_bookingId_idx" ON "journal_lines"("orgId", "bookingId");

-- CreateIndex
CREATE INDEX "journal_lines_orgId_posSaleId_idx" ON "journal_lines"("orgId", "posSaleId");

-- CreateIndex
CREATE INDEX "journal_lines_orgId_invoiceId_idx" ON "journal_lines"("orgId", "invoiceId");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "journal_lines"("entryId");

-- CreateIndex
CREATE INDEX "journal_lines_reconciledInId_idx" ON "journal_lines"("reconciledInId");

-- CreateIndex
CREATE INDEX "account_balances_orgId_periodId_idx" ON "account_balances"("orgId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "account_balances_orgId_ledgerAccountId_periodId_locationKey_key" ON "account_balances"("orgId", "ledgerAccountId", "periodId", "locationKey");

-- CreateIndex
CREATE INDEX "accounting_posting_queue_status_nextAttemptAt_idx" ON "accounting_posting_queue"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "accounting_posting_queue_orgId_status_idx" ON "accounting_posting_queue"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_posting_queue_orgId_sourceType_sourceId_sourceEv_key" ON "accounting_posting_queue"("orgId", "sourceType", "sourceId", "sourceEvent");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_sequences_orgId_key_key" ON "accounting_sequences"("orgId", "key");

-- CreateIndex
CREATE INDEX "accounting_mappings_orgId_kind_idx" ON "accounting_mappings"("orgId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_mappings_orgId_kind_matchKey_locationId_key" ON "accounting_mappings"("orgId", "kind", "matchKey", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_orgId_code_key" ON "tax_codes"("orgId", "code");

-- CreateIndex
CREATE INDEX "suppliers_orgId_name_idx" ON "suppliers"("orgId", "name");

-- CreateIndex
CREATE INDEX "suppliers_orgId_locationId_idx" ON "suppliers"("orgId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_orgId_code_key" ON "suppliers"("orgId", "code");

-- CreateIndex
CREATE INDEX "purchase_orders_orgId_status_idx" ON "purchase_orders"("orgId", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_orgId_supplierId_idx" ON "purchase_orders"("orgId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_orgId_number_key" ON "purchase_orders"("orgId", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchaseOrderId_idx" ON "purchase_order_lines"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "supplier_bills_orgId_status_dueDate_idx" ON "supplier_bills"("orgId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "supplier_bills_orgId_supplierId_idx" ON "supplier_bills"("orgId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bills_orgId_number_key" ON "supplier_bills"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bills_orgId_supplierId_supplierInvoiceNumber_key" ON "supplier_bills"("orgId", "supplierId", "supplierInvoiceNumber");

-- CreateIndex
CREATE INDEX "supplier_bill_lines_billId_idx" ON "supplier_bill_lines"("billId");

-- CreateIndex
CREATE INDEX "supplier_payments_orgId_supplierId_idx" ON "supplier_payments"("orgId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_payments_orgId_status_idx" ON "supplier_payments"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_orgId_number_key" ON "supplier_payments"("orgId", "number");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_billId_idx" ON "supplier_payment_allocations"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_allocations_paymentId_billId_key" ON "supplier_payment_allocations"("paymentId", "billId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_orgId_name_key" ON "expense_categories"("orgId", "name");

-- CreateIndex
CREATE INDEX "expenses_orgId_status_idx" ON "expenses"("orgId", "status");

-- CreateIndex
CREATE INDEX "expenses_orgId_expenseDate_idx" ON "expenses"("orgId", "expenseDate");

-- CreateIndex
CREATE INDEX "expenses_orgId_categoryId_idx" ON "expenses"("orgId", "categoryId");

-- CreateIndex
CREATE INDEX "expenses_orgId_employeeUserId_idx" ON "expenses"("orgId", "employeeUserId");

-- CreateIndex
CREATE INDEX "expenses_orgId_createdById_idx" ON "expenses"("orgId", "createdById");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_orgId_number_key" ON "expenses"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_ledgerAccountId_key" ON "bank_accounts"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "bank_accounts_orgId_kind_idx" ON "bank_accounts"("orgId", "kind");

-- CreateIndex
CREATE INDEX "bank_accounts_orgId_stripeAccountId_idx" ON "bank_accounts"("orgId", "stripeAccountId");

-- CreateIndex
CREATE INDEX "bank_statement_imports_orgId_bankAccountId_idx" ON "bank_statement_imports"("orgId", "bankAccountId");

-- CreateIndex
CREATE INDEX "bank_transactions_orgId_bankAccountId_txnDate_idx" ON "bank_transactions"("orgId", "bankAccountId", "txnDate");

-- CreateIndex
CREATE INDEX "bank_transactions_orgId_status_idx" ON "bank_transactions"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_bankAccountId_dedupeHash_key" ON "bank_transactions"("bankAccountId", "dedupeHash");

-- CreateIndex
CREATE INDEX "bank_transaction_matches_journalLineId_idx" ON "bank_transaction_matches"("journalLineId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_matches_bankTransactionId_journalLineId_key" ON "bank_transaction_matches"("bankTransactionId", "journalLineId");

-- CreateIndex
CREATE INDEX "bank_transfers_orgId_transferDate_idx" ON "bank_transfers"("orgId", "transferDate");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transfers_orgId_number_key" ON "bank_transfers"("orgId", "number");

-- CreateIndex
CREATE INDEX "bank_reconciliations_orgId_bankAccountId_statementDate_idx" ON "bank_reconciliations"("orgId", "bankAccountId", "statementDate");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliations_orgId_number_key" ON "bank_reconciliations"("orgId", "number");

-- CreateIndex
CREATE INDEX "inventory_movements_orgId_locationId_createdAt_idx" ON "inventory_movements"("orgId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_movements_orgId_posProductId_idx" ON "inventory_movements"("orgId", "posProductId");

-- CreateIndex
CREATE INDEX "inventory_movements_orgId_shopProductId_idx" ON "inventory_movements"("orgId", "shopProductId");

-- CreateIndex
CREATE INDEX "inventory_movements_orgId_sourceType_sourceId_idx" ON "inventory_movements"("orgId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "booking_invoice_lines_invoiceId_idx" ON "booking_invoice_lines"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_receipts_stripePaymentIntentId_key" ON "customer_receipts"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "customer_receipts_orgId_guestProfileId_idx" ON "customer_receipts"("orgId", "guestProfileId");

-- CreateIndex
CREATE INDEX "customer_receipts_orgId_bookingAccountId_idx" ON "customer_receipts"("orgId", "bookingAccountId");

-- CreateIndex
CREATE INDEX "customer_receipts_orgId_customerUserId_idx" ON "customer_receipts"("orgId", "customerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_receipts_orgId_number_key" ON "customer_receipts"("orgId", "number");

-- CreateIndex
CREATE INDEX "customer_receipt_allocations_invoiceId_idx" ON "customer_receipt_allocations"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_receipt_allocations_receiptId_invoiceId_key" ON "customer_receipt_allocations"("receiptId", "invoiceId");

-- CreateIndex
CREATE INDEX "accounting_approvals_orgId_status_entity_idx" ON "accounting_approvals"("orgId", "status", "entity");

-- CreateIndex
CREATE INDEX "accounting_approvals_entity_entityId_idx" ON "accounting_approvals"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_statement_tokens_token_key" ON "accounting_statement_tokens"("token");

-- CreateIndex
CREATE INDEX "accounting_statement_tokens_orgId_expiresAt_idx" ON "accounting_statement_tokens"("orgId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_invoices_viewToken_key" ON "booking_invoices"("viewToken");

-- CreateIndex
CREATE INDEX "booking_invoices_orgId_kind_status_idx" ON "booking_invoices"("orgId", "kind", "status");

-- CreateIndex
CREATE INDEX "booking_invoices_orgId_guestProfileId_idx" ON "booking_invoices"("orgId", "guestProfileId");

-- CreateIndex
CREATE INDEX "booking_invoices_orgId_customerUserId_idx" ON "booking_invoices"("orgId", "customerUserId");

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_reconciledInId_fkey" FOREIGN KEY ("reconciledInId") REFERENCES "bank_reconciliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_posting_queue" ADD CONSTRAINT "accounting_posting_queue_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_sequences" ADD CONSTRAINT "accounting_sequences_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_mappings" ADD CONSTRAINT "accounting_mappings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_mappings" ADD CONSTRAINT "accounting_mappings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_mappings" ADD CONSTRAINT "accounting_mappings_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_billId_fkey" FOREIGN KEY ("billId") REFERENCES "supplier_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_billId_fkey" FOREIGN KEY ("billId") REFERENCES "supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_importId_fkey" FOREIGN KEY ("importId") REFERENCES "bank_statement_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "bank_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "journal_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_fromBankAccountId_fkey" FOREIGN KEY ("fromBankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfers" ADD CONSTRAINT "bank_transfers_toBankAccountId_fkey" FOREIGN KEY ("toBankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_posProductId_fkey" FOREIGN KEY ("posProductId") REFERENCES "pos_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_shopProductId_fkey" FOREIGN KEY ("shopProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_invoice_lines" ADD CONSTRAINT "booking_invoice_lines_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_invoice_lines" ADD CONSTRAINT "booking_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "booking_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipt_allocations" ADD CONSTRAINT "customer_receipt_allocations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipt_allocations" ADD CONSTRAINT "customer_receipt_allocations_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "customer_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipt_allocations" ADD CONSTRAINT "customer_receipt_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "booking_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_approvals" ADD CONSTRAINT "accounting_approvals_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_statement_tokens" ADD CONSTRAINT "accounting_statement_tokens_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Double entry: exactly one positive side per journal line.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_one_side_chk"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" = 0) <> ("credit" = 0)));

-- Inventory movement references exactly one product kind.
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_one_product_chk"
  CHECK ((("posProductId" IS NULL) <> ("shopProductId" IS NULL)));

-- Company-wide mapping rows (locationId NULL) are unique per kind + matchKey.
CREATE UNIQUE INDEX "accounting_mappings_company_unique"
  ON "accounting_mappings" ("orgId", "kind", "matchKey")
  WHERE "locationId" IS NULL;

-- One pending approval per entity.
CREATE UNIQUE INDEX "accounting_approvals_pending_unique"
  ON "accounting_approvals" ("entity", "entityId")
  WHERE "status" = 'pending';

-- Backfill existing booking invoices (kind defaults to booking).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE "booking_invoices"
SET "subtotal" = "amount",
    "amountPaid" = CASE WHEN "status" = 'paid' THEN "amount" ELSE 0 END,
    "amountDue" = CASE WHEN "status" IN ('paid', 'void', 'cancelled') THEN 0 ELSE "amount" END,
    "issueDate" = COALESCE("sentAt", "createdAt"),
    "viewToken" = COALESCE(
      "viewToken",
      rtrim(translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_'), '=')
    );
