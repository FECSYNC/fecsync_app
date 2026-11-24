export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { apiRateLimited } from "@/lib/rateLimit";
import { publicGuestMembershipPayload } from "@/lib/memberships/members";
import { selfServeReactivate } from "@/lib/memberships/selfServe";
import {
  authorizeMeMemberships,
  requireIdempotencyKey,
  meMembershipCatch,
  readMeBody,
  rejectQueryOrg,
  toGuestActor,
} from "@/lib/memberships/meRoute";

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = "POST me/memberships/[id]/reactivate";

export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "me-memberships-billing", 10, 60_000);
  if (limited) return limited;
  const auth = await authorizeMeMemberships(request, P.MembershipsWriteOwn, ROUTE);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const rejected = rejectQueryOrg(request);
  if (rejected) return rejected;
  const parsed = await readMeBody(request);
  if (!parsed.ok) return parsed.response;
  const idem = requireIdempotencyKey(parsed.body);
  if (!idem.ok) return idem.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const result = await selfServeReactivate({
      actor: toGuestActor(actor),
      guestMembershipId: id,
      idempotencyKey: idem.key,
    });
    return ok({
      membership: publicGuestMembershipPayload(result.membership),
      stripeConfigured: result.stripeConfigured,
      note: result.note,
    });
  } catch (err) {
    return meMembershipCatch(err, request, ROUTE, actor, P.MembershipsWriteOwn);
  }
}
