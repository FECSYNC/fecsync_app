export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { signAccessToken, signRefreshToken } from "@/lib/jwt";
import prisma from "@/lib/prisma";
import { ensureProfileForUser } from "@/lib/models/Profile";
import { ensureOwnedWallet } from "@/lib/wallet";
import dbConnect from "@/lib/db";
import { resolveAuthzForUser } from "@/lib/membership";
import { getStorefrontOrgId } from "@/lib/org";
import { assertNotBlacklisted } from "@/lib/userBlacklist";
import { isAuthHttpError } from "@/lib/auth/http-error";
import { recordUserLogin } from "@/lib/audit/sessionAudit";
import { appendAuthSessionCookies } from "@/lib/auth/sessionCookies";
import {
  companyLoginGate,
  companyOnlySignIn,
  USE_COMPANY_SIGNIN_CODE,
} from "@/lib/companyLogin";
import { tenantDashboardOrigin } from "@/lib/tenantDomain";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL!;
const OAUTH_STATE_COOKIE = "oauth-state";
const OAUTH_COMPANY_COOKIE = "oauth-company";

function clearOAuthStateCookie(response: NextResponse) {
  const isProd = process.env.NODE_ENV === "production";
  for (const name of [OAUTH_STATE_COOKIE, OAUTH_COMPANY_COOKIE]) {
    response.headers.append(
      "Set-Cookie",
      [
        `${name}=`,
        "HttpOnly",
        "Path=/",
        "Max-Age=0",
        "SameSite=Lax",
        isProd ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; ")
    );
  }
  return response;
}

/**
 * The company sign-in page that opened this popup lives on {slug}.{root} when
 * subdomains are on (this callback is on the root host); otherwise same origin.
 */
function companyOpenerOrigin(req: NextRequest, slug: string | null): string | null {
  if (!slug) return null;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const protocol =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol;
  const port = host.includes(":") ? (host.split(":").pop() ?? "") : "";
  return tenantDashboardOrigin(slug, { protocol, port });
}

function popupMessageHtml(message: Record<string, unknown>, targetOrigin: string | null) {
  const target = targetOrigin ? JSON.stringify(targetOrigin) : "window.origin";
  // Escape "<" so profile strings cannot close the script tag.
  const payload = JSON.stringify(message).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html>
  <body>
    <script>
      window.opener && window.opener.postMessage(${payload}, ${target});
      window.close();
    </script>
  </body>
</html>`;
}

export async function GET(req: NextRequest) {
  await dbConnect();

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code) {
    return clearOAuthStateCookie(
      NextResponse.redirect(new URL("/login?error=NoCode", req.url))
    );
  }
  if (
    !state ||
    !expectedState ||
    state.length !== expectedState.length ||
    !crypto.timingSafeEqual(
      Buffer.from(state),
      Buffer.from(expectedState)
    )
  ) {
    return clearOAuthStateCookie(
      NextResponse.redirect(new URL("/login?error=InvalidState", req.url))
    );
  }

  // 1) Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_CALLBACK_URL,
      grant_type: "authorization_code",
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return NextResponse.redirect(new URL("/login?error=TokenExchangeFailed", req.url));
  }

  // 2) Fetch Google profile
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const googleProfile = await profileRes.json();
  if (!googleProfile.email || !googleProfile.id) {
    return NextResponse.redirect(new URL("/login?error=NoProfile", req.url));
  }

  const googleEmail = String(googleProfile.email).trim().toLowerCase();

  try {
    const orgId = await getStorefrontOrgId();
    await assertNotBlacklisted(orgId, { email: googleEmail });
  } catch (err) {
    if (isAuthHttpError(err) && err.status === 403) {
      return NextResponse.redirect(
        new URL("/signin?error=AccountBlocked", req.url)
      );
    }
    throw err;
  }

  // 3) Upsert user
  const existingUser = await prisma.user.findFirst({
    where: {
      email: googleEmail,
      googleId: null,
    },
  });
  const firstName =
    typeof googleProfile.given_name === "string" && googleProfile.given_name.trim().length
      ? googleProfile.given_name.trim()
      : undefined;
  const lastName =
    typeof googleProfile.family_name === "string" && googleProfile.family_name.trim().length
      ? googleProfile.family_name.trim()
      : undefined;
  const displayName =
    typeof googleProfile.name === "string" && googleProfile.name.trim().length
      ? googleProfile.name.trim()
      : googleEmail.split("@")[0];

  if (existingUser) {
    if (existingUser.accountDeleted) {
      return clearOAuthStateCookie(
        NextResponse.redirect(
          new URL("/signin?error=AccountDeleted", req.url)
        )
      );
    }
    if (existingUser.accountSuspended === true) {
      return clearOAuthStateCookie(
        NextResponse.redirect(
          new URL("/signin?error=AccountSuspended", req.url)
        )
      );
    }
    try {
      const orgId = await getStorefrontOrgId();
      await assertNotBlacklisted(orgId, {
        email: existingUser.email,
        phone: existingUser.phoneNumber,
      });
    } catch (err) {
      if (isAuthHttpError(err) && err.status === 403) {
        return NextResponse.redirect(
          new URL("/signin?error=AccountBlocked", req.url)
        );
      }
      throw err;
    }
    // Link Google only. Never promote role (admins: /register-company or create-admin).
    const wasUnverified = existingUser.isVerified === false;
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        googleId: googleProfile.id,
        username: displayName,
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
        isVerified: true,
        verificationCode: null,
        ...(wasUnverified ? { password: null } : {}),
      },
    });
  }

  let user = await prisma.user.findFirst({
    where: {
      googleId: googleProfile.id,
      email: googleEmail,
    },
  });
  if (user?.accountDeleted) {
    return clearOAuthStateCookie(
      NextResponse.redirect(
        new URL("/signin?error=AccountDeleted", req.url)
      )
    );
  }
  if (user?.accountSuspended === true) {
    return clearOAuthStateCookie(
      NextResponse.redirect(
        new URL("/signin?error=AccountSuspended", req.url)
      )
    );
  }
  if (!user) {
    // Soft-deleted email must not be recreated via Google (same policy as
    // register-company / password login).
    const deletedSameEmail = await prisma.user.findFirst({
      where: { email: googleEmail, accountDeleted: true },
      select: { id: true },
    });
    if (deletedSameEmail) {
      return clearOAuthStateCookie(
        NextResponse.redirect(
          new URL("/signin?error=AccountDeleted", req.url)
        )
      );
    }
    // Guest / shop self-registration via Google is closed.
    // New operators must use /register-company (+ package). Existing users
    // can still link/sign in with Google below.
    return clearOAuthStateCookie(
      NextResponse.redirect(
        new URL(
          "/register-company?error=UseCompanyRegistration",
          req.url
        )
      )
    );
  }

  try {
    const orgId = await getStorefrontOrgId();
    await assertNotBlacklisted(orgId, {
      email: user.email,
      phone: user.phoneNumber,
    });
  } catch (err) {
    if (isAuthHttpError(err) && err.status === 403) {
      return NextResponse.redirect(
        new URL("/signin?error=AccountBlocked", req.url)
      );
    }
    throw err;
  }

  const companySlug = req.cookies.get(OAUTH_COMPANY_COOKIE)?.value?.trim() || null;
  const openerOrigin = companyOpenerOrigin(req, companySlug);
  let companyOrgId: string | null = null;
  if (companySlug) {
    const gate = await companyLoginGate(user.id, companySlug);
    if (!gate.ok) {
      return clearOAuthStateCookie(
        new NextResponse(
          popupMessageHtml(
            {
              type: "oauth",
              status: "error",
              message: gate.message,
              code: gate.code,
              companySlug: gate.companySlug,
            },
            openerOrigin
          ),
          { headers: { "Content-Type": "text/html" } }
        )
      );
    }
    companyOrgId = gate.orgId;
  } else {
    const companyHome = await companyOnlySignIn(user.id);
    if (companyHome) {
      return clearOAuthStateCookie(
        new NextResponse(
          popupMessageHtml(
            {
              type: "oauth",
              status: "error",
              code: USE_COMPANY_SIGNIN_CODE,
              companySlug: companyHome.slug,
              message: `This account belongs to ${companyHome.name}. Sign in on ${companyHome.name}'s own sign-in page.`,
            },
            null
          ),
          { headers: { "Content-Type": "text/html" } }
        )
      );
    }
  }

  // Ensure profile doc exists and carries social avatar/name metadata.
  const picture =
    typeof googleProfile.picture === "string" && googleProfile.picture.trim().length
      ? googleProfile.picture.trim()
      : undefined;
  const existingProfile = await prisma.profile.findUnique({
    where: { userId: user.id },
  });
  if (!existingProfile) {
    await ensureProfileForUser(user.id, {
      firstName: firstName ?? user.firstName ?? "",
      lastName: lastName ?? user.lastName ?? "",
      profilePicture: picture ?? "",
    });
  } else {
    const patch: {
      firstName?: string;
      lastName?: string;
      profilePicture?: string;
    } = {};
    if (firstName && existingProfile.firstName !== firstName) {
      patch.firstName = firstName;
    }
    if (lastName && existingProfile.lastName !== lastName) {
      patch.lastName = lastName;
    }
    if (picture && existingProfile.profilePicture !== picture) {
      patch.profilePicture = picture;
    }
    if (Object.keys(patch).length > 0) {
      await prisma.profile.update({
        where: { id: existingProfile.id },
        data: patch,
      });
    }
  }

  await ensureOwnedWallet(user.id);

  // 4) Sign tokens & set cookies
  // companyOrgId is server-resolved and its active Membership verified above.
  const authz = await resolveAuthzForUser(user, { preferOrgId: companyOrgId });
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

  await recordUserLogin({
    userId: user.id,
    request: req,
    method: "google",
    orgId: authz.orgId,
  });

  const html = popupMessageHtml(
    {
      type: "oauth",
      status: "success",
      user: {
        name: displayName,
        picture: picture ?? "",
        email: String(googleProfile.email),
      },
    },
    openerOrigin
  );

  const response = new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
  appendAuthSessionCookies(response, req, { accessToken, refreshToken });
  clearOAuthStateCookie(response);
  return response;
}
