export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { listOwnMemberships } from "@/lib/memberships/selfServe";
import {
  isMembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import {
  authorizeMeMemberships,
  meMembershipCatch,
  rejectQueryOrg,
  toGuestActor,
} from "@/lib/memberships/meRoute";

const ROUTE = "GET me/memberships";

export async function GET(request: NextRequest) {
  const auth = await authorizeMeMemberships(request, P.MembershipsReadOwn, ROUTE);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const rejected = rejectQueryOrg(request);
  if (rejected) return rejected;
  try {
    await connectDB();
    const memberships = await listOwnMemberships(toGuestActor(actor));
    return ok({ linked: true, memberships });
  } catch (err) {
    if (
      isMembershipBillingError(err) &&
      err.code === MembershipErrorCodes.NOT_LINKED_TO_GUEST
    ) {
      return ok({ linked: false, memberships: [] });
    }
    return meMembershipCatch(err, request, ROUTE, actor, P.MembershipsReadOwn);
  }
}
