export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { generateMembershipWalletPass } from "@/lib/memberships/walletPass";
import { assertOwnGuestMembership } from "@/lib/memberships/guestAuth";
import {
  authorizeMeMemberships,
  meMembershipCatch,
  rejectQueryOrg,
  toGuestActor,
} from "@/lib/memberships/meRoute";

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = "GET me/memberships/[id]/wallet";

/**
 * Own wallet endpoint — always honest not_configured until signed-pass
 * issuance ships. Digital QR via card route. Never staff admin wallet URL.
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await authorizeMeMemberships(request, P.MembershipsReadOwn, ROUTE);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const rejected = rejectQueryOrg(request);
  if (rejected) return rejected;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const guest = toGuestActor(actor);
    const member = await assertOwnGuestMembership(guest, id);
    const url = new URL(request.url);
    const platformRaw = url.searchParams.get("platform");
    const platform =
      platformRaw === "apple" || platformRaw === "google"
        ? platformRaw
        : "auto";
    const wallet = await generateMembershipWalletPass({
      orgId: member.orgId,
      guestMembershipId: member.id,
      platform,
      downloadBasePath: `/api/me/memberships/${member.id}/wallet`,
    });
    return ok({ wallet });
  } catch (err) {
    return meMembershipCatch(err, request, ROUTE, actor, P.MembershipsReadOwn);
  }
}
