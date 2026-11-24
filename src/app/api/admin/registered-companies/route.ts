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
import {
  assertStorefrontPlatformAdmin,
  listRegisteredCompanies,
  approveRegisteredCompany,
  suspendRegisteredCompany,
  clearRegisteredCompanyOffboard,
  opsSetCompanySubscriptionPlan,
  opsCreateRegisteredCompany,
  REGISTERED_COMPANIES_LIST_LIMIT,
  REGISTERED_COMPANIES_LIST_MAX,
} from "@/lib/companyApproval";
import { isPlainObject } from "@/lib/catalogWrite";
import { isValidId } from "@/lib/ids";

/** GET /api/admin/registered-companies — Harewa storefront platform_admin only */
export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.RegisteredCompaniesRead);
    await assertStorefrontPlatformAdmin(actor);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/registered-companies", {
          permission: P.RegisteredCompaniesRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const statusRaw = request.nextUrl.searchParams.get("status") || "all";
    const status =
      statusRaw === "pending" ||
      statusRaw === "active" ||
      statusRaw === "suspended" ||
      statusRaw === "offboard" ||
      statusRaw === "all"
        ? statusRaw
        : "all";
    const limitRaw = request.nextUrl.searchParams.get("limit");
    const limitParsed =
      limitRaw != null && limitRaw.trim() !== ""
        ? Number(limitRaw)
        : REGISTERED_COMPANIES_LIST_LIMIT;
    const limit =
      Number.isFinite(limitParsed) && limitParsed > 0
        ? Math.min(Math.floor(limitParsed), REGISTERED_COMPANIES_LIST_MAX)
        : REGISTERED_COMPANIES_LIST_LIMIT;
    const cursorRaw = request.nextUrl.searchParams.get("cursor");
    const cursor =
      typeof cursorRaw === "string" && cursorRaw.trim()
        ? cursorRaw.trim()
        : null;
    const { companies, nextCursor, hasMore } = await listRegisteredCompanies({
      status,
      limit,
      cursor,
    });
    return ok({ companies, nextCursor, hasMore, limit });
  } catch (err) {
    return routeErrorResponse(err, "Failed to list companies");
  }
}

/**
 * POST /api/admin/registered-companies
 * Ops-create a company workspace (no public register / Checkout required).
 * body: {
 *   companyName, slug?, adminEmail, adminPassword?, adminFullName?,
 *   subscriptionPlan, activate? (default true)
 * }
 */
export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.RegisteredCompaniesManage);
    await assertStorefrontPlatformAdmin(actor);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/registered-companies", {
          permission: P.RegisteredCompaniesManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: Record<string, unknown>;
  try {
    const raw = await request.json();
    if (!isPlainObject(raw)) return badRequest("Invalid body");
    body = raw;
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    await connectDB();
    const company = await opsCreateRegisteredCompany({
      actor,
      request,
      companyName:
        typeof body.companyName === "string" ? body.companyName : "",
      slug: typeof body.slug === "string" ? body.slug : null,
      adminEmail: typeof body.adminEmail === "string" ? body.adminEmail : "",
      adminPassword:
        typeof body.adminPassword === "string" ? body.adminPassword : null,
      adminFullName:
        typeof body.adminFullName === "string" ? body.adminFullName : null,
      subscriptionPlan:
        typeof body.subscriptionPlan === "string"
          ? body.subscriptionPlan
          : "",
      activate: body.activate !== false,
      durationMonths:
        typeof body.durationMonths === "number" ||
        typeof body.durationMonths === "string"
          ? Number(body.durationMonths)
          : null,
    });
    return ok({ company });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "POST /api/admin/registered-companies", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.RegisteredCompaniesManage,
      })
    );
    if (authRes) return authRes;
    return routeErrorResponse(err, "Failed to create company");
  }
}

/**
 * PATCH /api/admin/registered-companies
 * body: {
 *   orgId,
 *   action: "approve" | "suspend" | "clear_offboard" | "set_plan",
 *   subscriptionPlan?,
 *   reason?
 * }
 */
export async function PATCH(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.RegisteredCompaniesManage);
    await assertStorefrontPlatformAdmin(actor);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/registered-companies", {
          permission: P.RegisteredCompaniesManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: Record<string, unknown>;
  try {
    const raw = await request.json();
    if (!isPlainObject(raw)) return badRequest("Invalid body");
    body = raw;
  } catch {
    return badRequest("Invalid JSON");
  }

  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return badRequest("orgId is required");
  if (!isValidId(orgId)) return badRequest("Invalid orgId");
  if (
    action !== "approve" &&
    action !== "suspend" &&
    action !== "clear_offboard" &&
    action !== "set_plan"
  ) {
    return badRequest(
      'action must be "approve", "suspend", "clear_offboard", or "set_plan"'
    );
  }

  try {
    await connectDB();
    if (action === "approve") {
      const result = await approveRegisteredCompany({
        orgId,
        actor,
        request,
        subscriptionPlan:
          typeof body.subscriptionPlan === "string"
            ? body.subscriptionPlan
            : null,
        durationMonths:
          typeof body.durationMonths === "number" ||
          typeof body.durationMonths === "string"
            ? Number(body.durationMonths)
            : null,
      });
      return ok({ company: result });
    }
    if (action === "set_plan") {
      if (
        typeof body.subscriptionPlan !== "string" ||
        !body.subscriptionPlan.trim()
      ) {
        return badRequest(
          "subscriptionPlan is required for set_plan (demo|starter|growth|enterprise)"
        );
      }
      const result = await opsSetCompanySubscriptionPlan({
        orgId,
        actor,
        request,
        subscriptionPlan: body.subscriptionPlan,
        durationMonths:
          typeof body.durationMonths === "number" ||
          typeof body.durationMonths === "string"
            ? Number(body.durationMonths)
            : null,
      });
      return ok({ company: result });
    }
    if (action === "clear_offboard") {
      const result = await clearRegisteredCompanyOffboard({
        orgId,
        actor,
        request,
      });
      return ok({ company: result });
    }
    const result = await suspendRegisteredCompany({
      orgId,
      actor,
      request,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
    return ok({ company: result });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "PATCH /api/admin/registered-companies", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.RegisteredCompaniesManage,
      })
    );
    if (authRes) return authRes;
    return routeErrorResponse(err, "Failed to update company");
  }
}
