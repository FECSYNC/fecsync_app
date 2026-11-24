import { NextRequest } from "next/server";
import {
  ok,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  listJobsForOrg,
  isTailoringJobStatus,
} from "@/lib/tailoringJobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/admin/tailoring-jobs — staff org-scoped list */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.TailoringJobsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/tailoring-jobs", {
          permission: P.TailoringJobsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    void req.nextUrl.searchParams.get("userId");
    void req.nextUrl.searchParams.get("orgId");
    const statusRaw = req.nextUrl.searchParams.get("status")?.trim() || "";
    const status =
      statusRaw && isTailoringJobStatus(statusRaw) ? statusRaw : undefined;
    const q = req.nextUrl.searchParams.get("q")?.trim() || undefined;
    const page = req.nextUrl.searchParams.get("page");
    const limit = req.nextUrl.searchParams.get("limit");
    const result = await listJobsForOrg(orgId, {
      status,
      q,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return ok(result);
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Admin list tailoring jobs error:", err);
    return serverError("Failed to list tailoring jobs");
  }
}
