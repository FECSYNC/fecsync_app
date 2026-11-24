export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
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
import { isPlainObject, auditCreateToPrisma } from "@/lib/catalogWrite";
import {
  assertTemplatePermissionsSubset,
  serializeRoleTemplate,
} from "@/lib/roleTemplateAdmin";
import { stampCreate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/role-templates", {
          permission: P.UsersRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const rows = await prisma.roleTemplate.findMany({
      where: { orgId },
      orderBy: { name: "asc" },
    });
    return ok({
      templates: rows.map((row) => serializeRoleTemplate(row)),
      orgId: String(orgId),
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "GET /api/admin/role-templates", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersRead,
      })
    );
    if (authRes) return authRes;
    console.error("Failed to list role templates:", err);
    return serverError("Failed to list role templates");
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersManageRoles);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/role-templates", {
          permission: P.UsersManageRoles,
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
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const permissions = Array.isArray(body.permissions) ? body.permissions : [];

  if (!name) {
    return badRequest("Name is required");
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq, PARK_LOCKED_STAFF_ADMIN_MESSAGE } =
      await import("@/lib/assertNotParkLockedCompanyHq");
    await assertNotParkLockedCompanyHq(actor, PARK_LOCKED_STAFF_ADMIN_MESSAGE);
    const { getStorefrontOrgId } = await import("@/lib/org");
    const parsed = assertTemplatePermissionsSubset(
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

    const audit = await stampCreate(actor.sub);
    const { assertWithinPlanLimit } = await import("@/lib/planLimits");
    await assertWithinPlanLimit(orgId, "roleTemplates");
    const template = await prisma.roleTemplate.create({
      data: {
        orgId,
        name,
        description: description || null,
        permissions: parsed,
        ...auditCreateToPrisma(audit),
      },
    });

    logStaffActivityEntry(actor, {
      action: "Role Template Created",
      entityType: "RoleTemplate",
      entityId: template.id,
      description: `Created role template "${template.name}"`,
      request,
    });

    return created({
      template: serializeRoleTemplate(template),
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "POST /api/admin/role-templates", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersManageRoles,
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
    console.error("Failed to create role template:", err);
    return serverError("Failed to create role template");
  }
}
