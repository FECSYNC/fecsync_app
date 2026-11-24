import { NextRequest } from "next/server";
import {
  ok,
  routeErrorResponse,
  authorizeGuardResponse,
  authAudit,
} from "@/lib/response";
import {
  requirePermissionFresh,
} from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { withDbRetry } from "@/lib/db";
import {
  listMyCampaignParticipations,
  CAMPAIGN_EMAIL_VERIFICATION_REQUIRED,
} from "@/lib/measurementCampaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/campaigns/my — campaigns the customer participates in */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.MeasurementsReadOwn);
  } catch (err) {
    return authorizeGuardResponse(
      err,
      authAudit(req, "GET /api/campaigns/my")
    );
  }

  try {
    const participations = await withDbRetry(() =>
      listMyCampaignParticipations(actor.sub)
    );
    return ok({ participations });
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === CAMPAIGN_EMAIL_VERIFICATION_REQUIRED
    ) {
      return ok({ participations: [], emailVerificationRequired: true });
    }
    return routeErrorResponse(err, "Failed to load campaigns");
  }
}
