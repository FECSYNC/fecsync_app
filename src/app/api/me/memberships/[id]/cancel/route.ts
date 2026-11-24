export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { apiRateLimited } from "@/lib/rateLimit";
import { publicGuestMembershipPayload } from "@/lib/memberships/members";
import { selfServeCancel } from "@/lib/memberships/selfServe";
import {
  authorizeMeMemberships,
  requireIdempotencyKey,
  meMembershipCatch,
  readMeBody,
  rejectQueryOrg,
  toGuestActor,
} from "@/lib/memberships/meRoute";

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = "POST me/memberships/[id]/cancel";

/**
 * Body: { when?: "end_of_period" | "immediate", reason?, confirm: true,
 *         declineAlternatives?, alternativeId?, idempotencyKey }
 * First call without declineAlternatives/alternativeId may return
 * { requiresAlternatives: true, alternatives } instead of cancelling.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "me-memberships-cancel", 10, 60_000);
  if (limited) return limited;
  const auth = await authorizeMeMemberships(request, P.MembershipsWriteOwn, ROUTE);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const rejected = rejectQueryOrg(request);
  if (rejected) return rejected;
  const parsed = await readMeBody(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;
  const idem = requireIdempotencyKey(body);
  if (!idem.ok) return idem.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const result = await selfServeCancel({
      actor: toGuestActor(actor),
      guestMembershipId: id,
      when: body.when === "immediate" ? "immediate" : "end_of_period",
      reason: typeof body.reason === "string" ? body.reason : undefined,
      confirm: body.confirm === true,
      declineAlternatives: body.declineAlternatives === true,
      alternativeId:
        typeof body.alternativeId === "string" ? body.alternativeId : null,
      idempotencyKey: idem.key,
    });
    if (result.requiresAlternatives) {
      return ok({
        requiresAlternatives: true,
        alternatives: result.alternatives,
        membershipId: result.membershipId,
        beta: true,
      });
    }
    if ("alternativeApplied" in result) {
      return ok({
        requiresAlternatives: false,
        alternativeApplied: result.alternativeApplied,
        beta: true,
      });
    }
    return ok({
      requiresAlternatives: false,
      membership: publicGuestMembershipPayload(result.membership),
      note: result.note,
    });
  } catch (err) {
    return meMembershipCatch(err, request, ROUTE, actor, P.MembershipsWriteOwn);
  }
}
