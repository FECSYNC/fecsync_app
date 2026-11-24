export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { selfServeCard } from "@/lib/memberships/selfServe";
import {
  authorizeMeMemberships,
  meMembershipCatch,
  rejectQueryOrg,
  toGuestActor,
} from "@/lib/memberships/meRoute";

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = "GET me/memberships/[id]/card";

/** Own digital card (QR payload) + wallet pass or honest not_configured. */
export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await authorizeMeMemberships(request, P.MembershipsReadOwn, ROUTE);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const rejected = rejectQueryOrg(request);
  if (rejected) return rejected;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const result = await selfServeCard(toGuestActor(actor), id);
    return ok(result);
  } catch (err) {
    return meMembershipCatch(err, request, ROUTE, actor, P.MembershipsReadOwn);
  }
}
