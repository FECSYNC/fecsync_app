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
import { updateMeasurementProfileCategory } from "@/lib/measurements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PATCH /api/measurement-profiles/[id]/category — merge one category (owner only) */
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
        authAudit(req, "PATCH /api/measurement-profiles/[id]/category")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!isPlainObject(body)) return badRequest("Invalid body");
    void body.userId;
    void body.user;

    const audit = await stampUpdate(actor.sub);
    const profile = await updateMeasurementProfileCategory(
      actor.sub,
      id,
      body,
      audit
    );
    if (!profile) return notFound("Measurement profile not found");
    return ok({ profile, message: "Category measurements updated" });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update category";
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("Must") ||
      message.includes("Add at least") ||
      message.includes("Add measurements") ||
      message.includes("Profile must include") ||
      message.includes("not valid") ||
      message.includes("too")
    ) {
      return badRequest(message);
    }
    console.error("Patch measurement category error:", err);
    return serverError("Failed to update category measurements");
  }
}
