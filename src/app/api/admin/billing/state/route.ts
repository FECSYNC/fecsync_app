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
import { assertOrganizationActive } from "@/lib/org";
import {
  assertRegisteredCompanyBillingOrg,
  getCompanyBillingState,
} from "@/lib/companyBilling";
import { assertNotParkLockedCompanyHq } from "@/lib/assertNotParkLockedCompanyHq";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/billing/state
 * Thin billing state for dashboard widgets.
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.BillingRead, { allowOnDemo: true });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/billing/state", {
          permission: P.BillingRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    await assertNotParkLockedCompanyHq(actor);
    await assertRegisteredCompanyBillingOrg(orgId);
    await assertOrganizationActive(orgId);
    const billing = await getCompanyBillingState(orgId);
    return ok({ billing });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/billing/state", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BillingRead,
      })
    );
    if (authRes) return authRes;
    console.error("billing state error:", err);
    return serverError("Failed to load billing state");
  }
}
