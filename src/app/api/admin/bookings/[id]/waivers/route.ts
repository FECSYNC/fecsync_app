export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { assertLocationInHqScope } from "@/lib/ticketing/common";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { evaluateBookingWaivers } from "@/lib/waivers/bookingHooks";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.BookingsRead);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/bookings/[id]/waivers", P.BookingsRead);
  }
  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { id } = await ctx.params;
    const owned = await prisma.booking.findFirst({
      where: { id, orgId },
      select: { id: true, locationId: true },
    });
    if (!owned) throw new ForbiddenError("Booking not found");
    await assertLocationInHqScope(actor, owned.locationId);
    const waiver = await evaluateBookingWaivers(owned.id);
    return ok({ waiver });
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/bookings/[id]/waivers", "Failed to check booking waivers", actor);
  }
}
