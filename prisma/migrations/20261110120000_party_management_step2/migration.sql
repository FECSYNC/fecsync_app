-- Party Management Step 2: support outstanding-balance queries (amountDue > 0).
CREATE INDEX IF NOT EXISTS "bookings_orgId_locationId_amountDue_idx" ON "bookings"("orgId", "locationId", "amountDue");
