import { NextRequest } from "next/server";
import {
  ok,
  notFound,
  badRequest,
  forbidden,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P, hasPermission } from "@/lib/auth/permissions";
import { requireActorOrgId, assertActorOrgMatch } from "@/lib/staffOrg";
import { isPlainObject } from "@/lib/catalogWrite";
import { stampUpdate } from "@/lib/audit/recordAudit";
import {
  getTailoringJobById,
  patchTailoringJob,
} from "@/lib/tailoringJobs";
import { ForbiddenError } from "@/lib/auth/http-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/admin/tailoring-jobs/[id] — staff org-scoped detail */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.TailoringJobsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/tailoring-jobs/[id]", {
          permission: P.TailoringJobsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    void req.nextUrl.searchParams;
    const { id } = await params;
    const orgId = requireActorOrgId(actor);
    const job = await getTailoringJobById(id);
    if (!job) return notFound("Tailoring job not found");
    assertActorOrgMatch(orgId, job.orgId);
    return ok({ job });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Admin get tailoring job error:", err);
    return serverError("Failed to fetch tailoring job");
  }
}

/**
 * PATCH /api/admin/tailoring-jobs/[id]
 * Ops transitions; status paid routes through ops settlement (wallet + notifications).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.TailoringJobsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PATCH /api/admin/tailoring-jobs/[id]", {
          permission: P.TailoringJobsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { id } = await params;
    const body = await req.json();
    if (!isPlainObject(body)) return badRequest("Invalid body");

    const orgId = requireActorOrgId(actor);
    const existing = await getTailoringJobById(id);
    if (!existing) return notFound("Tailoring job not found");
    assertActorOrgMatch(orgId, existing.orgId);

    if (!hasPermission(actor.permissions, P.TailoringJobsManage)) {
      return forbidden("Missing required permission");
    }

    if (body.status === "paid") {
      const note = typeof body.note === "string" ? body.note.trim() : undefined;
      const { settleTailoringJobOpsPayment } = await import(
        "@/lib/tailoringJobPaymentSettle"
      );
      const settled = await settleTailoringJobOpsPayment({
        jobId: id,
        adminUserId: actor.sub,
        note,
      });
      if (!settled.ok) {
        if (settled.code === "not_found") return notFound(settled.message);
        if (
          settled.code === "invalid_status" ||
          settled.code === "amount_mismatch" ||
          settled.code === "missing_reference"
        ) {
          return badRequest(settled.message);
        }
        if (settled.code === "wallet_error") {
          return serverError(settled.message || "Wallet settlement failed");
        }
        return badRequest(settled.message);
      }
      const job = await getTailoringJobById(id);
      if (!job) return notFound("Tailoring job not found");
      return ok({ job, message: "Job marked paid" });
    }

    const audit = await stampUpdate(actor.sub);
    const job = await patchTailoringJob(
      id,
      { sub: actor.sub, role: "admin" },
      body,
      audit
    );
    return ok({ job, message: "Job updated" });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    if (err instanceof ForbiddenError) return forbidden(err.message);
    const message = err instanceof Error ? err.message : "Failed to update";
    if (message.includes("not found")) return notFound(message);
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("Cannot")
    ) {
      return badRequest(message);
    }
    console.error("Admin patch tailoring job error:", err);
    return serverError("Failed to update tailoring job");
  }
}
