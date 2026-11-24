export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  created,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermission, requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  listBookingAccounts,
  createBookingAccount,
  parseCreateAccountBody,
} from "@/lib/ticketing/accounts";

/*
 * GET|POST /api/admin/booking-accounts
 * B2B companies (NOT SaaS Organization). Actor.orgId only.
 */

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = requirePermission(request, P.BookingAccountsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/booking-accounts", {
          permission: P.BookingAccountsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
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
    const accounts = await listBookingAccounts(actor);
    return ok({
      accounts,
      orgId: String(actor.orgId),
    });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to list booking accounts",
      authAudit(request, "GET /api/admin/booking-accounts", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingAccountsRead,
      })
    );
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.BookingAccountsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/booking-accounts", {
          permission: P.BookingAccountsWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
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
    const input = parseCreateAccountBody(body);
    const account = await createBookingAccount(actor, input);

    logStaffActivityEntry(actor, {
      action: "Booking Account Created",
      entityType: "BookingAccount",
      entityId: account.id,
      description: `Created booking account "${account.name}"`,
      request,
    });

    return created({ account });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to create booking account",
      authAudit(request, "POST /api/admin/booking-accounts", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BookingAccountsWrite,
      })
    );
  }
}
