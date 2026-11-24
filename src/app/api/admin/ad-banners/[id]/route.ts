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
import {
  deleteAdBanner,
  getAdminAdBanner,
  updateAdBanner,
} from "@/lib/adBanners";
import { assertStorefrontStaffOrg } from "@/lib/staffOrg";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/admin/ad-banners/[id] → settings:manage */
export async function GET(req: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.SettingsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/ad-banners/[id]", {
          permission: P.SettingsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { id } = await context.params;
    const orgId = await assertStorefrontStaffOrg(actor);
    const banner = await getAdminAdBanner(orgId, id);
    if (!banner) return notFound("Banner not found");
    return ok({ banner });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/ad-banners/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.SettingsManage,
      })
    );
    if (authRes) return authRes;
    console.error("Error fetching ad banner:", err);
    return serverError("Failed to fetch banner");
  }
}

/** PUT /api/admin/ad-banners/[id] → settings:manage */
export async function PUT(req: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.SettingsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PUT /api/admin/ad-banners/[id]", {
          permission: P.SettingsManage,
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
    const orgId = await assertStorefrontStaffOrg(actor);
    const audit = await stampUpdate(actor.sub);
    const banner = await updateAdBanner(orgId, id, body, audit);
    if (!banner) return notFound("Banner not found");
    logStaffActivityEntry(actor, {
      action: "Ad Banner Updated",
      entityType: "AdBanner",
      entityId: banner._id,
      description: `Updated ad banner "${banner.heading}"`,
      request: req,
    });
    return ok({ banner, message: "Banner updated" });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "PUT /api/admin/ad-banners/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.SettingsManage,
      })
    );
    if (authRes) return authRes;
    const message =
      err instanceof Error ? err.message : "Failed to update banner";
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("must")
    ) {
      return badRequest(message);
    }
    console.error("Error updating ad banner:", err);
    return serverError("Failed to update banner");
  }
}

/** DELETE /api/admin/ad-banners/[id] → settings:manage */
export async function DELETE(req: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.SettingsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "DELETE /api/admin/ad-banners/[id]", {
          permission: P.SettingsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { id } = await context.params;
    const orgId = await assertStorefrontStaffOrg(actor);
    const deleted = await deleteAdBanner(orgId, id);
    if (!deleted) return notFound("Banner not found");
    logStaffActivityEntry(actor, {
      action: "Ad Banner Deleted",
      entityType: "AdBanner",
      entityId: id,
      description: "Deleted ad banner",
      request: req,
    });
    return ok({ message: "Banner deleted" });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "DELETE /api/admin/ad-banners/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.SettingsManage,
      })
    );
    if (authRes) return authRes;
    console.error("Error deleting ad banner:", err);
    return serverError("Failed to delete banner");
  }
}
