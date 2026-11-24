/**
 * The one staff gate for every accounting route (R8):
 * Fresh permission → actor org → module entitlement (active, billing,
 * Demo, storefront, moduleHints) → soft-hold create-deny on mutations →
 * initialized → location scope.
 *
 * assertModuleEnabled already fails closed on overdue soft-hold via
 * assertOrganizationActive + assertCompanyBillingEntitled. Mutations still
 * re-check create entitlement so the R8 order is explicit at this gate.
 */
import type { NextRequest } from "next/server";
import { requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { isPermission, type Permission } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { actorLocationScope } from "@/lib/actorLocationScope";
import {
  getCachedLocationScope,
  setCachedLocationScope,
} from "@/lib/ticketing/staffGateCache";
import type { ActorLocationScope } from "@/lib/actorLocationScope";
import { assertAccountingEnabled, assertAccountingInitialized } from "@/lib/accounting/assertAccountingEnabled";
import { assertCompanyBillingEntitled } from "@/lib/planLimits";
import { buildScope } from "@/lib/accounting/scope";
import type { AccountingActor, AccountingCtx } from "@/lib/accounting/types";

export type AccountingGateOptions = {
  mutation?: boolean;
  requireInitialized?: boolean;
};

export async function requireAccountingActor(
  req: NextRequest,
  permission: Permission | readonly Permission[],
  opts: AccountingGateOptions = {}
): Promise<AccountingCtx> {
  const needed = (typeof permission === "string" ? [permission] : permission) as readonly Permission[];
  const actor = await requireAnyPermissionFresh(req, needed);
  return ctxFromActor(actor, opts);
}

export async function ctxFromActor(
  actor: AccountingActor & { sub?: string; permissions?: Iterable<string> | null },
  opts: AccountingGateOptions = {}
): Promise<AccountingCtx> {
  const orgId = requireActorOrgId(actor as never);
  await assertAccountingEnabled(orgId);
  if (opts.mutation) {
    await assertCompanyBillingEntitled(orgId);
  }
  if (opts.requireInitialized !== false) await assertAccountingInitialized(orgId);
  const cacheKey = `scope:${orgId}:acct:${actor.sub ?? ""}`;
  let scope = getCachedLocationScope<ActorLocationScope>(cacheKey);
  if (!scope) {
    scope = await actorLocationScope(actor as never);
    setCachedLocationScope(cacheKey, scope);
  }
  const permissions = new Set<string>();
  for (const p of actor.permissions ?? []) if (isPermission(String(p))) permissions.add(String(p));
  return {
    orgId,
    actorId: actor.sub ? String(actor.sub) : null,
    actor,
    permissions,
    scope: buildScope(scope),
    system: false,
  };
}
