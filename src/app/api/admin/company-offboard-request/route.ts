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
import { isPlainObject } from "@/lib/catalogWrite";
import { requestCompanyOffboard } from "@/lib/companyExport";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { apiRateLimited } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/company-offboard-request
 * Soft offboard request â€” audit + ops notice. No hard-delete.
 * Soft billing hold allowed (workspace lifecycle gate). Idempotent.
 */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFreshWorkspaceLifecycle(req, P.SettingsManage, { allowOnDemo: true });
    if (!isPlatformAdminActor(actor)) {
      throw new ForbiddenError(
        "Only company platform admins can request workspace offboard"
      );
    }
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/admin/company-offboard-request", {
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
      "company-workspace-offboard",
      8,
      15 * 60 * 1000,
      `${orgId}:${actor.sub}`
    );
    if (limited) return limited;

    const { resolveEffectiveParkScope } = await import("@/lib/parkAdminScope");
    const parkScope = await resolveEffectiveParkScope(actor);
    if (parkScope.parkLocked) {
      throw new ForbiddenError(
        "Park-locked admins cannot request company offboard"
      );
    }

    let reason: string | null = null;
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return badRequest("Invalid JSON");
      }
      if (!isPlainObject(body)) {
        return badRequest("Invalid body");
      }
      if ("orgId" in body || "organizationId" in body) {
        return badRequest("Unsupported offboard fields in request body");
      }
      if (typeof body.reason === "string") {
        reason = body.reason.trim().slice(0, 500) || null;
      }
    }

    const result = await requestCompanyOffboard({
      orgId,
      actorSub: actor.sub,
      reason,
    });

    if (result.created) {
      logStaffActivityEntry(actor, {
        action: "Company Offboard Requested",
        entityType: "Settings",
        entityId: orgId,
        description:
          "Company workspace offboard requested (soft â€” no hard-delete)",
        request: req,
        metadata: {
          domain: "company-offboard",
          reason,
          offboardRequestedAt: result.offboardRequestedAt,
        },
      });
    }

    // Always attempt notice â€” stamp may have succeeded on a prior attempt while
    // notice failed; notify is idempotent (recent notification watermark).
    try {
      const { notifyCompanyOffboardRequested } = await import(
        "@/lib/companySubscriptionNotices"
      );
      await notifyCompanyOffboardRequested(orgId, reason);
    } catch (err) {
      console.warn("[company-offboard] notice failed:", err);
    }

    return ok({ offboard: result });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return authErrorToResponse(err) ?? badRequest(err.message);
    }
    console.error("[company-offboard]", err);
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/admin/company-offboard-request", {
          actorSub: actor.sub,
          orgId: actor.orgId ?? null,
        })
      ) ?? serverError("Failed to request company offboard")
    );
  }
}
