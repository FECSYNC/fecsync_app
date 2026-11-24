import { NextRequest } from "next/server";
import {
  ok,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { isValidId } from "@/lib/ids";
import {
  assertCanAccessParkPayouts,
  getParkMarketplaceAccount,
  toParkMarketplaceAccountDto,
} from "@/lib/marketplace/parkAccount";
import { getParkMarketplaceChargeReadyState } from "@/lib/marketplace/guestPayoutDestination";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/marketplace/park-accounts/[locationId]
 * View gate (list parity) — includes archived franchise parks. Mutating Connect
 * routes use assertCanManageParkConnect (active only).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ locationId: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.PayoutsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/marketplace/park-accounts/[locationId]", {
          permission: P.PayoutsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { locationId } = await params;
  if (!isValidId(locationId)) {
    return notFound("Venue not found");
  }

  try {
    const { orgId } = await assertCanAccessParkPayouts(actor, locationId);
    const venue = await prisma.venueLocation.findFirst({
      where: { id: locationId, orgId },
      select: { id: true, orgId: true, name: true, isFranchise: true },
    });
    if (!venue) return notFound("Venue not found");
    const row = await getParkMarketplaceAccount(locationId);
    const ready = await getParkMarketplaceChargeReadyState(orgId, locationId);
    return ok({
      account: toParkMarketplaceAccountDto(row, venue, ready.chargeReady),
      chargeReadyReason: ready.reason,
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/marketplace/park-accounts/[locationId]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.PayoutsRead,
      })
    );
    if (authRes) return authRes;
    console.error("park-accounts get error:", err);
    return serverError("Failed to load park payout account");
  }
}
