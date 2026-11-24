/**
 * Organization helpers — Account → Organization (architecture-doc Account).
 *
 * Tenant root is Organization, not Shop. Company Admin = active Membership with
 * rolePreset `platform_admin` (no ownerUserId FK on Organization).
 *
 * JWT `orgId` / membershipRole come from Membership when present.
 * Storefront catalog uses this module (never JWT orgId for public shop):
 *   1. `DEFAULT_ORG_ID` env (current storefront org), if that org exists
 *   2. else the unique `isDefault` org (bootstrap FECSYNC storefront)
 *
 * Multi-company registration creates additional orgs with `isDefault: false`
 * via `@/lib/orgRegistration` — it must not claim the storefront default.
 * New registered companies start as `status: pending` until a FECSYNC
 * storefront platform_admin approves them (`active`). Subscription expiry /
 * ops holds use `suspended` (staff/tailor fail-closed; public shop unaffected).
 *
 * Staff catalog/order mutations use `@/lib/staffOrg` (actor.orgId), not these
 * storefront helpers. Cart / Wishlist stay user-scoped (no orgId on those models).
 */

import prisma from "@/lib/prisma";
import { asIdString, isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { PLATFORM_BRAND_NAME } from "@/lib/platformBrand";
import { isReservedFirstSegment } from "@/lib/publicCategory/slug";
import { isReservedTenantSubdomain } from "@/lib/tenantDomain";

/** App route / public folder segments, plus infra hosts (slug is also the dashboard subdomain). */
export function isReservedOrgSlug(slug: string): boolean {
  return isReservedFirstSegment(slug) || isReservedTenantSubdomain(slug);
}

export const DEFAULT_ORG_NAME = PLATFORM_BRAND_NAME;
export const DEFAULT_ORG_SLUG = "fecsync";
/** Former client storefront slug — reserved forever; never show in product UI. */
export const LEGACY_DEFAULT_ORG_SLUG = "harewa";
/** Server-only storefront catalog selector. Documented in README. */
export const DEFAULT_ORG_ENV_KEY = "DEFAULT_ORG_ID";
export const ORG_SUSPENDED_MESSAGE = "Organization is suspended";
export const ORG_PENDING_APPROVAL_MESSAGE =
  "Organization is pending FECSYNC approval";
export const ORG_SLUG_INVALID_MESSAGE = "Organization slug is invalid";
/** Company links are /{orgSlug}/…, so the slug may not shadow an app route or public folder. */
export const ORG_SLUG_RESERVED_MESSAGE = "That company link is reserved";

/** Re-export plan ids from subscriptionPlans SSOT (avoid divergent arrays). */
export {
  ORG_SUBSCRIPTION_PLANS,
  type OrgSubscriptionPlan,
} from "@/lib/subscriptionPlans";

export const ORG_SUBSCRIPTION_STATUSES = [
  "none",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;
export type OrgSubscriptionStatus = (typeof ORG_SUBSCRIPTION_STATUSES)[number];

type CachedOrg = {
  defaultOrgId: string;
  storefrontOrgId: string;
};

let cache: Promise<CachedOrg> | null = null;

/** Normalize a company slug for uniqueness (lowercase kebab). */
export function normalizeOrgSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Pick a free Organization.slug from a preferred name/slug.
 * Never claims the storefront default slug. Appends -2, -3, … then a short
 * random suffix if needed. Pass `excludeOrgId` when renaming an existing org.
 */
export async function allocateUniqueOrgSlug(
  preferredRaw: string,
  options?: { excludeOrgId?: string | null }
): Promise<string> {
  let base = normalizeOrgSlug(preferredRaw);
  if (!base) base = "company";
  if (base === DEFAULT_ORG_SLUG || base === LEGACY_DEFAULT_ORG_SLUG) {
    base = `${base}-workspace`.slice(0, 64);
  }

  const exclude =
    typeof options?.excludeOrgId === "string" && options.excludeOrgId.trim()
      ? options.excludeOrgId.trim()
      : null;

  const isFree = async (slug: string): Promise<boolean> => {
    const row = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!row) return true;
    return Boolean(exclude && row.id === exclude);
  };

  if (!isReservedOrgSlug(base) && (await isFree(base))) return base;

  for (let i = 2; i <= 99; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
    if (await isFree(candidate)) return candidate;
  }

  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const suffix = `-${rand}`;
  return `${base.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
}

/**
 * Company-admin rename of Organization.slug. Exact slug must be free (or
 * unchanged). Storefront / default org cannot rename.
 */
export async function updateOrganizationSlug(
  orgId: string,
  preferredRaw: string
): Promise<{ slug: string; changed: boolean }> {
  const id = String(orgId || "").trim();
  if (!id) {
    throw new Error(ORG_SLUG_INVALID_MESSAGE);
  }
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, slug: true, isDefault: true },
  });
  if (!org) {
    throw new Error(ORG_SLUG_INVALID_MESSAGE);
  }
  if (org.isDefault) {
    throw new Error("The platform storefront organization slug cannot be changed");
  }

  const next = normalizeOrgSlug(preferredRaw);
  if (!next) {
    throw new Error(ORG_SLUG_INVALID_MESSAGE);
  }
  // Profile saves resend the current slug; a legacy slug that is now reserved
  // must not block unrelated profile edits.
  if (next === org.slug) {
    return { slug: org.slug, changed: false };
  }
  if (next === DEFAULT_ORG_SLUG || next === LEGACY_DEFAULT_ORG_SLUG) {
    throw new Error("That slug is reserved for the platform storefront");
  }
  if (isReservedOrgSlug(next)) {
    throw new Error(ORG_SLUG_RESERVED_MESSAGE);
  }

  const taken = await prisma.organization.findUnique({
    where: { slug: next },
    select: { id: true },
  });
  if (taken && taken.id !== id) {
    throw new Error("Organization slug already in use");
  }

  await prisma.organization.update({
    where: { id },
    data: { slug: next },
  });
  return { slug: next, changed: true };
}

type OrgStatusRow = {
  status: string;
  isDefault?: boolean;
};

const LIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
]);

type OrgLazyExpireRow = {
  id: string;
  status: string;
  isDefault: boolean;
  subscriptionEndsAt: Date | null;
  subscriptionStatus: string | null;
  /** Used to detect Demo demotion vs prior paid plan. */
  subscriptionPlan?: string | null;
};

/**
 * Shared lazy expiry used by Fresh gates, `/me`, and login snapshots.
 * When a non-storefront active org has a live subscriptionStatus and a past
 * `subscriptionEndsAt`, soft-hold immediately; Demo demotion runs only after
 * COMPANY_BILLING_GRACE_DAYS (same as reconcile/webhooks).
 * Returns updated status fields (and whether an expire/demote completed).
 */
export async function applyLazySubscriptionExpiryIfNeeded(
  org: OrgLazyExpireRow,
  reason = "fresh:subscriptionEndsAt passed"
): Promise<{
  status: string;
  subscriptionStatus: string | null;
  subscriptionEndsAt: Date | null;
  subscriptionPlan?: string | null;
  didExpire: boolean;
}> {
  const liveSub = LIVE_SUBSCRIPTION_STATUSES.has(
    org.subscriptionStatus || ""
  );
  const pastEnds =
    org.subscriptionEndsAt != null &&
    org.subscriptionEndsAt.getTime() < Date.now();

  // Past-period apply refuse can stamp past_due before endsAt exists.
  // Try Stripe refresh first (same as overdue); only soft-deny / expire after.
  if (
    !org.isDefault &&
    org.status === "active" &&
    org.subscriptionStatus === "past_due" &&
    org.subscriptionEndsAt == null
  ) {
    try {
      const storefrontOrgId = await getStorefrontOrgId();
      if (org.id === storefrontOrgId) {
        return {
          status: org.status,
          subscriptionStatus: org.subscriptionStatus,
          subscriptionEndsAt: org.subscriptionEndsAt,
          didExpire: false,
        };
      }
    } catch {
      /* fall through */
    }
    try {
      const {
        tryRefreshBoundSubscriptionIfLive,
        markOrganizationSubscriptionExpired,
      } = await import("@/lib/companyBilling");
      const refreshed = await tryRefreshBoundSubscriptionIfLive(org.id);
      if (refreshed === true) {
        const again = await prisma.organization.findUnique({
          where: { id: org.id },
          select: {
            status: true,
            subscriptionStatus: true,
            subscriptionEndsAt: true,
            subscriptionPlan: true,
          },
        });
        return {
          status: again?.status ?? org.status,
          subscriptionStatus:
            again?.subscriptionStatus ?? org.subscriptionStatus,
          subscriptionEndsAt:
            again?.subscriptionEndsAt ?? org.subscriptionEndsAt,
          subscriptionPlan: again?.subscriptionPlan ?? null,
          didExpire: false,
        };
      }
      if (refreshed === null) {
        const latest = await prisma.organization.findUnique({
          where: { id: org.id },
          select: {
            status: true,
            subscriptionStatus: true,
            subscriptionEndsAt: true,
            subscriptionPlan: true,
          },
        });
        // Align with overdue soft-skip: accept concurrent unlock
        // (approve-without-plan → none/null, or ops grant → future endsAt).
        const stillLive = LIVE_SUBSCRIPTION_STATUSES.has(
          latest?.subscriptionStatus || ""
        );
        const stillPastDueNull =
          latest?.subscriptionStatus === "past_due" &&
          latest.subscriptionEndsAt == null;
        const stillPast =
          latest?.subscriptionEndsAt != null &&
          latest.subscriptionEndsAt.getTime() < Date.now();
        if (
          latest?.status === "active" &&
          (!stillLive || (!stillPastDueNull && !stillPast))
        ) {
          return {
            status: latest.status,
            subscriptionStatus: latest.subscriptionStatus,
            subscriptionEndsAt: latest.subscriptionEndsAt,
            subscriptionPlan: latest.subscriptionPlan,
            didExpire: false,
          };
        }
        return {
          status: "suspended",
          subscriptionStatus:
            latest?.subscriptionStatus ?? org.subscriptionStatus,
          subscriptionEndsAt:
            latest?.subscriptionEndsAt ?? org.subscriptionEndsAt,
          subscriptionPlan: latest?.subscriptionPlan ?? null,
          didExpire: false,
        };
      }
      await markOrganizationSubscriptionExpired(org.id, reason, {
        cancelStripe: true,
        requireStillOverdue: true,
      });
      const confirmed = await prisma.organization.findUnique({
        where: { id: org.id },
        select: {
          status: true,
          subscriptionStatus: true,
          subscriptionEndsAt: true,
          subscriptionPlan: true,
        },
      });
      if (confirmed?.status === "suspended") {
        return {
          status: "suspended",
          subscriptionStatus: confirmed.subscriptionStatus,
          subscriptionEndsAt: confirmed.subscriptionEndsAt,
          subscriptionPlan: confirmed.subscriptionPlan,
          didExpire: true,
        };
      }
      if (
        confirmed?.status === "active" &&
        confirmed.subscriptionPlan?.trim().toLowerCase() === "demo" &&
        org.subscriptionPlan?.trim().toLowerCase() !== "demo"
      ) {
        return {
          status: "active",
          subscriptionStatus: confirmed.subscriptionStatus,
          subscriptionEndsAt: confirmed.subscriptionEndsAt,
          subscriptionPlan: confirmed.subscriptionPlan,
          didExpire: true,
        };
      }
      return {
        status: confirmed?.status ?? org.status,
        subscriptionStatus:
          confirmed?.subscriptionStatus ?? org.subscriptionStatus,
        subscriptionEndsAt:
          confirmed?.subscriptionEndsAt ?? org.subscriptionEndsAt,
        subscriptionPlan: confirmed?.subscriptionPlan ?? null,
        didExpire: false,
      };
    } catch (err) {
      console.warn(
        "[org] past_due null-endsAt refresh failed:",
        org.id,
        err
      );
      // Re-read so a concurrent Approve unlock is not sticky-denied.
      try {
        const latest = await prisma.organization.findUnique({
          where: { id: org.id },
          select: {
            status: true,
            subscriptionStatus: true,
            subscriptionEndsAt: true,
            subscriptionPlan: true,
          },
        });
        const stillLive = LIVE_SUBSCRIPTION_STATUSES.has(
          latest?.subscriptionStatus || ""
        );
        const stillPastDueNull =
          latest?.subscriptionStatus === "past_due" &&
          latest.subscriptionEndsAt == null;
        const stillPast =
          latest?.subscriptionEndsAt != null &&
          latest.subscriptionEndsAt.getTime() < Date.now();
        if (
          latest?.status === "active" &&
          (!stillLive || (!stillPastDueNull && !stillPast))
        ) {
          return {
            status: latest.status,
            subscriptionStatus: latest.subscriptionStatus,
            subscriptionEndsAt: latest.subscriptionEndsAt,
            subscriptionPlan: latest.subscriptionPlan,
            didExpire: false,
          };
        }
      } catch {
        /* fall through to soft-deny */
      }
      return {
        status: "suspended",
        subscriptionStatus: org.subscriptionStatus,
        subscriptionEndsAt: org.subscriptionEndsAt,
        didExpire: false,
      };
    }
  }

  if (
    org.isDefault ||
    org.status !== "active" ||
    !liveSub ||
    !pastEnds
  ) {
    return {
      status: org.status,
      subscriptionStatus: org.subscriptionStatus,
      subscriptionEndsAt: org.subscriptionEndsAt,
      didExpire: false,
    };
  }

  // Never lazy-expire the public storefront org (env DEFAULT_ORG_ID or isDefault).
  try {
    const storefrontOrgId = await getStorefrontOrgId();
    if (org.id === storefrontOrgId) {
      return {
        status: org.status,
        subscriptionStatus: org.subscriptionStatus,
        subscriptionEndsAt: org.subscriptionEndsAt,
        didExpire: false,
      };
    }
  } catch {
    /* cache/bootstrap failure — fall through; isDefault already gated above */
  }

  try {
    const {
      tryRefreshBoundSubscriptionIfLive,
      markOrganizationSubscriptionExpired,
    } = await import("@/lib/companyBilling");

    // Prefer reconcile-style refresh when Stripe still shows a live future period.
    // Confirmed non-live → expire + cancel Stripe. Transient Stripe errors →
    // deny without durable suspend (avoid ops-hold on outage).
    const refreshed = await tryRefreshBoundSubscriptionIfLive(org.id);
    if (refreshed === true) {
      const again = await prisma.organization.findUnique({
        where: { id: org.id },
        select: {
          status: true,
          subscriptionStatus: true,
          subscriptionEndsAt: true,
          subscriptionPlan: true,
        },
      });
      return {
        status: again?.status ?? org.status,
        subscriptionStatus: again?.subscriptionStatus ?? org.subscriptionStatus,
        subscriptionEndsAt: again?.subscriptionEndsAt ?? org.subscriptionEndsAt,
        subscriptionPlan: again?.subscriptionPlan ?? null,
        didExpire: false,
      };
    }

    if (refreshed === null) {
      // Soft-skip or Stripe unreachable — re-read before synthetic suspend so a
      // concurrent apply that already advanced endsAt is not sticky-locked on /me.
      const latest = await prisma.organization.findUnique({
        where: { id: org.id },
        select: {
          status: true,
          subscriptionStatus: true,
          subscriptionEndsAt: true,
          subscriptionPlan: true,
        },
      });
      const endsAt = latest?.subscriptionEndsAt ?? null;
      const stillPast =
        endsAt != null && endsAt.getTime() < Date.now();
      const stillLive = LIVE_SUBSCRIPTION_STATUSES.has(
        latest?.subscriptionStatus || ""
      );
      if (
        latest?.status === "active" &&
        (!stillLive || !stillPast)
      ) {
        return {
          status: latest.status,
          subscriptionStatus: latest.subscriptionStatus,
          subscriptionEndsAt: latest.subscriptionEndsAt,
          subscriptionPlan: latest.subscriptionPlan,
          didExpire: false,
        };
      }
      // Fail-closed for this request without writing expire. Align /me with Fresh.
      return {
        status: "suspended",
        subscriptionStatus:
          latest?.subscriptionStatus ?? org.subscriptionStatus,
        subscriptionEndsAt:
          latest?.subscriptionEndsAt ?? org.subscriptionEndsAt,
        subscriptionPlan: latest?.subscriptionPlan ?? null,
        didExpire: false,
      };
    }

    // refreshed === false: no binding, or Stripe confirmed not live/future.
    // Paid plans: Demo demotion only after COMPANY_BILLING_GRACE_DAYS.
    // Demo trials: suspend as soon as endsAt passes (no grace).
    const { isDemoPlanId } = await import("@/lib/subscriptionPlans");
    const onDemo = isDemoPlanId(org.subscriptionPlan);
    if (!onDemo && org.subscriptionEndsAt) {
      const { isPastBillingGracePeriod } = await import("@/lib/billingGrace");
      if (!isPastBillingGracePeriod(org.subscriptionEndsAt)) {
        return {
          status: org.status,
          subscriptionStatus: org.subscriptionStatus,
          subscriptionEndsAt: org.subscriptionEndsAt,
          subscriptionPlan: org.subscriptionPlan ?? null,
          didExpire: false,
        };
      }
    }

    await markOrganizationSubscriptionExpired(org.id, reason, {
      cancelStripe: true,
      requireStillOverdue: true,
    });
  } catch (err) {
    console.warn("[org] lazy subscription expire failed:", org.id, err);
  }

  const confirmed = await prisma.organization.findUnique({
    where: { id: org.id },
    select: {
      status: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      subscriptionPlan: true,
    },
  });
  if (confirmed?.status === "suspended") {
    return {
      status: "suspended",
      subscriptionStatus: confirmed.subscriptionStatus,
      subscriptionEndsAt: confirmed.subscriptionEndsAt,
      subscriptionPlan: confirmed.subscriptionPlan,
      didExpire: true,
    };
  }

  // Demo demotion (active + demo) — treat as completed expire for callers.
  if (
    confirmed?.status === "active" &&
    confirmed.subscriptionPlan?.trim().toLowerCase() === "demo" &&
    org.subscriptionPlan?.trim().toLowerCase() !== "demo"
  ) {
    return {
      status: "active",
      subscriptionStatus: confirmed.subscriptionStatus,
      subscriptionEndsAt: confirmed.subscriptionEndsAt,
      subscriptionPlan: confirmed.subscriptionPlan,
      didExpire: true,
    };
  }

  // Expire write failed or still in grace — leave Fresh / soft-hold to retry.
  return {
    status: confirmed?.status ?? org.status,
    subscriptionStatus:
      confirmed?.subscriptionStatus ?? org.subscriptionStatus,
    subscriptionEndsAt: confirmed?.subscriptionEndsAt ?? org.subscriptionEndsAt,
    subscriptionPlan: confirmed?.subscriptionPlan ?? null,
    didExpire: false,
  };
}

/**
 * Session may continue for `pending` (post-register waiting room).
 * `suspended` (ops hold / subscription ended) fail-closes staff Fresh paths.
 * Public storefront is unaffected.
 *
 * Note: overdue subscriptionEndsAt is handled by
 * `applyLazySubscriptionExpiryIfNeeded` in assertOrganizationActive and in
 * `/me` / login snapshots (not here) so waiting-room `/me` with
 * allowSuspendedOrg can still refresh after expiry.
 */
export async function assertOrganizationNotSuspended(
  orgId: string
): Promise<OrgStatusRow> {
  const id = asIdString(orgId);
  if (!id) {
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE);
  }
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { status: true, isDefault: true, subscriptionStatus: true },
  });
  if (!org) {
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, id);
  }
  if (org.status === "suspended") {
    const sub = (org.subscriptionStatus || "").trim().toLowerCase();
    if (sub === "ops_hold") {
      const { ACCOUNT_SUSPENDED_MESSAGE } = await import(
        "@/lib/accountSuspendMessages"
      );
      throw new ForbiddenError(ACCOUNT_SUSPENDED_MESSAGE, id);
    }
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, id);
  }
  return org;
}

/**
 * Staff/tailor operational unlock — org must be `active`.
 * Pending companies can hold a session but cannot run /admin mutations,
 * catalog writes, or studio tools until Harewa approves.
 *
 * Lazy expiry: non-storefront orgs with a live subscriptionStatus and a past
 * `subscriptionEndsAt` are suspended here (ops grant / missed cron/webhook)
 * so PermissionFresh fail-closes without waiting for reconcile.
 */
export async function assertOrganizationActive(
  orgId: string
): Promise<OrgStatusRow> {
  const id = asIdString(orgId);
  if (!id) {
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE);
  }

  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      isDefault: true,
      subscriptionEndsAt: true,
      subscriptionStatus: true,
      subscriptionPlan: true,
    },
  });
  if (!org) {
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, id);
  }

  const after = await applyLazySubscriptionExpiryIfNeeded(
    org,
    "fresh:subscriptionEndsAt passed"
  );
  // Ops / durable suspend only. Demo demotion sets didExpire + active — allow
  // through so demo lock (not this gate) restricts apps.
  if (after.status === "suspended") {
    const sub = (
      after.subscriptionStatus ||
      org.subscriptionStatus ||
      ""
    )
      .trim()
      .toLowerCase();
    // Manual ops hold — same unlock copy as User.accountSuspended (IT dialog).
    if (sub === "ops_hold") {
      const { ACCOUNT_SUSPENDED_MESSAGE } = await import(
        "@/lib/accountSuspendMessages"
      );
      throw new ForbiddenError(ACCOUNT_SUSPENDED_MESSAGE, id);
    }
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, id);
  }
  if (after.status === "pending" || org.status === "pending") {
    throw new ForbiddenError(ORG_PENDING_APPROVAL_MESSAGE, id);
  }
  if (after.status !== "active") {
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, id);
  }
  // Soft-hold: overdue live period (incl. grace) — Fresh soft-denies until renew
  // or Demo demotion stamps a future Demo endsAt.
  const stillLive = LIVE_SUBSCRIPTION_STATUSES.has(
    after.subscriptionStatus || ""
  );
  const stillPast =
    after.subscriptionEndsAt != null &&
    after.subscriptionEndsAt.getTime() < Date.now();
  if (!org.isDefault && stillLive && stillPast) {
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, id);
  }
  // past_due without endsAt (past-period refuse) — soft-deny if lazy missed it.
  if (
    !org.isDefault &&
    after.subscriptionStatus === "past_due" &&
    after.subscriptionEndsAt == null
  ) {
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, id);
  }

  return { status: after.status, isDefault: org.isDefault };
}

/**
 * Workspace export / soft-offboard gate.
 * Allows `active` (incl. soft billing hold) and billing/Demo `suspended`
 * (`expired`) so waiting-room portability stays available.
 * Denies pending and manual ops_hold (contact IT — no self-serve lifecycle).
 * Does not run lazy hard-expiry.
 */
export async function assertOrganizationAllowsWorkspaceLifecycle(
  orgId: string
): Promise<OrgStatusRow> {
  const id = asIdString(orgId);
  if (!id) {
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE);
  }
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { status: true, isDefault: true, subscriptionStatus: true },
  });
  if (!org) {
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, id);
  }
  if (org.status === "pending") {
    throw new ForbiddenError(ORG_PENDING_APPROVAL_MESSAGE, id);
  }
  if (org.status !== "active" && org.status !== "suspended") {
    throw new ForbiddenError(ORG_SUSPENDED_MESSAGE, id);
  }
  if (
    org.status === "suspended" &&
    (org.subscriptionStatus || "").trim().toLowerCase() === "ops_hold"
  ) {
    const { ACCOUNT_SUSPENDED_MESSAGE } = await import(
      "@/lib/accountSuspendMessages"
    );
    throw new ForbiddenError(ACCOUNT_SUSPENDED_MESSAGE, id);
  }
  return { status: org.status, isDefault: org.isDefault };
}

export function parseDefaultOrgEnv(
  raw: string | undefined = process.env.DEFAULT_ORG_ID
): string | null {
  const value = raw?.trim();
  if (!value || !isValidId(value)) return null;
  return value;
}

/** Exactly one default storefront org (FECSYNC). Idempotent.
 * Renames legacy client slug → DEFAULT_ORG_SLUG when found.
 * Never promote a registered company (`isDefault: false`) to storefront
 * default just because it is the only Organization row.
 */
export async function ensureDefaultOrganization() {
  let org = await prisma.organization.findFirst({ where: { isDefault: true } });
  if (!org) {
    org = await prisma.organization.findUnique({
      where: { slug: DEFAULT_ORG_SLUG },
    });
  }
  if (!org) {
    org = await prisma.organization.findUnique({
      where: { slug: LEGACY_DEFAULT_ORG_SLUG },
    });
  }
  if (!org) {
    // Sole-org fallback only when that row is already a storefront slug —
    // never steal a self-serve company's isDefault:false identity.
    const only = await prisma.organization.findMany({ take: 2 });
    if (
      only.length === 1 &&
      (only[0].slug === DEFAULT_ORG_SLUG ||
        only[0].slug === LEGACY_DEFAULT_ORG_SLUG)
    ) {
      org = only[0];
    }
  }
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: DEFAULT_ORG_NAME,
        slug: DEFAULT_ORG_SLUG,
        status: "active",
        isDefault: true,
      },
    });
  } else if (!org.isDefault) {
    await prisma.$transaction([
      prisma.organization.updateMany({
        where: { isDefault: true, NOT: { id: org.id } },
        data: { isDefault: false },
      }),
      prisma.organization.update({
        where: { id: org.id },
        data: { isDefault: true, status: "active" },
      }),
    ]);
    org = { ...org, isDefault: true, status: "active" };
  }

  // Scrub legacy client branding from the storefront org row.
  if (
    org.slug === LEGACY_DEFAULT_ORG_SLUG ||
    org.name !== DEFAULT_ORG_NAME ||
    org.slug !== DEFAULT_ORG_SLUG
  ) {
    const taken = await prisma.organization.findFirst({
      where: {
        slug: DEFAULT_ORG_SLUG,
        NOT: { id: org.id },
      },
      select: { id: true },
    });
    const nextSlug = taken ? org.slug : DEFAULT_ORG_SLUG;
    org = await prisma.organization.update({
      where: { id: org.id },
      data: {
        name: DEFAULT_ORG_NAME,
        ...(nextSlug !== org.slug ? { slug: nextSlug } : {}),
        isDefault: true,
        status: "active",
      },
    });
  }

  return org;
}

async function resolveCachedOrg(): Promise<CachedOrg> {
  const defaultOrg = await ensureDefaultOrganization();
  const defaultOrgId = defaultOrg.id;

  const envId = parseDefaultOrgEnv();
  if (envId && envId !== defaultOrgId) {
    const storefront = await prisma.organization.findUnique({
      where: { id: envId },
      select: { id: true },
    });
    if (storefront) {
      return {
        defaultOrgId,
        storefrontOrgId: storefront.id,
      };
    }
    console.warn(
      `[org] ${DEFAULT_ORG_ENV_KEY}=${envId} was not found; using default org ${defaultOrgId}`
    );
  }

  return { defaultOrgId, storefrontOrgId: defaultOrgId };
}

async function getCachedOrg(): Promise<CachedOrg> {
  if (!cache) {
    cache = resolveCachedOrg().catch((err) => {
      cache = null;
      throw err;
    });
  }
  return cache;
}

/** Invalidate cached default/storefront ids after org bootstrap/registration. */
export function clearOrgIdCache(): void {
  cache = null;
}

export async function getDefaultOrgId(): Promise<string> {
  const { defaultOrgId } = await getCachedOrg();
  return defaultOrgId;
}

export async function getStorefrontOrgId(): Promise<string> {
  const { storefrontOrgId } = await getCachedOrg();
  return storefrontOrgId;
}

/** True when actor.orgId is the public storefront / default Harewa org. */
export async function isStorefrontOrganization(
  orgId: string | null | undefined
): Promise<boolean> {
  const id = asIdString(orgId);
  if (!id) return false;
  const storefrontOrgId = await getStorefrontOrgId();
  return id === storefrontOrgId;
}

/** Public catalog / discovery filter — never JWT orgId. */
export async function storefrontOrgFilter(): Promise<{ orgId: string }> {
  return { orgId: await getStorefrontOrgId() };
}

export async function withStorefrontOrg<T extends Record<string, unknown>>(
  filter: T
): Promise<T & { orgId: string }> {
  return { ...filter, orgId: await getStorefrontOrgId() };
}

/** Stamp server-side orgId. Never take orgId from the client. */
export async function stampStorefrontOrgId<T extends Record<string, unknown>>(
  fields: T
): Promise<T & { orgId: string }> {
  const next = { ...fields };
  delete (next as { orgId?: unknown }).orgId;
  return { ...next, orgId: await getStorefrontOrgId() };
}

export function orgIdsEqual(a: unknown, b: unknown): boolean {
  const left = asIdString(a);
  const right = asIdString(b);
  if (!left || !right) return false;
  return left === right;
}

/** One shared org across line items; otherwise null (caller uses default/storefront). */
export function soleLineOrgId(orgIds: Iterable<unknown>): string | null {
  const unique = new Set<string>();
  for (const raw of orgIds) {
    const id = asIdString(raw);
    if (id) unique.add(id);
  }
  if (unique.size !== 1) return null;
  return [...unique][0] ?? null;
}

/**
 * Checkout / order stamp: prefer the sole catalog org on the cart lines;
 * mixed or empty carts fall back to the Harewa storefront org.
 */
export async function orgIdForOrder(
  orgIds: Iterable<unknown>
): Promise<string> {
  const sole = soleLineOrgId(orgIds);
  if (sole) return sole;
  return getStorefrontOrgId();
}
