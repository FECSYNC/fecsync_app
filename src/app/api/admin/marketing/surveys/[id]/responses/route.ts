export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { listSurveyResponses } from "@/lib/marketing/surveys";
import {
  marketingAuthFail,
  marketingFail,
  rejectClientOrgSelectors,
} from "@/lib/marketing/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingSurveys);
  } catch (err) {
    return marketingAuthFail(
      err,
      request,
      "GET /api/admin/marketing/surveys/[id]/responses",
      P.MarketingSurveys
    );
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { id } = await context.params;
    const takeRaw = request.nextUrl.searchParams.get("take");
    const take = takeRaw ? Number(takeRaw) : undefined;
    const responses = await listSurveyResponses(orgId, id, { take });
    return ok({ responses, surveyId: id });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "GET /api/admin/marketing/surveys/[id]/responses",
      "Failed to load responses",
      actor
    );
  }
}
