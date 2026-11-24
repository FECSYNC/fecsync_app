export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { apiRateLimited } from "@/lib/rateLimit";
import { linkGuestProfileToUser } from "@/lib/memberships/selfServe";
import {
  authorizeMeMemberships,
  meMembershipCatch,
  readMeBody,
  rejectQueryOrg,
  toGuestActor,
} from "@/lib/memberships/meRoute";

const ROUTE = "POST me/memberships/link";

export async function POST(request: NextRequest) {
  const limited = apiRateLimited(request, "me-memberships-link", 10, 60_000);
  if (limited) return limited;
  const auth = await authorizeMeMemberships(request, P.MembershipsWriteOwn, ROUTE);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const rejected = rejectQueryOrg(request);
  if (rejected) return rejected;
  const parsed = await readMeBody(request, { allowOrgId: true });
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;
  const guestProfileId =
    typeof body.guestProfileId === "string" ? body.guestProfileId.trim() : "";
  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
  if (!guestProfileId || !orgId) {
    return badRequest("guestProfileId and orgId are required");
  }
  try {
    await connectDB();
    const linked = await linkGuestProfileToUser(toGuestActor(actor), {
      guestProfileId,
      orgId,
    });
    return ok({ linked });
  } catch (err) {
    return meMembershipCatch(err, request, ROUTE, actor, P.MembershipsWriteOwn);
  }
}
