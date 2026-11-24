-- CreateTable
CREATE TABLE "membership_categories" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_categories_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "membership_plans" ADD COLUMN "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "membership_categories_orgId_archivedAt_idx" ON "membership_categories"("orgId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "membership_categories_orgId_name_key" ON "membership_categories"("orgId", "name");

-- CreateIndex
CREATE INDEX "membership_plans_orgId_categoryId_idx" ON "membership_plans"("orgId", "categoryId");

-- AddForeignKey
ALTER TABLE "membership_categories" ADD CONSTRAINT "membership_categories_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "membership_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
