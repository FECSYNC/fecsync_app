export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { listPartyWaiverGaps, sendPartyWaiverChase } from "@/lib/waivers/desk";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/party-chase", P.WaiversRead);
  }
  try {
    await connectDB();
    const bookingId = request.nextUrl.searchParams.get("bookingId") ?? "";
    if (!bookingId) return badRequest("bookingId is required");
    return ok(await listPartyWaiverGaps(actor, bookingId));
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/party-chase", "Failed to list party waivers", actor);
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(err, request, "POST /api/admin/waivers/party-chase", P.WaiversWrite);
  }
  try {
    await connectDB();
    const body = (await request.json().catch(() => null)) as {
      bookingId?: string;
      templateId?: string;
    } | null;
    if (!body?.bookingId || !body.templateId) {
      return badRequest("bookingId and templateId are required");
    }
    return ok(await sendPartyWaiverChase(actor, body.bookingId, body.templateId));
  } catch (err) {
    return waiverFail(err, request, "POST /api/admin/waivers/party-chase", "Failed to send party waiver links", actor);
  }
}
