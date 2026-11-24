export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { idWhere, isValidId } from "@/lib/ids";
import { auditUpdateToPrisma, whereOrgAndCatalogId } from "@/lib/catalogWrite";
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
import { requireActorOrgId } from "@/lib/staffOrg";
import { isPlainObject } from "@/lib/catalogWrite";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertRoleTemplateDeletable,
  assertTemplatePermissionsSubset,
  serializeRoleTemplate,
  ROLE_TEMPLATE_IN_USE_MESSAGE,
} from "@/lib/roleTemplateAdmin";
import { invalidateSessionsForRoleTemplateAssignees } from "@/lib/memberAdmin";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { Prisma } from "@prisma/client";

const NOT_FOUND = "Role template not found";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/role-templates/[id]", {
          permission: P.UsersRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(NOT_FOUND);
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const row = await prisma.roleTemplate.findFirst({
      where: whereOrgAndCatalogId(orgId, id),
    });
    if (!row) return notFound(NOT_FOUND);
    return ok({ template: serializeRoleTemplate(row) });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "GET /api/admin/role-templates/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersRead,
        metadata: { templateId: id },
      })
    );
    if (authRes) return authRes;
    console.error("Failed to get role template:", err);
    return serverError("Failed to get role template");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersManageRoles);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/role-templates/[id]", {
          permission: P.UsersManageRoles,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(NOT_FOUND);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");
  const hasPermissions = Object.prototype.hasOwnProperty.call(body, "permissions");

  if (!hasName && !hasDescription && !hasPermissions) {
    return badRequest("Provide name, description, and/or permissions");
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq, PARK_LOCKED_STAFF_ADMIN_MESSAGE } =
      await import("@/lib/assertNotParkLockedCompanyHq");
    await assertNotParkLockedCompanyHq(actor, PARK_LOCKED_STAFF_ADMIN_MESSAGE);
    const existing = await prisma.roleTemplate.findFirst({
      where: whereOrgAndCatalogId(orgId, id),
    });
    if (!existing) return notFound(NOT_FOUND);

    const audit = await stampUpdate(actor.sub);
    const data: Parameters<typeof prisma.roleTemplate.update>[0]["data"] = {
      ...auditUpdateToPrisma(audit),
    };

    if (hasName) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return badRequest("Name cannot be empty");
      data.name = name;
    }
    if (hasDescription) {
      data.description =
        typeof body.description === "string" ? body.description.trim() : "";
    }
    if (hasPermissions) {
      const permissions = Array.isArray(body.permissions) ? body.permissions : [];
      const { getStorefrontOrgId } = await import("@/lib/org");
      data.permissions = assertTemplatePermissionsSubset(
        actor.permissions,
        permissions,
        {
          permissions: actor.permissions,
          preset: actor.preset,
          membershipRole: actor.membershipRole,
          orgId: actor.orgId,
          storefrontOrgId:
            (actor as { storefrontOrgId?: string | null }).storefrontOrgId ??
            (await getStorefrontOrgId()),
        }
      );
    }

    const template = await prisma.roleTemplate.update({
      where: { id: existing.id },
      data,
    });

    // Permission changes must invalidate assignee JWTs (same as membership edit).
    let invalidatedAssigneeIds: string[] = [];
    if (hasPermissions) {
      invalidatedAssigneeIds = await invalidateSessionsForRoleTemplateAssignees(
        orgId,
        template.id
      );
    }

    logStaffActivityEntry(actor, {
      action: "Role Template Updated",
      entityType: "RoleTemplate",
      entityId: template.id,
      description: `Updated role template "${template.name}"`,
      request,
    });

    return ok({
      template: serializeRoleTemplate(template),
      invalidatedAssigneeIds,
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "PATCH /api/admin/role-templates/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersManageRoles,
        metadata: { templateId: id },
      })
    );
    if (authRes) return authRes;
    const prismaCode =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code;
    if (prismaCode === "P2002") {
      return badRequest("A role template with this name already exists");
    }
    console.error("Failed to update role template:", err);
    return serverError("Failed to update role template");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersManageRoles);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "DELETE /api/admin/role-templates/[id]", {
          permission: P.UsersManageRoles,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(NOT_FOUND);
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq, PARK_LOCKED_STAFF_ADMIN_MESSAGE } =
      await import("@/lib/assertNotParkLockedCompanyHq");
    await assertNotParkLockedCompanyHq(actor, PARK_LOCKED_STAFF_ADMIN_MESSAGE);
    const template = await prisma.roleTemplate.findFirst({
      where: whereOrgAndCatalogId(orgId, id),
    });
    if (!template) return notFound(NOT_FOUND);

    await assertRoleTemplateDeletable(orgId, template.id);
    // Part 9: detach revoked pointers + delete in one Serializable tx; re-check
    // live assignees inside the tx so concurrent invite cannot race.
    await prisma.$transaction(
      async (tx) => {
        const live = await tx.membership.count({
          where: {
            orgId,
            roleTemplateId: template.id,
            status: { in: ["active", "invited", "suspended"] },
          },
        });
        if (live > 0) {
          throw new ForbiddenError(ROLE_TEMPLATE_IN_USE_MESSAGE);
        }
        await tx.membership.updateMany({
          where: {
            orgId,
            roleTemplateId: template.id,
            status: "revoked",
          },
          data: { roleTemplateId: null },
        });
        await tx.roleTemplate.delete({ where: { id: template.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    logStaffActivityEntry(actor, {
      action: "Role Template Deleted",
      entityType: "RoleTemplate",
      entityId: id,
      description: `Deleted role template "${template.name}"`,
      request,
    });

    return ok({ deleted: true, id });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "DELETE /api/admin/role-templates/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersManageRoles,
        metadata: { templateId: id },
      })
    );
    if (authRes) return authRes;
    const prismaCode =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code;
    if (prismaCode === "P2003") {
      return badRequest(ROLE_TEMPLATE_IN_USE_MESSAGE);
    }
    console.error("Failed to delete role template:", err);
    return serverError("Failed to delete role template");
  }
}
