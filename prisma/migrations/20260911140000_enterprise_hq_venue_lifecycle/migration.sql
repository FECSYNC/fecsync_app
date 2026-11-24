-- Enterprise HQ Step 1: venue archive timestamp + membership location scope preference.
-- No Ticketing/POS tables. Organization remains the sole tenant HQ.

ALTER TABLE "venue_locations" ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "memberships" ADD COLUMN "hqSelectedLocationId" TEXT;
