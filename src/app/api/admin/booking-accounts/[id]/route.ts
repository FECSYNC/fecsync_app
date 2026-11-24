export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { isValidId } from "@/lib/ids";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  getBookingAccount,
  updateBookingAccount,
  archiveBookingAccount,
} from "@/lib/ticketing/accounts";
import {
  ACCOUNT_NOT_FOUND,
  rejectClientOrgFields,
} from "@/lib/ticketing/common";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

/*
 * GET|PATCH|DELETE /api/admin/booking-accounts/[id]
 * DELETE soft-archives (archivedAt).
 */

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

function parsePatchAccountBody(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  return {
    name: typeof b.name === "string" ? b.name : undefined,
    billingEmail:
      b.billingEmail === undefined
        ? undefined
        : typeof b.billingEmail === "string"
          ? b.billingEmail
          : null,
    phone:
      b.phone === undefined
        ? undefined
        : typeof b.phone === "string"
          ? b.phone
          : null,
    taxId:
      b.taxId === undefined
        ? undefined
        : typeof b.taxId === "string"
          ? b.taxId
          : null,
    notes:
      b.notes === undefined
        ? undefined
        : typeof b.notes === "string"
          ? b.notes
          : null,
    defaultTaxExempt:
      typeof b.defaultTaxExempt === "boolean"
        ? b.defaultTaxExempt
        : undefined,
    archive: b.archive === true ? true : undefined,
    unarchive: b.unarchive === true ? true : undefined,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.BookingAccountsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/booking-accounts/[id]", {
          permission: P.BookingAccountsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(ACCOUNT_NOT_FOUND);
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const account = await getBookingAccount(actor, id);
    return ok({ account });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to load booking account",
      authAudit(request, "GET /api/admin/booking-accounts/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingAccountsRead,
      })
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.BookingAccountsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/booking-accounts/[id]", {
          permission: P.BookingAccountsWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(ACCOUNT_NOT_FOUND);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const patch = parsePatchAccountBody(body);
    const account = await updateBookingAccount(actor, id, patch);
    return ok({ account });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to update booking account",
      authAudit(request, "PATCH /api/admin/booking-accounts/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingAccountsWrite,
      })
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.BookingAccountsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "DELETE /api/admin/booking-accounts/[id]", {
          permission: P.BookingAccountsWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(ACCOUNT_NOT_FOUND);
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const account = await archiveBookingAccount(actor, id);
    logStaffActivityEntry(actor, {
      action: "Booking Account Archived",
      entityType: "BookingAccount",
      entityId: account.id,
      description: `Archived booking account "${account.name}"`,
      request,
    });
    return ok({ account });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to archive booking account",
      authAudit(request, "DELETE /api/admin/booking-accounts/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingAccountsWrite,
      })
    );
  }
}
