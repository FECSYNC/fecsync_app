export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { apiRateLimited } from "@/lib/rateLimit";
import { selfServeUpdateCard } from "@/lib/memberships/selfServe";
import {
  authorizeMeMemberships,
  meMembershipCatch,
  readMeBody,
  rejectQueryOrg,
  toGuestActor,
} from "@/lib/memberships/meRoute";

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = "POST me/memberships/[id]/update-card";

export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "me-memberships-card", 10, 60_000);
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
    const pm = await selfServeUpdateCard({
      actor: toGuestActor(actor),
      guestMembershipId: id,
    });
    return ok({
      paymentMethod: {
        clientSecret: pm.clientSecret,
        setupIntentId: pm.setupIntentId,
      },
      note: "Confirm the card with Stripe using clientSecret. No raw card numbers are accepted by this API.",
    });
  } catch (err) {
    return meMembershipCatch(err, request, ROUTE, actor, P.MembershipsWriteOwn);
  }
}
