import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  notFound,
  forbidden,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { isPlainObject } from "@/lib/catalogWrite";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { P, hasAnyPermission } from "@/lib/auth/permissions";
import { isStaffPreset, isRolePresetId } from "@/lib/auth/permissions";
import { requireActorOrgId, assertActorOrgMatch } from "@/lib/staffOrg";
import {
  getTailoringJobById,
  patchTailoringJob,
  resolveJobAccessRole,
} from "@/lib/tailoringJobs";
import { customerCanReviewJob, jobHasTailorReview } from "@/lib/tailorReviews";
import { ForbiddenError } from "@/lib/auth/http-error";
import { assertOrganizationActive } from "@/lib/org";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isStaffActor(actor: {
  role?: string | null;
  preset?: string | null;
  membershipRole?: string | null;
  permissions?: Iterable<string> | null;
}): boolean {
  // Do not trust User.role=admin alone — Fresh membership claims are the SSOT
  // (revoked seats resolve to client preset/permissions).
  const preset =
    (typeof actor.preset === "string" && actor.preset) ||
    (typeof actor.membershipRole === "string" && actor.membershipRole) ||
    "";
  if (isRolePresetId(preset) && isStaffPreset(preset)) return true;
  return hasAnyPermission(actor.permissions, [
    P.TailoringJobsRead,
    P.TailoringJobsManage,
  ]);
}

/** GET /api/tailoring-jobs/[id] — customer, assigned tailor, or staff (org) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    // Fresh so demotion/revoke cannot keep reading staff-scoped job PII.
    // Owner/customer path allows suspended company Membership (Harewa shop).
    actor = await requireAuthFresh(req, { allowSuspendedOrg: true });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/tailoring-jobs/[id]")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    void req.nextUrl.searchParams;
    const { id } = await params;
    const job = await getTailoringJobById(id);
    if (!job) return notFound("Tailoring job not found");

    const staff = isStaffActor(actor);
    const role = await resolveJobAccessRole({
      job,
      actorSub: actor.sub,
      isStaff: staff,
    });
    if (!role) return forbidden("Forbidden");

    if (role === "admin") {
      try {
        if (actor.orgId) {
          await assertOrganizationActive(actor.orgId);
        }
        const orgId = requireActorOrgId(actor);
        assertActorOrgMatch(orgId, job.orgId);
        if (
          !hasAnyPermission(actor.permissions, [
            P.TailoringJobsRead,
            P.TailoringJobsManage,
          ])
        ) {
          return forbidden("Missing required permission");
        }
      } catch (err) {
        return authErrorToResponse(err) ?? forbidden("Forbidden");
      }
    }

    if (role === "tailor") {
      try {
        const { assertActiveTailorProviderAccess } = await import("@/lib/tailors");
        await assertActiveTailorProviderAccess(actor);
      } catch (err) {
        return authErrorToResponse(err) ?? forbidden("Forbidden");
      }
    }

    let responseJob = job;
    if (role === "customer") {
      const [canReview, hasReview] = await Promise.all([
        customerCanReviewJob({
          customerId: actor.sub,
          jobId: job._id,
        }),
        job.status === "completed"
          ? jobHasTailorReview(job._id)
          : Promise.resolve(false),
      ]);
      responseJob = { ...job, canReview, hasReview };
    }

    return ok({ job: responseJob });
  } catch (err) {
    console.error("Get tailoring job error:", err);
    return serverError("Failed to fetch tailoring job");
  }
}

/** PATCH /api/tailoring-jobs/[id] — status transitions + quote */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requireAuthFresh(req, { allowSuspendedOrg: true });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PATCH /api/tailoring-jobs/[id]")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { id } = await params;
    const body = await req.json();
    if (!isPlainObject(body)) return badRequest("Invalid body");
    void body.customer;
    void body.tailorProfile;
    void body.orgId;
    void body.userId;

    const job = await getTailoringJobById(id);
    if (!job) return notFound("Tailoring job not found");

    const staff = isStaffActor(actor);
    let role = await resolveJobAccessRole({
      job,
      actorSub: actor.sub,
      isStaff: staff,
    });
    if (!role) return forbidden("Forbidden");

    if (role === "admin") {
      try {
        if (actor.orgId) {
          await assertOrganizationActive(actor.orgId);
        }
        const orgId = requireActorOrgId(actor);
        assertActorOrgMatch(orgId, job.orgId);
        if (!hasAnyPermission(actor.permissions, [P.TailoringJobsManage])) {
          return forbidden("Missing required permission");
        }
      } catch (err) {
        return authErrorToResponse(err) ?? forbidden("Forbidden");
      }
    }

    if (role === "tailor") {
      try {
        const { assertActiveTailorProviderAccess } = await import("@/lib/tailors");
        await assertActiveTailorProviderAccess(actor);
      } catch (err) {
        return authErrorToResponse(err) ?? forbidden("Forbidden");
      }
    }

    if (role === "admin" && body.status === "paid") {
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
      const updated = await getTailoringJobById(id);
      if (!updated) return notFound("Tailoring job not found");
      return ok({ job: updated, message: "Job marked paid" });
    }

    const audit = await stampUpdate(actor.sub);
    const updated = await patchTailoringJob(
      id,
      { sub: actor.sub, role },
      body,
      audit
    );
    return ok({ job: updated, message: "Job updated" });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    if (err instanceof ForbiddenError) {
      return forbidden(err.message);
    }
    const message = err instanceof Error ? err.message : "Failed to update job";
    if (message.includes("not found")) return notFound(message);
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("Cannot")
    ) {
      return badRequest(message);
    }
    console.error("Patch tailoring job error:", err);
    return serverError("Failed to update tailoring job");
  }
}
