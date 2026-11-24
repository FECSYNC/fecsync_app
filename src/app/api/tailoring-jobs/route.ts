import { NextRequest } from "next/server";
import {
  ok,
  created,
  badRequest,
  forbidden,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAuthActiveAccount, requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { isPlainObject } from "@/lib/catalogWrite";
import { stampCreate } from "@/lib/audit/recordAudit";
import { P } from "@/lib/auth/permissions";
import {
  listJobsForCustomer,
  listJobsForTailorProfile,
  createSubmittedJob,
  getTailorProfileIdForUser,
  isTailoringJobStatus,
} from "@/lib/tailoringJobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/tailoring-jobs
 * - default / ?scope=customer → jobs where customer === sub
 * - ?scope=tailor → jobs for actor's TailorProfile
 * Staff should use /api/admin/tailoring-jobs.
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireAuthActiveAccount(req);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/tailoring-jobs")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const scope = (req.nextUrl.searchParams.get("scope") || "customer").trim();
    void req.nextUrl.searchParams.get("userId");
    void req.nextUrl.searchParams.get("orgId");
    const statusRaw = req.nextUrl.searchParams.get("status")?.trim() || "";
    const status =
      statusRaw && isTailoringJobStatus(statusRaw) ? statusRaw : undefined;
    const page = req.nextUrl.searchParams.get("page");
    const limit = req.nextUrl.searchParams.get("limit");

    if (scope === "tailor") {
      const profileId = await getTailorProfileIdForUser(actor.sub);
      if (!profileId) {
        return ok({ jobs: [], page: 1, limit: 20, total: 0, totalPages: 1 });
      }
      const result = await listJobsForTailorProfile(profileId, {
        status,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return ok(result);
    }

    if (scope === "admin" || scope === "staff") {
      return forbidden("Use /api/admin/tailoring-jobs for staff lists");
    }

    const result = await listJobsForCustomer(actor.sub, {
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return ok(result);
  } catch (err) {
    console.error("List tailoring jobs error:", err);
    return serverError("Failed to list tailoring jobs");
  }
}

/** POST /api/tailoring-jobs — customer submits a job (status=submitted) */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.TailoringJobsWriteOwn);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/tailoring-jobs", {
          permission: P.TailoringJobsWriteOwn,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const [body, audit] = await Promise.all([req.json(), stampCreate(actor.sub)]);
    if (!isPlainObject(body)) return badRequest("Invalid body");
    void body.customer;
    void body.user;
    void body.userId;
    void body.orgId;
    void body.status;

    const job = await createSubmittedJob(actor.sub, body, audit);
    return created({ job, message: "Tailoring job submitted" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit job";
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("not found") ||
      message.includes("not available") ||
      message.includes("Select") ||
      message.includes("usable values") ||
      message.includes("HTTPS") ||
      message.includes("Check My jobs") ||
      message.includes("could not be loaded") ||
      message.includes("too large") ||
      message.includes("Reference images") ||
      /measurement/i.test(message)
    ) {
      return badRequest(message);
    }
    console.error("Create tailoring job error:", err);
    return serverError("Failed to submit tailoring job");
  }
}
