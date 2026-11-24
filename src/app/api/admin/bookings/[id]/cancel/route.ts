export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  authErrorToResponse, authAudit, serverError, bookingRouteCatch,
} from "@/lib/ticketing/bookingRoute";
import { cancelBooking } from "@/lib/services/bookings";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsWrite); }
  catch (err) {
    return authErrorToResponse(err, authAudit(request, "POST /api/admin/bookings/[id]/cancel", { permission: P.BookingsWrite })) ?? serverError("Failed to authorize");
  }
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const { id } = await ctx.params;
    const booking = await cancelBooking(actor, id, { reason: body.reason ? String(body.reason) : undefined });
    return ok({ booking });
  } catch (err) {
    return bookingRouteCatch(err, request, "POST /api/admin/bookings/[id]/cancel", actor, "Failed: cancel", P.BookingsWrite);
  }
}
