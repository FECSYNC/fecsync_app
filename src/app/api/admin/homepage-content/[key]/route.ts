import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { isPlainObject, auditCreateToPrisma, auditUpdateToPrisma } from "@/lib/catalogWrite";
import {
  getHomepageSection,
  isHomepageSectionKey,
  resetHomepageSection,
  updateHomepageSection,
} from "@/lib/homepageContent";
import { assertStorefrontStaffOrg } from "@/lib/staffOrg";
import { stampCreate, stampUpdate } from "@/lib/audit/recordAudit";
import type { AuditCreateStamp, AuditUpdateStamp } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ key: string }> };

/**
 * GET /api/admin/homepage-content/[key] → settings:manage
 */
export async function GET(req: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.SettingsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/homepage-content/[key]", {
          permission: P.SettingsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { key } = await context.params;
    if (!isHomepageSectionKey(key)) {
      return notFound("Homepage section not found");
    }
    const orgId = await assertStorefrontStaffOrg(actor);
    const section = await getHomepageSection(key, orgId);
    return ok({ section });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/homepage-content/[key]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.SettingsManage,
      })
    );
    if (authRes) return authRes;
    console.error("Error fetching homepage section:", err);
    return serverError("Failed to fetch homepage section");
  }
}

/**
 * PUT /api/admin/homepage-content/[key] → settings:manage
 * Body: { published?, content?, label? }
 */
export async function PUT(req: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.SettingsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PUT /api/admin/homepage-content/[key]", {
          permission: P.SettingsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  try {
    const { key } = await context.params;
    if (!isHomepageSectionKey(key)) {
      return notFound("Homepage section not found");
    }

    const orgId = await assertStorefrontStaffOrg(actor);
    const published =
      typeof body.published === "boolean" ? body.published : undefined;
    const label = typeof body.label === "string" ? body.label : undefined;
    const content = body.content !== undefined ? body.content : undefined;

    if (published === undefined && content === undefined && label === undefined) {
      return badRequest("Provide published, content, and/or label to update");
    }

    void body.createdBy;
    void body.createdByName;
    void body.updatedBy;
    void body.updatedByName;

    const existing = await prisma.homepageSection.findUnique({
      where: { orgId_key: { orgId, key } },
      select: { createdById: true },
    });
    const stamp = !existing?.createdById
      ? await stampCreate(actor.sub)
      : await stampUpdate(actor.sub);
    const audit = !existing?.createdById
      ? auditCreateToPrisma(stamp as AuditCreateStamp)
      : auditUpdateToPrisma(stamp as AuditUpdateStamp);

    const section = await updateHomepageSection(
      key,
      orgId,
      {
        published,
        content,
        label,
      },
      audit
    );

    logStaffActivityEntry(actor, {
      action: "Homepage Content Updated",
      entityType: "Settings",
      entityId: section._id,
      description: `Updated homepage section "${key}"`,
      request: req,
      metadata: { key },
    });

    return ok({
      message: "Homepage section updated successfully",
      section,
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "PUT /api/admin/homepage-content/[key]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.SettingsManage,
      })
    );
    if (authRes) return authRes;
    console.error("Error updating homepage section:", err);
    return serverError("Failed to update homepage section");
  }
}

/**
 * DELETE /api/admin/homepage-content/[key] → settings:manage
 * Resets the section to built-in defaults (does not remove the system row).
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.SettingsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "DELETE /api/admin/homepage-content/[key]", {
          permission: P.SettingsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const { key } = await context.params;
    if (!isHomepageSectionKey(key)) {
      return notFound("Homepage section not found");
    }
    const orgId = await assertStorefrontStaffOrg(actor);
    const audit = auditUpdateToPrisma(await stampUpdate(actor.sub));
    await resetHomepageSection(key, orgId);
    await prisma.homepageSection.update({
      where: { orgId_key: { orgId, key } },
      data: audit,
    });
    const section = await getHomepageSection(key, orgId);
    logStaffActivityEntry(actor, {
      action: "Homepage Content Reset",
      entityType: "Settings",
      entityId: section._id,
      description: `Reset homepage section "${key}" to defaults`,
      request: req,
      metadata: { key },
    });
    return ok({
      message: "Homepage section reset to defaults",
      section,
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "DELETE /api/admin/homepage-content/[key]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.SettingsManage,
      })
    );
    if (authRes) return authRes;
    console.error("Error resetting homepage section:", err);
    return serverError("Failed to reset homepage section");
  }
}
