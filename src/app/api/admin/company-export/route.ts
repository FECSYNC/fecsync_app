import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  serverError,
  authErrorToResponse,
  authAudit,
  badRequest,
} from "@/lib/response";
import { requirePermissionFreshWorkspaceLifecycle } from "@/lib/middleware/requireAuth";
import { P, isPlatformAdminActor } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { ForbiddenError } from "@/lib/auth/http-error";
import { buildCompanyWorkspaceExport } from "@/lib/companyExport";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { apiRateLimited } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/company-export
 * Platform admin + settings:manage â€” actor.orgId workspace JSON export (redacted).
 * Soft billing hold allowed (workspace lifecycle gate).
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFreshWorkspaceLifecycle(req, P.SettingsManage, { allowOnDemo: true });
    if (!isPlatformAdminActor(actor)) {
      throw new ForbiddenError(
        "Only company platform admins can export the workspace"
      );
    }
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/company-export", {
          permission: P.SettingsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const limited = apiRateLimited(
      req,
      "company-workspace-export",
      8,
      15 * 60 * 1000,
      `${orgId}:${actor.sub}`
    );
    if (limited) return limited;

    // Never honor client orgId — export is always the actor tenant.
    const url = new URL(req.url);
    if (url.searchParams.has("orgId") || url.searchParams.has("organizationId")) {
      return badRequest("Unsupported export fields in query");
    }

    const { resolveEffectiveParkScope } = await import("@/lib/parkAdminScope");
    const parkScope = await resolveEffectiveParkScope(actor);
    if (parkScope.parkLocked) {
      throw new ForbiddenError(
        "Park-locked admins cannot export the company workspace"
      );
    }

    const payload = await buildCompanyWorkspaceExport(orgId);
    logStaffActivityEntry(actor, {
      action: "Company Workspace Exported",
      entityType: "Settings",
      entityId: orgId,
      description: "Exported redacted company workspace package",
      request: req,
      metadata: { domain: "company-export" },
    });
    return ok({ export: payload });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return authErrorToResponse(err) ?? badRequest(err.message);
    }
    console.error("[company-export]", err);
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/company-export", {
          actorSub: actor.sub,
          orgId: actor.orgId ?? null,
        })
      ) ?? serverError("Failed to export company workspace")
    );
  }
}
