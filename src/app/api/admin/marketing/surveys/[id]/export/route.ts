export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { exportSurveyResponsesCsv } from "@/lib/marketing/surveys";
import {
  marketingAuthFail,
  marketingFail,
  rejectClientOrgSelectors,
} from "@/lib/marketing/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingExport);
  } catch (err) {
    return marketingAuthFail(
      err,
      request,
      "POST /api/admin/marketing/surveys/[id]/export",
      P.MarketingExport
    );
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { id } = await context.params;
    const csv = await exportSurveyResponsesCsv(orgId, id);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="survey-${id}.csv"`,
      },
    });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "POST /api/admin/marketing/surveys/[id]/export",
      "Failed to export survey",
      actor
    );
  }
}
