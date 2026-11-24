// src/services/auth.ts
import { api, ApiError } from "@/utils/api";
import {
  parsePermissionList,
  toAuthzClaims,
  toDbUserRole,
  isRolePresetId,
  isStaffPreset,
} from "@/lib/auth/permissions";

export type UserProfile = {
  id: string;
  email: string;
  name?: string;
  fullName?: string;
  /** Display role: `admin` | `user`. Clients are shown as `user`. */
  role: string;
  avatar?: string;
  isVerified?: boolean;
  /** Catalog strings from JWT /me. Always an array. */
  permissions: string[];
  /** Primary Membership.orgId when present; null for clients without membership. */
  orgId: string | null;
  membershipRole: string | null;
  preset?: string | null;
  /** Feature perms apply to all org records when true. */
  companyWideView?: boolean;
  /** Harewa storefront Organization id — compare to orgId for storefront-only admin UI. */
  storefrontOrgId?: string | null;
  /** Primary Membership org status: pending | active | suspended. */
  orgStatus?: string | null;
  organizationName?: string | null;
  /** Company profile completeness 0–100 when org has a profile row. */
  profileCompleteness?: number | null;
  hasLogo?: boolean;
  /** White-label dashboard logo; null for the platform storefront org. */
  companyLogoUrl?: string | null;
  /** Organization.slug — also the {slug}.{root} dashboard subdomain. */
  organizationSlug?: string | null;
  legalName?: string | null;
  tradingName?: string | null;
  /** legalName || tradingName || organizationName — synced with documents/emails */
  companyDisplayName?: string | null;
  subscriptionPlan?: string | null;
  /** Checkout interest — never entitles alone. */
  requestedPlan?: string | null;
  requestedDurationMonths?: number | null;
  subscriptionInterval?: string | null;
  subscriptionStatus?: string | null;
  subscriptionEndsAt?: string | null;
  /** Soft billing hold — Fresh soft-denies writes; export/offboard still allowed. */
  billingSoftHold?: boolean;
  /** ISO when unpaid soft-hold grace ends and Demo demotion runs. */
  billingGraceEndsAt?: string | null;
  /** Entitled Enterprise HQ soft-gate (company admin UI / Step 2+). */
  enterpriseHqEnabled?: boolean;
  /** True when MembershipVenueAssignment park-locks this seat. */
  parkLocked?: boolean;
  /** Active assigned venue ids when park-locked (empty when company-wide). */
  assignedLocationIds?: string[];
  /**
   * Effective selected park (HQ / park-context preference, or forced assignment).
   * Null = All locations for company-wide seats only.
   */
  effectiveLocationId?: string | null;
  /** Stored Membership.hqSelectedLocationId (may match effectiveLocationId). */
  hqSelectedLocationId?: string | null;
  /** Franchise park manager (park-locked + Membership.franchiseParkManager). */
  franchiseParkManager?: boolean;
  /** Soft ops lock on the User row — never deletes account data. */
  accountSuspended?: boolean;
};

/**
 * Canonical DB roles: `admin` | `client`. Public signup is always `client`.
 * FE display: `client` (and archived `seller` → client) → `"user"`.
 * Internal gates use permissions[] / isStaff — not `role === "admin"` vs `"user"`.
 */
export function toFrontendRole(backendRole: string | null | undefined): string {
  return toDbUserRole(backendRole) === "admin" ? "admin" : "user";
}

export function toBackendRole(frontendRole: string | null | undefined): string {
  if (!frontendRole) return "client";
  if (frontendRole === "user") return "client";
  return toDbUserRole(frontendRole);
}

export function normalizeSessionUser(
  user: Omit<UserProfile, "permissions" | "orgId" | "membershipRole"> &
    Partial<
      Pick<
        UserProfile,
        | "permissions"
        | "orgId"
        | "membershipRole"
        | "preset"
        | "companyWideView"
        | "storefrontOrgId"
        | "orgStatus"
        | "organizationName"
        | "profileCompleteness"
        | "hasLogo"
        | "companyLogoUrl"
        | "organizationSlug"
        | "legalName"
        | "tradingName"
        | "companyDisplayName"
        | "subscriptionPlan"
        | "requestedPlan"
        | "requestedDurationMonths"
        | "subscriptionInterval"
        | "subscriptionStatus"
        | "subscriptionEndsAt"
        | "billingSoftHold"
        | "billingGraceEndsAt"
        | "enterpriseHqEnabled"
        | "parkLocked"
        | "assignedLocationIds"
        | "effectiveLocationId"
        | "hqSelectedLocationId"
        | "franchiseParkManager"
        | "accountSuspended"
      >
    >
): UserProfile {
  const dbRole = toBackendRole(user.role);
  const claims = toAuthzClaims(dbRole);
  // Explicit permissions from /me or login (incl. empty custom) are authoritative.
  const hasExplicitPermissions = Array.isArray(user.permissions);
  const parsed = parsePermissionList(user.permissions);
  const orgId =
    typeof user.orgId === "string" &&
    user.orgId.trim() &&
    user.orgId.trim() !== "undefined" &&
    user.orgId.trim() !== "null"
      ? user.orgId.trim()
      : null;
  const storefrontOrgId =
    typeof user.storefrontOrgId === "string" &&
    user.storefrontOrgId.trim() &&
    user.storefrontOrgId.trim() !== "undefined" &&
    user.storefrontOrgId.trim() !== "null"
      ? user.storefrontOrgId.trim()
      : null;
  const orgStatus =
    typeof user.orgStatus === "string" && user.orgStatus.trim()
      ? user.orgStatus.trim()
      : null;
  const organizationName =
    typeof user.organizationName === "string" && user.organizationName.trim()
      ? user.organizationName.trim()
      : null;
  const legalName =
    typeof user.legalName === "string" && user.legalName.trim()
      ? user.legalName.trim()
      : null;
  const tradingName =
    typeof user.tradingName === "string" && user.tradingName.trim()
      ? user.tradingName.trim()
      : null;
  const companyDisplayName =
    typeof user.companyDisplayName === "string" && user.companyDisplayName.trim()
      ? user.companyDisplayName.trim()
      : legalName || tradingName || organizationName;
  const profileCompleteness =
    typeof user.profileCompleteness === "number" &&
    Number.isFinite(user.profileCompleteness)
      ? Math.max(0, Math.min(100, Math.round(user.profileCompleteness)))
      : null;
  const hasLogo = typeof user.hasLogo === "boolean" ? user.hasLogo : undefined;
  const companyLogoUrl =
    typeof user.companyLogoUrl === "string" && user.companyLogoUrl.trim()
      ? user.companyLogoUrl.trim()
      : null;
  const organizationSlug =
    typeof user.organizationSlug === "string" && user.organizationSlug.trim()
      ? user.organizationSlug.trim()
      : null;
  const subscriptionPlan =
    typeof user.subscriptionPlan === "string" && user.subscriptionPlan.trim()
      ? user.subscriptionPlan.trim()
      : null;
  const requestedPlan =
    typeof user.requestedPlan === "string" && user.requestedPlan.trim()
      ? user.requestedPlan.trim()
      : null;
  const requestedDurationMonths =
    typeof user.requestedDurationMonths === "number" &&
    Number.isFinite(user.requestedDurationMonths)
      ? Math.floor(user.requestedDurationMonths)
      : null;
  const subscriptionInterval =
    typeof user.subscriptionInterval === "string" &&
    user.subscriptionInterval.trim()
      ? user.subscriptionInterval.trim()
      : null;
  const subscriptionStatus =
    typeof user.subscriptionStatus === "string" &&
    user.subscriptionStatus.trim()
      ? user.subscriptionStatus.trim()
      : null;
  const subscriptionEndsAt =
    typeof user.subscriptionEndsAt === "string" &&
    user.subscriptionEndsAt.trim()
      ? user.subscriptionEndsAt.trim()
      : null;
  const billingSoftHold = user.billingSoftHold === true;
  const billingGraceEndsAt =
    typeof user.billingGraceEndsAt === "string" &&
    user.billingGraceEndsAt.trim()
      ? user.billingGraceEndsAt.trim()
      : null;
  const enterpriseHqEnabled = user.enterpriseHqEnabled === true;
  const parkLocked = user.parkLocked === true;
  const assignedLocationIds = Array.isArray(user.assignedLocationIds)
    ? user.assignedLocationIds.filter(
        (id): id is string => typeof id === "string" && Boolean(id.trim())
      )
    : [];
  const effectiveLocationId =
    typeof user.effectiveLocationId === "string" &&
    user.effectiveLocationId.trim()
      ? user.effectiveLocationId.trim()
      : null;
  const hqSelectedLocationId =
    typeof user.hqSelectedLocationId === "string" &&
    user.hqSelectedLocationId.trim()
      ? user.hqSelectedLocationId.trim()
      : null;
  const franchiseParkManager =
    user.franchiseParkManager === true && parkLocked;
  const accountSuspended = user.accountSuspended === true;
  const membershipRole =
    typeof user.membershipRole === "string" && user.membershipRole.trim()
      ? user.membershipRole.trim()
      : null;
  const preset =
    typeof user.preset === "string" && user.preset.trim()
      ? user.preset.trim()
      : claims.preset;

  let permissions = hasExplicitPermissions ? parsed : claims.permissions;
  // Corrupt empty list + non-custom staff preset → expand (matches JWT normalize).
  if (
    permissions.length === 0 &&
    preset &&
    isRolePresetId(preset) &&
    preset !== "custom" &&
    isStaffPreset(preset)
  ) {
    permissions = [...toAuthzClaims(preset).permissions];
  }
  // Super admin always carries the full catalog (including *_own).
  if (preset === "platform_admin" || membershipRole === "platform_admin") {
    permissions = [...toAuthzClaims("platform_admin").permissions];
  }

  const companyWideView =
    typeof user.companyWideView === "boolean"
      ? user.companyWideView
      : claims.companyWideView;
  const resolvedCwv =
    preset === "platform_admin" || membershipRole === "platform_admin"
      ? true
      : companyWideView;

  // Suspended/revoked membership resolves preset "client" while User.role may
  // still be admin — display + staff gates must follow the preset.
  const role =
    preset === "client" ? "user" : toFrontendRole(dbRole);
  return {
    ...user,
    role,
    permissions,
    orgId,
    membershipRole,
    preset,
    companyWideView: resolvedCwv,
    storefrontOrgId,
    orgStatus,
    organizationName,
    profileCompleteness,
    hasLogo,
    companyLogoUrl,
    organizationSlug,
    legalName,
    tradingName,
    companyDisplayName,
    subscriptionPlan,
    requestedPlan,
    requestedDurationMonths,
    subscriptionInterval,
    subscriptionStatus,
    subscriptionEndsAt,
    billingSoftHold,
    billingGraceEndsAt,
    enterpriseHqEnabled,
    parkLocked,
    assignedLocationIds,
    effectiveLocationId,
    hqSelectedLocationId,
    franchiseParkManager,
    accountSuspended,
  };
}

/** True when the session's primary org is the Harewa storefront. */
export function isStorefrontOrgSession(
  user: Pick<UserProfile, "orgId" | "storefrontOrgId"> | null | undefined
): boolean {
  const orgId = typeof user?.orgId === "string" ? user.orgId.trim() : "";
  const storefront =
    typeof user?.storefrontOrgId === "string" ? user.storefrontOrgId.trim() : "";
  return Boolean(orgId && storefront && orgId === storefront);
}

function cleanStr(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : undefined;
  }
  return undefined;
}

let getMeInflight: Promise<any> | null = null;

function toUserProfile(payload: any): UserProfile {
  // Accept multiple backend shapes without leaking tokens
  const data = payload?.data ?? payload;
  const profile = data?.profile ?? data?.user ?? data;

  // Some backends nest the "user" node inside "profile"
  const userNode = profile?.user ?? profile;

  const first = cleanStr(profile?.firstName);
  const last = cleanStr(profile?.lastName);
  const compositeFull =
    [first, last].filter(Boolean).join(" ") || undefined;

  const email = cleanStr(userNode?.email) ?? "";
  const id =
    cleanStr(payload?.userId) ??
    cleanStr(data?.userId) ??
    cleanStr(userNode?._id) ??
    cleanStr(userNode?.id) ??
    "";

  const backendRole = toDbUserRole(
    cleanStr(payload?.role) ??
      cleanStr(data?.role) ??
      cleanStr(userNode?.role) ??
      "client"
  );

  const permissionsFromPayload = parsePermissionList(
    payload?.permissions ?? data?.permissions ?? userNode?.permissions
  );

  const orgIdRaw = payload?.orgId ?? data?.orgId ?? userNode?.orgId;
  const orgIdStr =
    typeof orgIdRaw === "string"
      ? orgIdRaw.trim()
      : orgIdRaw != null
        ? String(orgIdRaw).trim()
        : "";
  const orgId =
    orgIdStr && orgIdStr !== "undefined" && orgIdStr !== "null" ? orgIdStr : null;
  const storefrontRaw =
    payload?.storefrontOrgId ?? data?.storefrontOrgId ?? userNode?.storefrontOrgId;
  const storefrontStr =
    typeof storefrontRaw === "string"
      ? storefrontRaw.trim()
      : storefrontRaw != null
        ? String(storefrontRaw).trim()
        : "";
  const storefrontOrgId =
    storefrontStr && storefrontStr !== "undefined" && storefrontStr !== "null"
      ? storefrontStr
      : null;
  const membershipRaw =
    payload?.membershipRole ?? data?.membershipRole ?? userNode?.membershipRole;
  const orgStatusRaw =
    payload?.orgStatus ??
    data?.orgStatus ??
    data?.organization?.status ??
    payload?.organization?.status;
  const organizationNameRaw =
    payload?.organizationName ??
    data?.organizationName ??
    data?.organization?.name ??
    payload?.organization?.name;
  const legalNameRaw =
    payload?.legalName ??
    data?.legalName ??
    data?.organization?.legalName ??
    payload?.organization?.legalName;
  const tradingNameRaw =
    payload?.tradingName ??
    data?.tradingName ??
    data?.organization?.tradingName ??
    payload?.organization?.tradingName;
  const companyDisplayNameRaw =
    payload?.companyDisplayName ??
    data?.companyDisplayName ??
    data?.organization?.companyDisplayName ??
    payload?.organization?.companyDisplayName;
  const completenessRaw =
    payload?.profileCompleteness ??
    data?.profileCompleteness ??
    data?.organization?.profileCompleteness ??
    payload?.organization?.profileCompleteness;
  const hasLogoRaw =
    payload?.hasLogo ??
    data?.hasLogo ??
    data?.organization?.hasLogo ??
    payload?.organization?.hasLogo;
  const companyLogoUrlRaw =
    payload?.companyLogoUrl ??
    data?.companyLogoUrl ??
    data?.organization?.logoUrl ??
    payload?.organization?.logoUrl;
  const organizationSlugRaw =
    payload?.organizationSlug ??
    data?.organizationSlug ??
    data?.organization?.slug ??
    payload?.organization?.slug;
  const subscriptionPlanRaw =
    payload?.subscriptionPlan ??
    data?.subscriptionPlan ??
    data?.organization?.subscriptionPlan ??
    payload?.organization?.subscriptionPlan;
  const requestedPlanRaw =
    payload?.requestedPlan ??
    data?.requestedPlan ??
    data?.organization?.requestedPlan ??
    payload?.organization?.requestedPlan;
  const requestedDurationMonthsRaw =
    payload?.requestedDurationMonths ??
    data?.requestedDurationMonths ??
    data?.organization?.requestedDurationMonths ??
    payload?.organization?.requestedDurationMonths;
  const subscriptionIntervalRaw =
    payload?.subscriptionInterval ??
    data?.subscriptionInterval ??
    data?.organization?.subscriptionInterval ??
    payload?.organization?.subscriptionInterval;
  const subscriptionStatusRaw =
    payload?.subscriptionStatus ??
    data?.subscriptionStatus ??
    data?.organization?.subscriptionStatus ??
    payload?.organization?.subscriptionStatus;
  const subscriptionEndsAtRaw =
    payload?.subscriptionEndsAt ??
    data?.subscriptionEndsAt ??
    data?.organization?.subscriptionEndsAt ??
    payload?.organization?.subscriptionEndsAt;
  const billingSoftHoldRaw =
    payload?.billingSoftHold ??
    data?.billingSoftHold ??
    data?.organization?.billingSoftHold ??
    payload?.organization?.billingSoftHold;
  const billingGraceEndsAtRaw =
    payload?.billingGraceEndsAt ??
    data?.billingGraceEndsAt ??
    data?.organization?.billingGraceEndsAt ??
    payload?.organization?.billingGraceEndsAt;
  const enterpriseHqEnabledRaw =
    payload?.enterpriseHqEnabled ??
    data?.enterpriseHqEnabled ??
    data?.organization?.enterpriseHqEnabled ??
    payload?.organization?.enterpriseHqEnabled;
  const parkLockedRaw = payload?.parkLocked ?? data?.parkLocked;
  const assignedLocationIdsRaw =
    payload?.assignedLocationIds ?? data?.assignedLocationIds;
  const effectiveLocationIdRaw =
    payload?.effectiveLocationId ?? data?.effectiveLocationId;
  const hqSelectedLocationIdRaw =
    payload?.hqSelectedLocationId ?? data?.hqSelectedLocationId;
  const franchiseParkManagerRaw =
    payload?.franchiseParkManager ?? data?.franchiseParkManager;
  const accountSuspendedRaw =
    payload?.accountSuspended ?? data?.accountSuspended ?? userNode?.accountSuspended;

  return normalizeSessionUser({
    id,
    email,
    // Prefer real display names over technical usernames for social logins.
    name:
      cleanStr(userNode?.name) ??
      compositeFull ??
      cleanStr(userNode?.username),
    fullName:
      cleanStr(userNode?.name) ??
      compositeFull ??
      cleanStr(userNode?.username),
    role: backendRole,
    avatar: cleanStr(userNode?.avatar) ?? cleanStr(userNode?.picture) ?? cleanStr(profile?.profilePicture),
    isVerified:
      typeof userNode?.isVerified === "boolean"
        ? userNode.isVerified
        : typeof profile?.isVerified === "boolean"
          ? profile.isVerified
          : undefined,
    permissions: permissionsFromPayload,
    orgId,
    storefrontOrgId,
    orgStatus: cleanStr(orgStatusRaw) ?? null,
    organizationName: cleanStr(organizationNameRaw) ?? null,
    legalName: cleanStr(legalNameRaw) ?? null,
    tradingName: cleanStr(tradingNameRaw) ?? null,
    companyDisplayName: cleanStr(companyDisplayNameRaw) ?? null,
    profileCompleteness:
      typeof completenessRaw === "number" && Number.isFinite(completenessRaw)
        ? completenessRaw
        : null,
    hasLogo: typeof hasLogoRaw === "boolean" ? hasLogoRaw : undefined,
    companyLogoUrl: cleanStr(companyLogoUrlRaw) ?? null,
    organizationSlug: cleanStr(organizationSlugRaw) ?? null,
    subscriptionPlan: cleanStr(subscriptionPlanRaw) ?? null,
    requestedPlan: cleanStr(requestedPlanRaw) ?? null,
    requestedDurationMonths:
      typeof requestedDurationMonthsRaw === "number" &&
      Number.isFinite(requestedDurationMonthsRaw)
        ? Math.floor(requestedDurationMonthsRaw)
        : typeof requestedDurationMonthsRaw === "string" &&
            requestedDurationMonthsRaw.trim() &&
            Number.isFinite(Number(requestedDurationMonthsRaw))
          ? Math.floor(Number(requestedDurationMonthsRaw))
          : null,
    subscriptionInterval: cleanStr(subscriptionIntervalRaw) ?? null,
    subscriptionStatus: cleanStr(subscriptionStatusRaw) ?? null,
    subscriptionEndsAt:
      subscriptionEndsAtRaw instanceof Date
        ? subscriptionEndsAtRaw.toISOString()
        : cleanStr(subscriptionEndsAtRaw) ?? null,
    billingSoftHold: billingSoftHoldRaw === true,
    billingGraceEndsAt:
      billingGraceEndsAtRaw instanceof Date
        ? billingGraceEndsAtRaw.toISOString()
        : cleanStr(billingGraceEndsAtRaw) ?? null,
    enterpriseHqEnabled: enterpriseHqEnabledRaw === true,
    parkLocked: parkLockedRaw === true,
    assignedLocationIds: Array.isArray(assignedLocationIdsRaw)
      ? assignedLocationIdsRaw.filter(
          (id): id is string => typeof id === "string" && Boolean(id.trim())
        )
      : [],
    effectiveLocationId:
      typeof effectiveLocationIdRaw === "string" &&
      effectiveLocationIdRaw.trim()
        ? effectiveLocationIdRaw.trim()
        : null,
    hqSelectedLocationId:
      typeof hqSelectedLocationIdRaw === "string" &&
      hqSelectedLocationIdRaw.trim()
        ? hqSelectedLocationIdRaw.trim()
        : null,
    franchiseParkManager: franchiseParkManagerRaw === true,
    accountSuspended: accountSuspendedRaw === true,
    membershipRole:
      typeof membershipRaw === "string" && membershipRaw.length
        ? membershipRaw
        : null,
    preset: cleanStr(payload?.preset) ?? cleanStr(data?.preset),
    companyWideView:
      typeof (payload?.companyWideView ?? data?.companyWideView) === "boolean"
        ? Boolean(payload?.companyWideView ?? data?.companyWideView)
        : undefined,
  });
}

/** Email/password login — relies on HttpOnly cookies set by server */
export async function loginWithEmail(params: {
  email: string;
  password: string;
  /** Sign in through this company's own login page (members only). */
  companySlug?: string | null;
}) {
  try {
    // Dev first-compile of /api/auth/login often takes 30–70s under webpack
    // pressure; default 90s races the abort and looks like "login hung".
    const data = await api(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: params.email.trim(),
          password: params.password, // don't trim passwords
          ...(params.companySlug ? { companySlug: params.companySlug } : {}),
        }),
      },
      { timeout: 120_000 }
    );
    // Do NOT return tokens even if backend includes them
    return { user: toUserProfile(data) };
  } catch (err) {
    // Server may have set session cookies just as the client aborted.
    if (
      err instanceof ApiError &&
      err.status === 0 &&
      (err.payload as { reason?: string } | undefined)?.reason === "timeout"
    ) {
      try {
        const me = await getMe({ force: true });
        if (me) return { user: me };
      } catch {
        /* fall through */
      }
    }
    throw err;
  }
}

/** Get current user from server session (cookies) */
export async function getMe(options?: { force?: boolean }) {
  if (options?.force) {
    getMeInflight = null;
  }
  if (!getMeInflight) {
    getMeInflight = api("/api/auth/me", { method: "GET" }).finally(() => {
      getMeInflight = null;
    });
  }
  const data = await getMeInflight;
  const memberships = Array.isArray(data?.memberships) ? data.memberships : [];
  return { user: toUserProfile(data), memberships };
}

/**
 * Re-issue access cookie from Membership (live permissions/orgId), then /me.
 * Use on admin boot so stale JWTs cannot keep serving old grants.
 * Single-flight on globalThis so Turbopack remounts cannot start a second POST.
 */
type RefreshAuthzGlobal = typeof globalThis & {
  __fecsyncRefreshAuthzPromise?: Promise<{ user: UserProfile }> | null;
};

export async function refreshSessionAuthz(): Promise<{ user: UserProfile }> {
  const g = globalThis as RefreshAuthzGlobal;
  if (!g.__fecsyncRefreshAuthzPromise) {
    g.__fecsyncRefreshAuthzPromise = (async () => {
      const { refreshAccessToken } = await import("@/utils/api");
      await refreshAccessToken();
      return getMe();
    })().finally(() => {
      g.__fecsyncRefreshAuthzPromise = null;
    });
  }
  return g.__fecsyncRefreshAuthzPromise;
}

/** Logout on server (best-effort). Cookies are HttpOnly so server must clear them. */
export async function logoutServer() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    // Use plain fetch — do not go through api() (90s timeout + refresh retry).
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    // ignore; client still clears local UI state
  } finally {
    clearTimeout(timer);
  }
}

/** Delete current user account */
export async function deleteCurrentUser() {
  // The api() utility returns parsed JSON data, not the Response object
  // If the request succeeds, we'll get the data back
  // If it fails, api() will throw an error
  const data = await api("/api/auth/me", {
    method: "DELETE",
  });

  // Return the response data (e.g., {"message": "User deleted successfully"})
  return data;
}

/** OAuth entry (opened in popup by the UI) */
export const GOOGLE_OAUTH_URL = "/api/auth/google";
