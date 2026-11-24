-- TailorClient ↔ campaign participant bridge (Phase 7)
ALTER TABLE "tailor_clients"
ADD COLUMN IF NOT EXISTS "email" TEXT,
ADD COLUMN IF NOT EXISTS "userId" TEXT,
ADD COLUMN IF NOT EXISTS "campaignParticipantId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "tailor_clients_campaignParticipantId_key"
ON "tailor_clients"("campaignParticipantId");

CREATE INDEX IF NOT EXISTS "tailor_clients_tailorProfileId_email_idx"
ON "tailor_clients"("tailorProfileId", "email");

CREATE INDEX IF NOT EXISTS "tailor_clients_userId_idx"
ON "tailor_clients"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tailor_clients_campaignParticipantId_fkey'
  ) THEN
    ALTER TABLE "tailor_clients"
    ADD CONSTRAINT "tailor_clients_campaignParticipantId_fkey"
    FOREIGN KEY ("campaignParticipantId") REFERENCES "campaign_participants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
