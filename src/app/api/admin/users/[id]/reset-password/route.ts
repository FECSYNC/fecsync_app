export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  badRequest,
  notFound,
  forbidden,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { isAuthHttpError } from "@/lib/auth/http-error";
import { requireActorOrgId, actorHasCompanyWideView } from "@/lib/staffOrg";
import { apiRateLimited } from "@/lib/rateLimit";
import { isPlainObject } from "@/lib/catalogWrite";
import { adminResetStaffPassword } from "@/lib/adminResetStaffPassword";
import { isValidId } from "@/lib/ids";
import {
  PLATFORM_OWNER_HIDDEN_FROM_TENANT_MESSAGE,
  PLATFORM_OWNER_PROTECTED_MESSAGE,
} from "@/lib/resolvePlatformSoftwareOwner";

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = "POST /api/admin/users/[id]/reset-password";

function isOwnerInvisibilityMessage(message: string): boolean {
  return (
    message === PLATFORM_OWNER_PROTECTED_MESSAGE ||
    message === PLATFORM_OWNER_HIDDEN_FROM_TENANT_MESSAGE ||
    message === "That account is not available"
  );
}

/**
 * Desk-assist password reset for another staff user in the actor's org.
 * Requires users:reset_password. Software owners are invisible / untouchable
 * unless the actor is also a software owner.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(
    request,
    "admin-users-reset-password",
    10,
    15 * 60 * 1000
  );
  if (limited) return limited;

  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersResetPassword);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, ROUTE, { permission: P.UsersResetPassword })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await ctx.params;
  if (!isValidId(id)) {
    return notFound("That account is not available");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  const password =
    typeof body.password === "string" ? body.password : "";
  const confirm =
    typeof body.confirmPassword === "string" ? body.confirmPassword : password;
  if (password !== confirm) {
    return badRequest("Password confirmation does not match");
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    const actorLimited = apiRateLimited(
      request,
      "admin-users-reset-password-actor",
      10,
      15 * 60 * 1000,
      actor.sub
    );
    if (actorLimited) return actorLimited;

    const { resolveIsPlatformSoftwareOwner } = await import(
      "@/lib/resolvePlatformSoftwareOwner"
    );
    const viewerIsOwner = await resolveIsPlatformSoftwareOwner(actor);
    if (!viewerIsOwner && !actorHasCompanyWideView(actor)) {
      return forbidden(
        "Company-wide view is required to reset another member's password. Also grant View Users."
      );
    }

    const { assertNotParkLockedCompanyHq, PARK_LOCKED_STAFF_ADMIN_MESSAGE } =
      await import("@/lib/assertNotParkLockedCompanyHq");
    await assertNotParkLockedCompanyHq(actor, PARK_LOCKED_STAFF_ADMIN_MESSAGE);

    const result = await adminResetStaffPassword(actor, {
      targetUserId: id,
      password,
      sendEmail: body.sendEmail !== false,
    });
    return ok(result);
  } catch (err) {
    if (isAuthHttpError(err)) {
      // Owner invisibility → 404 (no leak). Park-lock / other forbids → 403.
      if (err.status === 403 && isOwnerInvisibilityMessage(err.message)) {
        return notFound(err.message);
      }
      return (
        authErrorToResponse(
          err,
          authAudit(request, ROUTE, {
            actorSub: actor.sub,
            orgId: actor.orgId ?? null,
            permission: P.UsersResetPassword,
          })
        ) ?? forbidden(err.message)
      );
    }
    if (err instanceof Error && err.name === "Error") {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to reset password",
      authAudit(request, ROUTE, {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersResetPassword,
      })
    );
  }
}
