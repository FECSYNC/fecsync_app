/**
 * Accounting module gate (rides assertModuleEnabled; no fork).
 */
import { assertModuleEnabled } from "@/lib/moduleEntitlement";
import { requireId } from "@/lib/ids";
import prisma from "@/lib/prisma";
import { acctError, ACCT } from "@/lib/accounting/errors";

export async function assertAccountingEnabled(orgId: string): Promise<void> {
  await assertModuleEnabled(requireId(orgId, "orgId"), "accounting");
}

export async function assertAccountingInitialized(orgId: string): Promise<void> {
  const s = await prisma.accountingSettings.findUnique({
    where: { orgId: requireId(orgId, "orgId") },
    select: { enabled: true },
  });
  if (!s || !s.enabled) throw acctError(ACCT.NOT_INITIALIZED);
}
