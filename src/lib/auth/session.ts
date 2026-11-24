/**
 * Client session helpers. UI gates use permissions[] / isStaff — not
 * `user.role === "admin"` vs FE `"user"`.
 *
 * Display: clients still show as "user". Access: `sessionCan` / `sessionIsStaff`.
 * orgId comes from Membership when present (Step 5.2). Staff admin APIs use
 * actor.orgId (Step 5.3); storefront catalog still uses DEFAULT_ORG_ID.
 * Do not build a permission-settings UI here — live UI is `/admin/users`
 * (Step 6.2) using `sessionCan` / store `can()`. Admin page/action gates are
 * Step 6.3 (`AdminLayout` → /403, sidebar + mutation buttons).
 * Checkout method lives in PAYMENT_POLICY (Stripe on / Paystack UI off /
 * wallet API-only). Membership admin + Step 6.3 UI gates do not change
 * checkout isolation or method availability.
 *
 * When `permissions` is non-empty (JWT / Membership), only that list is used —
 * never re-inflate to full admin via User.role. Empty/omitted list falls back to
 * the role/preset catalog (legacy cookies).
 */

import {
  hasPermission,
  isPermission,
  isRolePresetId,
  toAuthzClaims,
  type Permission,
} from "@/lib/auth/permissions";
import { isStaffActor } from "@/lib/auth/routePolicy";

export type SessionLike = {
  role?: string | null;
  preset?: string | null;
  membershipRole?: string | null;
  permissions?: Iterable<string> | null;
  /** pending | active | suspended — used for post-login company waiting room. */
  orgStatus?: string | null;
  /** Soft billing hold — waiting room even when orgStatus still projects active. */
  billingSoftHold?: boolean | null;
  /** Soft user lock — dialog on all surfaces; no admin landing. */
  accountSuspended?: boolean | null;
  /** Used with orgStatus to detect ops_hold waiting-room vs renewable expiry. */
  subscriptionStatus?: string | null;
  /** Park-locked seats must not resume company HQ bookmarks after sign-in. */
  parkLocked?: boolean | null;
  franchiseParkManager?: boolean | null;
} | null | undefined;

function sessionPermissionList(
  session: NonNullable<SessionLike>
): string[] {
  if (!session.permissions) return [];
  return [...session.permissions].filter(
    (item): item is string => typeof item === "string"
  );
}

function sessionPresetId(session: NonNullable<SessionLike>): string | null {
  for (const candidate of [session.preset, session.membershipRole]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

export function sessionCan(
  session: SessionLike,
  permission: Permission | string
): boolean {
  if (!session || !isPermission(permission)) return false;
  const listed = sessionPermissionList(session);
  const presetId = sessionPresetId(session);

  // Admin (platform_admin): always use the live full catalog. Stale localStorage /
  // truncated JWT embeds from before Online Booking shipped must not hide nav.
  if (presetId === "platform_admin") {
    return hasPermission(
      toAuthzClaims("platform_admin").permissions,
      permission
    );
  }

  // Server-provided permission list is authoritative when present.
  if (listed.length > 0) {
    return hasPermission(listed, permission);
  }

  // Prefer Membership preset expansion when the list was omitted (token-size)
  // or corrupt empty embed for a non-custom staff preset.
  if (presetId && isRolePresetId(presetId) && presetId !== "custom") {
    return hasPermission(toAuthzClaims(presetId).permissions, permission);
  }

  // Empty custom membership → no grants until overrides/template exist.
  if (presetId === "custom") {
    return false;
  }

  // Stale admin cache without Membership preset: wait for /me hydrate.
  // Do not invent full platform_admin from bare role alone when permissions
  // were explicitly empty custom — that path is handled above.
  if (!presetId && (session.role === "admin" || session.role === "Admin")) {
    return hasPermission(
      toAuthzClaims("platform_admin").permissions,
      permission
    );
  }

  return hasPermission(
    toAuthzClaims(presetId || session.role).permissions,
    permission
  );
}

export function sessionIsStaff(session: SessionLike): boolean {
  if (!session) return false;
  return isStaffActor(session.role, session.preset, session.permissions);
}
