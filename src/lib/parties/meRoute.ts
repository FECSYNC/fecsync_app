/**
 * Party host (`/api/me/parties*`) route wrapper: own-party permission keys only.
 */
import type { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import type { Permission } from "@/lib/auth/permissions";
import { authAudit, authErrorToResponse, serverError } from "@/lib/ticketing/bookingRoute";
import { partyRouteCatch } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";

export async function withPartyHostRoute(
  request: NextRequest,
  opts: { route: string; permission: Permission },
  handler: (userId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  let actor;
  try {
    actor = await requirePermissionFresh(request, opts.permission);
  } catch (err) {
    return (
      authErrorToResponse(err, authAudit(request, opts.route, { permission: opts.permission })) ??
      serverError("Failed to authorize")
    );
  }
  try {
    rejectQueryOrgId(request.nextUrl.searchParams);
    await connectDB();
    return await handler(String(actor.sub ?? ""));
  } catch (err) {
    return partyRouteCatch(err, request, opts.route, actor);
  }
}
