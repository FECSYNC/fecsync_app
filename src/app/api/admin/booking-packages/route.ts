import { NextRequest } from "next/server";
import {
  ok,
  created,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  errorResponse,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermissionFresh, requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P, hasPermission } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { isPlainObject } from "@/lib/catalogWrite";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  listBookingPackagesForOrg,
  createBookingPackage,
} from "@/lib/marketplace/packages";
import { isPlanLimitOrBillingGateMessage } from "@/lib/planLimits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET|POST /api/admin/booking-packages
 * Actor.orgId only — never trust body.orgId / ?orgId=.
 */

class BodyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyValidationError";
  }
}

function optionalString(
  body: Record<string, unknown>,
  key: string
): string | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null) return null;
  if (typeof v === "string") return v;
  throw new BodyValidationError(`${key} must be a string or null`);
}

function optionalBool(
  body: Record<string, unknown>,
  key: string
): boolean | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (typeof v !== "boolean") {
    throw new BodyValidationError(`${key} must be a boolean`);
  }
  return v;
}

function optionalNumber(
  body: Record<string, unknown>,
  key: string
): number | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  throw new BodyValidationError(`${key} must be a number or null`);
}

export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireAnyPermissionFresh(req, [
      P.BookingPackagesRead,
      P.BookingPackagesManage,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/booking-packages", {
          permission: P.BookingPackagesRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    if (
      req.nextUrl.searchParams.has("orgId") ||
      req.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const { resolveEffectiveParkScope } = await import("@/lib/parkAdminScope");
    const parkScope = await resolveEffectiveParkScope(actor);
    const packages = await listBookingPackagesForOrg(orgId, {
      parkLocked: parkScope.parkLocked,
      locationId: parkScope.locationId,
      locationIds: parkScope.assignedLocationIds,
    });
    return ok({ packages, orgId });
  } catch (err) {
    return routeErrorResponse(
      err,
      "Failed to list booking packages",
      authAudit(req, "GET /api/admin/booking-packages", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingPackagesRead,
      })
    );
  }
}

export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.BookingPackagesWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/admin/booking-packages", {
          permission: P.BookingPackagesWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    const orgId = requireActorOrgId(actor);
    if (
      req.nextUrl.searchParams.has("orgId") ||
      req.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    if (!isPlainObject(body)) {
      return badRequest("Invalid body");
    }
    if ("orgId" in body || "organizationId" in body) {
      return badRequest("Unsupported marketplace fields in request body");
    }

    const published = optionalBool(body, "published");
    if (
      published === true &&
      !hasPermission(actor.permissions, P.BookingPackagesPublish)
    ) {
      return authErrorToResponse(
        new ForbiddenError("Missing required permission")
      ) ?? badRequest("Missing publish permission");
    }

    const title =
      typeof body.title === "string" ? body.title : "";
    const amountMinor = optionalNumber(body, "amountMinor");
    if (amountMinor == null) {
      return badRequest("amountMinor is required");
    }

    const { resolveEffectiveParkScope, assertLocationInAssignedSet } =
      await import("@/lib/parkAdminScope");
    const parkScope = await resolveEffectiveParkScope(actor);
    let locationId = optionalString(body, "locationId");
    if (parkScope.parkLocked) {
      if (!locationId) {
        locationId = parkScope.locationId;
      }
      assertLocationInAssignedSet(parkScope, locationId);
    }

    const pkg = await createBookingPackage({
      orgId,
      title,
      slug: typeof body.slug === "string" ? body.slug : undefined,
      description: optionalString(body, "description"),
      amountMinor,
      currency: typeof body.currency === "string" ? body.currency : undefined,
      capacity: optionalNumber(body, "capacity"),
      locationId: locationId ?? null,
      requireLocation: parkScope.parkLocked,
      published,
      active: optionalBool(body, "active"),
      startsAt: optionalString(body, "startsAt"),
      endsAt: optionalString(body, "endsAt"),
    });

    return created({ package: pkg });
  } catch (err) {
    if (err instanceof BodyValidationError) {
      return badRequest(err.message);
    }
    if (err instanceof ForbiddenError) {
      if (isPlanLimitOrBillingGateMessage(err.message)) {
        return errorResponse(err.message, 403);
      }
      return authErrorToResponse(err) ?? badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to create booking package",
      authAudit(req, "POST /api/admin/booking-packages", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingPackagesWrite,
      })
    );
  }
}
