/**
 * Align campaign_participants with prisma/schema.prisma:
 * - inviteExpiresAt column
 * - measurementSnapshot column (frozen measurements for tailor read)
 * - unique (campaignId, userId) for join race safety
 * - coordinator hierarchy (role, shareToken, invitedByParticipantId, etc.)
 *
 * Usage: node scripts/sync-campaign-participant-schema.mjs
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
const prisma = new PrismaClient();

async function columnExists(name) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaign_participants'
      AND column_name = '${name}'
    LIMIT 1
  `);
  return Array.isArray(rows) && rows.length > 0;
}

async function indexExists(name) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'campaign_participants'
      AND indexname = '${name}'
    LIMIT 1
  `);
  return Array.isArray(rows) && rows.length > 0;
}

async function enumExists(name) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM pg_type WHERE typname = '${name}' LIMIT 1
  `);
  return Array.isArray(rows) && rows.length > 0;
}

async function syncCoordinatorHierarchy() {
  if (!(await enumExists("CampaignParticipantRole"))) {
    console.log("Creating CampaignParticipantRole enum …");
    await prisma.$executeRawUnsafe(`
      CREATE TYPE "CampaignParticipantRole" AS ENUM ('direct', 'coordinator', 'member')
    `);
  } else {
    console.log("CampaignParticipantRole enum already present");
  }

  if (!(await columnExists("role"))) {
    console.log("Adding coordinator hierarchy columns …");
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "campaign_participants"
      ADD COLUMN "canInviteMembers" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN "coordinatorGroupLabel" TEXT,
      ADD COLUMN "invitedByParticipantId" TEXT,
      ADD COLUMN "role" "CampaignParticipantRole" NOT NULL DEFAULT 'direct',
      ADD COLUMN "shareToken" TEXT
    `);
  } else {
    console.log("Coordinator hierarchy columns already present");
  }

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "campaign_participants_shareToken_key"
    ON "campaign_participants"("shareToken")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "campaign_participants_campaignId_role_idx"
    ON "campaign_participants"("campaignId", "role")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "campaign_participants_invitedByParticipantId_idx"
    ON "campaign_participants"("invitedByParticipantId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "campaign_participants_shareToken_idx"
    ON "campaign_participants"("shareToken")
  `);

  const fkRows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'campaign_participants_invitedByParticipantId_fkey'
    LIMIT 1
  `);
  if (!Array.isArray(fkRows) || fkRows.length === 0) {
    console.log("Adding invitedByParticipantId foreign key …");
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "campaign_participants"
      ADD CONSTRAINT "campaign_participants_invitedByParticipantId_fkey"
      FOREIGN KEY ("invitedByParticipantId")
      REFERENCES "campaign_participants"("id")
      ON DELETE SET NULL ON UPDATE CASCADE
    `);
  }

  await prisma.$executeRawUnsafe(`
    UPDATE "campaign_participants"
    SET "role" = 'direct', "canInviteMembers" = false
    WHERE "role" IS NULL
  `);
}

try {
  if (!(await columnExists("inviteExpiresAt"))) {
    console.log("Adding campaign_participants.inviteExpiresAt …");
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "campaign_participants"
      ADD COLUMN "inviteExpiresAt" TIMESTAMP(3)
    `);
    console.log("Added inviteExpiresAt");
  } else {
    console.log("inviteExpiresAt already present");
  }

  if (!(await columnExists("measurementSnapshot"))) {
    console.log("Adding campaign_participants.measurementSnapshot …");
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "campaign_participants"
      ADD COLUMN "measurementSnapshot" JSONB
    `);
    console.log("Added measurementSnapshot");
  } else {
    console.log("measurementSnapshot already present");
  }

  const dups = await prisma.$queryRawUnsafe(`
    SELECT "campaignId", "userId", COUNT(*)::int AS n
    FROM campaign_participants
    WHERE "userId" IS NOT NULL
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
  `);

  if (Array.isArray(dups) && dups.length > 0) {
    console.error(
      "Cannot add unique (campaignId, userId): duplicate rows exist:",
      JSON.stringify(dups)
    );
    process.exit(1);
  }

  const uniqueName = "campaign_participants_campaignId_userId_key";
  if (!(await indexExists(uniqueName))) {
    console.log(`Creating unique index ${uniqueName} …`);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "${uniqueName}"
      ON "campaign_participants" ("campaignId", "userId")
    `);
    console.log("Unique index created");
  } else {
    console.log("Unique (campaignId, userId) index already present");
  }

  await syncCoordinatorHierarchy();

  const tailorClientCol = await prisma.$queryRawUnsafe(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tailor_clients'
      AND column_name = 'campaignParticipantId'
    LIMIT 1
  `);
  if (!Array.isArray(tailorClientCol) || tailorClientCol.length === 0) {
    console.log("Adding TailorClient ↔ campaign participant bridge columns …");
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "tailor_clients"
      ADD COLUMN IF NOT EXISTS "email" TEXT,
      ADD COLUMN IF NOT EXISTS "userId" TEXT,
      ADD COLUMN IF NOT EXISTS "campaignParticipantId" TEXT
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "tailor_clients_campaignParticipantId_key"
      ON "tailor_clients"("campaignParticipantId")
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "tailor_clients_tailorProfileId_email_idx"
      ON "tailor_clients"("tailorProfileId", "email")
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "tailor_clients_userId_idx"
      ON "tailor_clients"("userId")
    `);
    const fkTc = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'tailor_clients_campaignParticipantId_fkey'
      LIMIT 1
    `);
    if (!Array.isArray(fkTc) || fkTc.length === 0) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "tailor_clients"
        ADD CONSTRAINT "tailor_clients_campaignParticipantId_fkey"
        FOREIGN KEY ("campaignParticipantId")
        REFERENCES "campaign_participants"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
      `);
    }
    console.log("TailorClient bridge columns added");
  } else {
    console.log("TailorClient bridge columns already present");
  }

  console.log("Campaign participant schema sync complete.");
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
