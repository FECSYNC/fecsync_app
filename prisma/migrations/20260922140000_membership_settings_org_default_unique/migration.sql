-- Memberships data consistency:
-- 1) At most one org-default MembershipSettings row per org (locationId IS NULL).
--    Postgres UNIQUE (orgId, locationId) allows multiple NULLs — close that hole.
-- 2) Dedupe any accidental duplicate org-default rows (keep newest updatedAt).

DELETE FROM "membership_settings" AS a
USING "membership_settings" AS b
WHERE a."locationId" IS NULL
  AND b."locationId" IS NULL
  AND a."orgId" = b."orgId"
  AND a."id" <> b."id"
  AND (
    a."updatedAt" < b."updatedAt"
    OR (a."updatedAt" = b."updatedAt" AND a."id" < b."id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "membership_settings_org_default_uidx"
ON "membership_settings" ("orgId")
WHERE "locationId" IS NULL;
