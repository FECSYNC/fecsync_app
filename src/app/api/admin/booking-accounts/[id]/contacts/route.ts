export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { isValidId } from "@/lib/ids";
import {
  ok,
  created,
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
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  listAccountContacts,
  createAccountContact,
  parseCreateContactBody,
} from "@/lib/ticketing/accounts";
import { ACCOUNT_NOT_FOUND } from "@/lib/ticketing/common";

/*
 * GET|POST /api/admin/booking-accounts/[id]/contacts
 */

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
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
        authAudit(request, "GET /api/admin/booking-accounts/[id]/contacts", {
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
    const contacts = await listAccountContacts(actor, id);
    return ok({ contacts });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to list account contacts",
      authAudit(request, "GET /api/admin/booking-accounts/[id]/contacts", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingAccountsRead,
      })
    );
  }
}

export async function POST(
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
        authAudit(request, "POST /api/admin/booking-accounts/[id]/contacts", {
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
    const input = parseCreateContactBody(body);
    const contact = await createAccountContact(actor, id, input);

    logStaffActivityEntry(actor, {
      action: "Booking Account Contact Created",
      entityType: "BookingAccount",
      entityId: id,
      description: `Created contact on booking account ${id}`,
      request,
    });

    return created({ contact });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to create account contact",
      authAudit(request, "POST /api/admin/booking-accounts/[id]/contacts", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingAccountsWrite,
      })
    );
  }
}
