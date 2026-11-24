import { NextRequest } from "next/server";
import {
  ok,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { setDefaultMeasurementProfile } from "@/lib/measurements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PATCH /api/measurement-profiles/[id]/default — set as default (owner only) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.MeasurementsWriteOwn);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PATCH /api/measurement-profiles/[id]/default")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    void req.nextUrl.searchParams;
    const { id } = await params;
    const audit = await stampUpdate(actor.sub);
    const profile = await setDefaultMeasurementProfile(actor.sub, id, audit);
    if (!profile) return notFound("Measurement profile not found");
    return ok({ profile, message: "Default measurement profile updated" });
  } catch (err) {
    console.error("Set default measurement profile error:", err);
    return serverError("Failed to set default measurement profile");
  }
}
