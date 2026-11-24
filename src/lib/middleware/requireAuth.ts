/**
 * API auth guards. Cookie names/path/HttpOnly are unchanged.
 *
 * 401 = missing/invalid/expired access-token
 * 403 = authenticated but missing permission / not owner / not client|admin
 *
 * Permission path: JWT from Membership (Step 5.2) or legacy User.role expansion.
 * requirePermission is sync (JWT). requirePermissionFresh always reloads
 * Membership once (permissions + orgId) then checks — use on staff routes that
 * stamp/filter actor.orgId (Step 5.3) or mutate admin data.
 *
 * Do not check `role === "admin"` for staff gates: staff presets still map to
 * DB `admin`. Dead helpers `requireAdmin` / `requireClient` were removed in
 * Step 7.1 — use requirePermission / requirePermissionFresh instead.
 *
 * Isolation: document.user === JWT `sub`. Tenancy: Organization + Membership.
 * Storefront catalog still uses DEFAULT_ORG_ID for public reads.
 * Staff catalog/order APIs use actor.orgId (Step 5.3; see `@/lib/staffOrg`).
 * Payments: Stripe UI on / Paystack UI off / wallet API-only (PAYMENT_POLICY).
 */

import { verifyAccessToken, verifyValidatorToken } from "@/lib/jwt";
import { NextRequest } from "next/server";
import {
  ownerIdFromDocument,
  ownsResource,
  asUserId,
  type NormalizedAccessToken,
} from "@/lib/auth/claims";
import {
  hasAllPermissions,
  hasAnyPermission,
  isCheckoutApiImplemented,
  isCheckoutUiEnabled,
  lookupApiPermission,
  isUnguardedApiIsolation,
  resolveCompanyWideView,
  type CheckoutMethod,
  type Permission,
  type ApiPermissionRule,
  type AuthzClaims,
} from "@/lib/auth/permissions";
import {
  ForbiddenError,
  UnauthorizedError,
  isAuthHttpError,
} from "@/lib/auth/http-error";
import { refreshAuthzFromMembership } from "@/lib/membership";
import {
  assertOrganizationActive,
  assertOrganizationAllowsWorkspaceLifecycle,
  ORG_SUSPENDED_MESSAGE,
} from "@/lib/org";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import { logPermissionDenial } from "@/lib/audit/activityLog";
import { withDbRetry } from "@/lib/db";
import prisma from "@/lib/prisma";
import { idWhere } from "@/lib/ids";

/** Opt-in for Demo-safe surfaces (company profile, billing, workspace export). */
export type RequirePermissionFreshOptions = {
  allowOnDemo?: boolean;
};

function toPermissionList(
  permission: Permission | readonly Permission[]
): readonly Permission[] {
  return typeof permission === "string" ? [permission] : permission;
}

/**
 * Company SaaS org lock applies to staff/org-scoped permissions.
 * Customer `*_own` APIs must keep working when the actor's Membership is a
 * suspended/pending registered company (they still shop / join on Harewa).
 */
function permissionRequiresActiveOrganization(
  permissions: readonly Permission[]
): boolean {
  return permissions.some(
    (p) => typeof p === "string" && !String(p).endsWith("_own")
  );
}

function applyAuthzClaims(
  decoded: NormalizedAccessToken,
  claims: AuthzClaims
): NormalizedAccessToken {
  return {
    ...decoded,
    role: claims.role,
    preset: claims.preset,
    permissions: claims.permissions,
    orgId: claims.orgId,
    membershipRole: claims.membershipRole,
    companyWideView: claims.companyWideView,
    cwv: claims.companyWideView,
  };
}

function rethrowAsUnauthorized(error: unknown): never {
  if (isAuthHttpError(error)) throw error;

  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  const message = error instanceof Error ? error.message : "";

  if (name === "TokenExpiredError" || message.toLowerCase().includes("expired")) {
    throw new UnauthorizedError("Token expired");
  }
  throw new UnauthorizedError("Invalid token");
}

/**
 * Decode the HttpOnly access-token. Always returns catalog permissions:
 * embedded claim, else expand from `role` / membershipRole (Step 1.1 / 5.2).
 */
export function requireAuth(req: NextRequest): NormalizedAccessToken {
  const token = req.cookies.get("access-token")?.value;

  if (!token) {
    throw new UnauthorizedError("No access token provided");
  }

  try {
    const decoded = verifyAccessToken(token);
    if (!decoded.sub) {
      throw new UnauthorizedError("Invalid token");
    }
    return decoded;
  } catch (error: unknown) {
    rethrowAsUnauthorized(error);
  }
}

/**
 * JWT auth + soft User.accountSuspended check.
 * Use on customer own-scope routes that still call sync {@link requireAuth}
 * (cart/wishlist/profile/wallet/orders) so user suspend is not JWT-bypassable.
 */
export async function requireAuthActiveAccount(
  req: NextRequest
): Promise<NormalizedAccessToken> {
  const decoded = requireAuth(req);
  const { assertUserNotAccountSuspended } = await import(
    "@/lib/accountSuspend"
  );
  await assertUserNotAccountSuspended(decoded.sub);
  return decoded;
}

/**
 * 401 if unauthenticated; 403 unless the actor holds every listed permission.
 * Empty list = authenticated only (all of nothing). JWT-only (no DB).
 */
export function requirePermission(
  req: NextRequest,
  permission: Permission | readonly Permission[]
): NormalizedAccessToken {
  const decoded = requireAuth(req);
  const needed = toPermissionList(permission);
  if (!hasAllPermissions(decoded.permissions, needed)) {
    throw new ForbiddenError("Missing required permission");
  }
  return decoded;
}

/**
 * Like requirePermission, but always reloads Membership from Mongo once
 * (stale JWT after role/override/org change). Prefer on admin routes that
 * stamp or filter by actor.orgId (Step 5.3) or mutate with staff permissions.
 *
 * Demo tenants: fail-closed unless `options.allowOnDemo` (company profile /
 * billing / workspace lifecycle only).
 */
export async function requirePermissionFresh(
  req: NextRequest,
  permission: Permission | readonly Permission[],
  options?: RequirePermissionFreshOptions
): Promise<NormalizedAccessToken> {
  const needed = toPermissionList(permission);
  const needsActiveOrg = permissionRequiresActiveOrganization(needed);
  // Always allowSuspendedOrg here — Active gate below owns soft-hold / pending /
  // suspended. Avoids double assertOrganizationActive now that requireAuthFresh
  // (tailor default) also uses Active when allowSuspendedOrg is false.
  const decoded = await requireAuthFresh(req, {
    allowSuspendedOrg: true,
  });
  if (needsActiveOrg && decoded.orgId) {
    await assertOrganizationActive(decoded.orgId);
  }
  if (!options?.allowOnDemo && decoded.orgId) {
    await assertNotDemoPlanLocked(decoded.orgId);
  }
  if (!hasAllPermissions(decoded.permissions, needed)) {
    throw new ForbiddenError("Missing required permission");
  }
  return decoded;
}

/**
 * Like requirePermissionFresh, but allows soft billing hold (DB still `active`).
 * Use only for GDPR workspace export / soft offboard — not catalog creates.
 */
export async function requirePermissionFreshWorkspaceLifecycle(
  req: NextRequest,
  permission: Permission | readonly Permission[],
  options?: RequirePermissionFreshOptions
): Promise<NormalizedAccessToken> {
  const needed = toPermissionList(permission);
  const decoded = await requireAuthFresh(req, {
    allowSuspendedOrg: true,
  });
  if (permissionRequiresActiveOrganization(needed) && decoded.orgId) {
    await assertOrganizationAllowsWorkspaceLifecycle(decoded.orgId);
  }
  if (!options?.allowOnDemo && decoded.orgId) {
    await assertNotDemoPlanLocked(decoded.orgId);
  }
  if (!hasAllPermissions(decoded.permissions, needed)) {
    throw new ForbiddenError("Missing required permission");
  }
  return decoded;
}

/**
 * 401 if unauthenticated; 403 unless the actor holds at least one listed permission.
 * Empty list cannot be satisfied → 403.
 */
export function requireAnyPermission(
  req: NextRequest,
  permission: Permission | readonly Permission[]
): NormalizedAccessToken {
  const decoded = requireAuth(req);
  const needed = toPermissionList(permission);
  if (!hasAnyPermission(decoded.permissions, needed)) {
    throw new ForbiddenError("Missing required permission");
  }
  return decoded;
}

export async function requireAnyPermissionFresh(
  req: NextRequest,
  permission: Permission | readonly Permission[],
  options?: RequirePermissionFreshOptions
): Promise<NormalizedAccessToken> {
  const needed = toPermissionList(permission);
  const needsActiveOrg = permissionRequiresActiveOrganization(needed);
  const decoded = await requireAuthFresh(req, {
    allowSuspendedOrg: true,
  });
  if (needsActiveOrg && decoded.orgId) {
    await assertOrganizationActive(decoded.orgId);
  }
  if (!options?.allowOnDemo && decoded.orgId) {
    await assertNotDemoPlanLocked(decoded.orgId);
  }
  if (!hasAnyPermission(decoded.permissions, needed)) {
    throw new ForbiddenError("Missing required permission");
  }
  return decoded;
}

/**
 * @deprecated Prefer requirePermissionFreshWorkspaceLifecycle for a single
 * soft-hold-tolerant permission, or an explicit settings-vs-orders branch
 * (see GET /api/admin/company-profile). Do not OR orders:* through this helper —
 * that would soft-hold-allow print-brand reads.
 */
export async function requireAnyPermissionFreshWorkspaceLifecycle(
  req: NextRequest,
  permission: Permission | readonly Permission[]
): Promise<NormalizedAccessToken> {
  const needed = toPermissionList(permission);
  const decoded = await requireAuthFresh(req, {
    allowSuspendedOrg: true,
  });
  if (permissionRequiresActiveOrganization(needed) && decoded.orgId) {
    await assertOrganizationAllowsWorkspaceLifecycle(decoded.orgId);
  }
  if (!hasAnyPermission(decoded.permissions, needed)) {
    throw new ForbiddenError("Missing required permission");
  }
  return decoded;
}

/**
 * Catalog rule from Step 1.1 (`API_PERMISSIONS` / `lookupApiPermission`).
 * Public, provider, and gone (410) rules are not this helper — they are not RBAC.
 * Multiple permissions on a rule are OR (`own_or_staff`).
 */
export function requireApiRule(
  req: NextRequest,
  rule: ApiPermissionRule
): NormalizedAccessToken {
  if (isUnguardedApiIsolation(rule.isolation)) {
    throw new Error("requireApiRule is for guarded catalog rules only");
  }
  if (rule.permissions.length === 0) {
    return requireAuth(req);
  }
  return requireAnyPermission(req, rule.permissions);
}

/**
 * Look up Step 1.1 `API_PERMISSIONS` for this method+path, then requireApiRule.
 * Unknown paths still require a session. Public/provider/gone rules are not RBAC —
 * this helper will not invent a permission for them (returns requireAuth only
 * when the path is missing from the catalog).
 */
export function requireApiPermission(
  req: NextRequest,
  method: string,
  pathname: string
): NormalizedAccessToken {
  const rule = lookupApiPermission(method, pathname);
  if (!rule) {
    return requireAuth(req);
  }
  if (isUnguardedApiIsolation(rule.isolation)) {
    throw new Error("requireApiPermission is for guarded catalog rules only");
  }
  return requireApiRule(req, rule);
}

/**
 * requireAuth + Membership DB reload. Use on mutating routes that gate via
 * ownership/allowPermissions (order/customization/reviews staff path) so a
 * stale JWT cannot miss a newly granted staff permission.
 * Step 6.1: membership role changes bump User.authzVersion and clear
 * refreshTokenJTI. If the access token carries `av` and it no longer matches,
 * reject with 401 so the actor must sign in again (Fresh staff paths).
 *
 * Suspended / soft-held / pending orgs fail-closed by default (staff/tailor
 * Fresh via `assertOrganizationActive` — same soft-deny as PermissionFresh).
 * Waiting-room `/api/auth/me` and customer own-scope commerce pass
 * `{ allowSuspendedOrg: true }` so dual-role company members can still shop
 * on Harewa. PermissionFresh skips Active only for pure `*_own` permissions;
 * staff permissions still require `assertOrganizationActive`.
 */
export async function requireAuthFresh(
  req: NextRequest,
  options?: { allowSuspendedOrg?: boolean; allowAccountSuspended?: boolean }
): Promise<NormalizedAccessToken> {
  const decoded = requireAuth(req);
  // Reject stale av BEFORE resolveAuthzForUser — that resolver can self-heal
  // bootstrap invited rows and must not run for revoked sessions with old JWTs.
  const avRow = await withDbRetry(() =>
    prisma.user.findFirst({
      where: idWhere(decoded.sub),
      select: { authzVersion: true },
    })
  );
  if (!avRow) {
    throw new UnauthorizedError("Session outdated; sign in again");
  }
  // Soft account lock — never deletes rows; blocks Fresh unless waiting-room /me.
  if (!options?.allowAccountSuspended) {
    const { assertUserNotAccountSuspended } = await import(
      "@/lib/accountSuspend"
    );
    await assertUserNotAccountSuspended(decoded.sub);
  }
  if (
    decoded.av != null &&
    typeof avRow.authzVersion === "number" &&
    decoded.av !== avRow.authzVersion
  ) {
    throw new UnauthorizedError("Session outdated; sign in again");
  }
  const { authzVersion, userMissing, ...claims } = await withDbRetry(() =>
    refreshAuthzFromMembership(decoded)
  );
  if (userMissing) {
    throw new UnauthorizedError("Session outdated; sign in again");
  }
  if (
    decoded.av != null &&
    typeof authzVersion === "number" &&
    decoded.av !== authzVersion
  ) {
    throw new UnauthorizedError("Session outdated; sign in again");
  }
  // Clients without Membership.orgId are unaffected; public shop stays open.
  // Soft-hold (DB still active) must fail-close tailor/studio the same way
  // admin PermissionFresh does — NotSuspended alone left soft-holds writable.
  if (claims.orgId && !options?.allowSuspendedOrg) {
    try {
      await assertOrganizationActive(claims.orgId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : ORG_SUSPENDED_MESSAGE;
      logPermissionDenial(req, err, {
        route: req.nextUrl.pathname || "requireAuthFresh",
        actorSub: decoded.sub,
        orgId: claims.orgId,
        reason: message,
        metadata: { domain: "org-status" },
      });
      throw err;
    }
  }
  return applyAuthzClaims(decoded, claims);
}

export type OwnershipCheck = {
  /** Owner user id (`document.user`). Never shop, seller, or orgId. */
  resourceUserId: string | null | undefined;
  actorId: string;
  /** Actor catalog permissions — required when `allowPermissions` is set. */
  permissions?: Iterable<string> | null;
  /** Staff may access another user's row if they hold any of these. */
  allowPermissions?: readonly Permission[];
  /** When false, staff allowPermissions cannot cross-user (own-scope only). */
  companyWideView?: boolean | null;
  preset?: string | null;
  membershipRole?: string | null;
};

/**
 * IDOR helper: owner (`resourceUserId === actorId`) OR staff with allowPermissions
 * and company-wide view. Throws 403 Forbidden otherwise.
 */
export function assertOwnership(check: OwnershipCheck): void {
  const actorId = asUserId(check.actorId);
  if (!actorId) {
    throw new ForbiddenError("Forbidden");
  }
  if (ownsResource({ sub: actorId }, check.resourceUserId)) {
    return;
  }

  const staffOverride = check.allowPermissions ?? [];
  if (
    staffOverride.length > 0 &&
    hasAnyPermission(check.permissions, staffOverride) &&
    resolveCompanyWideView({
      companyWideView: check.companyWideView,
      preset: check.preset,
      membershipRole: check.membershipRole,
    })
  ) {
    return;
  }

  throw new ForbiddenError("Forbidden");
}

/**
 * Same as assertOwnership, but reads `doc.user` only (populated or id).
 * Catalog models (Product/Fabric/TaxSettings) have no owner — do not use this.
 */
export function assertOwnedDocument(
  token: Pick<
    NormalizedAccessToken,
    | "sub"
    | "permissions"
    | "companyWideView"
    | "preset"
    | "membershipRole"
  >,
  doc: { user?: unknown } | null | undefined,
  allowPermissions?: readonly Permission[]
): void {
  assertOwnership({
    resourceUserId: ownerIdFromDocument(doc),
    actorId: token.sub,
    permissions: token.permissions,
    allowPermissions,
    companyWideView: token.companyWideView,
    preset: token.preset,
    membershipRole: token.membershipRole,
  });
}

/**
 * requireAuth + assertOwnership. 401 if unauthenticated, 403 if not owner
 * and not staff with allowPermissions.
 */
export function requireOwnership(
  req: NextRequest,
  resourceUserId: string | null | undefined,
  allowPermissions?: readonly Permission[]
): NormalizedAccessToken {
  const actor = requireAuth(req);
  assertOwnership({
    resourceUserId,
    actorId: actor.sub,
    permissions: actor.permissions,
    allowPermissions,
    companyWideView: actor.companyWideView,
    preset: actor.preset,
    membershipRole: actor.membershipRole,
  });
  return actor;
}

/** Convenience: ownership check against a decoded access token. */
export function assertOwnershipForToken(
  token: Pick<
    NormalizedAccessToken,
    | "sub"
    | "permissions"
    | "companyWideView"
    | "preset"
    | "membershipRole"
  >,
  resourceUserId: string | null | undefined,
  allowPermissions?: readonly Permission[]
): void {
  assertOwnership({
    resourceUserId,
    actorId: token.sub,
    permissions: token.permissions,
    allowPermissions,
    companyWideView: token.companyWideView,
    preset: token.preset,
    membershipRole: token.membershipRole,
  });
}

/**
 * Checkout method vs PAYMENT_POLICY.
 * `surface: "ui"` — Stripe only (Paystack/wallet stay off in the selector).
 * `surface: "api"` — Stripe, Paystack, and wallet handlers as implemented.
 * Holding payments:checkout_own does not enable a disabled UI method.
 */
export function assertCheckoutMethod(
  method: CheckoutMethod,
  surface: "ui" | "api" = "api"
): void {
  if (surface === "ui") {
    if (!isCheckoutUiEnabled(method)) {
      throw new ForbiddenError("Checkout method is not enabled");
    }
    return;
  }
  if (!isCheckoutApiImplemented(method)) {
    throw new ForbiddenError("Checkout method is not enabled");
  }
}

export function validatorAccess(req: NextRequest) {
  const token = req.cookies.get("validatorToken")?.value;

  if (!token) {
    throw new UnauthorizedError("Unauthorized");
  }
  return verifyValidatorToken(token);
}

/*
 * Inventory sync (do not treat as auto-wired requireApiPermission).
 *
 * requirePermissionFresh (live staff / membership-sensitive):
 *   GET /api/analytics                   → analytics:read (actor.orgId)
 *   GET|PUT /api/admin/tax-settings      → tax:manage (actor.orgId)
 *   GET|PUT|POST /api/admin/ai-settings       → ai:manage (actor.orgId)
 *   GET /api/admin/fashion-chats*        → ai:chats_read (actor.orgId)
 *   POST /api/admin/fashion-chats/[id]/reply → ai:chats_reply
 *   PATCH /api/admin/fashion-chats/[id]  → ai:chats_reply
 *   DELETE /api/admin/fashion-chats/[id] → ai:chats_delete
 *   DELETE /api/admin/fashion-chats      → ai:chats_delete (bulk)
 *   POST /api/upload, POST /api/upload/sign, POST /api/upload/bulk → uploads:write
 *   POST /api/product                    → products:write (stamp actor.orgId; never body.seller/shop/orgId)
 *   PUT /api/product/[id]                → products:write (actor.orgId)
 *   DELETE /api/product/[id]             → products:delete (actor.orgId)
 *   GET /api/product/bulk                → products:read (actor.orgId)
 *   POST /api/product/bulk               → products:write (stamp actor.orgId)
 *   GET|PUT|DELETE /api/product/shop|seller/[id] → products:* (unused; actor.orgId)
 *   POST /api/fabric, PUT /api/fabric/[id] → fabrics:write
 *   DELETE /api/fabric/[id]              → fabrics:delete
 *   POST /api/product-category, PUT /[id] → categories:write
 *   DELETE /api/product-category/[id]    → categories:delete
 *   GET /api/order                       → orders:read (actor.orgId)
 *   GET /api/cart                        → cart:read + storefront staff (assertStorefrontStaffOrg)
 *   GET /api/wallet                      → wallet:read + storefront staff
 *   GET /api/customization               → customizations:read + storefront staff
 *   GET|POST|PATCH|DELETE /api/admin/members* → users:*
 *   GET|POST|DELETE /api/admin/user-blacklist* → users:blacklist
 *
 * 410 Gone (live — unused leftover, not RBAC, not multi-tenant, not settings:manage):
 *   GET|POST|PUT|PATCH|DELETE /api/shop and /api/shop/[id]
 *
 * requireAuth + isolation (live — orders + cart + wishlist + wallet + customization + notification + reviews + profile + fashion-chat):
 *   POST /api/order                      → force user=sub; cart.user must match sub; stamps Order.orgId
 *   GET /api/order/me                    → ownedByFilter
 *   GET /api/order/[id]                  → owner OR orders:read (staff: actor.orgId; cross-tenant 403)
 *   PUT /api/order/[id]                  → owner OR orders:manage; status needs orders:manage (staff: actor.orgId)
 *   DELETE /api/order/[id]               → owner OR orders:manage (pending/initiated; staff: actor.orgId)
 *   POST /api/cart                       → force user=sub
 *   GET/POST /api/cart/me                → ownedByFilter / user=sub
 *   GET/PUT/DELETE /api/cart/[id]        → owner-only (403 if not owner)
 *   /api/cart/[id]/product|fabric|clear  → owner-only
 *   GET/POST /api/wishlist               → ownedByFilter; ignore ?userId=
 *   POST /api/wallet                     → force user=sub
 *   GET /api/wallet/me                   → requireAuth; ensureOwnedWallet(sub); ignore ?userId=
 *   POST /api/wallet/fund               → requireAuth; uuid from session
 *   POST /api/wallet/withdraw            → requireAuth; deductFunds(sub)
 *   POST /api/wallet/reciept/generate    → requireAuth; txn belongs to sub
 *   GET/PUT/DELETE /api/wallet/[id]      → owner-only (403 if not owner); PUT no balance
 *   POST /api/customization              → force user=sub
 *   GET /api/customization/me            → ownedByFilter; ignore ?userId=
 *   GET /api/customization/[id]          → owner OR customizations:read
 *   PUT/DELETE /api/customization/[id]   → owner OR customizations:manage; never body.user
 *   GET /api/customization/user/[userId] → owner if userId===sub, else customizations:read
 *   POST/GET /api/custom-request         → user=sub / ownedByFilter (unused by UI)
 *   GET/PATCH /api/notification          → ownedByFilter / owner (403 IDOR); ignore ?userId=
 *   POST /api/reviews                    → user=sub; never body.user
 *   GET /api/reviews                     → public by productId only (no auth)
 *   PATCH/DELETE /api/reviews/[id]       → owner OR reviews:moderate; empty PATCH = like-toggle
 *   GET/DELETE /api/auth/me              → session user only
 *   PATCH /api/auth/profile              → session user only; never body.user
 *   POST /api/auth/profile/picture       → ownedByFilter
 *   DELETE /api/auth/profile/address/[addressId] → session profile only
 *   GET/POST /api/fashion-chat           → guest sessionId+IP or auth user=sub; contact for inbox; ignore body.user
 *   POST /api/fashion-chat/stream        → same isolation (SSE)
 *   POST /api/fashion-chat/start         → create/open shell with contact (guest-open)
 *   POST /api/fashion-chat/end           → mark open chat resolved; keep contact + transcript
 *
 * Payments (PAYMENT_POLICY — Stripe UI on / Paystack UI off / wallet API-only):
 *   POST /api/payment/purchase           → requireAuth + assertCheckoutMethod("api") + owned order/wallet
 *   POST /api/payment/paystack/initialize → requireAuth + owned order (UI off)
 *   POST /api/payment/stripe/create-session → requireAuth + owned order
 *   GET /api/payment/paystack/banks      → requireAuth (unused)
 *   POST /api/payment/paystack/verify-transfer → requireAuth
 *   GET /api/payment/stripe/confirm       → ACCEPTED provider (session_id)
 *   GET /api/payment/paystack/callback    → ACCEPTED provider; /payment/callback UI uses this
 *   POST /api/webhooks/stripe             → ACCEPTED Stripe-Signature
 *
 * GET /api/ai-settings                   → public botName (chatbot; never secrets)
 * GET /api/tax-settings                  → public enabled/rate/label (storefront org)
 *
 * Organization + Membership live. requirePermissionFresh reloads Membership.
 * Dashboard /admin soft-gated; widgets use analytics:read etc. (Step 6.3).
 */
