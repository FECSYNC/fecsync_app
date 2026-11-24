/**
 * One staff gate for every party route and party lib call.
 *
 * Route order: requirePermissionFresh (or any-of) → requireActorOrgId →
 * assertPartiesEnabled (assertModuleEnabled runs assertOrganizationActive,
 * assertCompanyBillingEntitled — which fails closed on pending / suspended /
 * soft-hold / overdue — Demo deny, storefront deny, plan moduleHints) →
 * actor location scope. Libs call `partyStaffContext` again so a direct lib
 * caller cannot skip the org gates.
 */
import type { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import {
  requireAnyPermissionFresh,
  requirePermissionFresh,
} from "@/lib/middleware/requireAuth";
import {
  ROLE_PRESETS,
  expandHeldPermissions,
  isRolePresetId,
  type Permission,
} from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { locationScopeFilter, type TicketingActor } from "@/lib/ticketing/common";
import {
  authAudit,
  authErrorToResponse,
  bookingValidationResponse,
  serverError,
} from "@/lib/ticketing/bookingRoute";
import { routeErrorResponse } from "@/lib/response";
import { assertPartiesEnabled } from "@/lib/parties/assertPartiesEnabled";
import { partyErrorToResponse } from "@/lib/parties/errors";
import { rejectBodyOrgId, rejectQueryOrgId, type PartyScope } from "@/lib/parties/scope";

export type PartyActor = TicketingActor & {
  permissions?: readonly string[] | null;
  preset?: string | null;
  rolePreset?: string | null;
  membershipRole?: string | null;
};

export type PartyStaffContext = {
  orgId: string;
  actor: PartyActor;
  scope: PartyScope;
};

export async function partyStaffContext(actor: PartyActor): Promise<PartyStaffContext> {
  const orgId = requireActorOrgId(actor);
  await assertPartiesEnabled(orgId);
  const scope = await locationScopeFilter(actor);
  return { orgId, actor, scope };
}

/**
 * Permission check for in-lib decisions (overbook, deposit override, food cutoff).
 * JWT actors carry `permissions`; script / system actors fall back to their preset.
 */
export function actorCan(actor: PartyActor, permission: Permission): boolean {
  if (Array.isArray(actor.permissions)) {
    return expandHeldPermissions(actor.permissions).has(permission);
  }
  const preset = actor.preset ?? actor.rolePreset ?? actor.membershipRole ?? null;
  if (preset && isRolePresetId(preset)) {
    return expandHeldPermissions(ROLE_PRESETS[preset]).has(permission);
  }
  return false;
}

type RouteOpts = {
  route: string;
  /** All required (default) or any-of when `any` is true. */
  permission: Permission | readonly Permission[];
  any?: boolean;
};

/** Standard party staff route wrapper: auth → org gates → handler → stable errors. */
export async function withPartyStaffRoute(
  request: NextRequest,
  opts: RouteOpts,
  handler: (ctx: PartyStaffContext) => Promise<NextResponse>
): Promise<NextResponse> {
  let actor: PartyActor;
  try {
    actor = (opts.any
      ? await requireAnyPermissionFresh(request, opts.permission)
      : await requirePermissionFresh(request, opts.permission)) as PartyActor;
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, opts.route, {
          permission: Array.isArray(opts.permission)
            ? opts.permission.join("|")
            : (opts.permission as string),
        })
      ) ?? serverError("Failed to authorize")
    );
  }
  try {
    rejectQueryOrgId(request.nextUrl.searchParams);
    await connectDB();
    const ctx = await partyStaffContext(actor);
    return await handler(ctx);
  } catch (err) {
    return partyRouteCatch(err, request, opts.route, actor);
  }
}

export function partyRouteCatch(
  err: unknown,
  request: NextRequest,
  route: string,
  actor?: { sub?: string; orgId?: string | null } | null
): NextResponse {
  const party = partyErrorToResponse(err);
  if (party) return party;
  const validation = bookingValidationResponse(err);
  if (validation) return validation;
  return routeErrorResponse(
    err,
    "Request failed",
    authAudit(request, route, {
      actorSub: actor?.sub,
      orgId: actor?.orgId ?? null,
    })
  );
}

/** Parsed JSON object body; any client orgId / organizationId → 400. */
export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {};
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return rejectBodyOrgId(body);
}
