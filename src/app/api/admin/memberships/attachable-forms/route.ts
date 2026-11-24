export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { listAttachableForms } from "@/lib/memberships/attachableForms";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MembershipsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/memberships/attachable-forms", {
          permission: P.MembershipsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const forms = await listAttachableForms(actor);
    return ok({ forms, orgId: String(actor.orgId) });
  } catch (err) {
    return (
      routeErrorResponse(
        err,
        authAudit(request, "GET /api/admin/memberships/attachable-forms", {
          permission: P.MembershipsRead,
          orgId: actor.orgId != null ? String(actor.orgId) : null,
        })
      ) ?? serverError("Failed to list attachable forms")
    );
  }
}
