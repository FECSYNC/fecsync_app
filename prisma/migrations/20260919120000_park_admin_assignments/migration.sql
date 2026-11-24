-- Park-admin epic: MembershipVenueAssignment + Product/Order.venueLocationId stamps.
-- Idempotent so environments that already applied schema via `db push` can still migrate.

CREATE TABLE IF NOT EXISTS "membership_venue_assignments" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "membership_venue_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "membership_venue_assignments_membershipId_locationId_key"
  ON "membership_venue_assignments"("membershipId", "locationId");

CREATE INDEX IF NOT EXISTS "membership_venue_assignments_orgId_locationId_idx"
  ON "membership_venue_assignments"("orgId", "locationId");

CREATE INDEX IF NOT EXISTS "membership_venue_assignments_membershipId_idx"
  ON "membership_venue_assignments"("membershipId");

CREATE INDEX IF NOT EXISTS "membership_venue_assignments_locationId_idx"
  ON "membership_venue_assignments"("locationId");

DO $$ BEGIN
  ALTER TABLE "membership_venue_assignments"
    ADD CONSTRAINT "membership_venue_assignments_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "memberships"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "membership_venue_assignments"
    ADD CONSTRAINT "membership_venue_assignments_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "membership_venue_assignments"
    ADD CONSTRAINT "membership_venue_assignments_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "venueLocationId" TEXT;
CREATE INDEX IF NOT EXISTS "products_orgId_venueLocationId_idx"
  ON "products"("orgId", "venueLocationId");

DO $$ BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_venueLocationId_fkey"
    FOREIGN KEY ("venueLocationId") REFERENCES "venue_locations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "venueLocationId" TEXT;
CREATE INDEX IF NOT EXISTS "orders_orgId_venueLocationId_idx"
  ON "orders"("orgId", "venueLocationId");

DO $$ BEGIN
  ALTER TABLE "orders"
    ADD CONSTRAINT "orders_venueLocationId_fkey"
    FOREIGN KEY ("venueLocationId") REFERENCES "venue_locations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
