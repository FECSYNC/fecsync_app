export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { getOwnMembershipDetail } from "@/lib/memberships/selfServe";
import {
  authorizeMeMemberships,
  meMembershipCatch,
  rejectQueryOrg,
  toGuestActor,
} from "@/lib/memberships/meRoute";

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = "GET me/memberships/[id]";

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await authorizeMeMemberships(request, P.MembershipsReadOwn, ROUTE);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const rejected = rejectQueryOrg(request);
  if (rejected) return rejected;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const locationId = request.nextUrl.searchParams.get("locationId");
    const detail = await getOwnMembershipDetail(
      toGuestActor(actor),
      id,
      locationId
    );
    return ok(detail);
  } catch (err) {
    return meMembershipCatch(err, request, ROUTE, actor, P.MembershipsReadOwn);
  }
}
