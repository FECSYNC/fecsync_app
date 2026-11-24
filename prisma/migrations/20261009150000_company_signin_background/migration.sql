-- Company staff sign-in page background image (additive, nullable).
ALTER TABLE "company_profiles" ADD COLUMN IF NOT EXISTS "signinBackgroundUrl" TEXT;
ALTER TABLE "company_profiles" ADD COLUMN IF NOT EXISTS "signinBackgroundPublicId" TEXT;
