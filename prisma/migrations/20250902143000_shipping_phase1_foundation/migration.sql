-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('pending', 'booked', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ShippingProviderCode" AS ENUM ('shipbubble', 'fez', 'kwik', 'manual');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shippingFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "shippingMethod" JSONB,
ADD COLUMN     "shippingAddress" JSONB;

-- CreateTable
CREATE TABLE "shipping_settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "originAddress" JSONB NOT NULL,
    "defaultWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "defaultDimensions" JSONB NOT NULL DEFAULT '{"length":30,"width":25,"height":5}',
    "autoBookOnPaid" BOOLEAN NOT NULL DEFAULT true,
    "primaryProvider" "ShippingProviderCode" NOT NULL DEFAULT 'shipbubble',
    "enabledProviders" "ShippingProviderCode"[] DEFAULT ARRAY['shipbubble']::"ShippingProviderCode"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "ShippingProviderCode" NOT NULL,
    "providerShipmentId" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'pending',
    "courierName" TEXT,
    "serviceCode" TEXT,
    "rateToken" TEXT,
    "shippingFee" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "labelUrl" TEXT,
    "rawProviderPayload" JSONB,
    "lastWebhookEventId" TEXT,
    "failureReason" TEXT,
    "bookedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipping_settings_orgId_key" ON "shipping_settings"("orgId");

-- CreateIndex
CREATE INDEX "shipments_orgId_status_idx" ON "shipments"("orgId", "status");

-- CreateIndex
CREATE INDEX "shipments_orderId_idx" ON "shipments"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_orderId_provider_key" ON "shipments"("orderId", "provider");

-- AddForeignKey
ALTER TABLE "shipping_settings" ADD CONSTRAINT "shipping_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
