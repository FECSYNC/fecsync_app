/**
 * Remove fixtures left by interrupted party smokes (orgs `party-<tag>-<13-digit stamp>`,
 * users `smokeparty…@test.local`). Dry run by default.
 *   npx tsx scripts/purge-party-smoke-fixtures.mts          # list
 *   npx tsx scripts/purge-party-smoke-fixtures.mts --apply  # delete
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";
import { teardownSmokeData } from "./party-smoke-teardown.mts";

process.env.POS_SMOKE = "1";
loadDatabaseUrl();
const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

try {
  const orgs = await prisma.$queryRaw<{ id: string; slug: string }[]>`
    SELECT id, slug FROM organizations
    WHERE "isDefault" = false AND slug ~ '^party-[a-z0-9]+-[0-9]{13}$' AND name LIKE 'Party %'`;
  const users = await prisma.$queryRaw<{ id: string; email: string }[]>`
    SELECT id, email FROM users
    WHERE username ~ '^smokeparty2?[a-z0-9]*[0-9]{13}$' AND email LIKE 'smoke-party%@test.local'`;
  console.log(`${orgs.length} smoke org(s), ${users.length} smoke user(s)`);
  for (const o of orgs) console.log(` - ${o.slug}`);
  if (apply) {
    await teardownSmokeData(prisma, orgs.map((o) => o.id), users.map((u) => u.id));
    console.log("deleted");
  }
} finally {
  await prisma.$disconnect();
}
