-- Phase 2: per-person group id, signature audit locale, standing signage token.

ALTER TABLE "waiver_records" ADD COLUMN "waiverGroupId" TEXT;

CREATE INDEX "waiver_records_waiverGroupId_idx" ON "waiver_records"("waiverGroupId");

ALTER TABLE "waiver_signatures" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "waiver_signatures" ADD COLUMN "templateVersionId" TEXT;

ALTER TABLE "waiver_signatures"
ADD CONSTRAINT "waiver_signatures_templateVersionId_fkey"
FOREIGN KEY ("templateVersionId") REFERENCES "waiver_template_versions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "waiver_requests" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "waiver_requests" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "waiver_requests" ADD COLUMN "waiverGroupId" TEXT;

CREATE TABLE "waiver_signage_tokens" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'signage',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiver_signage_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "waiver_signage_tokens_tokenHash_key" ON "waiver_signage_tokens"("tokenHash");
CREATE UNIQUE INDEX "waiver_signage_tokens_orgId_locationId_templateId_key" ON "waiver_signage_tokens"("orgId", "locationId", "templateId");
CREATE INDEX "waiver_signage_tokens_orgId_locationId_idx" ON "waiver_signage_tokens"("orgId", "locationId");

ALTER TABLE "waiver_signage_tokens"
ADD CONSTRAINT "waiver_signage_tokens_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "waiver_signage_tokens"
ADD CONSTRAINT "waiver_signage_tokens_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "waiver_signage_tokens"
ADD CONSTRAINT "waiver_signage_tokens_templateId_fkey"
FOREIGN KEY ("templateId") REFERENCES "waiver_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
