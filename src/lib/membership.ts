/**
 * Membership resolution (Step 5.2) — Account → Organization via Membership.
 *
 * Primary membership policy (no org switcher):
 *   1. If `preferOrgId` is passed and an active Membership exists on that org,
 *      use it (company registration / sticky refresh from current access JWT).
 *   2. Else prefer any active **staff** Membership over client/tailor seats
 *      (stops silent refresh from demoting a company admin when a storefront
 *      client/tailor seat also exists).
 *   3. Else prefer active Membership on the storefront/default org.
 *   4. Else oldest active Membership by createdAt.
 * Stuck empty `custom` rows are skipped when another active Membership exists
 * (avoids empty JWT after refusing cross-org platform_admin auto-promote).
 * JWT carries that single orgId only. Members admin is always scoped to actor.orgId.
 *
 * Effective permissions = preset ∪ permissionsOverride (union), or
 * template ∪ override when a RoleTemplate is assigned.
 * Documented choice: overrides only add; they never strip preset grants.
 * Use rolePreset `custom` (empty preset) when the override should be the
 * entire staff set.
 *
 * Clients typically have no Membership row — JWT falls back to legacy
 * User.role → client preset. Staff User.role === "admin" without a row is
 * auto-bootstrapped onto the default org as platform_admin.
 * Invited/suspended/revoked membership on a registered company org does not
 * fall back to full admin via User.role. Bootstrap (default/storefront) admin
 * self-heal still applies for developer lockout recovery only.
 * Stuck empty `custom` on the default org is healed only via
 * `ensureAdminMembership` (bootstrap lockout recovery) — never by promoting
 * registered-company `custom` seats to platform_admin in `resolveAuthzForUser`.
 * Company Admin = platform_admin Membership (not an Organization.ownerUserId).
 * Step 6.1 admin APIs: /api/admin/members (list/invite/role/revoke).
 * Step 6.2 admin UI: /admin/users (gated by users:read; mutate via users:*).
 * Isolation / payments unchanged: Cart/Wishlist/Wallet stay user===sub;
 * PAYMENT_POLICY Stripe on / Paystack UI off / wallet API-only.
 */

import type { Membership } from "@prisma/client";
import prisma from "@/lib/prisma";
import { asIdString, requireId } from "@/lib/ids";
import { ensureFranchiseManagerCapabilityPermissions } from "@/lib/franchisePark";
import { getDefaultOrgId, getStorefrontOrgId } from "@/lib/org";
import {
  MEMBERSHIP_ROLE_PRESETS,
  type MembershipRolePreset,
} from "@/lib/membershipConstants";
import {
  expandRoleToPermissions,
  isRolePresetId,
  isStaffPreset,
  parsePermissionList,
  PRESET_TO_DB_ROLE,
  toAuthzClaims,
  toDbUserRole,
  uniquePermissions,
  resolveCompanyWideView,
  type AuthzClaims,
  type Permission,
  type RolePresetId,
} from "@/lib/auth/permissions";
import type { AccessTokenSubject } from "@/lib/auth/claims";

export function isMembershipRolePreset(
  value: string
): value is MembershipRolePreset {
  return (MEMBERSHIP_ROLE_PRESETS as readonly string[]).includes(value);
}

export { resolveCompanyWideView } from "@/lib/auth/permissions";

/**
 * preset ∪ override, or template ∪ override when templatePermissions provided.
 * Unknown override strings are dropped by parsePermissionList.
 * Invalid/missing rolePreset does not silently yield empty grants when a
 * fallback preset is supplied by membershipToAuthzClaims.
 */
export function effectiveMembershipPermissions(membership: {
  rolePreset: string;
  permissionsOverride?: string[] | null;
  templatePermissions?: string[] | null;
}): Permission[] {
  const templatePerms = parsePermissionList(membership.templatePermissions);
  if (templatePerms.length > 0) {
    const fromOverride = parsePermissionList(membership.permissionsOverride);
    return uniquePermissions([...templatePerms, ...fromOverride]);
  }
  const fromPreset = isMembershipRolePreset(membership.rolePreset)
    ? expandRoleToPermissions(membership.rolePreset)
    : isRolePresetId(membership.rolePreset)
      ? expandRoleToPermissions(membership.rolePreset)
      : [];
  const fromOverride = parsePermissionList(membership.permissionsOverride);
  return uniquePermissions([...fromPreset, ...fromOverride]);
}

/** Load template catalog permissions for a membership row (Step 8). */
export async function templatePermissionsForMembership(membership: {
  id?: unknown;
  _id?: unknown;
  orgId: unknown;
  roleTemplateId?: unknown | null;
}): Promise<Permission[]> {
  if (!membership.roleTemplateId) return [];
  const orgId = asIdString(membership.orgId);
  const templateId = asIdString(membership.roleTemplateId);
  if (!orgId || !templateId) return [];
  const { loadOrgRoleTemplate } = await import("@/lib/roleTemplateAdmin");
  // roleTemplateAdmin may still be typed for legacy ObjectId during migration.
  const row = await loadOrgRoleTemplate(orgId as never, templateId);
  if (!row) {
    // Self-heal sticky orphan pointer so stuck-empty detection and grants stay consistent.
    const membershipId = asIdString(membership.id ?? membership._id);
    if (membershipId) {
      await prisma.membership
        .updateMany({
          where: { id: membershipId, roleTemplateId: templateId },
          data: { roleTemplateId: null },
        })
        .catch(() => {});
    }
    return [];
  }
  return parsePermissionList(row.permissions);
}

function coerceOrgIdString(value: unknown): string | null {
  return asIdString(value);
}

function userIdFrom(user: { id?: unknown; _id?: unknown }): string {
  return requireId(user.id ?? user._id, "userId");
}

/**
 * Normalize Membership fields from a Prisma row (plain object).
 */
function membershipFields(membership: {
  id?: unknown;
  _id?: unknown;
  orgId?: unknown;
  rolePreset?: unknown;
  permissionsOverride?: string[] | null;
  roleTemplateId?: unknown | null;
  companyWideView?: boolean | null;
  franchiseParkManager?: boolean | null;
}) {
  return {
    id: membership.id ?? membership._id,
    orgId: membership.orgId,
    rolePreset:
      typeof membership.rolePreset === "string" ? membership.rolePreset : "",
    permissionsOverride: membership.permissionsOverride,
    roleTemplateId: membership.roleTemplateId ?? null,
    companyWideView:
      typeof membership.companyWideView === "boolean"
        ? membership.companyWideView
        : undefined,
    franchiseParkManager: membership.franchiseParkManager === true,
  };
}

export function membershipToAuthzClaims(
  membership: {
    orgId: unknown;
    rolePreset: string;
    permissionsOverride?: string[] | null;
    templatePermissions?: string[] | null;
    companyWideView?: boolean | null;
    /** When true, union durable FPM capability pack into effective grants. */
    franchiseParkManager?: boolean | null;
  },
  legacyRole?: string | null
): AuthzClaims {
  const rawPreset =
    typeof membership.rolePreset === "string" ? membership.rolePreset.trim() : "";
  // Keep preset claim and permission expansion in lockstep — never advertise
  // platform_admin while returning an empty permission list (UI/API desync).
  // Unknown / corrupt preset → fail closed to client (never invent Admin).
  const preset: RolePresetId = isRolePresetId(rawPreset)
    ? rawPreset
    : isMembershipRolePreset(rawPreset)
      ? (rawPreset as RolePresetId)
      : "client";
  const dbRole =
    PRESET_TO_DB_ROLE[preset] ?? toDbUserRole(legacyRole ?? "client");
  // Hardening: session grants include FPM pack even if DB override was granted
  // before users:invite|park_assign|manage_roles were auto-ensured on write.
  let override = membership.permissionsOverride;
  if (membership.franchiseParkManager === true && preset !== "platform_admin") {
    override = ensureFranchiseManagerCapabilityPermissions(
      Array.isArray(override) ? override : []
    );
  }
  const permissions = effectiveMembershipPermissions({
    rolePreset: preset,
    permissionsOverride: override,
    templatePermissions: membership.templatePermissions,
  });
  return {
    role: dbRole,
    preset,
    permissions,
    orgId: coerceOrgIdString(membership.orgId),
    membershipRole: rawPreset || preset,
    companyWideView: resolveCompanyWideView({
      companyWideView: membership.companyWideView,
      rolePreset: preset,
    }),
  };
}

export async function membershipToAuthzClaimsResolved(
  membership: {
    orgId: unknown;
    rolePreset: string;
    permissionsOverride?: string[] | null;
    roleTemplateId?: unknown | null;
    companyWideView?: boolean | null;
    franchiseParkManager?: boolean | null;
  },
  legacyRole?: string | null
): Promise<AuthzClaims> {
  const fields = membershipFields(membership);
  const templatePermissions = await templatePermissionsForMembership(fields);
  return membershipToAuthzClaims(
    {
      ...fields,
      templatePermissions,
      franchiseParkManager: membership.franchiseParkManager === true,
    },
    legacyRole
  );
}

export type ResolvePrimaryMembershipOptions = {
  /**
   * Prefer this org when the user has an active Membership there.
   * Used after company registration so the new org is primary without a switcher,
   * and on refresh/`/me` so the current access JWT org stays sticky (server-
   * attested cookie claims only — never a client body/query orgId).
   *
   * SECURITY: server-attested only. Never pass a client body/query `orgId` /
   * `preferOrgId` here — that would be an org-switcher / tenant-hop bypass.
   * Callers must derive this from the Organization just created, or from the
   * verified/decoded access JWT we issued, after verifying membership ownership.
   */
  preferOrgId?: string | null;
};

/**
 * Stuck empty `custom` (no template, no override) yields zero staff grants.
 * When the user has another active Membership, skip these rows so storefront-first
 * primary resolution cannot lock a registered company admin into an empty JWT
 * after we stopped auto-promoting that custom row to Harewa platform_admin.
 */
function isStuckEmptyCustomMembership(row: {
  rolePreset: string;
  permissionsOverride?: string[] | null;
  roleTemplateId?: string | null;
}): boolean {
  const overrideCount = Array.isArray(row.permissionsOverride)
    ? row.permissionsOverride.length
    : 0;
  return (
    row.rolePreset === "custom" &&
    overrideCount === 0 &&
    !row.roleTemplateId
  );
}

/** Active staff seat (platform_admin / ops / catalog / finance / custom). */
function isStaffMembershipRow(row: { rolePreset: string }): boolean {
  const raw =
    typeof row.rolePreset === "string" ? row.rolePreset.trim() : "";
  return isRolePresetId(raw) && isStaffPreset(raw);
}

/**
 * Prefer staff seats, then storefront/default org, else oldest active row.
 * With `preferOrgId`, that org wins when an active membership exists
 * (registration / sticky refresh from the current access JWT).
 * No multi-company switcher — JWT embeds one primary orgId only.
 *
 * Skips stuck empty `custom` rows when another active Membership exists so
 * multi-membership users keep a usable primary (company platform_admin, etc.).
 */
export async function resolvePrimaryMembership(
  userId: string,
  options?: ResolvePrimaryMembershipOptions
): Promise<Membership | null> {
  const uid = requireId(userId, "userId");
  const preferOrgId = asIdString(options?.preferOrgId);

  if (preferOrgId) {
    const preferred = await prisma.membership.findFirst({
      where: {
        userId: uid,
        orgId: preferOrgId,
        status: "active",
      },
    });
    if (preferred) return preferred;
  }

  const active = await prisma.membership.findMany({
    where: { userId: uid, status: "active" },
    orderBy: { createdAt: "asc" },
  });
  if (active.length === 0) return null;

  const usable =
    active.length === 1
      ? active
      : active.filter((row) => !isStuckEmptyCustomMembership(row));
  const pool = usable.length > 0 ? usable : active;

  // Staff seats outrank storefront client/tailor so silent refresh cannot
  // rewrite a company admin JWT to "client" and bounce /admin → /403.
  const staffPool = pool.filter(isStaffMembershipRow);
  const pickFrom = staffPool.length > 0 ? staffPool : pool;

  const storefrontOrgId = await getStorefrontOrgId();
  const onStorefront = pickFrom.find((row) => row.orgId === storefrontOrgId);
  if (onStorefront) return onStorefront;

  return pickFrom[0] ?? null;
}

/**
 * Ensure User.role === "admin" has an active platform_admin membership on
 * the default org. Idempotent. Clients are never given staff membership.
 * Also repairs stuck "custom" rows with zero grants (common cause of
 * dashboard 403s while User.role is still admin).
 *
 * Multi-company safety: if the user already has a Membership on another org
 * (any status — including revoked/suspended after soft-revoke), do NOT invent
 * a default-org membership. That would re-elevate via User.role=admin during
 * the sync window and steal primary JWT context via storefront-first resolve.
 */
export async function ensureAdminMembership(
  user: { id?: unknown; _id?: unknown; role?: string | null },
  invitedBy?: string | null
): Promise<Membership | null> {
  if (toDbUserRole(user.role) !== "admin") return null;

  const userId = userIdFrom(user);
  const orgId = await getDefaultOrgId();
  const invitedById = invitedBy ? asIdString(invitedBy) : null;

  const existing = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });

  if (existing) {
    // Do not auto-reactivate suspended/revoked/invited rows.
    if (existing.status !== "active") {
      return existing;
    }

    const overrideCount = Array.isArray(existing.permissionsOverride)
      ? existing.permissionsOverride.length
      : 0;
    const stuckEmptyCustom =
      existing.rolePreset === "custom" &&
      overrideCount === 0 &&
      !existing.roleTemplateId;

    if (stuckEmptyCustom) {
      // Only self-heal when this is the user's sole active membership.
      // Registered company admins (User.role=admin + other org Membership)
      // must not be silently promoted to Harewa platform_admin via a stuck
      // empty custom row on the default org.
      const otherActive = await prisma.membership.findFirst({
        where: {
          userId,
          status: "active",
          NOT: { id: existing.id },
        },
        select: { id: true },
      });
      if (otherActive) {
        return existing;
      }

      return prisma.membership.update({
        where: { id: existing.id },
        data: {
          rolePreset: "platform_admin",
          permissionsOverride: [],
          roleTemplateId: null,
          companyWideView: true,
        },
      });
    }

    return existing;
  }

  // Multi-company / revoke safety: any membership on another org (any status)
  // blocks inventing a default-org platform_admin. Soft-revoke leaves
  // User.role=admin briefly; must not elevate via storefront bootstrap on /me.
  // Ops recovery after a fully revoked company seat uses create-admin /
  // ensure-memberships / repair-admin / create-admin (those scripts also skip
  // any other-org Membership and do not reactivate revoked/suspended without
  // --force-reactivate).
  const otherOrgMembership = await prisma.membership.findFirst({
    where: {
      userId,
      NOT: { orgId },
    },
    select: { id: true },
  });
  if (otherOrgMembership) {
    return null;
  }

  return prisma.membership.create({
    data: {
      userId,
      orgId,
      rolePreset: "platform_admin",
      companyWideView: true,
      status: "active",
      invitedById,
    },
  });
}

/** Authz for tokens /me: membership first, else legacy User.role expansion. */
export async function resolveAuthzForUser(
  user: {
    id?: unknown;
    _id?: unknown;
    role?: string | null;
  },
  options?: ResolvePrimaryMembershipOptions
): Promise<AuthzClaims> {
  await ensureAdminMembership(user);
  const userId = userIdFrom(user);
  const isAdminUser = toDbUserRole(user.role) === "admin";

  const membership = await resolvePrimaryMembership(userId, options);
  if (membership) {
    // Persist FPM capability pack when DB override is stale (pre-hardening seats).
    // Only when park-locked — matches resolveEffectiveParkScope franchiseParkManager.
    if (
      membership.franchiseParkManager === true &&
      membership.rolePreset !== "platform_admin"
    ) {
      const assignmentCount = await prisma.membershipVenueAssignment.count({
        where: {
          membershipId: membership.id,
          orgId: membership.orgId,
          location: { status: "active", orgId: membership.orgId },
        },
      });
      if (assignmentCount > 0) {
        const healed = ensureFranchiseManagerCapabilityPermissions(
          membership.permissionsOverride
        );
        const current = parsePermissionList(membership.permissionsOverride);
        const needsWrite =
          healed.length !== current.length ||
          healed.some((p) => !current.includes(p));
        if (needsWrite) {
          await prisma.membership.update({
            where: { id: membership.id },
            data: { permissionsOverride: healed },
          });
          membership.permissionsOverride = healed;
        }
      }
    }

    let claims = await membershipToAuthzClaimsResolved(membership, user.role);

    // Admin accounts must never end up with zero staff grants (blank dashboard /
    // 403 on every /api/*). Repair only a corrupt *platform_admin* row —
    // never promote `custom` (incl. empty role templates) to platform_admin.
    // Company role-managers could otherwise mint empty templates, assign them
    // to a controlled User.role=admin seat, and escalate to billing/settings.
    if (isAdminUser && claims.permissions.length === 0) {
      if (membership.rolePreset === "platform_admin") {
        await prisma.membership.update({
          where: { id: membership.id },
          data: {
            rolePreset: "platform_admin",
            roleTemplateId: null,
            companyWideView: true,
            permissionsOverride: [],
            status: "active",
          },
        });
        claims = membershipToAuthzClaims(
          {
            orgId: membership.orgId,
            rolePreset: "platform_admin",
            permissionsOverride: null,
            templatePermissions: null,
            companyWideView: true,
          },
          user.role
        );
      }
    }

    // Staff claims without a usable orgId → stamp default org (never "undefined").
    if (isAdminUser && !claims.orgId) {
      const orgId =
        coerceOrgIdString(membership.orgId) ?? (await getDefaultOrgId());
      claims = { ...claims, orgId };
    }

    return claims;
  }

  // Inactive membership must not be bypassed by legacy User.role === "admin".
  // Check any org — storefront may differ from the bootstrap default org.
  // Prefer invited tailor rows: first login activates studio access (providers
  // are not staff; "invited" must not collapse them to bare client claims).
  const inactive = await prisma.membership.findFirst({
    where: {
      userId,
      status: { in: ["invited", "suspended", "revoked"] },
    },
    select: {
      id: true,
      status: true,
      orgId: true,
      rolePreset: true,
      permissionsOverride: true,
      roleTemplateId: true,
      companyWideView: true,
      inviteExpiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  if (inactive) {
    if (isAdminUser) {
      // Only self-heal bootstrap *invited* rows (never revoked/suspended —
      // soft-revoke must stay sticky even if User.role is still admin briefly).
      const defaultOrgId = await getDefaultOrgId();
      const storefrontOrgId = await getStorefrontOrgId();
      const bootstrapOrgIds = [...new Set([defaultOrgId, storefrontOrgId])];
      const bootstrapInactive = await prisma.membership.findFirst({
        where: {
          userId,
          status: "invited",
          orgId: { in: bootstrapOrgIds },
        },
        orderBy: { createdAt: "asc" },
      });

      if (bootstrapInactive) {
        await prisma.membership.update({
          where: { id: bootstrapInactive.id },
          data: {
            rolePreset: "platform_admin",
            status: "active",
            roleTemplateId: null,
            companyWideView: true,
            permissionsOverride: [],
            inviteExpiresAt: null,
          },
        });
        return membershipToAuthzClaims(
          {
            orgId: bootstrapInactive.orgId,
            rolePreset: "platform_admin",
            permissionsOverride: null,
            templatePermissions: null,
            companyWideView: true,
          },
          user.role
        );
      }

      // Revoked/suspended (any org) or non-bootstrap invited: fail closed.
      return toAuthzClaims("client");
    }

    const inactivePreset =
      typeof inactive.rolePreset === "string" ? inactive.rolePreset.trim() : "";
    if (
      inactive.status === "invited" &&
      isMembershipRolePreset(inactivePreset) &&
      inactivePreset === "tailor"
    ) {
      const { assertMembershipInviteNotExpired } = await import(
        "@/lib/membershipInvites"
      );
      try {
        await assertMembershipInviteNotExpired(inactive);
      } catch {
        // Overdue invite revoked — do not activate studio access.
        return toAuthzClaims("client");
      }
      const activated = await prisma.membership.update({
        where: { id: inactive.id },
        data: { status: "active", inviteExpiresAt: null },
      });
      return membershipToAuthzClaimsResolved(activated, user.role);
    }

    return toAuthzClaims("client");
  }

  const legacy = toAuthzClaims(user.role);
  // Legacy admin path (no Membership row yet) still needs an orgId for staff APIs.
  if (isAdminUser && !legacy.orgId) {
    return { ...legacy, orgId: await getDefaultOrgId() };
  }
  return legacy;
}

/** All memberships for a user (active + other statuses). Used by /me. */
export async function listMembershipsForUser(userId: string) {
  const uid = requireId(userId, "userId");
  const rows = await prisma.membership.findMany({
    where: { userId: uid },
    select: {
      id: true,
      orgId: true,
      rolePreset: true,
      roleTemplateId: true,
      status: true,
      permissionsOverride: true,
      companyWideView: true,
      invitedById: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    _id: row.id,
    orgId: row.orgId,
    rolePreset: row.rolePreset,
    roleTemplateId: row.roleTemplateId,
    status: row.status,
    permissionsOverride: row.permissionsOverride,
    companyWideView: row.companyWideView,
    invitedBy: row.invitedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/** Subject fields for signAccessToken after membership resolve. */
export async function accessTokenSubjectFromUser(
  user: {
    id?: unknown;
    _id?: unknown;
    email: string;
    role?: string | null;
    authzVersion?: number | null;
  },
  options?: ResolvePrimaryMembershipOptions
): Promise<AccessTokenSubject> {
  const authz = await resolveAuthzForUser(user, options);
  return {
    id: userIdFrom(user),
    email: user.email,
    role: authz.role,
    permissions: authz.permissions,
    orgId: authz.orgId,
    membershipRole: authz.membershipRole,
    preset: authz.preset,
    companyWideView: authz.companyWideView,
    authzVersion:
      typeof user.authzVersion === "number" ? user.authzVersion : 0,
  };
}

/** Reload membership perms when the JWT may be stale (mutating admin paths). */
export async function refreshAuthzFromMembership(actor: {
  sub: string;
  role?: string | null;
  email?: string;
  /** Sticky primary org from the current access JWT (server-attested). */
  orgId?: string | null;
}): Promise<AuthzClaims & { authzVersion: number; userMissing?: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: actor.sub },
    select: { id: true, email: true, role: true, authzVersion: true },
  });
  if (!user) {
    return {
      ...toAuthzClaims(actor.role),
      authzVersion: 0,
      userMissing: true,
    };
  }
  const claims = await resolveAuthzForUser(user, {
    preferOrgId: actor.orgId,
  });
  return {
    ...claims,
    authzVersion: user.authzVersion ?? 0,
    userMissing: false,
  };
}
