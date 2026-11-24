/**
 * Pure JWT claim builders for access tokens.
 *
 * RBAC: Membership (Step 5.2) supplies orgId + permissions when present
 * (effective = preset ∪ permissionsOverride). Fallback: expand from User.role
 * via the Step 1.1 catalog (legacy).
 * Isolation: document.user === JWT `sub` for Cart/Wishlist/Wallet/etc.
 * Tenancy: Organization is the tenant root. JWT orgId is the primary
 * Membership.orgId for staff; clients without membership keep orgId null
 * (storefront catalog still uses DEFAULT_ORG_ID).
 * Payments: client tokens get payments:checkout_own + orders:create_own;
 * staff (platform_admin) get payments:read, tax:manage, wallet:read.
 * Checkout method (Stripe on / Paystack UI off / wallet API-only) lives in
 * PAYMENT_POLICY, not in the JWT.
 *
 * Token size: embed catalog permissions on the 15m access token.
 * Fallback: if STAFF_PERMISSIONS.length exceeds JWT_EMBED_PERMISSIONS_MAX,
 * omit `permissions` at sign time; verify expands from `role` / membershipRole.
 * Refresh tokens never carry permissions.
 * Step 6.1: `av` = User.authzVersion. Membership role changes bump authzVersion
 * and clear refreshTokenJTI. Fresh guards reject mismatched `av` with 401
 * (“Session outdated; sign in again”) and reload Membership when av matches.
 */

import type { JwtAccessTokenPayload } from "@/lib/types/auth";
import {
  PLATFORM,
  expandRoleToPermissions,
  hasPermission,
  isRolePresetId,
  isStaffPreset,
  parsePermissionList,
  PERMISSIONS,
  toAuthzClaims,
  resolveCompanyWideView,
  type AuthzClaims,
  type Permission,
  type RolePresetId,
} from "@/lib/auth/permissions";

/** Above this catalog size, stop embedding and expand on verify instead. */
export const JWT_EMBED_PERMISSIONS_MAX = 64;

export function shouldEmbedPermissionsInAccessToken(): boolean {
  return PERMISSIONS.length <= JWT_EMBED_PERMISSIONS_MAX;
}

export type AccessTokenSubject = {
  id: string;
  email: string;
  role?: string | null;
  /** When set (from Membership resolve), embedded on the token. */
  permissions?: readonly string[] | null;
  /** Primary Membership.orgId, or null for legacy client sessions. */
  orgId?: string | null;
  /** Membership.rolePreset when a membership exists. */
  membershipRole?: string | null;
  /** Catalog preset id (may match membershipRole). */
  preset?: string | null;
  /** Membership.companyWideView — omitted treated as true when signing legacy. */
  companyWideView?: boolean | null;
  /** User.authzVersion at sign time (Step 6.1 session invalidation). */
  authzVersion?: number | null;
};

export type NormalizedAccessToken = Omit<JwtAccessTokenPayload, "av"> & {
  role: string;
  permissions: Permission[];
  orgId: string | null;
  membershipRole: string | null;
  preset: RolePresetId;
  companyWideView: boolean;
  /** Present when signed after Step 6.1; compared on Fresh / refresh paths. */
  av: number | null;
};

function resolvePreset(
  decoded: JwtAccessTokenPayload,
  legacy: AuthzClaims
): RolePresetId {
  if (decoded.preset && isRolePresetId(decoded.preset)) {
    return decoded.preset;
  }
  if (decoded.membershipRole && isRolePresetId(decoded.membershipRole)) {
    return decoded.membershipRole;
  }
  return legacy.preset;
}

export function buildAccessTokenPayload(
  user: AccessTokenSubject
): JwtAccessTokenPayload {
  const legacy = toAuthzClaims(user.role);
  const embed = shouldEmbedPermissionsInAccessToken();

  const preset: RolePresetId =
    user.preset && isRolePresetId(user.preset)
      ? user.preset
      : user.membershipRole && isRolePresetId(user.membershipRole)
        ? user.membershipRole
        : legacy.preset;

  // When caller passes permissions (incl. empty custom preset), honor that list.
  // Only expand from role when permissions were omitted (legacy sign paths).
  // Recover corrupt empty embeds for non-custom staff presets (UI/API 403 desync).
  let permissions =
    user.permissions != null
      ? parsePermissionList(user.permissions)
      : legacy.permissions;
  if (
    permissions.length === 0 &&
    user.permissions != null &&
    preset !== "custom" &&
    isStaffPreset(preset)
  ) {
    permissions = expandRoleToPermissions(preset);
  }
  if (preset === "platform_admin") {
    permissions = expandRoleToPermissions("platform_admin");
  }

  const orgId =
    typeof user.orgId === "string" &&
    user.orgId.trim() &&
    user.orgId.trim() !== "undefined" &&
    user.orgId.trim() !== "null"
      ? user.orgId.trim()
      : null;
  const membershipRole =
    typeof user.membershipRole === "string" && user.membershipRole.trim()
      ? user.membershipRole.trim()
      : null;

  const payload: JwtAccessTokenPayload = {
    sub: user.id,
    email: user.email,
    role: legacy.role,
    type: "access",
    preset,
    orgId,
    membershipRole,
    cwv: resolveCompanyWideView({
      companyWideView: user.companyWideView,
      preset,
      membershipRole,
    }),
  };

  if (
    typeof user.authzVersion === "number" &&
    Number.isFinite(user.authzVersion) &&
    user.authzVersion >= 0
  ) {
    payload.av = Math.floor(user.authzVersion);
  }

  if (embed) {
    payload.permissions = permissions;
  }

  return payload;
}

/**
 * Fill missing claims on decoded tokens (old cookies, or embed-disabled).
 * Does not change cookie names, path, or expiry.
 * Honors Membership orgId / membershipRole when present on the JWT.
 */
export function normalizeAccessTokenPayload(
  decoded: JwtAccessTokenPayload
): NormalizedAccessToken {
  const legacy = toAuthzClaims(decoded.role);
  const embedded = parsePermissionList(decoded.permissions);

  const orgId =
    typeof decoded.orgId === "string" &&
    decoded.orgId.trim() &&
    decoded.orgId.trim() !== "undefined" &&
    decoded.orgId.trim() !== "null"
      ? decoded.orgId.trim()
      : null;
  const membershipRole =
    typeof decoded.membershipRole === "string" && decoded.membershipRole.trim()
      ? decoded.membershipRole.trim()
      : null;

  const preset = resolvePreset(decoded, legacy);

  // Prefer embedded permissions when present. Empty embed + non-custom staff
  // preset is treated as corrupt/stale — expand from preset so requirePermission
  // matches Membership (avoids 403 while UI still shows platform_admin).
  // Omitted claim (token-size): expand from membershipRole, else legacy role.
  // custom + [] stays empty until override/template / requirePermissionFresh.
  let permissions: Permission[];
  if (Array.isArray(decoded.permissions)) {
    if (embedded.length > 0) {
      permissions = embedded;
    } else if (preset !== "custom" && isStaffPreset(preset)) {
      permissions = expandRoleToPermissions(preset);
    } else if (
      membershipRole &&
      isRolePresetId(membershipRole) &&
      membershipRole !== "custom"
    ) {
      permissions = expandRoleToPermissions(membershipRole);
    } else {
      permissions = embedded;
    }
  } else if (membershipRole && isRolePresetId(membershipRole)) {
    permissions = expandRoleToPermissions(membershipRole);
  } else {
    permissions = legacy.permissions;
  }

  // Super admin always resolves to the full catalog (staff + *_own).
  if (preset === "platform_admin" || membershipRole === "platform_admin") {
    permissions = expandRoleToPermissions("platform_admin");
  }

  const av =
    typeof decoded.av === "number" && Number.isFinite(decoded.av)
      ? Math.floor(decoded.av)
      : null;

  const companyWideView = resolveCompanyWideView({
    companyWideView: decoded.cwv,
    preset,
    membershipRole,
  });

  return {
    sub: decoded.sub,
    email: decoded.email,
    type: "access",
    iat: decoded.iat,
    exp: decoded.exp,
    // Step 7.1: always normalize (archived `seller` → `client`); never echo raw JWT role.
    role: legacy.role,
    preset,
    permissions,
    orgId,
    membershipRole,
    companyWideView,
    cwv: companyWideView,
    av,
  };
}

/** Session fields for login /me JSON (never includes tokens). */
export function toPublicAuthz(role: string | null | undefined) {
  const claims = toAuthzClaims(role);
  return toPublicAuthzFromClaims(claims);
}

export function toPublicAuthzFromClaims(claims: AuthzClaims) {
  return {
    // Include role so login/me clients do not fall back to "user"/"client"
    // when profile.user.role is missing — that was demoting staff → /403.
    role: claims.role,
    permissions: claims.permissions as string[],
    orgId: claims.orgId,
    membershipRole: claims.membershipRole,
    preset: claims.preset,
    companyWideView: claims.companyWideView,
    tenancy: PLATFORM.tenancy,
    isolation: PLATFORM.isolation,
  };
}

/**
 * Step 7.1 — overwrite populated Mongoose `profile.user.role` with normalized
 * live role (`seller` → `client`) before serializing login/me responses.
 */
export function stampLiveRoleOnProfile(
  profile: { user?: unknown } | null | undefined,
  liveRole: string
): void {
  const nested = profile?.user;
  if (nested && typeof nested === "object" && nested !== null && "role" in nested) {
    (nested as { role?: string }).role = liveRole;
  }
}

/** Isolation key for user-scoped queries (Order/Cart/Wallet.user === this). */
export function sessionUserId(token: { sub: string }): string {
  return token.sub;
}

/**
 * Query filter for user-scoped models. Always `{ user: sub }`.
 * Never `{ orgId }` here — Cart/Wishlist stay user-scoped. Catalog uses
 * storefrontOrgFilter() (DEFAULT_ORG_ID / default org), not the JWT.
 */
export function ownedByFilter(token: { sub: string }): { user: string } {
  return { user: token.sub };
}

/**
 * Owner id from a user-scoped document (`doc.user`).
 * Accepts an ObjectId, string, or populated user. Ignores shop/seller/orgId.
 */
export function ownerIdFromDocument(
  doc: { user?: unknown } | null | undefined
): string | null {
  if (!doc || doc.user == null) return null;
  return coerceActorId(doc.user);
}

export function asUserId(value: unknown): string | null {
  return coerceActorId(value);
}

function coerceActorId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") {
    const id = String(value).trim();
    return id.length ? id : null;
  }
  if (typeof value !== "object") return null;

  const obj = value as {
    _id?: unknown;
    toHexString?: () => string;
  };

  if (obj._id != null && obj._id !== value) {
    return coerceActorId(obj._id);
  }

  if (typeof obj.toHexString === "function") {
    return obj.toHexString();
  }

  const asString = String(value);
  if (asString && asString !== "[object Object]") return asString;
  return null;
}

export function tokenHasPermission(
  token: { permissions?: Iterable<string> | null },
  needed: Permission
): boolean {
  return hasPermission(token.permissions, needed);
}

/** Client own-row check. Staff-wide access is a permission, not orgId/shop/seller. */
export function ownsResource(
  token: { sub: string },
  resourceUserId: unknown
): boolean {
  const owner = coerceActorId(resourceUserId);
  if (!owner) return false;
  return token.sub === owner;
}
