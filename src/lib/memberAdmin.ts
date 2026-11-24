/**
 * Org membership admin (Step 6.1 APIs + Step 6.2 /admin/users UI).
 */

import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { idWhere, isValidId, asIdString } from "@/lib/ids";
import { logActivityEntry } from "@/lib/audit/activityLog";
import type { NextRequest } from "next/server";
import type { Membership } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  MEMBERSHIP_STATUSES,
  type MembershipRolePreset,
  type MembershipStatus,
} from "@/lib/membershipConstants";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  PRESET_TO_DB_ROLE,
  hasPermission,
  isStaffPreset,
  parsePermissionList,
  resolveCompanyWideView,
  toDbUserRole,
  type Permission,
  P,
} from "@/lib/auth/permissions";
import {
  effectiveMembershipPermissions,
  isMembershipRolePreset,
} from "@/lib/membership";
import { ensureFranchiseManagerCapabilityPermissions } from "@/lib/franchisePark";
import {
  assertAssignableGrantsExtended,
  loadOrgRoleTemplate,
} from "@/lib/roleTemplateAdmin";
import { blacklistIdentifiersFromDeletedUser } from "@/lib/userBlacklist";

export const LAST_PLATFORM_ADMIN_MESSAGE =
  "Cannot remove or demote the last platform_admin in this organization";
export const ESCALATION_DENIED_MESSAGE =
  "Cannot grant permissions beyond your own";
export const MEMBER_NOT_FOUND_MESSAGE = "Membership not found";
export const CANNOT_DELETE_SELF_MESSAGE =
  "You cannot permanently delete your own account from here";
export const USER_HAS_OTHER_ORGS_MESSAGE =
  "This user still belongs to another organization. Revoke this membership instead of deleting the account.";
export const USER_HAS_DEPENDENT_DATA_MESSAGE =
  "Cannot permanently delete this account because it still has storefront or studio history (orders, reviews, jobs, chats, or customizations). Revoke the membership instead.";

/** Customer self-delete — same Restrict gate, without admin "revoke instead" copy. */
export const USER_HAS_DEPENDENT_DATA_SELF_MESSAGE =
  "Cannot delete your account while storefront or studio history still exists (orders, reviews, jobs, or customizations). Contact support if you need help.";

/**
 * Preflight Restrict FKs (Order, Review, Customization, …) before any
 * irreversible purge. Shared by admin hard-delete and DELETE /api/auth/me.
 */
export async function assertUserHasNoRestrictDependents(
  userId: string,
  message: string = USER_HAS_DEPENDENT_DATA_MESSAGE
): Promise<void> {
  await dbConnect();
  const id = String(userId);
  const [
    orderCount,
    reviewCount,
    customizationCount,
    customRequestCount,
    jobCount,
    tailorReviewCount,
    shopCount,
  ] = await Promise.all([
    prisma.order.count({ where: { userId: id } }),
    prisma.review.count({ where: { userId: id } }),
    prisma.customization.count({ where: { userId: id } }),
    prisma.customRequest.count({ where: { userId: id } }),
    prisma.tailoringJob.count({ where: { customerId: id } }),
    prisma.tailorReview.count({ where: { userId: id } }),
    prisma.shop.count({ where: { ownerId: id } }),
  ]);
  if (
    orderCount +
      reviewCount +
      customizationCount +
      customRequestCount +
      jobCount +
      tailorReviewCount +
      shopCount >
    0
  ) {
    throw new ForbiddenError(message);
  }
}

/**
 * Null optional FKs that default to Restrict so User delete cannot orphan or
 * fail mid-purge. Must run inside the same transaction as the user delete.
 */
export async function detachUserReferencesForDelete(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  const id = String(userId);
  await tx.membership.updateMany({
    where: { invitedById: id },
    data: { invitedById: null },
  });
  await tx.membership.updateMany({
    where: { updatedById: id },
    data: { updatedById: null, updatedByName: null },
  });
  await tx.roleTemplate.updateMany({
    where: { createdById: id },
    data: { createdById: null, createdByName: null },
  });
  await tx.roleTemplate.updateMany({
    where: { updatedById: id },
    data: { updatedById: null, updatedByName: null },
  });
  await tx.activityLog.updateMany({
    where: { userId: id },
    data: { userId: null },
  });
  await tx.fashionChat.updateMany({
    where: { userId: id },
    data: { userId: null },
  });
  await tx.fashionChatMessage.updateMany({
    where: { staffUserId: id },
    data: { staffUserId: null },
  });
}

/** Live seats elsewhere block invite/reactivate (no org switcher). */
export const ORG_DUAL_SEAT_LIVE_MESSAGE =
  "User already has a live membership in another organization. Revoke that seat before inviting or reactivating them here (no org switcher).";

/**
 * Active or invited Membership on another org (revoked/suspended do not block —
 * ops may move a user after soft-revoke; reactivation is gated separately).
 */
export async function findLiveOtherOrgMembership(
  userId: string,
  excludeOrgId: string
): Promise<{ id: string; orgId: string; status: string } | null> {
  const uid = asIdString(userId);
  const oid = asIdString(excludeOrgId);
  if (!uid || !oid) return null;
  const row = await prisma.membership.findFirst({
    where: {
      userId: uid,
      NOT: { orgId: oid },
      status: { in: ["active", "invited"] },
    },
    select: { id: true, orgId: true, status: true },
  });
  return row;
}
export type MemberActor = {
  sub: string;
  orgId?: string | null;
  storefrontOrgId?: string | null;
  permissions?: Iterable<string> | null;
  preset?: string | null;
  membershipRole?: string | null;
};

export { MEMBERSHIP_STATUSES };
export type { MembershipStatus, MembershipRolePreset };

export function isMembershipStatus(value: string): value is MembershipStatus {
  return (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

/** Target effective perms must be ⊆ actor grants (Step 1.1 catalog strings only). */
export function assertAssignableGrants(
  actor: MemberActor | Iterable<string> | null | undefined,
  rolePreset: MembershipRolePreset,
  permissionsOverride?: string[] | null,
  templatePermissions?: string[] | null
): Permission[] {
  if (
    actor &&
    typeof actor === "object" &&
    !Array.isArray(actor) &&
    "sub" in actor
  ) {
    return assertAssignableGrantsExtended(
      actor.permissions,
      {
        rolePreset,
        permissionsOverride,
        templatePermissions,
      },
      {
        preset: actor.preset,
        membershipRole: actor.membershipRole,
        permissions: actor.permissions,
        orgId: actor.orgId,
        storefrontOrgId: actor.storefrontOrgId,
      }
    );
  }
  return assertAssignableGrantsExtended(actor as Iterable<string> | null, {
    rolePreset,
    permissionsOverride,
    templatePermissions,
  });
}

export function assertMembershipMutationGrants(
  actor: MemberActor | Iterable<string> | null | undefined,
  rolePreset: MembershipRolePreset,
  permissionsOverride: string[] | null | undefined,
  options: {
    status: MembershipStatus;
    roleOrOverrideChanging: boolean;
    templatePermissions?: string[] | null;
  }
): void {
  // Always enforce grant ⊆ actor on the grants that will remain on the row
  // (including status-only edits that leave elevated invites/suspensions intact).
  assertAssignableGrants(
    actor,
    rolePreset,
    permissionsOverride,
    options.templatePermissions
  );
}

/** Persist override list; empty clears the field. */
export function applyPermissionsOverride(
  membership: { permissionsOverride?: string[] | null },
  override: Permission[] | undefined
): void {
  if (override === undefined) return;
  membership.permissionsOverride = override.length > 0 ? override : [];
}

export function assertInviteStatusAllowed(
  actorPermissions: Iterable<string> | null | undefined,
  status: MembershipStatus
): void {
  const canManage = hasPermission(actorPermissions, P.UsersManageRoles);
  const canInvite = hasPermission(actorPermissions, P.UsersInvite);
  if (status === "active" || status === "suspended") {
    if (!canManage) {
      throw new ForbiddenError("Missing required permission");
    }
    return;
  }
  if (status === "invited") {
    if (!canInvite && !canManage) {
      throw new ForbiddenError("Missing required permission");
    }
    return;
  }
  if (!canManage) {
    throw new ForbiddenError("Missing required permission");
  }
}

export async function countActivePlatformAdmins(
  orgId: string,
  excludeMembershipId?: string | null
): Promise<number> {
  await dbConnect();
  const where: Prisma.MembershipWhereInput = {
    orgId: String(orgId),
    rolePreset: "platform_admin",
    status: "active",
  };
  if (excludeMembershipId) {
    where.NOT = { ...idWhere(String(excludeMembershipId)) };
  }
  return prisma.membership.count({ where });
}

export async function assertNotLastPlatformAdmin(
  membership: {
    _id?: unknown;
    id?: unknown;
    orgId: unknown;
    rolePreset: string;
    status: string;
  },
  next: { rolePreset?: string; status?: string }
): Promise<void> {
  const wasActiveAdmin =
    membership.rolePreset === "platform_admin" &&
    membership.status === "active";
  if (!wasActiveAdmin) return;

  const nextPreset = next.rolePreset ?? membership.rolePreset;
  const nextStatus = next.status ?? membership.status;
  const stillActiveAdmin =
    nextPreset === "platform_admin" && nextStatus === "active";
  if (stillActiveAdmin) return;

  const remaining = await countActivePlatformAdmins(
    String(membership.orgId),
    String(membership._id ?? membership.id)
  );
  if (remaining < 1) {
    throw new ForbiddenError(LAST_PLATFORM_ADMIN_MESSAGE);
  }
}

/**
 * Update membership and enforce last-platform_admin inside one Serializable
 * transaction so concurrent demotions cannot leave an org with zero admins.
 */
export async function updateMembershipGuardingLastAdmin(input: {
  membership: {
    id: string;
    orgId: string;
    rolePreset: string;
    status: string;
  };
  next: { rolePreset?: string; status?: string };
  data: Prisma.MembershipUncheckedUpdateInput;
}): Promise<Membership> {
  const wasActiveAdmin =
    input.membership.rolePreset === "platform_admin" &&
    input.membership.status === "active";
  const nextPreset = input.next.rolePreset ?? input.membership.rolePreset;
  const nextStatus = input.next.status ?? input.membership.status;
  const stillActiveAdmin =
    nextPreset === "platform_admin" && nextStatus === "active";

  return prisma.$transaction(
    async (tx) => {
      if (wasActiveAdmin && !stillActiveAdmin) {
        const remaining = await tx.membership.count({
          where: {
            orgId: input.membership.orgId,
            rolePreset: "platform_admin",
            status: "active",
            id: { not: input.membership.id },
          },
        });
        if (remaining < 1) {
          throw new ForbiddenError(LAST_PLATFORM_ADMIN_MESSAGE);
        }
      }
      const updated = await tx.membership.update({
        where: { id: input.membership.id },
        data: input.data,
      });
      // platform_admin is always company-wide — drop leftover park rows so
      // roster/DTO assignedLocationIds cannot disagree with effective scope.
      if (nextPreset === "platform_admin") {
        await tx.membershipVenueAssignment.deleteMany({
          where: { membershipId: input.membership.id },
        });
      }
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function hardDeleteOrgMemberUser(input: {
  membership: {
    _id?: unknown;
    id?: unknown;
    orgId: unknown;
    userId: unknown;
    rolePreset: string;
    status: string;
  };
  actorSub: string;
  blacklist?: boolean;
}): Promise<{
  userId: string;
  email: string | null;
  phone: string | null;
  blacklisted: { emails: number; phones: number };
}> {
  await dbConnect();
  const userId = String(input.membership.userId);
  if (!userId || userId === String(input.actorSub)) {
    throw new ForbiddenError(CANNOT_DELETE_SELF_MESSAGE);
  }

  const user = await prisma.user.findFirst({
    where: idWhere(userId),
    select: { id: true, email: true, phoneNumber: true },
  });
  if (!user) {
    throw new ForbiddenError(MEMBER_NOT_FOUND_MESSAGE);
  }

  const otherOrgMemberships = await prisma.membership.count({
    where: {
      userId: user.id,
      orgId: { not: String(input.membership.orgId) },
    },
  });
  if (otherOrgMemberships > 0) {
    throw new ForbiddenError(USER_HAS_OTHER_ORGS_MESSAGE);
  }

  // Preflight Restrict FKs before session invalidate / tailor purge so we never
  // leave a half-deleted account (tailor domain gone, user row still present).
  await assertUserHasNoRestrictDependents(user.id);

  const email =
    typeof user.email === "string" && user.email.trim()
      ? user.email.trim()
      : null;
  const phone =
    typeof user.phoneNumber === "string" && user.phoneNumber.trim()
      ? user.phoneNumber.trim()
      : null;

  const membershipId = String(
    input.membership.id ?? input.membership._id ?? ""
  );
  const orgId = String(input.membership.orgId);
  const wasActiveAdmin =
    input.membership.rolePreset === "platform_admin" &&
    input.membership.status === "active";

  // Fail closed on last-admin BEFORE irreversible side effects.
  if (wasActiveAdmin) {
    const remaining = await countActivePlatformAdmins(orgId, membershipId);
    if (remaining < 1) {
      throw new ForbiddenError(LAST_PLATFORM_ADMIN_MESSAGE);
    }
  }

  // Last-admin recheck, then tailor purge + user graph in one Serializable tx
  // so a concurrent demotion cannot destroy tailor data after we abort.
  // Invalidate sessions only AFTER successful purge so a failed tx does not
  // lock the user out while the account still exists.
  const { deleteTailorDomainForUser } = await import("@/lib/tailors");
  await prisma.$transaction(
    async (tx) => {
      if (wasActiveAdmin) {
        const remaining = await tx.membership.count({
          where: {
            orgId,
            rolePreset: "platform_admin",
            status: "active",
            ...(membershipId ? { id: { not: membershipId } } : {}),
          },
        });
        if (remaining < 1) {
          throw new ForbiddenError(LAST_PLATFORM_ADMIN_MESSAGE);
        }
      }
      await detachUserReferencesForDelete(tx, user.id);
      // TailorProfile.userId has no onDelete Cascade — purge inside the same tx.
      await deleteTailorDomainForUser(user.id, tx);
      await tx.profile.deleteMany({ where: { userId: user.id } });
      await tx.wallet.deleteMany({ where: { userId: user.id } });
      await tx.membership.deleteMany({ where: { userId: user.id } });
      await tx.user.delete({ where: { id: user.id } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  // User row is gone — session invalidate is unnecessary (refresh fails on
  // missing user). Actor cookies are unchanged (admin deleted someone else).

  // Blacklist only after successful purge. Best-effort per org so a partial
  // blacklist failure does not turn a completed delete into a 500.
  let blacklisted = { emails: 0, phones: 0 };
  if (input.blacklist !== false) {
    const { stampCreate } = await import("@/lib/audit/recordAudit");
    const audit = await stampCreate(input.actorSub);
    const { getStorefrontOrgId } = await import("@/lib/org");
    const storefrontOrgId = await getStorefrontOrgId();
    const orgIds = [...new Set([orgId, String(storefrontOrgId)].filter(Boolean))];
    for (const blacklistOrgId of orgIds) {
      try {
        const part = await blacklistIdentifiersFromDeletedUser({
          orgId: blacklistOrgId,
          email,
          phone,
          actorSub: input.actorSub,
          audit,
        });
        blacklisted.emails += part.emails;
        blacklisted.phones += part.phones;
      } catch (blacklistErr) {
        console.error(
          "[hardDelete] blacklist after purge failed for org",
          blacklistOrgId,
          blacklistErr
        );
      }
    }
    if (blacklisted.emails + blacklisted.phones > 0) {
      logActivityEntry({
        actorSub: input.actorSub,
        orgId: asIdString(orgId),
        action: "Blacklist After Hard Delete",
        entityType: "Blacklist",
        description: `Auto-blacklisted after account delete (${blacklisted.emails} email, ${blacklisted.phones} phone)`,
        metadata: { ...blacklisted, orgIds },
      });
    }
  }

  return { userId: user.id, email, phone, blacklisted };
}

const REFRESH_REVOKED_PREFIX = "revoked:";

export function isRefreshSessionRevoked(
  refreshTokenJTI: string | null | undefined
): boolean {
  return (
    typeof refreshTokenJTI === "string" &&
    refreshTokenJTI.startsWith(REFRESH_REVOKED_PREFIX)
  );
}

export async function invalidateUserSessions(userId: string): Promise<number> {
  await dbConnect();
  const id = String(userId);
  const user = await prisma.user.findFirst({
    where: idWhere(id),
    select: { id: true },
  });
  if (!user) return 0;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      authzVersion: { increment: 1 },
      refreshTokenJTI: `${REFRESH_REVOKED_PREFIX}${crypto.randomUUID()}`,
    },
    select: { authzVersion: true },
  });
  return typeof updated.authzVersion === "number" ? updated.authzVersion : 0;
}

/** Bump authz for every member assigned to a role template in this org. */
export async function invalidateSessionsForRoleTemplateAssignees(
  orgId: string,
  roleTemplateId: string
): Promise<string[]> {
  await dbConnect();
  const rows = await prisma.membership.findMany({
    where: { orgId: String(orgId), roleTemplateId: String(roleTemplateId) },
    select: { userId: true },
  });
  const seen = new Set<string>();
  const userIds: string[] = [];
  for (const row of rows) {
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    userIds.push(row.userId);
    await invalidateUserSessions(row.userId);
  }
  return userIds;
}

export async function invalidateSessionsForIdentifiers(identifiers: {
  email?: string | null;
  phone?: string | null;
}): Promise<number> {
  await dbConnect();
  const email =
    typeof identifiers.email === "string"
      ? identifiers.email.trim().toLowerCase()
      : "";
  const phoneDigits =
    typeof identifiers.phone === "string"
      ? identifiers.phone.replace(/\D/g, "")
      : "";

  const ids = new Set<string>();

  if (email) {
    const byEmail = await prisma.user.findMany({
      where: { email },
      select: { id: true },
    });
    for (const row of byEmail) ids.add(row.id);
  }

  if (phoneDigits.length >= 7) {
    const candidates = await prisma.user.findMany({
      where: { phoneNumber: { not: null } },
      select: { id: true, phoneNumber: true },
    });
    for (const row of candidates) {
      const digits = String(row.phoneNumber || "").replace(/\D/g, "");
      if (digits === phoneDigits) ids.add(row.id);
    }
  }

  let count = 0;
  for (const id of ids) {
    await invalidateUserSessions(id);
    count += 1;
  }
  return count;
}

export async function syncUserRoleFromMemberships(userId: string): Promise<void> {
  await dbConnect();
  const uid = String(userId);
  const user = await prisma.user.findFirst({
    where: idWhere(uid),
    select: { id: true },
  });
  if (!user) return;

  const active = await prisma.membership.findMany({
    where: { userId: user.id, status: "active" },
    select: { rolePreset: true },
  });

  const staff = active.some(
    (row) =>
      isMembershipRolePreset(row.rolePreset) &&
      isStaffPreset(row.rolePreset)
  );

  if (staff) {
    const preferred =
      active.find((row) => row.rolePreset === "platform_admin")?.rolePreset ??
      active[0]?.rolePreset;
    const dbRole =
      preferred && isMembershipRolePreset(preferred)
        ? PRESET_TO_DB_ROLE[preferred]
        : "admin";
    await prisma.user.update({
      where: { id: user.id },
      data: { role: dbRole },
    });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { role: "client" },
  });
}

export async function logMembershipActivity(input: {
  actorSub: string;
  orgId?: string | null;
  action: string;
  membershipId: unknown;
  targetUserId: unknown;
  description: string;
  request?: NextRequest;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  logActivityEntry({
    actorSub: input.actorSub,
    orgId: input.orgId ?? null,
    action: input.action,
    entityType: "Membership",
    entityId: input.targetUserId ? String(input.targetUserId) : null,
    description: input.description.slice(0, 500),
    request: input.request,
    metadata: {
      membershipId: String(input.membershipId),
      domain: "membership",
      orgId: input.orgId ?? null,
      ...input.metadata,
    },
  });
}

export function serializeMembership(
  row: {
    _id?: unknown;
    id?: unknown;
    userId: unknown;
    orgId: unknown;
    rolePreset: string;
    roleTemplateId?: unknown | null;
    permissionsOverride?: string[] | null;
    companyWideView?: boolean | null;
    franchiseParkManager?: boolean | null;
    /** Enterprise HQ location preference (null = All locations). */
    hqSelectedLocationId?: string | null;
    status: string;
    inviteExpiresAt?: Date | null;
    invitedBy?: unknown;
    invitedById?: unknown;
    updatedBy?: unknown;
    updatedById?: unknown;
    updatedByName?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
  },
  user?: {
    _id?: unknown;
    id?: unknown;
    email?: string;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    role?: string | null;
    lastLoginAt?: Date | string | null;
    lastLogoutAt?: Date | string | null;
    lastLoginIp?: string | null;
  } | null,
  roleTemplate?: {
    _id: unknown;
    name: string;
    permissions?: string[] | null;
  } | null,
  /**
   * Workspace export only. Do not expose HQ location preference on members
   * list/detail or /me — that preference is Membership-private and mutable
   * only via /api/admin/hq/location-context for the actor's own seat.
   */
  options?: {
    includeHqLocationPreference?: boolean;
    assignedLocationIds?: string[];
  }
) {
  const assignedLocationIds = Array.isArray(options?.assignedLocationIds)
    ? options!.assignedLocationIds.filter(
        (id): id is string => typeof id === "string" && Boolean(id)
      )
    : undefined;
  const parkLocked =
    assignedLocationIds != null &&
    assignedLocationIds.length > 0 &&
    row.rolePreset !== "platform_admin";
  const franchiseParkManager =
    row.franchiseParkManager === true &&
    parkLocked === true &&
    row.rolePreset !== "platform_admin";
  // Heal FPM capability pack in serialized overrides (session/list honesty).
  let override = parsePermissionList(row.permissionsOverride);
  if (franchiseParkManager) {
    override = ensureFranchiseManagerCapabilityPermissions(override);
  }
  const templatePermissions = roleTemplate
    ? parsePermissionList(roleTemplate.permissions)
    : null;
  const permissions = effectiveMembershipPermissions({
    rolePreset: row.rolePreset,
    permissionsOverride: override,
    templatePermissions,
  });
  const companyWideView = resolveCompanyWideView({
    companyWideView: row.companyWideView,
    rolePreset: row.rolePreset,
  });
  const invitedBy = row.invitedBy ?? row.invitedById;
  const updatedBy = row.updatedBy ?? row.updatedById;
  return {
    _id: String(row._id ?? row.id),
    userId: String(row.userId),
    orgId: String(row.orgId),
    rolePreset: row.rolePreset,
    roleTemplateId: row.roleTemplateId ? String(row.roleTemplateId) : null,
    roleTemplate: roleTemplate
      ? {
          _id: String(roleTemplate._id),
          name: roleTemplate.name,
          permissions: templatePermissions ?? [],
        }
      : null,
    permissionsOverride: override,
    permissions,
    companyWideView,
    franchiseParkManager,
    ...(assignedLocationIds != null
      ? {
          assignedLocationIds,
          // Align with resolveEffectiveParkScope: one+ assignments lock
          // (CWV does not expand). Zero assignments = not park-locked.
          parkLocked,
        }
      : {}),
    ...(options?.includeHqLocationPreference
      ? {
          hqSelectedLocationId: row.hqSelectedLocationId
            ? String(row.hqSelectedLocationId)
            : null,
        }
      : {}),
    status: row.status,
    inviteExpiresAt: row.inviteExpiresAt
      ? row.inviteExpiresAt.toISOString()
      : null,
    invitedBy: invitedBy ? String(invitedBy) : null,
    updatedBy: updatedBy ? String(updatedBy) : null,
    updatedByName:
      typeof row.updatedByName === "string" && row.updatedByName.trim()
        ? row.updatedByName.trim()
        : null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    user: user
      ? {
          _id: String(user._id ?? user.id ?? row.userId),
          email: user.email ?? "",
          username: user.username ?? null,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          role: user.role != null ? toDbUserRole(String(user.role)) : null,
          lastLoginAt: user.lastLoginAt ?? null,
          lastLogoutAt: user.lastLogoutAt ?? null,
          lastLoginIp: user.lastLoginIp ?? null,
        }
      : null,
  };
}

export async function loadMembershipAssignedLocationIds(
  membershipId: string,
  orgId: string
): Promise<string[]> {
  if (!isValidId(membershipId) || !isValidId(orgId)) return [];
  const rows = await prisma.membershipVenueAssignment.findMany({
    where: {
      membershipId: String(membershipId),
      orgId: String(orgId),
      location: { status: "active", orgId: String(orgId) },
    },
    select: { locationId: true },
  });
  return rows.map((r) => r.locationId);
}

export async function serializeMembershipWithTemplate(
  row: Parameters<typeof serializeMembership>[0],
  user?: Parameters<typeof serializeMembership>[1]
) {
  let roleTemplate: Parameters<typeof serializeMembership>[2] = null;
  let normalized = row;
  if (row.roleTemplateId) {
    const loaded = await loadOrgRoleTemplate(
      String(row.orgId),
      String(row.roleTemplateId)
    );
    if (loaded) {
      roleTemplate = {
        _id: loaded._id,
        name: loaded.name,
        permissions: loaded.permissions,
      };
    } else {
      const membershipId = String(row.id ?? row._id ?? "");
      if (membershipId) {
        await prisma.membership
          .updateMany({
            where: {
              id: membershipId,
              roleTemplateId: String(row.roleTemplateId),
            },
            data: { roleTemplateId: null },
          })
          .catch(() => {});
      }
      normalized = { ...row, roleTemplateId: null };
    }
  }
  const membershipId = String(normalized.id ?? normalized._id ?? "");
  const assignedLocationIds = membershipId
    ? await loadMembershipAssignedLocationIds(
        membershipId,
        String(normalized.orgId)
      )
    : [];
  return serializeMembership(normalized, user, roleTemplate, {
    assignedLocationIds,
  });
}

export async function loadOrgMembership(
  orgId: string,
  membershipId: string
): Promise<Membership | null> {
  if (!isValidId(membershipId)) return null;
  await dbConnect();
  return prisma.membership.findFirst({
    where: {
      orgId: String(orgId),
      ...idWhere(membershipId),
    },
  });
}

export async function notifyMembershipInvite(input: {
  to: string;
  rolePreset: string;
  orgId: string;
  invitedBySub: string;
  inviteExpiresAt?: Date | null;
}): Promise<void> {
  try {
    const { sendMembershipInviteEmail } = await import("@/lib/mailer");
    const { membershipInviteTtlDays } = await import("@/lib/membershipInvites");
    const org = await prisma.organization.findFirst({
      where: idWhere(String(input.orgId)),
      select: { name: true },
    });
    const inviter = await prisma.user.findFirst({
      where: idWhere(input.invitedBySub),
      select: { email: true },
    });
    await sendMembershipInviteEmail({
      to: input.to,
      rolePreset: input.rolePreset,
      orgName: org?.name ? String(org.name) : undefined,
      invitedByEmail: inviter?.email ? String(inviter.email) : undefined,
      orgId: input.orgId,
      inviteExpiresAt: input.inviteExpiresAt ?? null,
      inviteTtlDays: membershipInviteTtlDays(),
    });
  } catch (mailErr) {
    console.error("[memberAdmin] invite email failed:", mailErr);
  }
}
