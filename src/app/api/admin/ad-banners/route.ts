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
import { createAdBanner, listAdminAdBanners } from "@/lib/adBanners";
import { assertStorefrontStaffOrg } from "@/lib/staffOrg";
import { stampCreate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/admin/ad-banners → settings:manage */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.SettingsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/ad-banners", {
          permission: P.SettingsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = await assertStorefrontStaffOrg(actor);
    const banners = await listAdminAdBanners(orgId);
    return ok({ banners });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/ad-banners", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.SettingsManage,
      })
    );
    if (authRes) return authRes;
    console.error("Error listing ad banners:", err);
    return serverError("Failed to list ad banners");
  }
}

/** POST /api/admin/ad-banners → settings:manage */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.SettingsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/admin/ad-banners", {
          permission: P.SettingsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const body = await req.json();
    if (!isPlainObject(body)) {
      return badRequest("Invalid body");
    }
    const orgId = await assertStorefrontStaffOrg(actor);
    const audit = await stampCreate(actor.sub);
    const banner = await createAdBanner(orgId, body, audit);
    logStaffActivityEntry(actor, {
      action: "Ad Banner Created",
      entityType: "AdBanner",
      entityId: banner._id,
      description: `Created ad banner "${banner.heading}"`,
      request: req,
    });
    return created({ banner, message: "Banner created" });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "POST /api/admin/ad-banners", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.SettingsManage,
      })
    );
    if (authRes) return authRes;
    const message =
      err instanceof Error ? err.message : "Failed to create banner";
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("must")
    ) {
      return badRequest(message);
    }
    console.error("Error creating ad banner:", err);
    return serverError("Failed to create banner");
  }
}
