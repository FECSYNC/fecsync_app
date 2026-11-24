/**
 * FEC default chart of accounts (editable after setup; system accounts locked).
 */
import type {
  AccountingSystemKey,
  CashFlowCategory,
  LedgerAccountSubtype,
  LedgerAccountType,
} from "@prisma/client";

export type ChartTemplateRow = {
  code: string;
  name: string;
  type: LedgerAccountType;
  subtype: LedgerAccountSubtype;
  systemKey?: AccountingSystemKey;
  cashFlowCategory: CashFlowCategory;
  parentCode?: string;
  isHeader?: boolean;
  allowManualPosting?: boolean;
};

const h = (
  code: string,
  name: string,
  type: LedgerAccountType,
  subtype: LedgerAccountSubtype
): ChartTemplateRow => ({
  code,
  name,
  type,
  subtype,
  cashFlowCategory: "none",
  isHeader: true,
  allowManualPosting: false,
});

export const FEC_DEFAULT_CHART: readonly ChartTemplateRow[] = [
  h("1000", "Assets", "asset", "other_current_asset"),
  { code: "1010", name: "Cash on hand", type: "asset", subtype: "cash", systemKey: "cash_on_hand", cashFlowCategory: "cash", parentCode: "1000" },
  { code: "1020", name: "Till cash", type: "asset", subtype: "cash", systemKey: "till_cash", cashFlowCategory: "cash", parentCode: "1000" },
  { code: "1030", name: "Petty cash", type: "asset", subtype: "cash", systemKey: "petty_cash", cashFlowCategory: "cash", parentCode: "1000" },
  { code: "1100", name: "Bank operating", type: "asset", subtype: "bank", systemKey: "bank_default", cashFlowCategory: "cash", parentCode: "1000" },
  { code: "1150", name: "Stripe clearing", type: "asset", subtype: "payment_clearing", systemKey: "stripe_clearing", cashFlowCategory: "cash", parentCode: "1000" },
  { code: "1160", name: "Paystack clearing", type: "asset", subtype: "payment_clearing", systemKey: "paystack_clearing", cashFlowCategory: "cash", parentCode: "1000" },
  { code: "1170", name: "Platform wallet clearing", type: "asset", subtype: "payment_clearing", systemKey: "platform_wallet_clearing", cashFlowCategory: "cash", parentCode: "1000" },
  { code: "1180", name: "Undeposited funds", type: "asset", subtype: "payment_clearing", systemKey: "undeposited_funds", cashFlowCategory: "cash", parentCode: "1000" },
  { code: "1200", name: "Accounts receivable", type: "asset", subtype: "receivable", systemKey: "accounts_receivable", cashFlowCategory: "operating", parentCode: "1000", allowManualPosting: false },
  { code: "1300", name: "Inventory food and beverage", type: "asset", subtype: "inventory", cashFlowCategory: "operating", parentCode: "1000" },
  { code: "1310", name: "Inventory merchandise", type: "asset", subtype: "inventory", systemKey: "inventory_default", cashFlowCategory: "operating", parentCode: "1000" },
  { code: "1400", name: "Input tax recoverable", type: "asset", subtype: "tax_receivable", systemKey: "input_tax", cashFlowCategory: "operating", parentCode: "1000", allowManualPosting: false },
  { code: "1500", name: "Prepaid expenses", type: "asset", subtype: "prepaid", cashFlowCategory: "operating", parentCode: "1000" },
  { code: "1600", name: "Fixed assets", type: "asset", subtype: "fixed_asset", cashFlowCategory: "investing", parentCode: "1000" },
  { code: "1650", name: "Accumulated depreciation", type: "asset", subtype: "contra_asset", cashFlowCategory: "investing", parentCode: "1000" },

  h("2000", "Liabilities", "liability", "other_liability"),
  { code: "2100", name: "Accounts payable", type: "liability", subtype: "payable", systemKey: "accounts_payable", cashFlowCategory: "operating", parentCode: "2000", allowManualPosting: false },
  { code: "2110", name: "Goods received not invoiced", type: "liability", subtype: "payable", systemKey: "goods_received_not_invoiced", cashFlowCategory: "operating", parentCode: "2000", allowManualPosting: false },
  { code: "2150", name: "Employee reimbursements payable", type: "liability", subtype: "payable", systemKey: "employee_reimbursements", cashFlowCategory: "operating", parentCode: "2000", allowManualPosting: false },
  { code: "2200", name: "Sales tax payable", type: "liability", subtype: "tax_payable", systemKey: "sales_tax_payable", cashFlowCategory: "operating", parentCode: "2000", allowManualPosting: false },
  { code: "2300", name: "Customer deposits", type: "liability", subtype: "unearned_revenue", systemKey: "customer_deposits", cashFlowCategory: "operating", parentCode: "2000" },
  { code: "2305", name: "Unearned booking revenue", type: "liability", subtype: "unearned_revenue", systemKey: "booking_unearned", cashFlowCategory: "operating", parentCode: "2000" },
  { code: "2310", name: "Gift card liability", type: "liability", subtype: "stored_value_liability", systemKey: "gift_card_liability", cashFlowCategory: "operating", parentCode: "2000", allowManualPosting: false },
  { code: "2320", name: "Park wallet and cashless liability", type: "liability", subtype: "stored_value_liability", systemKey: "stored_value_liability", cashFlowCategory: "operating", parentCode: "2000", allowManualPosting: false },
  { code: "2340", name: "Unearned membership revenue", type: "liability", subtype: "unearned_revenue", systemKey: "membership_unearned", cashFlowCategory: "operating", parentCode: "2000" },
  { code: "2400", name: "Tips payable", type: "liability", subtype: "tips_payable", systemKey: "tips_payable", cashFlowCategory: "operating", parentCode: "2000" },
  { code: "2500", name: "Accrued expenses", type: "liability", subtype: "accrued_liability", cashFlowCategory: "operating", parentCode: "2000" },
  { code: "2600", name: "Loans payable", type: "liability", subtype: "loan", cashFlowCategory: "financing", parentCode: "2000" },

  h("3000", "Equity", "equity", "equity_capital"),
  { code: "3100", name: "Owner capital", type: "equity", subtype: "equity_capital", cashFlowCategory: "financing", parentCode: "3000" },
  { code: "3200", name: "Retained earnings", type: "equity", subtype: "retained_earnings", systemKey: "retained_earnings", cashFlowCategory: "none", parentCode: "3000" },
  { code: "3300", name: "Opening balance equity", type: "equity", subtype: "opening_balance_equity", systemKey: "opening_balance_equity", cashFlowCategory: "none", parentCode: "3000" },
  { code: "3400", name: "Owner drawings", type: "equity", subtype: "drawings", cashFlowCategory: "financing", parentCode: "3000" },

  h("4000", "Revenue", "revenue", "operating_revenue"),
  { code: "4100", name: "Admission and ticket revenue", type: "revenue", subtype: "operating_revenue", systemKey: "revenue_admission", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4150", name: "Party revenue", type: "revenue", subtype: "operating_revenue", systemKey: "revenue_party", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4200", name: "Food and beverage sales", type: "revenue", subtype: "operating_revenue", systemKey: "revenue_food_beverage", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4250", name: "Merchandise sales", type: "revenue", subtype: "operating_revenue", systemKey: "revenue_merchandise", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4300", name: "Membership revenue", type: "revenue", subtype: "operating_revenue", systemKey: "revenue_membership", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4400", name: "Online shop sales", type: "revenue", subtype: "operating_revenue", systemKey: "revenue_shop", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4450", name: "Shipping income", type: "revenue", subtype: "operating_revenue", systemKey: "revenue_shipping", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4500", name: "Tailoring services", type: "revenue", subtype: "operating_revenue", systemKey: "revenue_tailoring", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4600", name: "Marketplace package revenue", type: "revenue", subtype: "operating_revenue", systemKey: "revenue_marketplace", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4700", name: "Gift card breakage", type: "revenue", subtype: "other_income", systemKey: "gift_card_breakage", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4800", name: "Other income", type: "revenue", subtype: "other_income", systemKey: "revenue_other", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4900", name: "Sales discounts", type: "revenue", subtype: "contra_revenue", systemKey: "sales_discounts", cashFlowCategory: "operating", parentCode: "4000" },
  { code: "4910", name: "Sales refunds", type: "revenue", subtype: "contra_revenue", systemKey: "sales_refunds", cashFlowCategory: "operating", parentCode: "4000" },

  h("5000", "Cost of sales", "expense", "cost_of_sales"),
  { code: "5100", name: "Cost of goods sold food and beverage", type: "expense", subtype: "cost_of_sales", cashFlowCategory: "operating", parentCode: "5000" },
  { code: "5200", name: "Cost of goods sold merchandise", type: "expense", subtype: "cost_of_sales", systemKey: "cogs_default", cashFlowCategory: "operating", parentCode: "5000" },
  { code: "5300", name: "Inventory wastage and shrinkage", type: "expense", subtype: "cost_of_sales", systemKey: "inventory_wastage", cashFlowCategory: "operating", parentCode: "5000" },

  h("6000", "Operating expenses", "expense", "operating_expense"),
  { code: "6100", name: "Rent", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6150", name: "Salaries and wages", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6200", name: "Transportation", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6250", name: "Fuel", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6300", name: "Electricity and utilities", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6350", name: "Marketing and advertising", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6400", name: "Internet and telephone", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6450", name: "Repairs and maintenance", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6500", name: "Payment processing fees", type: "expense", subtype: "operating_expense", systemKey: "payment_fees", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6550", name: "Platform fees", type: "expense", subtype: "operating_expense", systemKey: "platform_fees", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6600", name: "Bank charges", type: "expense", subtype: "operating_expense", systemKey: "bank_charges", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6650", name: "Office supplies", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6700", name: "Insurance", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6750", name: "Professional fees", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6800", name: "Depreciation", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6900", name: "Miscellaneous expenses", type: "expense", subtype: "operating_expense", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6950", name: "Bad debts", type: "expense", subtype: "operating_expense", systemKey: "bad_debt", cashFlowCategory: "operating", parentCode: "6000" },
  { code: "6960", name: "Chargebacks and disputes", type: "expense", subtype: "operating_expense", systemKey: "chargebacks", cashFlowCategory: "operating", parentCode: "6000" },

  h("7000", "Other income and expenses", "expense", "other_expense"),
  { code: "7100", name: "Cash over and short", type: "expense", subtype: "other_expense", systemKey: "cash_over_short", cashFlowCategory: "operating", parentCode: "7000" },
  { code: "7200", name: "Exchange gain or loss", type: "expense", subtype: "other_expense", systemKey: "fx_gain_loss", cashFlowCategory: "operating", parentCode: "7000" },
  { code: "7300", name: "Rounding", type: "expense", subtype: "other_expense", systemKey: "rounding", cashFlowCategory: "operating", parentCode: "7000" },
  { code: "9999", name: "Suspense", type: "asset", subtype: "suspense", systemKey: "suspense", cashFlowCategory: "operating", allowManualPosting: true },
];

/** Expense categories created on setup → template account code. */
export const DEFAULT_EXPENSE_CATEGORIES: ReadonlyArray<{ name: string; code: string }> = [
  { name: "Rent", code: "6100" },
  { name: "Salaries and wages", code: "6150" },
  { name: "Transportation", code: "6200" },
  { name: "Fuel", code: "6250" },
  { name: "Electricity and utilities", code: "6300" },
  { name: "Marketing and advertising", code: "6350" },
  { name: "Internet and telephone", code: "6400" },
  { name: "Repairs and maintenance", code: "6450" },
  { name: "Office supplies", code: "6650" },
  { name: "Insurance", code: "6700" },
  { name: "Professional fees", code: "6750" },
  { name: "Bank charges", code: "6600" },
  { name: "Miscellaneous", code: "6900" },
];

/** Normal balance side: debit for assets and expenses, credit otherwise (contra flips). */
export function normalBalance(
  type: LedgerAccountType,
  subtype: LedgerAccountSubtype
): "debit" | "credit" {
  if (subtype === "contra_asset") return "credit";
  if (subtype === "contra_revenue") return "debit";
  return type === "asset" || type === "expense" ? "debit" : "credit";
}
