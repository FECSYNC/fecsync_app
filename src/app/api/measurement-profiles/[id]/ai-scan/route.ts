import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  notFound,
  routeErrorResponse,
  authorizeGuardResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { isPlainObject } from "@/lib/catalogWrite";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { withDbRetry } from "@/lib/db";
import { runMeasurementAiScanForUser } from "@/lib/measurementAiScan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/measurement-profiles/[id]/ai-scan — analyze photos and merge measurements */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.MeasurementsWriteOwn);
  } catch (err) {
    return authorizeGuardResponse(
      err,
      authAudit(req, "POST /api/measurement-profiles/[id]/ai-scan")
    );
  }

  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!isPlainObject(body)) return badRequest("Invalid body");
    void body.userId;
    void body.user;
    void body.participantId;
    void body.campaignId;

    const audit = await stampUpdate(actor.sub);
    const result = await withDbRetry(() =>
      runMeasurementAiScanForUser({
        userId: actor.sub,
        profileId: id,
        rawInput: body,
        audit,
      })
    );

    return ok({
      ...result,
      message: result.stub
        ? "Measurements estimated (preview scan)"
        : "Measurements analyzed from photos",
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to analyze photos";
    if (
      message.includes("not found") ||
      message.includes("Invalid measurement profile")
    ) {
      return notFound("Measurement profile not found");
    }
    if (
      message.includes("required") ||
      message.includes("Photo") ||
      message.includes("too large") ||
      message.includes("JPEG") ||
      message.includes("participant") ||
      message.includes("sponsored") ||
      message.includes("Join the campaign") ||
      message.includes("Campaign not found") ||
      message.includes("Could not extract") ||
      message.includes("no longer accepting") ||
      message.includes("not started yet") ||
      message.includes("has expired") ||
      message.includes("verified email") ||
      message.includes("already submitted") ||
      message.includes("out of sync") ||
      message.includes("used all sponsored")
    ) {
      return badRequest(message);
    }
    return routeErrorResponse(err, "Failed to analyze photos");
  }
}
