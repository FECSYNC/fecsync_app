export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

/**
 * DELETE /api/admin/user-blacklist/[id] — remove blacklist entry (users:blacklist)
 */

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersBlacklist);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "DELETE /api/admin/user-blacklist/[id]", {
          permission: P.UsersBlacklist,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound("Blacklist entry not found");
  }

  try {
    await connectDB();
    const { assertNotParkLockedCompanyHq, PARK_LOCKED_STAFF_ADMIN_MESSAGE } =
      await import("@/lib/assertNotParkLockedCompanyHq");
    await assertNotParkLockedCompanyHq(actor, PARK_LOCKED_STAFF_ADMIN_MESSAGE);
    const orgId = requireActorOrgId(actor);
    const deleted = await prisma.userBlacklist.findFirst({
      where: { id, orgId: String(orgId) },
    });
    if (!deleted) return notFound("Blacklist entry not found");

    await prisma.userBlacklist.delete({ where: { id: deleted.id } });

    logStaffActivityEntry(actor, {
      action: "Blacklist Entry Removed",
      entityType: "Blacklist",
      entityId: id,
      description: `Removed blacklist ${deleted.type} ${deleted.value}`,
      request,
      metadata: { type: deleted.type, value: deleted.value },
    });
    return ok({ deleted: true, id });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "DELETE /api/admin/user-blacklist/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersBlacklist,
        metadata: { blacklistId: id },
      })
    );
    if (authRes) return authRes;
    console.error("Failed to remove blacklist entry:", err);
    return serverError("Failed to remove blacklist entry");
  }
}
