-- Step 3 kiosk and on-site walk-in pass. Public emailed signing links do not insert rows.

CREATE TABLE "waiver_walkin_passes" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "guestProfileId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "waiver_walkin_passes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "waiver_walkin_passes_orgId_locationId_idx" ON "waiver_walkin_passes"("orgId", "locationId");
CREATE INDEX "waiver_walkin_passes_guestProfileId_idx" ON "waiver_walkin_passes"("guestProfileId");

ALTER TABLE "waiver_walkin_passes" ADD CONSTRAINT "waiver_walkin_passes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "waiver_walkin_passes" ADD CONSTRAINT "waiver_walkin_passes_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "waiver_walkin_passes" ADD CONSTRAINT "waiver_walkin_passes_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
