/**
 * Party smoke teardown. Org delete hits RESTRICT FKs (memberships, …): clear
 * the blocking rows scoped to the org via the constraint's catalog entry, retry.
 */
import type { PrismaClient } from "@prisma/client";

export async function teardownOrg(prisma: PrismaClient, orgId: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await prisma.organization.delete({ where: { id: orgId } });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const constraint = /constraint: `([^`]+)`/.exec(msg)?.[1];
      if (!constraint) throw err;
      const [fk] = await prisma.$queryRaw<{ tbl: string; col: string; ref: string }[]>`
        SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confrelid::regclass::text AS ref
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.conname = ${constraint}
        LIMIT 1`;
      if (!fk) throw err;
      const q = (s: string) => `"${s.replace(/^"|"$/g, "")}"`;
      if (fk.ref.replace(/"/g, "") === "organizations") {
        await prisma.$executeRawUnsafe(`DELETE FROM ${q(fk.tbl)} WHERE ${q(fk.col)} = $1`, orgId);
      } else {
        await prisma.$executeRawUnsafe(
          `DELETE FROM ${q(fk.tbl)} WHERE ${q(fk.col)} IN (SELECT "id" FROM ${q(fk.ref)} WHERE "orgId" = $1)`,
          orgId
        );
      }
    }
  }
  throw new Error(`teardown org ${orgId}: too many FK retries`);
}

export async function teardownSmokeData(prisma: PrismaClient, orgIds: string[], userIds: string[]) {
  for (const orgId of orgIds) {
    await teardownOrg(prisma, orgId).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`teardown org ${orgId}: ${msg.slice(-200)}`);
    });
  }
  await prisma.profile.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`teardown users: ${msg.slice(-200)}`);
  });
}
