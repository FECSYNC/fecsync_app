import { NextRequest } from "next/server";
import {
  ok,
  created,
  badRequest,
  conflict,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { isPlainObject } from "@/lib/catalogWrite";
import { requireActorOrgId } from "@/lib/staffOrg";
import { stampCreate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { withDbRetry } from "@/lib/db";
import {
  createAdminTailor,
  isTailorStatus,
  listAdminTailors,
  type TailorStatus,
} from "@/lib/tailors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/admin/tailors → tailors:read */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.TailorsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/tailors", {
          permission: P.TailorsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    const q = req.nextUrl.searchParams.get("q") ?? undefined;
    const statusRaw = req.nextUrl.searchParams.get("status");
    const status =
      statusRaw && isTailorStatus(statusRaw)
        ? (statusRaw as TailorStatus)
        : undefined;
    const page = req.nextUrl.searchParams.get("page");
    const limit = req.nextUrl.searchParams.get("limit");
    const result = await withDbRetry(() =>
      listAdminTailors(orgId, {
        q,
        status,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      })
    );
    return ok(result);
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/tailors", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TailorsRead,
      })
    );
    if (authRes) return authRes;
    console.error("Error listing tailors:", err);
    return serverError("Failed to list tailors");
  }
}

/** POST /api/admin/tailors → tailors:manage */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.TailorsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/admin/tailors", {
          permission: P.TailorsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const body = await req.json();
    if (!isPlainObject(body)) {
      return badRequest("Invalid body");
    }
    void body.orgId;
    void body.createdBy;
    void body.updatedBy;
    const orgId = requireActorOrgId(actor);
    // Plan limits for members/tailorSeats are enforced inside ensureTailorMembership
    // (createAdminTailor → promote+forceActive), so we do not blindly +1 both here.
    const audit = await stampCreate(actor.sub);
    const tailor = await withDbRetry(() =>
      createAdminTailor(orgId, body, audit)
    );
    logStaffActivityEntry(actor, {
      action: "Tailor Profile Created",
      entityType: "TailorProfile",
      entityId: tailor._id,
      description: `Created tailor "${tailor.displayName}" (${tailor.slug})`,
      request: req,
    });
    return created({ tailor, message: "Tailor created" });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "POST /api/admin/tailors", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TailorsManage,
      })
    );
    if (authRes) return authRes;
    const message =
      err instanceof Error ? err.message : "Failed to create tailor";
    if (message.includes("already has a tailor")) {
      return conflict(message);
    }
    if (
      message.includes("live membership") ||
      message.includes("Membership validation") ||
      message.includes("Plan limit reached") ||
      message.includes("Subscribe to a plan before using this feature")
    ) {
      return badRequest(message);
    }
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("not found") ||
      message.includes("unique") ||
      message.includes("must")
    ) {
      return badRequest(message);
    }
    console.error("Error creating tailor:", err);
    return serverError("Failed to create tailor");
  }
}
