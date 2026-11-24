import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  notFound,
  conflict,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { isPlainObject } from "@/lib/catalogWrite";
import { requireActorOrgId } from "@/lib/staffOrg";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  getAdminTailor,
  isTailorStatus,
  patchAdminTailorStatus,
  updateAdminTailor,
} from "@/lib/tailors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/admin/tailors/[id] → tailors:read */
export async function GET(req: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.TailorsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/tailors/[id]", {
          permission: P.TailorsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { id } = await context.params;
    const orgId = requireActorOrgId(actor);
    const tailor = await getAdminTailor(orgId, id);
    if (!tailor) return notFound("Tailor not found");
    return ok({ tailor });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/tailors/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TailorsRead,
      })
    );
    if (authRes) return authRes;
    console.error("Error fetching tailor:", err);
    return serverError("Failed to fetch tailor");
  }
}

/** PUT /api/admin/tailors/[id] → tailors:manage */
export async function PUT(req: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.TailorsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PUT /api/admin/tailors/[id]", {
          permission: P.TailorsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { id } = await context.params;
    const body = await req.json();
    if (!isPlainObject(body)) {
      return badRequest("Invalid body");
    }
    void body.orgId;
    void body.userId;
    void body.createdBy;
    void body.updatedBy;
    const orgId = requireActorOrgId(actor);
    const audit = await stampUpdate(actor.sub);
    const tailor = await updateAdminTailor(orgId, id, body, audit);
    if (!tailor) return notFound("Tailor not found");
    logStaffActivityEntry(actor, {
      action: "Tailor Profile Updated",
      entityType: "TailorProfile",
      entityId: tailor._id,
      description: `Updated tailor "${tailor.displayName}"`,
      request: req,
    });
    return ok({ tailor, message: "Tailor updated" });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "PUT /api/admin/tailors/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TailorsManage,
      })
    );
    if (authRes) return authRes;
    const message =
      err instanceof Error ? err.message : "Failed to update tailor";
    if (message.includes("unique") || message.includes("Slug")) {
      return conflict(message);
    }
    if (
      message.includes("live membership") ||
      message.includes("Plan limit reached") ||
      message.includes("Subscribe to a plan before using this feature") ||
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("Cannot") ||
      message.includes("must")
    ) {
      return badRequest(message);
    }
    console.error("Error updating tailor:", err);
    return serverError("Failed to update tailor");
  }
}

/** PATCH /api/admin/tailors/[id] → tailors:manage (status) */
export async function PATCH(req: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.TailorsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PATCH /api/admin/tailors/[id]", {
          permission: P.TailorsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { id } = await context.params;
    const body = await req.json();
    if (!isPlainObject(body)) {
      return badRequest("Invalid body");
    }
    const status =
      typeof body.status === "string" ? body.status.trim() : "";
    if (!isTailorStatus(status)) {
      return badRequest(
        "status must be draft, pending, approved, or suspended"
      );
    }
    const orgId = requireActorOrgId(actor);
    const audit = await stampUpdate(actor.sub);
    const tailor = await patchAdminTailorStatus(orgId, id, status, audit);
    if (!tailor) return notFound("Tailor not found");
    logStaffActivityEntry(actor, {
      action: "Tailor Status Changed",
      entityType: "TailorProfile",
      entityId: tailor._id,
      description: `Set tailor "${tailor.displayName}" to ${status}`,
      request: req,
    });
    return ok({ tailor, message: `Tailor ${status}` });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "PATCH /api/admin/tailors/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TailorsManage,
      })
    );
    if (authRes) return authRes;
    const message =
      err instanceof Error ? err.message : "Failed to update tailor status";
    if (
      message.includes("live membership") ||
      message.includes("Plan limit reached") ||
      message.includes("Subscribe to a plan before using this feature") ||
      message.includes("Invalid")
    ) {
      return badRequest(message);
    }
    console.error("Error patching tailor status:", err);
    return serverError("Failed to update tailor status");
  }
}
