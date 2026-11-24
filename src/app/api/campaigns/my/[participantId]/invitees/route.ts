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
import { isPlainObject } from "@/lib/catalogWrite";
import { withDbRetry } from "@/lib/db";
import {
  inviteMembersAsCoordinator,
  listCoordinatorInvitees,
  setCoordinatorGroupLabel,
} from "@/lib/measurementCampaigns";
import { coordinatorInvitePostSchema } from "@/lib/measurementCampaigns.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function coordinatorApiErrorResponse(
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
    message.includes("Invalid") ||
    message.includes("Duplicate") ||
    message.includes("Already invited") ||
    message.includes("coordinator") ||
    message.includes("Group label") ||
    message.includes("expired") ||
    message.includes("not accepting") ||
    message.includes("Accept the campaign")
  ) {
    return badRequest(message);
  }
  return routeErrorResponse(err, fallback, audit);
}

/** GET — coordinator invitees, group link, and stats */
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
      authAudit(req, "GET /api/campaigns/my/[participantId]/invitees")
    );
  }

  try {
    const { participantId } = await ctx.params;
    const result = await withDbRetry(() =>
      listCoordinatorInvitees(actor.sub, participantId)
    );
    return ok(result);
  } catch (err) {
    return coordinatorApiErrorResponse(
      err,
      "Failed to load coordinator invitees",
      authAudit(req, "GET /api/campaigns/my/[participantId]/invitees")
    );
  }
}

/** POST — invite members or set group label */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ participantId: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.MeasurementsWriteOwn);
  } catch (err) {
    return authorizeGuardResponse(
      err,
      authAudit(req, "POST /api/campaigns/my/[participantId]/invitees")
    );
  }

  try {
    const { participantId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    if (!isPlainObject(body)) return badRequest("Invalid body");

    const parsed = coordinatorInvitePostSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(
        parsed.error.issues[0]?.message ?? "Invalid invite payload"
      );
    }

    if (parsed.data.action === "set-group-label") {
      const label = parsed.data.coordinatorGroupLabel;
      const updated = await withDbRetry(() =>
        setCoordinatorGroupLabel(actor.sub, participantId, label)
      );
      const listed = await withDbRetry(() =>
        listCoordinatorInvitees(actor.sub, participantId)
      );
      return ok({
        invited: 0,
        invitees: listed.invitees,
        coordinatorGroupLabel: label,
        campaignId: updated.campaignId,
      });
    }

    const result = await withDbRetry(() =>
      inviteMembersAsCoordinator(actor.sub, participantId, parsed.data)
    );
    const listed = await withDbRetry(() =>
      listCoordinatorInvitees(actor.sub, participantId)
    );
    return ok({
      invited: result.invited,
      invitees: listed.invitees,
      stats: listed.stats,
      groupJoinPath: listed.groupJoinPath,
      shareToken: listed.shareToken,
      campaignId: result.campaignId,
    });
  } catch (err) {
    return coordinatorApiErrorResponse(
      err,
      "Failed to invite coordinator members",
      authAudit(req, "POST /api/campaigns/my/[participantId]/invitees")
    );
  }
}
