import { NextRequest } from "next/server";
import {
  ok,
  created,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { isPlainObject } from "@/lib/catalogWrite";
import { stampCreate } from "@/lib/audit/recordAudit";
import {
  listMeasurementProfilesForUser,
  createMeasurementProfile,
} from "@/lib/measurements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/measurement-profiles — own profiles only */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.MeasurementsReadOwn);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/measurement-profiles")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    void req.nextUrl.searchParams.get("userId");
    const page = req.nextUrl.searchParams.get("page");
    const limit = req.nextUrl.searchParams.get("limit");
    const result = await listMeasurementProfilesForUser(actor.sub, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return ok(result);
  } catch (err) {
    console.error("List measurement profiles error:", err);
    return serverError("Failed to list measurement profiles");
  }
}

/** POST /api/measurement-profiles — create own profile */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.MeasurementsWriteOwn);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/measurement-profiles")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const body = await req.json().catch(() => null);
    if (!isPlainObject(body)) return badRequest("Invalid body");
    void body.user;
    void body.userId;

    const audit = await stampCreate(actor.sub);
    const profile = await createMeasurementProfile(actor.sub, body, audit);
    return created({ profile, message: "Measurement profile created" });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create profile";
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("Must") ||
      message.includes("Add at least") ||
      message.includes("too")
    ) {
      return badRequest(message);
    }
    console.error("Create measurement profile error:", err);
    return serverError("Failed to create measurement profile");
  }
}
