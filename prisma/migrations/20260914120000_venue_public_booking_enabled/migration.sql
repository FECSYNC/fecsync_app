-- Phase 2: gate public booking APIs on published venues.
ALTER TABLE "venue_locations"
  ADD COLUMN IF NOT EXISTS "publicBookingEnabled" BOOLEAN NOT NULL DEFAULT false;
