export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { apiRateLimited } from "@/lib/rateLimit";
import { signAgreementAsGuest } from "@/lib/memberships/agreements";
import {
  authorizeMeMemberships,
  meMembershipCatch,
  readMeBody,
  rejectQueryOrg,
  toGuestActor,
} from "@/lib/memberships/meRoute";

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = "POST me/memberships/[id]/sign-agreement";

/** Body: { accepted: true, bodyVersion? } */
export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "me-memberships-agreement", 10, 60_000);
  if (limited) return limited;
  const auth = await authorizeMeMemberships(request, P.MembershipsWriteOwn, ROUTE);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const rejected = rejectQueryOrg(request);
  if (rejected) return rejected;
  const parsed = await readMeBody(request);
  if (!parsed.ok) return parsed.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const result = await signAgreementAsGuest({
      actor: toGuestActor(actor),
      guestMembershipId: id,
      accepted: parsed.body.accepted === true,
      bodyVersion:
        typeof parsed.body.bodyVersion === "string"
          ? parsed.body.bodyVersion
          : undefined,
    });
    return ok(result);
  } catch (err) {
    return meMembershipCatch(err, request, ROUTE, actor, P.MembershipsWriteOwn);
  }
}
