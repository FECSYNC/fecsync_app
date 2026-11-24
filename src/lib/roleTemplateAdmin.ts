/**
 * Org role templates — validation and effective grant resolution.
 */

import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { idWhere, isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  expandRoleToPermissions,
  hasAllPermissions,
  parsePermissionList,
  uniquePermissions,
  isPlatformAdminActor,
  canAssignPlatformAdminPreset,
  isFullStaffPermissionSet,
  isStorefrontHostGrantActor,
  jurisdictionStaffPermissions,
  STOREFRONT_OPS_ONLY_PERMISSIONS,
  type GrantActorIdentity,
  type Permission,
} from "@/lib/auth/permissions";
import {
  MEMBERSHIP_ROLE_PRESETS,
  type MembershipRolePreset,
} from "@/lib/membershipConstants";

function isMembershipRolePreset(
  value: string
): value is MembershipRolePreset {
  return (MEMBERSHIP_ROLE_PRESETS as readonly string[]).includes(value);
}

export const ROLE_TEMPLATE_IN_USE_MESSAGE =
  "Cannot delete a role template that is still assigned to members";

export const PLATFORM_ADMIN_ASSIGN_DENIED =
  "Only a platform admin (Admin) can assign the Admin role or full Admin permissions";

export function effectiveGrantsFromAssignment(input: {
  rolePreset: string;
  permissionsOverride?: string[] | null;
  templatePermissions?: string[] | null;
}): Permission[] {
  const templatePerms = parsePermissionList(input.templatePermissions);
  if (templatePerms.length > 0) {
    const fromOverride = parsePermissionList(input.permissionsOverride);
    return uniquePermissions([...templatePerms, ...fromOverride]);
  }
  const fromPreset = isMembershipRolePreset(input.rolePreset)
    ? expandRoleToPermissions(input.rolePreset)
    : [];
  const fromOverride = parsePermissionList(input.permissionsOverride);
  return uniquePermissions([...fromPreset, ...fromOverride]);
}

/**
 * Actor must hold every permission being assigned, and must be platform_admin
 * to assign the Admin preset or a full staff permission set.
 * Company tenants cannot grant FECSYNC storefront-ops-only keys.
 */
export function assertAssignableGrantsExtended(
  actorPermissions: Iterable<string> | null | undefined,
  input: {
    rolePreset: MembershipRolePreset;
    permissionsOverride?: string[] | null;
    templatePermissions?: string[] | null;
  },
  actorIdentity?: GrantActorIdentity | null
): Permission[] {
  const identity: GrantActorIdentity = {
    permissions: actorPermissions,
    preset: actorIdentity?.preset,
    membershipRole: actorIdentity?.membershipRole,
    orgId: actorIdentity?.orgId,
    storefrontOrgId: actorIdentity?.storefrontOrgId,
  };

  if (
    input.rolePreset === "platform_admin" &&
    !canAssignPlatformAdminPreset(identity)
  ) {
    throw new ForbiddenError(PLATFORM_ADMIN_ASSIGN_DENIED);
  }

  // Company Admin may assign the Admin preset without holding FECSYNC-only keys
  // (those keys are inert for registered-company seats — APIs assert storefront).
  if (
    input.rolePreset === "platform_admin" &&
    canAssignPlatformAdminPreset(identity)
  ) {
    return effectiveGrantsFromAssignment(input);
  }

  let effective = effectiveGrantsFromAssignment(input);

  if (!isStorefrontHostGrantActor(identity)) {
    const opsOnly = new Set<string>(STOREFRONT_OPS_ONLY_PERMISSIONS);
    const leaked = effective.filter((p) => opsOnly.has(p));
    if (leaked.length > 0) {
      throw new ForbiddenError(
        "Cannot grant permissions outside this company workspace"
      );
    }
    // Strip any ops-only keys that arrived via preset expansion before subset check.
    effective = effective.filter((p) => !opsOnly.has(p));
  }

  if (
    !isPlatformAdminActor(identity) &&
    isFullStaffPermissionSet(effective)
  ) {
    throw new ForbiddenError(PLATFORM_ADMIN_ASSIGN_DENIED);
  }

  const held = isPlatformAdminActor(identity)
    ? jurisdictionStaffPermissions(identity)
    : actorPermissions;

  if (!hasAllPermissions(held, effective)) {
    throw new ForbiddenError("Cannot grant permissions beyond your own");
  }
  return effective;
}

export function assertTemplatePermissionsSubset(
  actorPermissions: Iterable<string> | null | undefined,
  permissions: string[],
  actorIdentity?: GrantActorIdentity | null
): Permission[] {
  const identity: GrantActorIdentity = {
    permissions: actorPermissions,
    preset: actorIdentity?.preset,
    membershipRole: actorIdentity?.membershipRole,
    orgId: actorIdentity?.orgId,
    storefrontOrgId: actorIdentity?.storefrontOrgId,
  };

  const jurisdiction = jurisdictionStaffPermissions(identity);
  const allowedSet = new Set(
    isPlatformAdminActor(identity)
      ? jurisdiction
      : jurisdiction.filter((p) => hasAllPermissions(actorPermissions, [p]))
  );

  const parsed = parsePermissionList(permissions).filter((p): p is Permission =>
    allowedSet.has(p)
  );

  if (parsed.length === 0) {
    throw new ForbiddenError(
      "Role template must include at least one permission"
    );
  }

  if (!isStorefrontHostGrantActor(identity)) {
    const opsOnly = new Set<string>(STOREFRONT_OPS_ONLY_PERMISSIONS);
    if (parsed.some((p) => opsOnly.has(p))) {
      throw new ForbiddenError(
        "Cannot grant permissions outside this company workspace"
      );
    }
  }

  if (!isPlatformAdminActor(identity) && isFullStaffPermissionSet(parsed)) {
    throw new ForbiddenError(PLATFORM_ADMIN_ASSIGN_DENIED);
  }

  const held = isPlatformAdminActor(identity)
    ? jurisdiction
    : actorPermissions;

  if (!hasAllPermissions(held, parsed)) {
    throw new ForbiddenError("Cannot grant permissions beyond your own");
  }
  return parsed;
}

export type RoleTemplateRow = {
  _id: unknown;
  orgId: unknown;
  name: string;
  description?: string | null;
  permissions?: string[] | null;
  createdBy?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

export async function loadOrgRoleTemplate(
  orgId: string,
  id: string
): Promise<RoleTemplateRow | null> {
  if (!isValidId(id)) return null;
  await dbConnect();
  const row = await prisma.roleTemplate.findFirst({
    where: {
      orgId: String(orgId),
      ...idWhere(id),
    },
  });
  if (!row) return null;
  return {
    _id: row.id,
    orgId: row.orgId,
    name: row.name,
    description: row.description,
    permissions: row.permissions,
    createdBy: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function assertRoleTemplateDeletable(
  orgId: string,
  templateId: string
): Promise<void> {
  await dbConnect();
  const tid = String(templateId);
  const inUse = await prisma.membership.count({
    where: {
      orgId: String(orgId),
      roleTemplateId: tid,
      // Part 9: block while assigned to active/invited/suspended (revoked OK).
      status: { in: ["active", "invited", "suspended"] },
    },
  });
  if (inUse > 0) {
    throw new ForbiddenError(ROLE_TEMPLATE_IN_USE_MESSAGE);
  }
}

/**
 * Clear sticky template pointers on revoked rows so RoleTemplate delete is not
 * blocked by Restrict FKs after Part 9 allows delete-while-only-revoked.
 */
export async function detachRevokedRoleTemplateAssignments(
  orgId: string,
  templateId: string
): Promise<number> {
  await dbConnect();
  const result = await prisma.membership.updateMany({
    where: {
      orgId: String(orgId),
      roleTemplateId: String(templateId),
      status: "revoked",
    },
    data: { roleTemplateId: null },
  });
  return result.count;
}

export function serializeRoleTemplate(row: {
  _id?: unknown;
  id?: unknown;
  orgId: unknown;
  name: string;
  description?: string | null;
  permissions?: string[] | null;
  createdBy?: unknown;
  createdById?: unknown;
  createdByName?: string | null;
  updatedBy?: unknown;
  updatedById?: unknown;
  updatedByName?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    _id: String(row._id ?? row.id),
    orgId: String(row.orgId),
    name: row.name,
    description: row.description?.trim() || "",
    permissions: parsePermissionList(row.permissions),
    createdBy: row.createdBy ?? row.createdById
      ? String(row.createdBy ?? row.createdById)
      : null,
    createdByName:
      typeof row.createdByName === "string" && row.createdByName.trim()
        ? row.createdByName.trim()
        : null,
    updatedBy: row.updatedBy ?? row.updatedById
      ? String(row.updatedBy ?? row.updatedById)
      : null,
    updatedByName:
      typeof row.updatedByName === "string" && row.updatedByName.trim()
        ? row.updatedByName.trim()
        : null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}
