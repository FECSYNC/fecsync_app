-- Partial POS refund ledger: remaining refundable = amount - amountRefunded
ALTER TABLE "pos_sale_payments"
  ADD COLUMN IF NOT EXISTS "amountRefunded" DECIMAL(12, 2) NOT NULL DEFAULT 0;
