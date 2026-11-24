export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/http-error";
import { isValidId } from "@/lib/ids";
import prisma from "@/lib/prisma";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { assertWaiverPermission } from "@/lib/waivers/access";
import { assertLocationInWaiverScope, waiverStampedLocationWhere } from "@/lib/waivers/common";
import { waiverRecordDisplayStatus } from "@/lib/waivers/records";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/guests/[id]", P.WaiversRead);
  }
  try {
    await connectDB();
    const orgId = await assertWaiverPermission(actor, P.WaiversRead);
    const { id } = await ctx.params;
    if (!isValidId(id)) throw new ForbiddenError("Guest not found");
    const guest = await prisma.guestProfile.findFirst({
      where: { id, orgId },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, locationId: true },
    });
    if (!guest) throw new ForbiddenError("Guest not found");
    let guestInScope = true;
    try {
      await assertLocationInWaiverScope(actor, guest.locationId);
    } catch (err) {
      if (!(err instanceof ForbiddenError)) throw err;
      guestInScope = false;
    }
    const scope = await waiverStampedLocationWhere(actor);
    const records = await prisma.waiverRecord.findMany({
      where: {
        orgId,
        guestProfileId: guest.id,
        ...(scope.locationId ? { locationId: scope.locationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        publicRef: true,
        status: true,
        signedAt: true,
        expiresAt: true,
        locationId: true,
        template: { select: { name: true } },
      },
    });
    if (!guestInScope && !records.length) throw new ForbiddenError("Guest not found");
    const now = new Date();
    return ok({
      guest: {
        id: guest.id,
        firstName: guest.firstName,
        lastName: guest.lastName,
        email: guest.email,
        phone: guest.phone,
      },
      records: records.map((row) => ({
        id: row.id,
        publicRef: row.publicRef,
        status: waiverRecordDisplayStatus(row.status, row.expiresAt, now),
        signedAt: row.signedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        templateName: row.template.name,
      })),
    });
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/guests/[id]", "Failed to load guest waivers", actor);
  }
}
