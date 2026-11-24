/**
 * Multi-company registration helper (Phase 1 contract; Phase 4 ships public UI/API).
 *
 * Creates a non-default Organization + first platform_admin Membership.
 * Does not change the storefront catalog org (DEFAULT_ORG_ID / isDefault Harewa).
 * Never trusts a client-supplied orgId — the org id is always server-generated.
 *
 * Does NOT auto-create VenueLocation rows — operators add parks/venues from
 * /admin/venues after Billing entitlement (Step 1 multi-park foundation).
 *
 * Closed guest /api/auth/signup must NOT call this. Company Admin = platform_admin
 * Membership (no Organization.ownerUserId).
 *
 * Phase 4 public API: bind `userId` to session `sub` when credentials are
 * omitted; when email/password are present, create that user (never trust a
 * client-supplied userId).
 *
 * Workflow (aligned with §5.2b + invite member session rules):
 *   BEFORE → validate name/slug/user/blacklist
 *   DURING → single transaction: lock user row → refuse any Membership →
 *            Organization + Membership + User.role=admin + isVerified=true +
 *            always bump authzVersion; set refresh JTI to revoked:… when
 *            invalidateSessions, else rotate to a fresh UUID (Phase 4)
 *   AFTER  → ActivityLog (best-effort, after commit); caller/Phase 4 issues
 *            JWT with preferOrgId
 */

import { randomUUID } from "crypto";
import type { Membership, Organization, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { asIdString, requireId } from "@/lib/ids";
import { logActivityEntryAsync } from "@/lib/audit/activityLog";
import { PRESET_TO_DB_ROLE } from "@/lib/auth/permissions";
import {
  DEFAULT_ORG_SLUG,
  LEGACY_DEFAULT_ORG_SLUG,
  getStorefrontOrgId,
  normalizeOrgSlug,
  ORG_SLUG_INVALID_MESSAGE,
  ORG_SLUG_RESERVED_MESSAGE,
  ORG_SUBSCRIPTION_PLANS,
  type OrgSubscriptionPlan,
} from "@/lib/org";
import { isReservedFirstSegment } from "@/lib/publicCategory/slug";
import { isReservedTenantSubdomain } from "@/lib/tenantDomain";
import {
  isBillingDurationMonths,
  normalizeBillingDurationMonths,
} from "@/lib/subscriptionPlans";
import { assertNotBlacklisted } from "@/lib/userBlacklist";

function normalizeRequestedPlan(
  raw: string | null | undefined
): OrgSubscriptionPlan | null {
  if (typeof raw !== "string") return null;
  const plan = raw.trim().toLowerCase();
  if (!plan) return null;
  return ORG_SUBSCRIPTION_PLANS.includes(plan as OrgSubscriptionPlan)
    ? (plan as OrgSubscriptionPlan)
    : null;
}

export const ORG_SLUG_TAKEN_MESSAGE = "Organization slug already in use";
export const ORG_NAME_TAKEN_MESSAGE =
  "A company with this name is already registered. Open the existing workspace or choose a different name.";
export const ORG_NAME_REQUIRED_MESSAGE = "Organization name is required";
export const ORG_NAME_TOO_LONG_MESSAGE = "Organization name is too long";
export const ORG_USER_REQUIRED_MESSAGE = "A valid userId is required";
export const ORG_CANNOT_CLAIM_DEFAULT_SLUG =
  "Cannot register a company with the storefront default slug";
export const ORG_INVITED_BY_INVALID_MESSAGE =
  "invitedById must reference an existing active user";
/** No org switcher: one user cannot own / seat on a second company via this helper. */
export const ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE =
  "User already has an organization membership. Company registration is for accounts without an existing org role (no org switcher).";

/**
 * Public /register-company when the email already belongs to a User.
 * Never auto-sign-in from this form — protect existing workspaces; send them to /signin.
 * Same message for soft-deleted and live accounts (no account-state oracle).
 */
export const ORG_EMAIL_USE_SESSION_REGISTER_MESSAGE =
  "This email is already registered. Sign in to open your existing company workspace, or use a different email. Registration will not create another company for this email.";

/**
 * Authenticated session retry on /register-company when the user already owns
 * an active or pending company admin seat. Do not re-issue as a “successful register.”
 */
export const ORG_ALREADY_HAS_COMPANY_MESSAGE =
  "Your account already has a registered company workspace. Sign in to open it — you cannot register another company with this account.";

/**
 * @deprecated Prefer ORG_EMAIL_USE_SESSION_REGISTER_MESSAGE for all
 * existing-email refusals so responses do not enumerate company-admin emails.
 */
export const ORG_EMAIL_SIGN_IN_ADMIN_MESSAGE =
  ORG_EMAIL_USE_SESSION_REGISTER_MESSAGE;

/** Same prefix as memberAdmin.invalidateUserSessions — forces re-login on refresh. */
const REFRESH_REVOKED_PREFIX = "revoked:";

export type CreateOrganizationWithPlatformAdminInput = {
  name: string;
  slug: string;
  /** Existing User id that becomes the first platform_admin. */
  userId: string;
  invitedById?: string | null;
  /**
   * Landing /register-company?plan= interest (demo|starter|growth|enterprise).
   * Stored as Organization.requestedPlan only — never sets subscriptionPlan.
   * Demo entitlement still comes from free Stripe Checkout (no card / no charge).
   */
  requestedPlan?: string | null;
  /**
   * Checkout term interest in months (1|2|3|6|12|24|60).
   * Stored as Organization.requestedDurationMonths — never entitles alone.
   */
  requestedDurationMonths?: number | null;
  /**
   * When true (default), set refresh JTI to revoked:… (same as invite).
   * When false (Phase 4 register-company), rotate to a fresh non-revoked UUID
   * so old refresh cookies fail without SESSION_REVOKED, then caller issues
   * new cookies. authzVersion always increments on successful registration.
   */
  invalidateSessions?: boolean;
  request?: Parameters<typeof logActivityEntryAsync>[0]["request"];
};

export type CreateOrganizationWithPlatformAdminOptions = {
  /**
   * Join an outer transaction (e.g. public register-company creates
   * User+Profile+Wallet+Org+Membership atomically). When set, audit is
   * deferred — caller must invoke `logOrganizationRegistered` after commit.
   */
  tx?: Prisma.TransactionClient;
};

export type CreateOrganizationWithPlatformAdminResult = {
  organization: Organization;
  membership: Membership;
};

/**
 * Active platform_admin seat on a non-default (registered) company.
 * Used to complete §5.2b AFTER idempotently when cookies failed or the
 * client retries register-company — not an org switcher.
 * Only returns orgs with status `active` (pending/suspended cannot full AFTER).
 */
export async function findRegisteredCompanyAdminOrgId(
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string | null> {
  const uid = requireId(userId, "userId");
  const row = await db.membership.findFirst({
    where: {
      userId: uid,
      status: "active",
      rolePreset: "platform_admin",
      // Suspended/pending company must not get full AFTER unlock.
      org: { isDefault: false, status: "active" },
    },
    select: { orgId: true },
    orderBy: { createdAt: "asc" },
  });
  return row?.orgId ?? null;
}

/**
 * Pending registered company (awaiting Harewa approval) — session recovery
 * to the waiting-room, not /admin unlock.
 */
export async function findPendingRegisteredCompanyAdminOrgId(
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string | null> {
  const uid = requireId(userId, "userId");
  const row = await db.membership.findFirst({
    where: {
      userId: uid,
      status: "active",
      rolePreset: "platform_admin",
      org: { isDefault: false, status: "pending" },
    },
    select: { orgId: true },
    orderBy: { createdAt: "asc" },
  });
  return row?.orgId ?? null;
}

/**
 * Same seat as findRegisteredCompanyAdminOrgId but org is suspended
 * (ops hold / subscription ended). Callers should 403 with ORG_SUSPENDED_MESSAGE
 * instead of mis-labeling as dual-seat.
 */
export async function findSuspendedRegisteredCompanyAdminOrgId(
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string | null> {
  const uid = requireId(userId, "userId");
  const row = await db.membership.findFirst({
    where: {
      userId: uid,
      status: "active",
      rolePreset: "platform_admin",
      org: { isDefault: false, status: "suspended" },
    },
    select: { orgId: true },
    orderBy: { createdAt: "asc" },
  });
  return row?.orgId ?? null;
}

function requireOrgName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error(ORG_NAME_REQUIRED_MESSAGE);
  }
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length < 2) {
    throw new Error(ORG_NAME_REQUIRED_MESSAGE);
  }
  if (name.length > 120) {
    throw new Error(ORG_NAME_TOO_LONG_MESSAGE);
  }
  return name;
}

/** Shared slug rules for helper + orgRegistrationCreateData. */
function requireRegistrableOrgSlug(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error(ORG_SLUG_INVALID_MESSAGE);
  }
  const slug = normalizeOrgSlug(raw);
  if (!slug) {
    throw new Error(ORG_SLUG_INVALID_MESSAGE);
  }
  if (slug === DEFAULT_ORG_SLUG || slug === LEGACY_DEFAULT_ORG_SLUG) {
    throw new Error(ORG_CANNOT_CLAIM_DEFAULT_SLUG);
  }
  if (isReservedFirstSegment(slug) || isReservedTenantSubdomain(slug)) {
    throw new Error(ORG_SLUG_RESERVED_MESSAGE);
  }
  return slug;
}

function uniqueConstraintTargets(err: unknown): string[] {
  if (!err || typeof err !== "object" || !("meta" in err)) return [];
  const meta = (err as { meta?: { target?: unknown } }).meta;
  const target = meta?.target;
  if (Array.isArray(target)) return target.map((t) => String(t).toLowerCase());
  if (typeof target === "string") return [target.toLowerCase()];
  return [];
}

function mapOrgRegistrationUniqueViolation(err: unknown): Error | null {
  const targets = uniqueConstraintTargets(err);
  if (targets.length === 0) return null;
  if (
    targets.some(
      (t) =>
        t.includes("userid") ||
        t === "user_id" ||
        (t.includes("user") && t.includes("org"))
    )
  ) {
    // Same (userId, orgId) race — treat as dual-seat / already seated.
    return new Error(ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE);
  }
  if (targets.some((t) => t.includes("slug"))) {
    return new Error(ORG_SLUG_TAKEN_MESSAGE);
  }
  if (targets.some((t) => t.includes("name"))) {
    return new Error(ORG_NAME_TAKEN_MESSAGE);
  }
  return null;
}

/** Best-effort audit after a successful (committed) registration. */
export async function logOrganizationRegistered(input: {
  userId: string;
  organization: Organization;
  membership: Membership;
  name: string;
  slug: string;
  request?: Parameters<typeof logActivityEntryAsync>[0]["request"];
}): Promise<void> {
  await logActivityEntryAsync({
    actorSub: input.userId,
    orgId: input.organization.id,
    action: "Organization Registered",
    entityType: "System",
    entityId: input.organization.id,
    description: `Created organization "${input.name}" (${input.slug}) with platform_admin`,
    request: input.request,
    metadata: {
      slug: input.slug,
      membershipId: input.membership.id,
      domain: "org-registration",
      requestedPlan: input.organization.requestedPlan ?? null,
      requestedDurationMonths:
        input.organization.requestedDurationMonths ?? null,
    },
  });
}

/**
 * Create Organization (isDefault=false, status=pending, subscriptionStatus=none)
 * + platform_admin Membership (companyWideView=true, status=active) in one
 * transaction. User.role is set to admin in the same transaction
 * (invite-equivalent sync). Demo uses free Stripe Checkout (no card); paid
 * packages use Checkout or ops Approve later via assertStorefrontPlatformAdmin.
 *
 * Serializes per-user via `SELECT … FOR UPDATE` so concurrent register-company
 * / helper calls cannot create dual Membership seats.
 */
export async function createOrganizationWithPlatformAdmin(
  input: CreateOrganizationWithPlatformAdminInput,
  options?: CreateOrganizationWithPlatformAdminOptions
): Promise<CreateOrganizationWithPlatformAdminResult> {
  const name = requireOrgName(input.name);
  const slug = requireRegistrableOrgSlug(input.slug);

  const userId = requireId(input.userId, "userId");
  let invitedById = input.invitedById
    ? asIdString(input.invitedById)
    : null;
  const invalidateSessions = input.invalidateSessions !== false;
  const externalTx = options?.tx;
  const db = externalTx ?? prisma;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      accountDeleted: true,
      email: true,
      phoneNumber: true,
    },
  });
  if (!user || user.accountDeleted) {
    throw new Error(ORG_USER_REQUIRED_MESSAGE);
  }

  if (invitedById) {
    if (invitedById === userId) {
      invitedById = null;
    } else {
      const inviter = await db.user.findUnique({
        where: { id: invitedById },
        select: { id: true, accountDeleted: true },
      });
      if (!inviter || inviter.accountDeleted) {
        throw new Error(ORG_INVITED_BY_INVALID_MESSAGE);
      }
    }
  }

  // Same gate as public signup: storefront-org blacklist blocks company onboarding.
  // Blacklist reads stay on the global client (safe outside / beside the write tx).
  await assertNotBlacklisted(await getStorefrontOrgId(), {
    email: user.email,
    phone: user.phoneNumber,
  });

  const write = async (tx: Prisma.TransactionClient) => {
    // Lock the user row so concurrent helpers serialize the membership gate.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;

    const locked = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, accountDeleted: true },
    });
    if (!locked || locked.accountDeleted) {
      throw new Error(ORG_USER_REQUIRED_MESSAGE);
    }

    const existingMembership = await tx.membership.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (existingMembership) {
      throw new Error(ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE);
    }

    const existingSlug = await tx.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existingSlug) {
      throw new Error(ORG_SLUG_TAKEN_MESSAGE);
    }

    // Case-insensitive company name — blocks re-registering the same workspace
    // (slug uniqueness alone used to allow "Acme" + "Acme" as acme / acme-2).
    // Serialize concurrent same-name creates within this transaction.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`org-name:${name.toLowerCase()}`}))
    `;
    const nameClash = await tx.organization.findFirst({
      where: {
        isDefault: false,
        name: { equals: name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (nameClash) {
      throw new Error(ORG_NAME_TAKEN_MESSAGE);
    }

    const requestedPlan = normalizeRequestedPlan(input.requestedPlan);
    // Do not coerce missing duration to 1 — that falsely labels ops interest as
    // "1 month" before Approve / Set plan stamps the real grant.
    const requestedDurationMonths =
      requestedPlan === "demo"
        ? 1
        : requestedPlan && isBillingDurationMonths(input.requestedDurationMonths)
          ? normalizeBillingDurationMonths(input.requestedDurationMonths)
          : null;
    const organization = await tx.organization.create({
      data: {
        name,
        slug,
        isDefault: false,
        // Demo and paid packages both start pending — entitlement comes from
        // Stripe Checkout (Demo = $0 / no card) or ops plan stamp.
        status: "pending",
        subscriptionStatus: "none",
        ...(requestedPlan ? { requestedPlan } : {}),
        ...(requestedDurationMonths != null
          ? { requestedDurationMonths }
          : {}),
      },
    });

    const membership = await tx.membership.create({
      data: {
        userId,
        orgId: organization.id,
        rolePreset: "platform_admin",
        companyWideView: true,
        status: "active",
        invitedById: invitedById || undefined,
        permissionsOverride: [],
      },
    });

    // Always bump authzVersion when promoting to company admin so pre-register
    // access tokens fail Fresh. Mark verified in the same write so session-path
    // promote / helper callers cannot leave platform_admin + isVerified:false
    // (login would 403 after logout). When invalidateSessions is false (Phase 4
    // register-company), rotate refresh JTI to a fresh UUID — not `revoked:` —
    // so in-flight silentRefresh gets plain expiry instead of SESSION_REVOKED
    // logout while new cookies are being issued.
    await tx.user.update({
      where: { id: userId },
      data: {
        role: PRESET_TO_DB_ROLE.platform_admin,
        authzVersion: { increment: 1 },
        isVerified: true,
        verificationCode: null,
        refreshTokenJTI: invalidateSessions
          ? `${REFRESH_REVOKED_PREFIX}${randomUUID()}`
          : randomUUID(),
      },
    });

    return { organization, membership };
  };

  let result: CreateOrganizationWithPlatformAdminResult;
  try {
    result = externalTx
      ? await write(externalTx)
      : await prisma.$transaction(write, {
          // Interactive tx + FOR UPDATE on pooled Postgres can exceed the
          // default 5s; keep registration atomic without P2028 flakiness.
          maxWait: 15_000,
          timeout: 30_000,
        });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message === ORG_SLUG_TAKEN_MESSAGE ||
        err.message === ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE ||
        err.message === ORG_USER_REQUIRED_MESSAGE ||
        err.message === ORG_INVITED_BY_INVALID_MESSAGE
      ) {
        throw err;
      }
    }
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code === "P2002") {
      const mapped = mapOrgRegistrationUniqueViolation(err);
      if (mapped) throw mapped;
    }
    if (code === "P2003") {
      const field = String(
        (err as { meta?: { field_name?: unknown } }).meta?.field_name ?? ""
      );
      if (field.toLowerCase().includes("invitedby")) {
        throw new Error(ORG_INVITED_BY_INVALID_MESSAGE);
      }
      if (field.toLowerCase().includes("userid")) {
        throw new Error(ORG_USER_REQUIRED_MESSAGE);
      }
      // FK race after pre-checks (inviter deleted, etc.)
      throw new Error(ORG_INVITED_BY_INVALID_MESSAGE);
    }
    throw err;
  }

  // Audit only after this helper owns a committed transaction. Outer-tx callers
  // must call logOrganizationRegistered after their commit succeeds.
  if (!externalTx) {
    await logOrganizationRegistered({
      userId,
      organization: result.organization,
      membership: result.membership,
      name,
      slug,
      request: input.request,
    });
  }

  return result;
}

/** Prisma-friendly create data for tests/scripts that already hold a tx. */
export function orgRegistrationCreateData(input: {
  name: string;
  slug: string;
}): Prisma.OrganizationCreateInput {
  return {
    name: requireOrgName(input.name),
    slug: requireRegistrableOrgSlug(input.slug),
    status: "pending",
    isDefault: false,
    subscriptionStatus: "none",
  };
}
