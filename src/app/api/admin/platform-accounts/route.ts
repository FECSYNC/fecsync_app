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
import { assertStorefrontPlatformAdmin } from "@/lib/companyApproval";
import {
  findPlatformUsers,
  opsSetUserAccountSuspended,
} from "@/lib/accountSuspend";
import { isPlainObject } from "@/lib/catalogWrite";
import { isValidId } from "@/lib/ids";

/** GET /api/admin/platform-accounts?q= — search any user (storefront platform_admin). */
export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersManageRoles);
    await assertStorefrontPlatformAdmin(actor);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/platform-accounts", {
          permission: P.UsersManageRoles,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const q = request.nextUrl.searchParams.get("q") || "";
    const users = await findPlatformUsers({ q });
    return ok({ users });
  } catch (err) {
    return routeErrorResponse(err, "Failed to search users");
  }
}

/**
 * PATCH /api/admin/platform-accounts
 * body: { userId, action: "suspend" | "unsuspend", reason? }
 * Soft lock only — never deletes user or company records.
 */
export async function PATCH(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersManageRoles);
    await assertStorefrontPlatformAdmin(actor);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/platform-accounts", {
          permission: P.UsersManageRoles,
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

  const userId = typeof body.userId === "string" ? body.userId : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!userId) return badRequest("userId is required");
  if (!isValidId(userId)) return badRequest("Invalid userId");
  if (action !== "suspend" && action !== "unsuspend") {
    return badRequest('action must be "suspend" or "unsuspend"');
  }

  try {
    await connectDB();
    const result = await opsSetUserAccountSuspended({
      userId,
      suspend: action === "suspend",
      actor,
      request,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
    return ok({ user: result });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "PATCH /api/admin/platform-accounts", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersManageRoles,
      })
    );
    if (authRes) return authRes;
    return routeErrorResponse(err, "Failed to update account");
  }
}
