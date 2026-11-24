export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest, notFound } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { setEmailOptIn } from "@/lib/marketing/consent";
import prisma from "@/lib/prisma";
import {
  marketingAuthFail,
  marketingFail,
  rejectClientOrgSelectors,
} from "@/lib/marketing/http";

type RouteContext = { params: Promise<{ guestProfileId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MarketingWrite);
  } catch (err) {
    return marketingAuthFail(
      err,
      request,
      "PATCH /api/admin/marketing/leads/[guestProfileId]/consent",
      P.MarketingWrite
    );
  }
  let body: { optedIn?: boolean; source?: string };
  try {
    body = (await request.json()) as { optedIn?: boolean; source?: string };
  } catch {
    return badRequest("Invalid JSON");
  }
  if (typeof body.optedIn !== "boolean") {
    return badRequest("optedIn boolean is required");
  }
  try {
    const rejected = rejectClientOrgSelectors(request);
    if (rejected) return rejected;
    await connectDB();
    const orgId = requireActorOrgId(actor);
    await assertMarketingEnabled(orgId);
    const { guestProfileId } = await context.params;
    const guest = await prisma.guestProfile.findFirst({
      where: { id: guestProfileId, orgId },
      select: { id: true },
    });
    if (!guest) return notFound("Guest not found");
    await setEmailOptIn({
      orgId,
      guestProfileId: guest.id,
      optedIn: body.optedIn,
      source: body.source ?? "admin",
    });
    return ok({ guestProfileId: guest.id, optedIn: body.optedIn });
  } catch (err) {
    return marketingFail(
      err,
      request,
      "PATCH /api/admin/marketing/leads/[guestProfileId]/consent",
      "Failed to update consent",
      actor
    );
  }
}
