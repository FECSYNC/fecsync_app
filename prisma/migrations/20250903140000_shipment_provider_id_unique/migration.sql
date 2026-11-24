-- Ensure webhook targeting cannot update the wrong order when courier ids collide.
-- PostgreSQL treats NULLs as distinct, so multiple pending rows without providerShipmentId remain allowed.
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_provider_providerShipmentId_key"
ON "shipments"("provider", "providerShipmentId");
