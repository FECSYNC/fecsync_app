export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest, created } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { createGuestSurvey, listGuestSurveys } from "@/lib/marketing/surveys";
import {
  marketingAuthFail,
  marketingFail,
  rejectClientOrgSelectors,
} from "@/lib/marketing/http";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingSurveys);
  } catch (err) {
    return marketingAuthFail(err, request, "GET /api/admin/marketing/surveys", P.MarketingSurveys);
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const surveys = await listGuestSurveys(orgId);
    return ok({ surveys, orgId });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "GET /api/admin/marketing/surveys",
      "Failed to list surveys",
      actor
    );
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingSurveys);
  } catch (err) {
    return marketingAuthFail(err, request, "POST /api/admin/marketing/surveys", P.MarketingSurveys);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON");
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const name = String(body.name ?? "").trim();
    if (!name) return badRequest("name is required");
    const survey = await createGuestSurvey({
      orgId,
      name,
      locationId: body.locationId ? String(body.locationId) : null,
      questions: body.questions,
      thankYouMessage: body.thankYouMessage ? String(body.thankYouMessage) : null,
      promoUrl: body.promoUrl ? String(body.promoUrl) : null,
      createdById: actor.sub ? String(actor.sub) : null,
    });
    return created({ survey });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "POST /api/admin/marketing/surveys",
      "Failed to create survey",
      actor
    );
  }
}
