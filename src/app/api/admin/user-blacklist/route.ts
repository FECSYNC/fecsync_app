export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  created,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { isPlainObject } from "@/lib/catalogWrite";
import prisma from "@/lib/prisma";
import {
  serializeBlacklistEntry,
  upsertBlacklistEntry,
} from "@/lib/userBlacklist";
import { invalidateSessionsForIdentifiers } from "@/lib/memberAdmin";
import { stampCreate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

/**
 * GET /api/admin/user-blacklist — list org blacklist entries
 * POST /api/admin/user-blacklist — add email or phone (users:blacklist)
 */

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersBlacklist);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/user-blacklist", {
          permission: P.UsersBlacklist,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const { assertNotParkLockedCompanyHq, PARK_LOCKED_STAFF_ADMIN_MESSAGE } =
      await import("@/lib/assertNotParkLockedCompanyHq");
    await assertNotParkLockedCompanyHq(actor, PARK_LOCKED_STAFF_ADMIN_MESSAGE);
    const orgId = requireActorOrgId(actor);
    const rows = await prisma.userBlacklist.findMany({
      where: { orgId: String(orgId) },
      orderBy: { createdAt: "desc" },
    });
    return ok({
      entries: rows.map((row) => serializeBlacklistEntry(row)),
      orgId: String(orgId),
    });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Failed to list user blacklist:", err);
    return serverError("Failed to list blacklist");
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersBlacklist);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/user-blacklist", {
          permission: P.UsersBlacklist,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) return badRequest("Invalid JSON");

  const type = body.type === "phone" ? "phone" : body.type === "email" ? "email" : null;
  const value = typeof body.value === "string" ? body.value : "";
  const reason = typeof body.reason === "string" ? body.reason : null;

  if (!type) return badRequest("type must be email or phone");
  if (!value.trim()) return badRequest("value is required");

  try {
    await connectDB();
    const { assertNotParkLockedCompanyHq, PARK_LOCKED_STAFF_ADMIN_MESSAGE } =
      await import("@/lib/assertNotParkLockedCompanyHq");
    await assertNotParkLockedCompanyHq(actor, PARK_LOCKED_STAFF_ADMIN_MESSAGE);
    const orgId = requireActorOrgId(actor);
    const audit = await stampCreate(actor.sub);
    const entry = await upsertBlacklistEntry({
      orgId,
      type,
      value,
      reason,
      source: "manual",
      createdBy: actor.sub,
      audit,
    });
    // Force logout on every device for any matching live account.
    await invalidateSessionsForIdentifiers(
      type === "email"
        ? { email: entry.value }
        : { phone: entry.value }
    );
    logStaffActivityEntry(actor, {
      action: entry.created ? "Blacklist Entry Created" : "Blacklist Entry Updated",
      entityType: "Blacklist",
      entityId: entry._id,
      description: `${entry.created ? "Blocked" : "Updated block for"} ${entry.type} ${entry.value}`,
      request,
      metadata: { type: entry.type, source: entry.source },
    });
    return created({ entry });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "Failed to add blacklist entry";
    if (
      message === "Invalid email" ||
      message === "Invalid phone number"
    ) {
      return badRequest(message);
    }
    console.error("Failed to add user blacklist entry:", err);
    return serverError("Failed to add blacklist entry");
  }
}
