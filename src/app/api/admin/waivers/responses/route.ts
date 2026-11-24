export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import prisma from "@/lib/prisma";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import { assertWaiverPermission } from "@/lib/waivers/access";
import { redactWaiverFormAnswers } from "@/lib/waivers/capture";
import { waiverStampedLocationWhere } from "@/lib/waivers/common";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/responses", P.WaiversRead);
  }
  try {
    await connectDB();
    const orgId = await assertWaiverPermission(actor, P.WaiversRead);
    const scope = await waiverStampedLocationWhere(actor);
    const templateId = request.nextUrl.searchParams.get("templateId")?.trim() || "";
    const rows = await prisma.formResponse.findMany({
      where: {
        orgId,
        ...(scope.locationId ? { locationId: scope.locationId } : {}),
        ...(templateId ? { templateId } : {}),
      },
      include: {
        template: { select: { name: true } },
        guestProfile: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { submittedAt: "desc" },
      take: 200,
    });
    return ok({
      responses: rows.map((row) => ({
        id: row.id,
        submittedAt: row.submittedAt.toISOString(),
        templateName: row.template.name,
        guestName: row.guestProfile
          ? `${row.guestProfile.firstName} ${row.guestProfile.lastName}`.trim()
          : "",
        email: row.guestProfile?.email ?? null,
        status: row.status,
        locale: row.locale,
        source: row.source,
        answers: redactWaiverFormAnswers(row.payloadJson),
      })),
    });
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/responses", "Failed to list form responses", actor);
  }
}
