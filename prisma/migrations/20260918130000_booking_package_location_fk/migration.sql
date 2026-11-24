-- Optional VenueLocation FK for BookingPackage.locationId (SetNull on venue delete).

ALTER TABLE "booking_packages" ADD CONSTRAINT "booking_packages_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
