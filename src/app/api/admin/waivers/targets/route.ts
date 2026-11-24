export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import prisma from "@/lib/prisma";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import {
  assertWaiversStaff,
  waiverListLocationWhere,
} from "@/lib/waivers/common";
import { requireActorOrgId } from "@/lib/staffOrg";

/** Product pickers for waiver requirements. POS products are not a catalog yet. */
export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/targets", P.WaiversRead);
  }
  try {
    await connectDB();
    const orgId = await assertWaiversStaff(actor);
    requireActorOrgId(actor);
    const loc = await waiverListLocationWhere(actor);
    const kind = request.nextUrl.searchParams.get("type") ?? "admission_product";
    if (kind === "admission_product") {
      const rows = await prisma.admissionProduct.findMany({
        where: { orgId, archivedAt: null, ...loc },
        select: { id: true, name: true, locationId: true },
        orderBy: { name: "asc" },
        take: 200,
      });
      return ok({ targets: rows, manual: false });
    }
    if (kind === "membership_plan") {
      const rows = await prisma.membershipPlan.findMany({
        where: { orgId, archivedAt: null, ...loc },
        select: { id: true, name: true, locationId: true },
        orderBy: { name: "asc" },
        take: 200,
      });
      return ok({ targets: rows, manual: false });
    }
    if (kind === "pos_product") {
      return ok({
        targets: [],
        manual: true,
        help: "Paste the product id when POS ships.",
      });
    }
    return badRequest("Unknown target type");
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/targets", "Failed to list targets", actor);
  }
}
