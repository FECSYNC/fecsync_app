export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { assertWaiverPermission } from "@/lib/waivers/access";
import { evaluateGuestWaivers } from "@/lib/waivers/evaluateWaiver";
import { searchWaiverGuests } from "@/lib/waivers/capture";
import { assertLocationInWaiverScope, waiverStampedLocationWhere } from "@/lib/waivers/common";
import { isValidId } from "@/lib/ids";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversVerify);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/evaluate", P.WaiversVerify);
  }
  try {
    await connectDB();
    const orgId = await assertWaiverPermission(actor, P.WaiversVerify);
    requireActorOrgId(actor);
    if (request.nextUrl.searchParams.has("orgId")) {
      return badRequest("Unsupported selector in query");
    }
    const guestProfileId = request.nextUrl.searchParams.get("guestProfileId");
    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const scope = await waiverStampedLocationWhere(actor);
    const requested = request.nextUrl.searchParams.get("locationId")?.trim() ?? "";
    const scoped =
      typeof scope.locationId === "string" ? scope.locationId : "";
    const locationId = requested || scoped;
    if (!locationId) return badRequest("Choose a venue");
    await assertLocationInWaiverScope(actor, locationId);
    if (guestProfileId) {
      if (!isValidId(guestProfileId)) throw new ForbiddenError("Guest not found");
      const guest = await prisma.guestProfile.findFirst({
        where: { id: guestProfileId, orgId },
        select: { locationId: true },
      });
      if (!guest) throw new ForbiddenError("Guest not found");
      let guestInScope = true;
      try {
        await assertLocationInWaiverScope(actor, guest.locationId);
      } catch (err) {
        if (!(err instanceof ForbiddenError)) throw err;
        guestInScope = false;
      }
      if (!guestInScope) {
        const signedHere = await prisma.waiverRecord.findFirst({
          where: { orgId, guestProfileId, locationId },
          select: { id: true },
        });
        if (!signedHere) throw new ForbiddenError("Guest not found");
      }
      const admissionProductId = request.nextUrl.searchParams.get("admissionProductId")?.trim() ?? "";
      const membershipPlanId = request.nextUrl.searchParams.get("membershipPlanId")?.trim() ?? "";
      const productTargets = [
        ...(admissionProductId
          ? [{ targetType: "admission_product", targetId: admissionProductId }]
          : []),
        ...(membershipPlanId
          ? [{ targetType: "membership_plan", targetId: membershipPlanId }]
          : []),
      ];
      const evaluation = await evaluateGuestWaivers({
        orgId,
        locationId,
        guestProfileId,
        ...(productTargets.length ? { productTargets } : {}),
      });
      return ok({ evaluation });
    }
    if (q.length < 2) return badRequest("Search for a guest");
    const guests = await searchWaiverGuests(actor, q);
    return ok({ guests });
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/evaluate", "Failed to check waivers", actor);
  }
}
