/**
 * Posting context shared by every posting rule (account + mapping caches,
 * suspense warnings). Rules always reload source rows; queue payloads are hints.
 */
import type { AccountingSettings, AccountingSystemKey, Prisma } from "@prisma/client";
import { getSystemAccount, type AccountCache } from "@/lib/accounting/accounts";
import {
  loadMappingIndex,
  resolveAccount,
  type MappingCandidate,
  type MappingIndex,
} from "@/lib/accounting/mappings";

export type PostingContext = {
  db: Prisma.TransactionClient;
  orgId: string;
  settings: AccountingSettings;
  accounts: AccountCache;
  mappings: MappingIndex;
  warnings: Set<string>;
};

export async function createPostingContext(
  db: Prisma.TransactionClient,
  settings: AccountingSettings
): Promise<PostingContext> {
  return {
    db,
    orgId: settings.orgId,
    settings,
    accounts: new Map(),
    mappings: await loadMappingIndex(db, settings.orgId),
    warnings: new Set(),
  };
}

export async function sysAccount(pc: PostingContext, key: AccountingSystemKey): Promise<string> {
  return (await getSystemAccount(pc.db, pc.orgId, key, pc.accounts)).id;
}

export async function mappedAccount(
  pc: PostingContext,
  candidates: MappingCandidate[],
  locationId: string | null,
  fallback: AccountingSystemKey
): Promise<string> {
  const r = await resolveAccount(pc.db, pc.orgId, {
    candidates,
    locationId,
    fallback,
    index: pc.mappings,
    cache: pc.accounts,
  });
  if (r.viaSuspense) pc.warnings.add("ACCT_MAPPING_MISSING");
  return r.accountId;
}

export function postingWarning(pc: PostingContext): string | null {
  return pc.warnings.size ? [...pc.warnings].join(",") : null;
}

/** Clearing account for a Stripe charge (park/org Connect account mapping first). */
export async function stripeClearingAccount(
  pc: PostingContext,
  connectedAccountId: string | null | undefined,
  locationId: string | null,
  extra: MappingCandidate[] = []
): Promise<string> {
  if (connectedAccountId) {
    const explicit =
      (locationId && pc.mappings.get(`stripe_account|${connectedAccountId}|${locationId}`)) ||
      pc.mappings.get(`stripe_account|${connectedAccountId}|`);
    if (explicit) return explicit;
    const bank = await pc.db.bankAccount.findFirst({
      where: { orgId: pc.orgId, stripeAccountId: connectedAccountId, archivedAt: null },
      select: { ledgerAccountId: true },
    });
    if (bank) return bank.ledgerAccountId;
  }
  return mappedAccount(pc, extra, locationId, "stripe_clearing");
}
