export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { authErrorToResponse, authAudit, serverError, bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { moveBookingLineResource } from "@/lib/services/bookings";
type Ctx = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsWrite); }
  catch (err) { return authErrorToResponse(err, authAudit(request, "PATCH resources", { permission: P.BookingsWrite })) ?? serverError("Failed to authorize"); }
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB(); requireActorOrgId(actor); const { id } = await ctx.params;
    if (body.allowOverbook) await requirePermissionFresh(request, P.BookingsOverbook);
    const booking = await moveBookingLineResource(actor, id, {
      lineId: String(body.lineId ?? ""),
      resourceId: String(body.resourceId ?? ""),
      sessionId: body.sessionId == null ? undefined : String(body.sessionId),
      allowOverbook: Boolean(body.allowOverbook),
    });
    return ok({ booking });
  } catch (err) { return bookingRouteCatch(err, request, "PATCH resources", actor, "Failed", P.BookingsWrite); }
}
