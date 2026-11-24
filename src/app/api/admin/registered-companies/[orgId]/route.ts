export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
  assertStorefrontPlatformAdmin,
  getRegisteredCompanyById,
  ORG_NOT_REGISTERED_COMPANY_MESSAGE,
} from "@/lib/companyApproval";
import { ForbiddenError } from "@/lib/auth/http-error";
import { isValidId } from "@/lib/ids";

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * GET /api/admin/registered-companies/[orgId]
 * FECSYNC storefront platform_admin — read one registered company workspace.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.RegisteredCompaniesRead);
    await assertStorefrontPlatformAdmin(actor);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/registered-companies/[orgId]", {
          permission: P.RegisteredCompaniesRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { orgId } = await params;
  if (!orgId || !isValidId(orgId)) {
    return notFound("Company not found");
  }

  try {
    await connectDB();
    const company = await getRegisteredCompanyById(orgId);
    return ok({ company });
  } catch (err) {
    if (
      err instanceof ForbiddenError &&
      err.message === ORG_NOT_REGISTERED_COMPANY_MESSAGE
    ) {
      return notFound("Company not found");
    }
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "GET /api/admin/registered-companies/[orgId]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.RegisteredCompaniesRead,
      })
    );
    if (authRes) return authRes;
    return routeErrorResponse(err, "Failed to load company");
  }
}
