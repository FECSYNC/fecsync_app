import { NextRequest } from "next/server";
import {
  ok,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { resolveEffectiveParkScope } from "@/lib/parkAdminScope";
import { isFranchiseParkManager } from "@/lib/franchisePark";
import { listParkMarketplaceAccountsForOrg } from "@/lib/marketplace/parkAccount";
import { resolveIsPlatformSoftwareOwner } from "@/lib/resolvePlatformSoftwareOwner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/marketplace/park-accounts
 * Company-wide: all franchise park Connect rows.
 * Franchise managers: assigned parks only.
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.PayoutsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/marketplace/park-accounts", {
          permission: P.PayoutsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    const scope = await resolveEffectiveParkScope(actor);
    const owner = await resolveIsPlatformSoftwareOwner(actor);
    let filter: string[] | null = null;
    if (!owner && scope.parkLocked) {
      if (!isFranchiseParkManager(scope)) {
        return (
          authErrorToResponse(
            new (await import("@/lib/auth/http-error")).ForbiddenError(
              "Park-locked seats cannot list park payouts"
            ),
            authAudit(req, "GET /api/admin/marketplace/park-accounts", {
              permission: P.PayoutsRead,
            })
          ) ?? serverError("Failed to authorize")
        );
      }
      filter = scope.assignedLocationIds;
    }
    const parks = await listParkMarketplaceAccountsForOrg(orgId, filter);
    return ok({ parks, orgId });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/marketplace/park-accounts", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.PayoutsRead,
      })
    );
    if (authRes) return authRes;
    console.error("park-accounts list error:", err);
    return serverError("Failed to list park payout accounts");
  }
}
