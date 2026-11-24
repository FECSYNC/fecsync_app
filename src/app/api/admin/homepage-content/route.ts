import { NextRequest } from "next/server";
import {
  ok,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { ensureHomepageSections } from "@/lib/homepageContent";
import { assertStorefrontStaffOrg } from "@/lib/staffOrg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/homepage-content → settings:manage on storefront org only.
 * Lists all homepage marketing sections (including unpublished).
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.SettingsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/homepage-content", {
          permission: P.SettingsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = await assertStorefrontStaffOrg(actor);
    const sections = await ensureHomepageSections(orgId);
    return ok({ sections });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/homepage-content", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.SettingsManage,
      })
    );
    if (authRes) return authRes;
    console.error("Error fetching admin homepage content:", err);
    return serverError("Failed to fetch homepage content");
  }
}
