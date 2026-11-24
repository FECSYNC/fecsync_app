import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  forbidden,
  routeErrorResponse,
  authorizeGuardResponse,
  authAudit,
  authErrorToResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { withDbRetry } from "@/lib/db";
import { getCoordinatorGroupLinkForActor } from "@/lib/measurementCampaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function groupLinkErrorResponse(
  err: unknown,
  fallback: string,
  audit?: ReturnType<typeof authAudit>
) {
  const authRes = authErrorToResponse(err, audit);
  if (authRes) return authRes;
  const message = err instanceof Error ? err.message : "";
  if (
    message === "You cannot invite members for this campaign" ||
    message === "You are not a participant in this campaign" ||
    message === "Not a campaign coordinator"
  ) {
    return forbidden(message);
  }
  if (
    message.includes("Accept the campaign") ||
    message.includes("not accepting") ||
    message.includes("expired")
  ) {
    return badRequest(message);
  }
  return routeErrorResponse(err, fallback, audit);
}

/** GET — coordinator reusable group join link */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ participantId: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.MeasurementsReadOwn);
  } catch (err) {
    return authorizeGuardResponse(
      err,
      authAudit(req, "GET /api/campaigns/my/[participantId]/group-link")
    );
  }

  try {
    const { participantId } = await ctx.params;
    const result = await withDbRetry(() =>
      getCoordinatorGroupLinkForActor(actor.sub, participantId)
    );
    return ok(result);
  } catch (err) {
    return groupLinkErrorResponse(
      err,
      "Failed to load coordinator group link",
      authAudit(req, "GET /api/campaigns/my/[participantId]/group-link")
    );
  }
}
