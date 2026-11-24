export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest, notFound } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { getGuestSurvey, updateGuestSurvey } from "@/lib/marketing/surveys";
import type { GuestSurveyStatus } from "@prisma/client";
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
      "GET /api/admin/marketing/surveys/[id]",
      P.MarketingSurveys
    );
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { id } = await context.params;
    const survey = await getGuestSurvey(orgId, id);
    if (!survey) return notFound("Survey not found");
    return ok({ survey });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "GET /api/admin/marketing/surveys/[id]",
      "Failed to load survey",
      actor
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingSurveys);
  } catch (err) {
    return marketingAuthFail(
      err,
      request,
      "PATCH /api/admin/marketing/surveys/[id]",
      P.MarketingSurveys
    );
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
    const { id } = await context.params;
    const survey = await updateGuestSurvey(orgId, id, {
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.locationId !== undefined
        ? { locationId: body.locationId ? String(body.locationId) : null }
        : {}),
      ...(body.status !== undefined
        ? { status: String(body.status) as GuestSurveyStatus }
        : {}),
      ...(body.questions !== undefined ? { questions: body.questions } : {}),
      ...(body.thankYouMessage !== undefined
        ? {
            thankYouMessage:
              body.thankYouMessage == null ? null : String(body.thankYouMessage),
          }
        : {}),
      ...(body.promoUrl !== undefined
        ? { promoUrl: body.promoUrl == null ? null : String(body.promoUrl) }
        : {}),
    });
    return ok({ survey });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "PATCH /api/admin/marketing/surveys/[id]",
      "Failed to update survey",
      actor
    );
  }
}
