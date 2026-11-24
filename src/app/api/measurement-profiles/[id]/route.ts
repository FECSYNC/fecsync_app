import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { isPlainObject } from "@/lib/catalogWrite";
import { stampUpdate } from "@/lib/audit/recordAudit";
import {
  getMeasurementProfileForUser,
  updateMeasurementProfile,
  deleteMeasurementProfile,
} from "@/lib/measurements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/measurement-profiles/[id] — owner only */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.MeasurementsReadOwn);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/measurement-profiles/[id]")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    void req.nextUrl.searchParams.get("userId");
    const { id } = await params;
    const profile = await getMeasurementProfileForUser(actor.sub, id);
    if (!profile) return notFound("Measurement profile not found");
    return ok({ profile });
  } catch (err) {
    console.error("Get measurement profile error:", err);
    return serverError("Failed to fetch measurement profile");
  }
}

/** PUT /api/measurement-profiles/[id] — owner only */
export async function PUT(
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
        authAudit(req, "PUT /api/measurement-profiles/[id]")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!isPlainObject(body)) return badRequest("Invalid body");
    void body.user;
    void body.userId;

    const audit = await stampUpdate(actor.sub);
    const profile = await updateMeasurementProfile(actor.sub, id, body, audit);
    if (!profile) return notFound("Measurement profile not found");
    return ok({ profile, message: "Measurement profile updated" });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update profile";
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("Must") ||
      message.includes("Add at least") ||
      message.includes("Add measurements") ||
      message.includes("too")
    ) {
      return badRequest(message);
    }
    console.error("Update measurement profile error:", err);
    return serverError("Failed to update measurement profile");
  }
}

/** DELETE /api/measurement-profiles/[id] — owner only */
export async function DELETE(
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
        authAudit(req, "DELETE /api/measurement-profiles/[id]")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    void req.nextUrl.searchParams;
    const { id } = await params;
    const deleted = await deleteMeasurementProfile(actor.sub, id);
    if (!deleted) return notFound("Measurement profile not found");
    return ok({ deleted: true, message: "Measurement profile deleted" });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete measurement profile";
    if (
      message.includes("linked to tailoring jobs") ||
      message.includes("measurement campaign")
    ) {
      return badRequest(message);
    }
    console.error("Delete measurement profile error:", err);
    return serverError("Failed to delete measurement profile");
  }
}
