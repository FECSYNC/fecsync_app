-- Tenant Company Profile (1:1 Organization) for document/email branding.
-- Bank account numbers are stored encrypted in bankAccountCiphertext; clients only see last4.

CREATE TABLE IF NOT EXISTS "company_profiles" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "legalName" TEXT,
    "tradingName" TEXT,
    "logoUrl" TEXT,
    "logoPublicId" TEXT,
    "supportEmail" TEXT,
    "billingEmail" TEXT,
    "replyToEmail" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "taxId" TEXT,
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "bankAccountLast4" TEXT,
    "bankAccountCiphertext" TEXT,
    "bankRoutingOrIban" TEXT,
    "bankCurrency" TEXT,
    "invoiceFooterNote" TEXT,
    "receiptFooterNote" TEXT,
    "letterheadColor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_profiles_orgId_key" ON "company_profiles"("orgId");

ALTER TABLE "company_profiles"
  DROP CONSTRAINT IF EXISTS "company_profiles_orgId_fkey";

ALTER TABLE "company_profiles"
  ADD CONSTRAINT "company_profiles_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
