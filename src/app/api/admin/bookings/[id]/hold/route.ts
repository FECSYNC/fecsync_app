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
import { holdBooking } from "@/lib/services/bookings";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  let actor;
  try { actor = await requirePermissionFresh(request, P.BookingsWrite); }
  catch (err) {
    return authErrorToResponse(err, authAudit(request, "POST /api/admin/bookings/[id]/hold", { permission: P.BookingsWrite })) ?? serverError("Failed to authorize");
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
    if (body.allowOverbook) await requirePermissionFresh(request, P.BookingsOverbook);
    const booking = await holdBooking(actor, id, { allowOverbook: Boolean(body.allowOverbook) });
    return ok({ booking });
  } catch (err) {
    return bookingRouteCatch(err, request, "POST /api/admin/bookings/[id]/hold", actor, "Failed: hold", P.BookingsWrite);
  }
}
