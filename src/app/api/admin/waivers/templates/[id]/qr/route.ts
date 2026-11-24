export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { badRequest, ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { issueSignageLink } from "@/lib/waivers/signToken";
import { waiverQrSvg } from "@/lib/waivers/qrSvg";
import prisma from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(
      err,
      request,
      "GET /api/admin/waivers/templates/[id]/qr",
      P.WaiversWrite
    );
  }
  try {
    await connectDB();
    const locationId = request.nextUrl.searchParams.get("locationId") ?? "";
    if (!locationId) return badRequest("locationId is required");
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const { id } = await ctx.params;
    const issued = await issueSignageLink(actor, id, locationId);
    const svg = waiverQrSvg(issued.url);
    const profile = await prisma.companyProfile.findUnique({
      where: { orgId: actor.orgId! },
      select: { logoUrl: true, tradingName: true },
    });
    const venue = await prisma.venueLocation.findFirst({
      where: { id: locationId, orgId: actor.orgId! },
      select: { name: true },
    });
    return ok({
      ...issued,
      svg,
      logoUrl: profile?.logoUrl ?? null,
      venueName: venue?.name ?? profile?.tradingName ?? null,
    });
  } catch (err) {
    return waiverFail(
      err,
      request,
      "GET /api/admin/waivers/templates/[id]/qr",
      "Failed to create signage link",
      actor
    );
  }
}
