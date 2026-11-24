export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { badRequest, errorResponse } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { exportWaiverCsv } from "@/lib/waivers/exportWaivers";
import { WaiverLinkError } from "@/lib/waivers/signToken";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversExport);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/export", P.WaiversExport);
  }
  try {
    await connectDB();
    const type = request.nextUrl.searchParams.get("type") === "responses" ? "responses" : "records";
    const expiringRaw = request.nextUrl.searchParams.get("expiringWithin");
    const body = await exportWaiverCsv(actor, type, {
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      q: request.nextUrl.searchParams.get("q") ?? undefined,
      email: request.nextUrl.searchParams.get("email") ?? undefined,
      phone: request.nextUrl.searchParams.get("phone") ?? undefined,
      templateId: request.nextUrl.searchParams.get("templateId") ?? undefined,
      locationId: request.nextUrl.searchParams.get("locationId") ?? undefined,
      channel: request.nextUrl.searchParams.get("channel") ?? undefined,
      from: request.nextUrl.searchParams.get("from") ?? undefined,
      to: request.nextUrl.searchParams.get("to") ?? undefined,
      expiringWithinDays: expiringRaw ? Number(expiringRaw) : undefined,
    });
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="waivers-${type}.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof WaiverLinkError) return errorResponse(err.message, err.status);
    if (err instanceof Error && err.message === "Choose records or responses") {
      return badRequest(err.message);
    }
    return waiverFail(err, request, "GET /api/admin/waivers/export", "Failed to export waivers", actor);
  }
}
