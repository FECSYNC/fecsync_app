export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Phase 4 — self-serve company registration (§5.2b).
 * Creates User (when public) + Organization (isDefault=false) + platform_admin
 * Membership via createOrganizationWithPlatformAdmin. Issues JWT with preferOrgId.
 * Does NOT overload closed /api/auth/signup or Google new-user create.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcrypt";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { signAccessToken, signRefreshToken } from "@/lib/jwt";
import {
  toPublicAuthzFromClaims,
  stampLiveRoleOnProfile,
} from "@/lib/auth/claims";
import {
  isStaffPreset,
  type RolePresetId,
} from "@/lib/auth/permissions";
import { resolveAuthzForUser } from "@/lib/membership";
import { isAuthHttpError } from "@/lib/auth/http-error";
import { appendAuthSessionCookies } from "@/lib/auth/sessionCookies";
import {
  createOrganizationWithPlatformAdmin,
  findRegisteredCompanyAdminOrgId,
  findPendingRegisteredCompanyAdminOrgId,
  findSuspendedRegisteredCompanyAdminOrgId,
  logOrganizationRegistered,
  ORG_SLUG_TAKEN_MESSAGE,
  ORG_NAME_TAKEN_MESSAGE,
  ORG_NAME_REQUIRED_MESSAGE,
  ORG_NAME_TOO_LONG_MESSAGE,
  ORG_CANNOT_CLAIM_DEFAULT_SLUG,
  ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE,
  ORG_USER_REQUIRED_MESSAGE,
  ORG_EMAIL_USE_SESSION_REGISTER_MESSAGE,
  ORG_ALREADY_HAS_COMPANY_MESSAGE,
} from "@/lib/orgRegistration";
import {
  ORG_SLUG_INVALID_MESSAGE,
  ORG_SLUG_RESERVED_MESSAGE,
  ORG_SUSPENDED_MESSAGE,
  ORG_PENDING_APPROVAL_MESSAGE,
  getStorefrontOrgId,
  assertOrganizationNotSuspended,
} from "@/lib/org";
import {
  organizationAuthFlatFields,
  organizationAuthSnapshot,
} from "@/lib/orgSession";
import {
  assertNotBlacklisted,
  BLACKLISTED_ACCOUNT_MESSAGE,
} from "@/lib/userBlacklist";
import { authRateLimited } from "@/lib/rateLimit";
import {
  generateUsername,
  splitFullName,
} from "@/lib/utils";
import {
  ensureProfileForUser,
  formatProfileForApi,
  loadProfileUser,
} from "@/lib/models/Profile";
import { ensureOwnedWallet } from "@/lib/wallet";
import {
  routeErrorResponse,
  badRequest,
  conflict,
  authErrorToResponse,
} from "@/lib/response";
import {
  isPlanCheckoutAvailable,
  isSubscriptionPlanId,
  normalizeBillingDurationMonths,
  type SubscriptionPlanId,
} from "@/lib/subscriptionPlans";

// Cap matches normalizeOrgSlug / register-company UI (64), not a looser API max.
const planField = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (v) => isSubscriptionPlanId(v),
    "plan must be a valid package id (demo, starter, growth, or enterprise)"
  );

const durationMonthsField = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => normalizeBillingDurationMonths(v));

const publicSchema = z.object({
  companyName: z.string().min(2).max(120),
  slug: z.string().min(2).max(64),
  fullName: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  /** Required package interest — Checkout / ops entitlement still separate. */
  plan: planField,
  /** Term length in months — ignored for Demo (free trial days). */
  durationMonths: durationMonthsField,
});

const sessionSchema = z.object({
  companyName: z.string().min(2).max(120),
  slug: z.string().min(2).max(64),
  plan: planField,
  durationMonths: durationMonthsField,
});

function requestedPlanFromBody(plan: string): SubscriptionPlanId {
  const id = plan.trim().toLowerCase();
  if (!isSubscriptionPlanId(id)) {
    throw new Error("Invalid plan");
  }
  return id;
}

/** Complete §5.2b AFTER when a company seat already exists (race / retry).
 * Used only for authenticated concurrent double-submit after a real create race —
 * never for public existing-email form submits (those must refuse and send to /signin).
 */
async function issueExistingCompanyAdminSession(
  req: NextRequest,
  userId: string
): Promise<NextResponse | null> {
  const orgId = await findRegisteredCompanyAdminOrgId(userId);
  if (orgId) {
    return issueCompanyAdminSession(req, userId, orgId, {
      alreadyRegistered: true,
    });
  }
  const pendingOrgId = await findPendingRegisteredCompanyAdminOrgId(userId);
  if (pendingOrgId) {
    return issueCompanyAdminSession(req, userId, pendingOrgId, {
      alreadyRegistered: true,
    });
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON");
    }

    await connectDB();

    let sessionSub: string | null = null;
    try {
      const { requireAuthActiveAccount } = await import(
        "@/lib/middleware/requireAuth"
      );
      sessionSub = (await requireAuthActiveAccount(req)).sub;
    } catch (err) {
      const { isAuthHttpError } = await import("@/lib/auth/http-error");
      const { isSuspendedAccessMessage } = await import(
        "@/lib/accountSuspendMessages"
      );
      if (
        isAuthHttpError(err) &&
        err.status === 403 &&
        isSuspendedAccessMessage(err.message)
      ) {
        return (
          authErrorToResponse(err) ??
          NextResponse.json({ message: err.message }, { status: 403 })
        );
      }
      sessionSub = null;
    }

    const bodyObj =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const hasPublicCredentials =
      typeof bodyObj.email === "string" &&
      typeof bodyObj.password === "string" &&
      bodyObj.email.trim().length > 0 &&
      bodyObj.password.length > 0;

    let userId: string;

    // Session path: signed-in client without staff Membership, company fields only
    // (no email/password in body). Full form with credentials always creates/links
    // via email — never silently bind a filled form to a different session user.
    if (sessionSub && !hasPublicCredentials) {
      const parsed = sessionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { message: "Invalid input", errors: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const user = await prisma.user.findUnique({
        where: { id: sessionSub },
        select: {
          id: true,
          email: true,
          phoneNumber: true,
          accountDeleted: true,
          accountSuspended: true,
          role: true,
        },
      });
      if (!user || user.accountDeleted) {
        return NextResponse.json({ message: "User not found" }, { status: 401 });
      }
      if (user.accountSuspended === true) {
        const { ACCOUNT_SUSPENDED_MESSAGE } = await import(
          "@/lib/accountSuspendMessages"
        );
        return NextResponse.json(
          { message: ACCOUNT_SUSPENDED_MESSAGE },
          { status: 403 }
        );
      }

      // Already owns an active/pending company — refuse re-registration.
      // Do not auto-sign-in / pretend this is a successful new register.
      // Concurrent double-submit recovery still uses issueExistingCompanyAdminSession
      // only after createOrganizationWithPlatformAdmin races below.
      const existingCompanyOrgId = await findRegisteredCompanyAdminOrgId(user.id);
      if (existingCompanyOrgId) {
        return conflict(ORG_ALREADY_HAS_COMPANY_MESSAGE);
      }

      const pendingCompanyOrgId =
        await findPendingRegisteredCompanyAdminOrgId(user.id);
      if (pendingCompanyOrgId) {
        return conflict(ORG_ALREADY_HAS_COMPANY_MESSAGE);
      }

      // Do not mis-label suspended company as dual-seat membership refuse.
      const suspendedCompanyOrgId =
        await findSuspendedRegisteredCompanyAdminOrgId(user.id);
      if (suspendedCompanyOrgId) {
        return NextResponse.json(
          { message: ORG_SUSPENDED_MESSAGE },
          { status: 403 }
        );
      }

      const currentAuthz = await resolveAuthzForUser(user);
      if (isStaffPreset(currentAuthz.preset as RolePresetId)) {
        return badRequest(
          "You already have a staff membership. Company registration is for new company admins only (no org switcher)."
        );
      }
      // Any membership row (invited/suspended/revoked/active) — no dual seat /
      // switcher. Matches createOrganizationWithPlatformAdmin gate.
      const existingMembership = await prisma.membership.findFirst({
        where: { userId: user.id },
        select: { id: true, rolePreset: true, status: true },
      });
      if (existingMembership) {
        return badRequest(ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE);
      }

      try {
        await assertNotBlacklisted(await getStorefrontOrgId(), {
          email: user.email,
          phone: user.phoneNumber,
        });
      } catch (err) {
        if (isAuthHttpError(err) && err.status === 403) {
          return NextResponse.json(
            { message: err.message || BLACKLISTED_ACCOUNT_MESSAGE },
            { status: 403 }
          );
        }
        throw err;
      }

      const limited = authRateLimited(
        req,
        "register-company",
        6,
        60 * 60 * 1000,
        user.id
      );
      if (limited) return limited;

      // Helper rotates refresh JTI to a fresh UUID (not revoked:) so in-flight
      // silentRefresh does not SESSION_REVOKED-logout while new cookies issue.
      try {
        const { organization } = await createOrganizationWithPlatformAdmin({
          name: parsed.data.companyName,
          slug: parsed.data.slug,
          userId: user.id,
          invalidateSessions: false,
          request: req,
          requestedPlan: requestedPlanFromBody(parsed.data.plan),
          requestedDurationMonths: parsed.data.durationMonths,
        });

        userId = user.id;
        void import("@/lib/companySubscriptionNotices")
          .then(async (m) => {
            await m.notifyCompanyRegistered(organization.id);
            await m.notifyHarewaOpsNewCompanyPending(organization.id);
          })
          .catch((err) =>
            console.warn("[register-company] notices failed:", err)
          );
        return await issueCompanyAdminSession(req, userId, organization.id);
      } catch (err) {
        // Concurrent double-submit: peer already committed the seat — finish AFTER.
        if (
          err instanceof Error &&
          err.message === ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE
        ) {
          const recovered = await issueExistingCompanyAdminSession(
            req,
            user.id
          );
          if (recovered) return recovered;
        }
        throw err;
      }
    }

    const parsed = publicSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid input", errors: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    try {
      await assertNotBlacklisted(await getStorefrontOrgId(), { email });
    } catch (err) {
      if (isAuthHttpError(err) && err.status === 403) {
        return NextResponse.json(
          { message: err.message || BLACKLISTED_ACCOUNT_MESSAGE },
          { status: 403 }
        );
      }
      throw err;
    }

    const existing = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        accountDeleted: true,
      },
    });
    // Soft-deleted and live existing emails share one message — no account-state
    // oracle and no password-verified auto-login from this form. Existing company
    // admins must use /signin. (True concurrent create races refuse the same way;
    // the winning request already issued cookies, or the user signs in.)
    if (existing) {
      const limitedExisting = authRateLimited(
        req,
        "register-company",
        6,
        60 * 60 * 1000,
        email
      );
      if (limitedExisting) return limitedExisting;
      return conflict(ORG_EMAIL_USE_SESSION_REGISTER_MESSAGE);
    }

    const limitedNew = authRateLimited(
      req,
      "register-company",
      6,
      60 * 60 * 1000,
      email
    );
    if (limitedNew) return limitedNew;

    const joinedAt = new Date();
    const hashedPassword = await bcrypt.hash(parsed.data.password, 12);
    const username = await generateUsername(joinedAt, parsed.data.fullName);
    const { firstName, lastName } = await splitFullName(parsed.data.fullName);

    // Company admins are verified at birth (ops create-admin equivalent).
    // Public company registration is verified at create — no email code gate.
    // Single transaction: User+Profile+Wallet+Org+Membership — no orphan client
    // if org create fails (avoids email lock without a company seat).
    const companyName = parsed.data.companyName;
    const companySlug = parsed.data.slug;
    let organizationId: string;
    try {
      const created = await prisma.$transaction(
        async (tx) => {
          const user = await tx.user.create({
            data: {
              firstName,
              lastName,
              email,
              password: hashedPassword,
              username,
              isVerified: true,
              joinedAt,
              role: "client",
            },
          });
          await tx.profile.create({
            data: {
              userId: user.id,
              firstName: firstName || "",
              lastName: lastName || "",
            },
          });
          await tx.wallet.create({
            data: { userId: user.id, balance: 0 },
          });
          // issueCompanyAdminSession rotates refresh JTI — do not revoke first.
          const reg = await createOrganizationWithPlatformAdmin(
            {
              name: companyName,
              slug: companySlug,
              userId: user.id,
              invalidateSessions: false,
              request: req,
              requestedPlan: requestedPlanFromBody(parsed.data.plan),
              requestedDurationMonths: parsed.data.durationMonths,
            },
            { tx }
          );
          return { user, ...reg };
        },
        { maxWait: 15_000, timeout: 30_000 }
      );

      await logOrganizationRegistered({
        userId: created.user.id,
        organization: created.organization,
        membership: created.membership,
        name: companyName,
        slug: created.organization.slug,
        request: req,
      });

      userId = created.user.id;
      organizationId = created.organization.id;
      void import("@/lib/companySubscriptionNotices")
        .then(async (m) => {
          await m.notifyCompanyRegistered(organizationId!);
          await m.notifyHarewaOpsNewCompanyPending(organizationId!);
        })
        .catch((err) =>
          console.warn("[register-company] notices failed:", err)
        );
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      if (code === "P2002") {
        const meta = (err as { meta?: { target?: unknown } }).meta;
        const targets = Array.isArray(meta?.target)
          ? meta.target.map((t) => String(t).toLowerCase())
          : typeof meta?.target === "string"
            ? [meta.target.toLowerCase()]
            : [];
        if (targets.some((t) => t.includes("username"))) {
          return badRequest(
            "Could not allocate a unique username. Try a different full name."
          );
        }
        if (targets.some((t) => t.includes("slug"))) {
          return badRequest(ORG_SLUG_TAKEN_MESSAGE);
        }
        if (targets.some((t) => t.includes("name"))) {
          return badRequest(ORG_NAME_TAKEN_MESSAGE);
        }
        // Email race: peer created the same email — never auto-sign-in from
        // register-company. Winning request holds the session, or they sign in.
        return conflict(ORG_EMAIL_USE_SESSION_REGISTER_MESSAGE);
      }
      if (
        err instanceof Error &&
        err.message === ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE
      ) {
        // Unlikely on public path (new user) unless concurrent attach — same
        // refuse as existing-email (no membership oracle / no auto-login).
        return conflict(ORG_EMAIL_USE_SESSION_REGISTER_MESSAGE);
      }
      throw err;
    }

    return await issueCompanyAdminSession(req, userId, organizationId);
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;
      if (
        msg === ORG_SLUG_TAKEN_MESSAGE ||
        msg === ORG_NAME_TAKEN_MESSAGE ||
        msg === ORG_NAME_REQUIRED_MESSAGE ||
        msg === ORG_NAME_TOO_LONG_MESSAGE ||
        msg === ORG_SLUG_INVALID_MESSAGE ||
        msg === ORG_SLUG_RESERVED_MESSAGE ||
        msg === ORG_CANNOT_CLAIM_DEFAULT_SLUG ||
        msg === ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE ||
        msg === ORG_USER_REQUIRED_MESSAGE
      ) {
        return badRequest(msg);
      }
    }
    return routeErrorResponse(err, "Failed to register company");
  }
}

async function issueCompanyAdminSession(
  req: NextRequest,
  userId: string,
  preferOrgId: string,
  options?: { alreadyRegistered?: boolean }
) {
  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ message: "User not found" }, { status: 500 });
  }

  // Soft-delete / blacklist can land between register commit and cookie issue
  // (or during AFTER). Never mint staff cookies for a dead/blocked account.
  if (user.accountDeleted) {
    return NextResponse.json({ message: "User not found" }, { status: 401 });
  }
  try {
    await assertNotBlacklisted(await getStorefrontOrgId(), {
      email: user.email,
      phone: user.phoneNumber,
    });
  } catch (err) {
    if (isAuthHttpError(err) && err.status === 403) {
      return NextResponse.json(
        { message: err.message || BLACKLISTED_ACCOUNT_MESSAGE },
        { status: 403 }
      );
    }
    throw err;
  }

  // AFTER / legacy rows: company admin must remain login-compatible.
  if (!user.isVerified || user.verificationCode) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true, verificationCode: null },
    });
  }

  const [profileRow, , authz, profileUser] = await Promise.all([
    ensureProfileForUser(user.id, {
      firstName: user.firstName || "",
      lastName: user.lastName || "",
    }),
    ensureOwnedWallet(user.id),
    resolveAuthzForUser(user, { preferOrgId }),
    loadProfileUser(user.id),
  ]);

  if (!profileUser) {
    return NextResponse.json(
      { message: "Unable to load user profile. Please try again." },
      { status: 500 }
    );
  }

  const profile = formatProfileForApi(profileRow, profileUser);
  stampLiveRoleOnProfile(profile, authz.role);

  // Prefer-org must resolve; otherwise we would stamp a storefront/client JWT
  // after a successful company register (preferOrgId miss / deleted seat).
  if (
    !authz.orgId ||
    authz.orgId !== preferOrgId ||
    authz.preset !== "platform_admin"
  ) {
    return NextResponse.json(
      {
        error:
          "Unable to establish company admin session. Sign in again, or contact support.",
      },
      { status: 500 }
    );
  }

  // Suspended companies cannot receive a staff session. Pending companies may —
  // they land on the waiting-room until FECSYNC approves.
  let orgStatus: string = "active";
  try {
    const org = await assertOrganizationNotSuspended(preferOrgId);
    orgStatus = org.status;
  } catch (err) {
    if (isAuthHttpError(err) && err.status === 403) {
      return NextResponse.json(
        { message: err.message || ORG_SUSPENDED_MESSAGE },
        { status: 403 }
      );
    }
    throw err;
  }

  const pendingApproval = orgStatus === "pending";
  let checkoutUrl: string | null = null;
  let checkoutError: string | null = null;
  let redirectTo = pendingApproval ? "/company-pending" : "/admin";

  // Self-serve: billable plans + free Demo ($0 / no card) open Stripe Checkout
  // while pending. Webhook / confirm activates the workspace.
  if (pendingApproval) {
    try {
      const orgBilling = await prisma.organization.findUnique({
        where: { id: preferOrgId },
        select: { requestedPlan: true, requestedDurationMonths: true },
      });
      const interest = orgBilling?.requestedPlan?.trim().toLowerCase() || "";
      if (
        interest &&
        isSubscriptionPlanId(interest) &&
        isPlanCheckoutAvailable(interest)
      ) {
        const { createCompanySubscriptionCheckout } = await import(
          "@/lib/companyBilling"
        );
        const { url } = await createCompanySubscriptionCheckout({
          orgId: preferOrgId,
          plan: interest,
          durationMonths: orgBilling?.requestedDurationMonths,
          allowPendingOnboarding: true,
          actor: {
            sub: user.id,
            email: user.email,
            preset: authz.preset,
            membershipRole: authz.membershipRole,
          },
        });
        checkoutUrl = url;
        // Keep redirectTo as waiting-room fallback if client cannot open Checkout.
      }
    } catch (err) {
      checkoutError =
        err instanceof Error
          ? err.message
          : "Could not start Stripe Checkout";
      console.warn(
        "[register-company] onboarding checkout unavailable — waiting room:",
        checkoutError
      );
    }
  }

  // Re-read authzVersion after promote / ensure steps so the JWT matches Fresh.
  const live = await prisma.user.findUnique({
    where: { id: user.id },
    select: { authzVersion: true },
  });
  const authzVersion =
    typeof live?.authzVersion === "number"
      ? live.authzVersion
      : typeof user.authzVersion === "number"
        ? user.authzVersion
        : 0;

  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    role: authz.role,
    permissions: authz.permissions,
    orgId: authz.orgId,
    membershipRole: authz.membershipRole,
    preset: authz.preset,
    companyWideView: authz.companyWideView,
    authzVersion,
  });

  const { token: refreshToken, jti: newJTI } = signRefreshToken(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenJTI: newJTI },
  });

  const orgSnap = await organizationAuthSnapshot(preferOrgId);
  const data = {
    success: true,
    profile,
    userId: user.id,
    role: authz.role,
    redirectTo,
    checkoutUrl,
    checkoutError,
    pendingApproval,
    ...(pendingApproval
      ? { pendingMessage: ORG_PENDING_APPROVAL_MESSAGE }
      : {}),
    ...toPublicAuthzFromClaims(authz),
    storefrontOrgId: await getStorefrontOrgId(),
    ...organizationAuthFlatFields(orgSnap),
    // Prefer live assert status if snapshot somehow diverges.
    orgStatus: orgSnap.orgStatus ?? orgStatus,
  };

  const message = options?.alreadyRegistered
    ? pendingApproval
      ? checkoutUrl
        ? "Company already registered. Continue to Checkout to activate your package."
        : "Company registration is awaiting FECSYNC approval."
      : "Company already registered. You are signed in as company admin."
    : pendingApproval
      ? checkoutUrl
        ? "Company registered. Continue to Checkout to pay for your package."
        : "Company registered. Awaiting FECSYNC approval before admin access."
      : "Company registered. You are signed in as company admin.";

  const response = new NextResponse(
    JSON.stringify({
      data,
      message,
    }),
    {
      status: options?.alreadyRegistered ? 200 : 201,
      headers: { "Content-Type": "application/json" },
    }
  );
  appendAuthSessionCookies(response, req, { accessToken, refreshToken });
  return response;
}
