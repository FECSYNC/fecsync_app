-- Partial refund ledger: remaining refundable = amount - amountRefunded
ALTER TABLE "booking_payments"
  ADD COLUMN IF NOT EXISTS "amountRefunded" DECIMAL(12, 2) NOT NULL DEFAULT 0;
