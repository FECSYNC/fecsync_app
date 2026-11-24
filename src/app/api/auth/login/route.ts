export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import { signAccessToken, signRefreshToken } from "@/lib/jwt";
import { toPublicAuthzFromClaims, stampLiveRoleOnProfile } from "@/lib/auth/claims";
import { resolveAuthzForUser } from "@/lib/membership";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import dbConnect, { withDbRetry } from "@/lib/db";
import {
  getAdminEmail,
  sendAdminVerificationEmail,
  sendVerificationEmail,
} from "@/lib/mailer";
import { generateVerificationCode } from "@/lib/utils";
import {
  ensureProfileForUser,
  formatProfileForApi,
  loadProfileUser,
} from "@/lib/models/Profile";
import { getStorefrontOrgId } from "@/lib/org";
import { appendAuthSessionCookies } from "@/lib/auth/sessionCookies";
import {
  companyLoginGate,
  companyOnlySignIn,
  USE_COMPANY_SIGNIN_CODE,
} from "@/lib/companyLogin";
import { tenantSlugFromHost } from "@/lib/tenantDomain";
import {
  organizationAuthFlatFields,
  organizationAuthSnapshot,
} from "@/lib/orgSession";
import {
  assertNotBlacklisted,
  BLACKLISTED_ACCOUNT_MESSAGE,
} from "@/lib/userBlacklist";
import { isAuthHttpError } from "@/lib/auth/http-error";
import { recordUserLogin } from "@/lib/audit/sessionAudit";
import { authRateLimited } from "@/lib/rateLimit";
import { routeErrorResponse } from "@/lib/response";

async function verifyPassword(input: string, hashed: string) {
  return bcrypt.compare(input, hashed);
}

export async function POST(req: NextRequest) {
  // Parse once outside withDbRetry — request bodies cannot be re-read on retry.
  let body: { email?: unknown; password?: unknown; companySlug?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid sign-in request. Please try again." },
      { status: 400 }
    );
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const { password } = body;
  // A company subdomain always signs in to that company; /signin/{slug} names it in the body.
  const companySlug =
    tenantSlugFromHost(req.headers.get("x-forwarded-host") ?? req.headers.get("host")) ??
    (typeof body.companySlug === "string" && body.companySlug.trim()
      ? body.companySlug.trim()
      : null);

  try {
    return await withDbRetry(async () => {
      await dbConnect();

      const limited = authRateLimited(req, "login", 12, 15 * 60 * 1000, email);
      if (limited) return limited;

      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        return NextResponse.json(
          { message: "Account does not exist. Register a company workspace at /register-company." },
          { status: 404 }
        );
      }

      const storefrontOrgId = await getStorefrontOrgId();

      try {
        await assertNotBlacklisted(storefrontOrgId, {
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

      if (user.googleId && !user.password) {
        return NextResponse.json(
          { message: "Google account, password login not supported." },
          { status: 403 }
        );
      }

      if (
        typeof password !== "string" ||
        !password ||
        typeof user.password !== "string" ||
        !(await verifyPassword(password, user.password))
      ) {
        return NextResponse.json(
          { message: "Wrong Password. password or email not correct." },
          { status: 401 }
        );
      }
      if (user.accountDeleted) {
        return NextResponse.json(
          { message: "User Account deleted" },
          { status: 403 }
        );
      }
      if (user.accountSuspended === true) {
        const { ACCOUNT_SUSPENDED_MESSAGE } = await import(
          "@/lib/accountSuspend"
        );
        return NextResponse.json(
          { message: ACCOUNT_SUSPENDED_MESSAGE },
          { status: 403 }
        );
      }
      let companyOrgId: string | null = null;
      if (companySlug) {
        const gate = await companyLoginGate(user.id, companySlug);
        if (!gate.ok) {
          return NextResponse.json(
            { message: gate.message, code: gate.code, companySlug: gate.companySlug },
            { status: gate.status }
          );
        }
        companyOrgId = gate.orgId;
      } else {
        // The platform sign-in is for FECSYNC staff and customers; company staff use their link.
        const companyHome = await companyOnlySignIn(user.id);
        if (companyHome) {
          return NextResponse.json(
            {
              message: `This account belongs to ${companyHome.name}. Sign in on ${companyHome.name}'s own sign-in page.`,
              code: USE_COMPANY_SIGNIN_CODE,
              companySlug: companyHome.slug,
              companyName: companyHome.name,
            },
            { status: 403 }
          );
        }
      }
      if (user.isVerified === false) {
        const verificationCode = generateVerificationCode();
        await prisma.user.update({
          where: { id: user.id },
          data: { verificationCode },
        });
        if (user.role == "admin" && getAdminEmail()) {
          await sendAdminVerificationEmail(user.email, verificationCode);
        } else {
          await sendVerificationEmail(email, verificationCode);
        }
        return NextResponse.json(
          { message: "User is not verified, verify your acount." },
          { status: 403 }
        );
      }

      // Profile + authz + user row for API shape in parallel.
      const [profileRow, authz, profileUser] = await Promise.all([
        ensureProfileForUser(user.id, {
          firstName: user.firstName || "",
          lastName: user.lastName || "",
        }),
        // companyOrgId is server-resolved and its active Membership verified above.
        resolveAuthzForUser(user, { preferOrgId: companyOrgId }),
        loadProfileUser(user.id),
      ]);

      if (!profileUser) {
        return NextResponse.json(
          { message: "Unable to load user profile. Please try again." },
          { status: 500 }
        );
      }
      let profile = formatProfileForApi(profileRow, profileUser);

      stampLiveRoleOnProfile(profile, authz.role);
      const accessToken = signAccessToken({
        id: user.id,
        email: user.email,
        role: authz.role,
        permissions: authz.permissions,
        orgId: authz.orgId,
        membershipRole: authz.membershipRole,
        preset: authz.preset,
        companyWideView: authz.companyWideView,
        authzVersion: typeof user.authzVersion === "number" ? user.authzVersion : 0,
      });

      const { token: refreshToken, jti: newJTI } = signRefreshToken(user.id);

      await prisma.user.update({
        where: { id: user.id },
        data: { refreshTokenJTI: newJTI },
      });

      // Audit + wallet should not block issuing cookies.
      void recordUserLogin({
        userId: user.id,
        request: req,
        method: "password",
        orgId: authz.orgId,
      }).catch((err) => {
        console.error("[auth/login] recordUserLogin failed:", err);
      });

      void (async () => {
        try {
          const { ensureOwnedWallet } = await import("@/lib/wallet");
          await ensureOwnedWallet(user.id);
        } catch (walletError) {
          console.error("[auth/login] wallet provision failed:", walletError);
        }
      })();

      // Tokens stay HttpOnly cookies only — never echo them in JSON (XSS amplification).
      const orgSnap = await organizationAuthSnapshot(authz.orgId, {
        orgId: authz.orgId,
        preset: authz.preset,
        membershipRole: authz.membershipRole,
        storefrontOrgId,
      });
      let parkLocked = false;
      let assignedLocationIds: string[] = [];
      let effectiveLocationId: string | null = null;
      let hqSelectedLocationId: string | null = null;
      let franchiseParkManager = false;
      if (authz.orgId && user.id) {
        try {
          const { resolveEffectiveParkScope } = await import(
            "@/lib/parkAdminScope"
          );
          const scope = await resolveEffectiveParkScope({
            orgId: authz.orgId,
            sub: user.id,
            companyWideView: authz.companyWideView,
            preset: authz.preset,
            membershipRole: authz.membershipRole,
            storefrontOrgId,
          });
          parkLocked = scope.parkLocked;
          assignedLocationIds = scope.assignedLocationIds;
          effectiveLocationId = scope.locationId;
          hqSelectedLocationId = scope.hqSelectedLocationId;
          franchiseParkManager = scope.franchiseParkManager === true;
        } catch {
          // Fail-closed: never imply company-wide parks on resolve errors.
          parkLocked = true;
          assignedLocationIds = [];
          effectiveLocationId = null;
          hqSelectedLocationId = null;
          franchiseParkManager = false;
        }
      }
      const data = {
        success: true,
        profile,
        userId: user.id,
        ...toPublicAuthzFromClaims(authz),
        parkLocked,
        assignedLocationIds,
        effectiveLocationId,
        hqSelectedLocationId,
        franchiseParkManager,
        storefrontOrgId,
        ...organizationAuthFlatFields(orgSnap),
      };
      const response = new NextResponse(
        JSON.stringify({ data, "message": "Login successful" }
        ), {
        status: 200,

        headers: {
          "Content-Type": "application/json",
        },
      });

      appendAuthSessionCookies(response, req, { accessToken, refreshToken });

      return response;
    });
  } catch (error) {
    return routeErrorResponse(error, "Login failed");
  }
}
