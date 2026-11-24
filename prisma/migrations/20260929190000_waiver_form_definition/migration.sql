-- Step 1 form definition columns. Existing rows keep defaults; new nullable columns stay null.

ALTER TABLE "waiver_settings" ADD COLUMN "notifyEmail" TEXT;

ALTER TABLE "waiver_template_versions" ADD COLUMN "layoutId" TEXT NOT NULL DEFAULT 'classic',
ADD COLUMN "displayMode" TEXT NOT NULL DEFAULT 'single_page',
ADD COLUMN "allowDocumentExtract" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "allowTypedSignature" BOOLEAN,
ADD COLUMN "allowDrawnSignature" BOOLEAN;

ALTER TABLE "waiver_template_locales" ADD COLUMN "layoutId" TEXT NOT NULL DEFAULT 'classic',
ADD COLUMN "displayMode" TEXT NOT NULL DEFAULT 'single_page',
ADD COLUMN "allowDocumentExtract" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "waiver_records" ADD COLUMN "fillMethod" TEXT;

ALTER TABLE "waiver_signatures" ADD COLUMN "acceptedClauses" JSONB;
