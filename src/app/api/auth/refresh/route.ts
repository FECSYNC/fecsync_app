export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import {
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  peekAccessTokenOrgId,
} from "@/lib/jwt";
import dbConnect, { withDbRetry } from "@/lib/db";
import prisma from "@/lib/prisma";
import { resolveAuthzForUser } from "@/lib/membership";
import { isRefreshSessionRevoked } from "@/lib/memberAdmin";
import { routeErrorResponse } from "@/lib/response";
import { isTransientDbError } from "@/lib/commerceSerialize";
import { appendAuthSessionCookies } from "@/lib/auth/sessionCookies";

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get("refresh-token")?.value;

  if (!refreshToken) {
    return NextResponse.json(
      { message: "No refresh token provided" },
      { status: 401 }
    );
  }

  try {
    return await withDbRetry(async () => {
      await dbConnect();

      const decoded = verifyRefreshToken(refreshToken);
      const user = await prisma.user.findFirst({
      where: {
        OR: [{ id: String(decoded.sub) }, { legacyId: String(decoded.sub) }],
      },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        role: true,
        accountDeleted: true,
        authzVersion: true,
        refreshTokenJTI: true,
      },
    });

    if (!user) throw new Error("Invalid user");

    // Explicit revoke (delete / blacklist / role change) — force re-login.
    // Distinct code so clients do not fall back to /me with a stale access JWT.
    if (isRefreshSessionRevoked(user.refreshTokenJTI)) {
      return NextResponse.json(
        {
          message: "Session revoked. Please sign in again.",
          code: "SESSION_REVOKED",
        },
        { status: 401 }
      );
    }

    // Reuse detection when a prior JTI is still recorded and does not match.
    // Legacy null JTI (pre-rotation / older sessions) is allowed once, then rotated.
    // Do NOT clear the stored JTI on mismatch — a parallel refresh may have already
    // won and written a new JTI; wiping it would log the winner out too.
    // Distinct code so clients try /me (winner's cookies) instead of hard-logout.
    if (
      user.refreshTokenJTI &&
      user.refreshTokenJTI !== decoded.jti
    ) {
      return NextResponse.json(
        {
          message: "Session expired. Please sign in again.",
          code: "REFRESH_REUSE",
        },
        { status: 401 }
      );
    }

    if (user.accountDeleted) {
      await prisma.user.update({
        where: { id: user.id },
        data: { refreshTokenJTI: null },
      }).catch(() => undefined);
      return NextResponse.json(
        { message: "User Account deleted" },
        { status: 403 }
      );
    }

    // accountSuspended: still refresh cookies so /me can surface the lock
    // dialog; Fresh staff/commerce APIs fail-closed via requireAuthFresh.

    try {
      const { getStorefrontOrgId } = await import("@/lib/org");
      const { assertNotBlacklisted } = await import("@/lib/userBlacklist");
      const orgId = await getStorefrontOrgId();
      await assertNotBlacklisted(orgId, {
        email: user.email,
        phone: user.phoneNumber,
      });
    } catch (err) {
      const { isAuthHttpError } = await import("@/lib/auth/http-error");
      if (isAuthHttpError(err) && err.status === 403) {
        await prisma.user.update({
          where: { id: user.id },
          data: { refreshTokenJTI: null },
        }).catch(() => undefined);
        return NextResponse.json(
          { message: err.message },
          { status: 403 }
        );
      }
      throw err;
    }

    // Sticky primary org from the current access JWT (may be expired). Only
    // wins when an active Membership still exists on that org — never a
    // client-supplied orgId.
    const stickyOrgId = peekAccessTokenOrgId(
      req.cookies.get("access-token")?.value
    );
    const authz = await resolveAuthzForUser(user, {
      preferOrgId: stickyOrgId,
    });
    const newAccessToken = signAccessToken({
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

    const { token: newRefreshToken, jti: newJTI } = signRefreshToken(user.id);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenJTI: newJTI },
    });

    const response = new NextResponse(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });

    appendAuthSessionCookies(response, req, {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });

    return response;
    });
  } catch (error) {
    if (isTransientDbError(error)) {
      return routeErrorResponse(error, "Session refresh failed");
    }
    console.error(error);
    return NextResponse.json(
      { message: "Invalid or expired refresh token" },
      { status: 401 }
    );
  }
}
