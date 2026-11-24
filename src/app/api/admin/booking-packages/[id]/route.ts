import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
  errorResponse,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P, hasPermission } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { isValidId } from "@/lib/ids";
import { isPlainObject } from "@/lib/catalogWrite";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  BOOKING_PACKAGE_NOT_FOUND,
  getBookingPackageForOrg,
  updateBookingPackage,
  deleteBookingPackage,
} from "@/lib/marketplace/packages";
import { isPlanLimitOrBillingGateMessage } from "@/lib/planLimits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET|PATCH|DELETE /api/admin/booking-packages/[id]
 * Actor.orgId only — lib helpers assert org match via stamped orgId.
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.BookingPackagesRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/booking-packages/[id]", {
          permission: P.BookingPackagesRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(BOOKING_PACKAGE_NOT_FOUND);
  }

  try {
    const orgId = requireActorOrgId(actor);
    if (
      req.nextUrl.searchParams.has("orgId") ||
      req.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const pkg = await getBookingPackageForOrg(orgId, id);
    const { resolveEffectiveParkScope, assertLocationInAssignedSet } =
      await import("@/lib/parkAdminScope");
    const parkScope = await resolveEffectiveParkScope(actor);
    if (parkScope.parkLocked) {
      assertLocationInAssignedSet(parkScope, pkg.locationId);
    }
    return ok({ package: pkg });
  } catch (err) {
    if (err instanceof ForbiddenError && err.message === BOOKING_PACKAGE_NOT_FOUND) {
      return notFound(BOOKING_PACKAGE_NOT_FOUND);
    }
    return routeErrorResponse(
      err,
      "Failed to load booking package",
      authAudit(req, "GET /api/admin/booking-packages/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingPackagesRead,
      })
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.BookingPackagesWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PATCH /api/admin/booking-packages/[id]", {
          permission: P.BookingPackagesWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(BOOKING_PACKAGE_NOT_FOUND);
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
      published !== undefined &&
      !hasPermission(actor.permissions, P.BookingPackagesPublish)
    ) {
      return (
        authErrorToResponse(new ForbiddenError("Missing required permission")) ??
        badRequest("Missing publish permission")
      );
    }

    const { resolveEffectiveParkScope, assertLocationInAssignedSet } =
      await import("@/lib/parkAdminScope");
    const parkScope = await resolveEffectiveParkScope(actor);
    const existing = await getBookingPackageForOrg(orgId, id);
    if (parkScope.parkLocked) {
      assertLocationInAssignedSet(parkScope, existing.locationId);
    }
    const nextLocationId = optionalString(body, "locationId");
    if (nextLocationId !== undefined) {
      assertLocationInAssignedSet(parkScope, nextLocationId);
    }

    const pkg = await updateBookingPackage({
      orgId,
      packageId: id,
      title: typeof body.title === "string" ? body.title : undefined,
      slug: typeof body.slug === "string" ? body.slug : undefined,
      description: optionalString(body, "description"),
      amountMinor: optionalNumber(body, "amountMinor") ?? undefined,
      currency: typeof body.currency === "string" ? body.currency : undefined,
      capacity: optionalNumber(body, "capacity"),
      locationId: nextLocationId,
      published,
      active: optionalBool(body, "active"),
      startsAt: optionalString(body, "startsAt"),
      endsAt: optionalString(body, "endsAt"),
    });

    return ok({ package: pkg });
  } catch (err) {
    if (err instanceof BodyValidationError) {
      return badRequest(err.message);
    }
    if (err instanceof ForbiddenError) {
      if (err.message === BOOKING_PACKAGE_NOT_FOUND) {
        return notFound(BOOKING_PACKAGE_NOT_FOUND);
      }
      if (isPlanLimitOrBillingGateMessage(err.message)) {
        return errorResponse(err.message, 403);
      }
      return authErrorToResponse(err) ?? badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to update booking package",
      authAudit(req, "PATCH /api/admin/booking-packages/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingPackagesWrite,
      })
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.BookingPackagesDelete);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "DELETE /api/admin/booking-packages/[id]", {
          permission: P.BookingPackagesDelete,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(BOOKING_PACKAGE_NOT_FOUND);
  }

  try {
    const orgId = requireActorOrgId(actor);
    if (
      req.nextUrl.searchParams.has("orgId") ||
      req.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const { resolveEffectiveParkScope, assertLocationInAssignedSet } =
      await import("@/lib/parkAdminScope");
    const parkScope = await resolveEffectiveParkScope(actor);
    const existing = await getBookingPackageForOrg(orgId, id);
    if (parkScope.parkLocked) {
      assertLocationInAssignedSet(parkScope, existing.locationId);
    }
    const result = await deleteBookingPackage(orgId, id);
    return ok(result);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      if (err.message === BOOKING_PACKAGE_NOT_FOUND) {
        return notFound(BOOKING_PACKAGE_NOT_FOUND);
      }
      return authErrorToResponse(err) ?? badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to delete booking package",
      authAudit(req, "DELETE /api/admin/booking-packages/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingPackagesDelete,
      })
    );
  }
}
