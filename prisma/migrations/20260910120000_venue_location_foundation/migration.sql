-- Multi-park / VenueLocation foundation (Step 1 control plane).
-- Zero locations auto-created on company register/approve — admin creates after entitled.

CREATE TYPE "VenueLocationStatus" AS ENUM ('active', 'archived');

CREATE TABLE "venue_locations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "VenueLocationStatus" NOT NULL DEFAULT 'active',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venue_locations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "venue_locations_orgId_idx" ON "venue_locations"("orgId");

CREATE INDEX "venue_locations_orgId_status_idx" ON "venue_locations"("orgId", "status");

CREATE UNIQUE INDEX "venue_locations_orgId_slug_key" ON "venue_locations"("orgId", "slug");

ALTER TABLE "venue_locations" ADD CONSTRAINT "venue_locations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
