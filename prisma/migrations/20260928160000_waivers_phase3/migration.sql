-- Phase 3: historical import key and reminder watermarks.

ALTER TABLE "waiver_records" ADD COLUMN "externalRef" TEXT;

CREATE UNIQUE INDEX "waiver_records_orgId_externalRef_key"
ON "waiver_records"("orgId", "externalRef");

CREATE TABLE "waiver_reminder_watermarks" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "remindedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waiver_reminder_watermarks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "waiver_reminder_watermarks_recordId_windowDays_key"
ON "waiver_reminder_watermarks"("recordId", "windowDays");

CREATE INDEX "waiver_reminder_watermarks_orgId_idx"
ON "waiver_reminder_watermarks"("orgId");

ALTER TABLE "waiver_reminder_watermarks"
ADD CONSTRAINT "waiver_reminder_watermarks_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "waiver_reminder_watermarks"
ADD CONSTRAINT "waiver_reminder_watermarks_recordId_fkey"
FOREIGN KEY ("recordId") REFERENCES "waiver_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
