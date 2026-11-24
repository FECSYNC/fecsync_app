import type { Prisma, PrismaClient } from "@prisma/client";

export type Db = Prisma.TransactionClient | PrismaClient;

/** JWT-shaped staff actor (NormalizedAccessToken subset). */
export type AccountingActor = {
  sub?: string;
  orgId?: string | null;
  permissions?: Iterable<string> | null;
  preset?: string | null;
  membershipRole?: string | null;
  companyWideView?: boolean | null;
  storefrontOrgId?: string | null;
};

/**
 * Location visibility for ledger rows.
 * allLocations: company-wide view with no park filter (includes company-level rows).
 * locationIds: explicit park filter (company-level rows excluded).
 */
export type ScopeFilter = {
  allLocations: boolean;
  locationIds: string[];
  parkLocked: boolean;
};

export type AccountingCtx = {
  orgId: string;
  actorId: string | null;
  actor: AccountingActor | null;
  permissions: ReadonlySet<string>;
  scope: ScopeFilter;
  system: boolean;
};

export function systemCtx(orgId: string): AccountingCtx {
  return {
    orgId,
    actorId: null,
    actor: null,
    permissions: new Set<string>(),
    scope: { allLocations: true, locationIds: [], parkLocked: false },
    system: true,
  };
}

export function ctxHas(ctx: AccountingCtx, permission: string): boolean {
  return ctx.system || ctx.permissions.has(permission);
}

export type PartyRef =
  | { type: "guest"; id: string }
  | { type: "account"; id: string }
  | { type: "user"; id: string }
  | { type: "supplier"; id: string }
  | { type: "employee"; id: string };
