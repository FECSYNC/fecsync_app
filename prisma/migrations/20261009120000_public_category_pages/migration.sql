-- Public category pages, embed origins, and company-profile visibility switches.
-- Bank, tax, and billing email stay private (no public columns).

CREATE TYPE "PublicCategoryKind" AS ENUM ('booking', 'menu', 'membership');

CREATE TYPE "PublicCategoryLayout" AS ENUM ('auto', 'grid', 'stack');

CREATE TABLE "public_category_pages" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "PublicCategoryKind" NOT NULL,
    "bookingCategoryId" TEXT,
    "membershipCategoryId" TEXT,
    "productCategoryId" TEXT,
    "slug" TEXT NOT NULL,
    "layout" "PublicCategoryLayout" NOT NULL DEFAULT 'auto',
    "embedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_category_pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_category_pages_bookingCategoryId_key" ON "public_category_pages"("bookingCategoryId");

CREATE UNIQUE INDEX "public_category_pages_membershipCategoryId_key" ON "public_category_pages"("membershipCategoryId");

CREATE UNIQUE INDEX "public_category_pages_productCategoryId_key" ON "public_category_pages"("productCategoryId");

CREATE INDEX "public_category_pages_orgId_idx" ON "public_category_pages"("orgId");

CREATE UNIQUE INDEX "public_category_pages_orgId_slug_key" ON "public_category_pages"("orgId", "slug");

ALTER TABLE "public_category_pages"
ADD CONSTRAINT "public_category_pages_one_category_chk"
CHECK (
  (
    "kind" = 'booking'
    AND "bookingCategoryId" IS NOT NULL
    AND "membershipCategoryId" IS NULL
    AND "productCategoryId" IS NULL
  )
  OR (
    "kind" = 'membership'
    AND "membershipCategoryId" IS NOT NULL
    AND "bookingCategoryId" IS NULL
    AND "productCategoryId" IS NULL
  )
  OR (
    "kind" = 'menu'
    AND "productCategoryId" IS NOT NULL
    AND "bookingCategoryId" IS NULL
    AND "membershipCategoryId" IS NULL
  )
);

ALTER TABLE "public_category_pages" ADD CONSTRAINT "public_category_pages_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public_category_pages" ADD CONSTRAINT "public_category_pages_bookingCategoryId_fkey" FOREIGN KEY ("bookingCategoryId") REFERENCES "booking_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public_category_pages" ADD CONSTRAINT "public_category_pages_membershipCategoryId_fkey" FOREIGN KEY ("membershipCategoryId") REFERENCES "membership_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public_category_pages" ADD CONSTRAINT "public_category_pages_productCategoryId_fkey" FOREIGN KEY ("productCategoryId") REFERENCES "product_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "company_embed_origins" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_embed_origins_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_embed_origins_orgId_idx" ON "company_embed_origins"("orgId");

CREATE UNIQUE INDEX "company_embed_origins_orgId_origin_key" ON "company_embed_origins"("orgId", "origin");

ALTER TABLE "company_embed_origins" ADD CONSTRAINT "company_embed_origins_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_profiles" ADD COLUMN "publicLogo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "company_profiles" ADD COLUMN "publicPhone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "company_profiles" ADD COLUMN "publicSupportEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "company_profiles" ADD COLUMN "publicWebsite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "company_profiles" ADD COLUMN "publicAddress" BOOLEAN NOT NULL DEFAULT false;
